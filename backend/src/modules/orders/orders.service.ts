import { db } from '../../config/db';
import { sql } from 'drizzle-orm';
import { ApiError } from '../../middlewares/errorHandler';
import { v4 as uuid } from 'uuid';
import { crmSyncService } from '../crm/crm-sync.service';

export class OrdersService {
  private migrationsRun = false;

  async ensureMigrations() {
    if (this.migrationsRun) return;
    try {
      // Ensure tables we JOIN on exist (they're normally created by their own modules,
      // but if orders loads first, the JOIN would crash)
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS cobros (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          company_id UUID NOT NULL,
          enterprise_id UUID,
          order_id UUID,
          invoice_id UUID,
          amount DECIMAL(12,2) NOT NULL DEFAULT 0,
          payment_method VARCHAR(50),
          bank_id UUID,
          reference VARCHAR(255),
          payment_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          notes TEXT,
          receipt_image TEXT,
          created_by UUID,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
      `).catch(() => {});

      await db.execute(sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS enterprise_id UUID`).catch(() => {});
      await db.execute(sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS bank_id UUID`).catch(() => {});
      await db.execute(sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS has_invoice BOOLEAN DEFAULT false`).catch(() => {});
      await db.execute(sql`ALTER TABLE order_items ADD COLUMN IF NOT EXISTS product_type VARCHAR(50) DEFAULT 'otro'`).catch(() => {});
      await db.execute(sql`ALTER TABLE order_items ADD COLUMN IF NOT EXISTS deduct_stock BOOLEAN DEFAULT false`).catch(() => {});
      await db.execute(sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS production_started_at TIMESTAMP WITH TIME ZONE`).catch(() => {});
      await db.execute(sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS cobro_id UUID`).catch(() => {});
      // Ensure quotes table has quote_number column (may not exist if quotes module hasn't run)
      await db.execute(sql`ALTER TABLE quotes ADD COLUMN IF NOT EXISTS quote_number INTEGER`).catch(() => {});
      this.migrationsRun = true;
    } catch (error) {
      console.error('Orders migrations error:', error);
    }
  }

  async getOrders(companyId: string, filters: {
    status?: string;
    product_type?: string;
    customer_id?: string;
    enterprise_id?: string;
    has_invoice?: string;
    search?: string;
    skip?: number;
    limit?: number;
  } = {}) {
    await this.ensureMigrations();
    try {
      const { status, product_type, customer_id, enterprise_id, has_invoice, search, skip = 0, limit = 50 } = filters;

      let whereClause = sql`o.company_id = ${companyId}`;

      if (status && status !== 'todos') {
        whereClause = sql`${whereClause} AND o.status = ${status}`;
      }
      if (product_type && product_type !== 'todos') {
        whereClause = sql`${whereClause} AND o.product_type = ${product_type}`;
      }
      if (customer_id) {
        whereClause = sql`${whereClause} AND o.customer_id = ${customer_id}`;
      }
      if (enterprise_id) {
        whereClause = sql`${whereClause} AND (o.enterprise_id = ${enterprise_id} OR c.enterprise_id = ${enterprise_id})`;
      }
      if (has_invoice === 'si') {
        whereClause = sql`${whereClause} AND o.has_invoice = true`;
      } else if (has_invoice === 'no') {
        whereClause = sql`${whereClause} AND o.has_invoice = false`;
      }
      if (search) {
        whereClause = sql`${whereClause} AND (o.title ILIKE ${'%' + search + '%'} OR c.name ILIKE ${'%' + search + '%'} OR e.name ILIKE ${'%' + search + '%'})`;
      }

      // Use a safe query that only JOINs core tables that are guaranteed to exist
      // Optional JOINs (cobros, quotes) are wrapped to handle missing tables/columns
      let selectExtra = sql``;
      let joinExtra = sql``;

      // Try to add cobros JOIN only if table and column exist
      try {
        await db.execute(sql`SELECT 1 FROM cobros LIMIT 0`);
        selectExtra = sql`${selectExtra}, CASE WHEN o.cobro_id IS NOT NULL THEN (SELECT json_build_object('id', cb2.id, 'amount', cb2.amount, 'payment_method', cb2.payment_method) FROM cobros cb2 WHERE cb2.id = o.cobro_id) ELSE NULL END as cobro`;
      } catch {
        selectExtra = sql`${selectExtra}, NULL as cobro`;
      }

      // Quote join is safe (quotes table created in config/db.ts)
      const result = await db.execute(sql`
        SELECT o.*,
          json_build_object('id', c.id, 'name', c.name, 'cuit', c.cuit) as customer,
          CASE WHEN e.id IS NOT NULL THEN json_build_object('id', e.id, 'name', e.name) ELSE
            CASE WHEN c.enterprise_id IS NOT NULL THEN (SELECT json_build_object('id', e2.id, 'name', e2.name) FROM enterprises e2 WHERE e2.id = c.enterprise_id) ELSE NULL END
          END as enterprise,
          CASE WHEN o.invoice_id IS NOT NULL THEN
            json_build_object('id', i.id, 'invoice_number', i.invoice_number, 'invoice_type', i.invoice_type, 'status', i.status, 'cae', i.cae)
          ELSE NULL END as invoice,
          CASE WHEN o.bank_id IS NOT NULL THEN json_build_object('id', bk.id, 'bank_name', bk.bank_name) ELSE NULL END as bank,
          CASE WHEN o.quote_id IS NOT NULL THEN json_build_object('id', qt.id, 'quote_number', qt.quote_number) ELSE NULL END as quote,
          COALESCE((SELECT json_agg(json_build_object('id',t.id,'name',t.name,'color',t.color)) FROM entity_tags et JOIN tags t ON et.tag_id=t.id WHERE et.entity_id=COALESCE(e.id, c.enterprise_id) AND et.entity_type='enterprise'),'[]'::json) as enterprise_tags,
          COALESCE((SELECT SUM(CAST(inv.total_amount AS decimal)) FROM invoices inv WHERE inv.order_id = o.id AND inv.status = 'authorized' AND (inv.fiscal_type = 'fiscal' OR inv.fiscal_type IS NULL)), 0) as invoiced_amount
          ${selectExtra}
        FROM orders o
        LEFT JOIN customers c ON o.customer_id = c.id
        LEFT JOIN enterprises e ON o.enterprise_id = e.id
        LEFT JOIN invoices i ON o.invoice_id = i.id
        LEFT JOIN banks bk ON o.bank_id = bk.id
        LEFT JOIN quotes qt ON o.quote_id = qt.id
        WHERE ${whereClause}
        ORDER BY o.created_at DESC
        LIMIT ${limit} OFFSET ${skip}
      `);

      const rows = (result as any).rows || result || [];

      // Get totals for summary
      const summaryResult = await db.execute(sql`
        SELECT
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE status = 'pendiente') as pendientes,
          COUNT(*) FILTER (WHERE status = 'en_produccion') as en_produccion,
          COUNT(*) FILTER (WHERE status = 'terminado') as terminados,
          COUNT(*) FILTER (WHERE status = 'entregado') as entregados,
          COALESCE((SELECT SUM(CAST(i.total_amount AS decimal)) FROM invoices i WHERE i.company_id = ${companyId} AND i.status = 'authorized' AND (i.fiscal_type = 'fiscal' OR i.fiscal_type IS NULL)), 0) as total_facturado,
          COALESCE(SUM(total_amount), 0) as total_pedidos
        FROM orders
        WHERE company_id = ${companyId}
      `);
      const summary = ((summaryResult as any).rows || summaryResult || [])[0] || {};

      return {
        items: rows,
        total: rows.length,
        summary: {
          total: parseInt(summary.total || '0'),
          pendientes: parseInt(summary.pendientes || '0'),
          en_produccion: parseInt(summary.en_produccion || '0'),
          terminados: parseInt(summary.terminados || '0'),
          entregados: parseInt(summary.entregados || '0'),
          total_facturado: parseFloat(summary.total_facturado || '0'),
          ganancia_total: parseFloat(summary.ganancia_total || '0'),
        },
      };
    } catch (error: any) {
      console.error('Get orders error:', error?.message || error);
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, `Failed to get orders: ${error?.message || 'unknown error'}`);
    }
  }

  async getOrder(companyId: string, orderId: string) {
    await this.ensureMigrations();
    try {
      const result = await db.execute(sql`
        SELECT o.*,
          json_build_object('id', c.id, 'name', c.name, 'cuit', c.cuit, 'email', c.email, 'phone', c.phone) as customer,
          CASE WHEN e.id IS NOT NULL THEN json_build_object('id', e.id, 'name', e.name) ELSE
            CASE WHEN c.enterprise_id IS NOT NULL THEN (SELECT json_build_object('id', e2.id, 'name', e2.name) FROM enterprises e2 WHERE e2.id = c.enterprise_id) ELSE NULL END
          END as enterprise,
          CASE WHEN o.invoice_id IS NOT NULL THEN
            json_build_object('id', i.id, 'invoice_number', i.invoice_number, 'invoice_type', i.invoice_type, 'status', i.status, 'total_amount', i.total_amount, 'cae', i.cae)
          ELSE NULL END as invoice,
          CASE WHEN o.bank_id IS NOT NULL THEN json_build_object('id', bk.id, 'bank_name', bk.bank_name) ELSE NULL END as bank,
          CASE WHEN o.quote_id IS NOT NULL THEN json_build_object('id', qt.id, 'quote_number', qt.quote_number) ELSE NULL END as quote,
          CASE WHEN o.cobro_id IS NOT NULL THEN json_build_object('id', cb.id, 'amount', cb.amount, 'payment_method', cb.payment_method) ELSE NULL END as cobro,
          COALESCE((SELECT json_agg(json_build_object('id',t.id,'name',t.name,'color',t.color)) FROM entity_tags et JOIN tags t ON et.tag_id=t.id WHERE et.entity_id=COALESCE(e.id, c.enterprise_id) AND et.entity_type='enterprise'),'[]'::json) as enterprise_tags
        FROM orders o
        LEFT JOIN customers c ON o.customer_id = c.id
        LEFT JOIN enterprises e ON o.enterprise_id = e.id
        LEFT JOIN invoices i ON o.invoice_id = i.id
        LEFT JOIN banks bk ON o.bank_id = bk.id
        LEFT JOIN quotes qt ON o.quote_id = qt.id
        LEFT JOIN cobros cb ON o.cobro_id = cb.id
        WHERE o.company_id = ${companyId} AND o.id = ${orderId}
      `);
      const rows = (result as any).rows || result || [];
      if (rows.length === 0) throw new ApiError(404, 'Order not found');

      // Get items
      const itemsResult = await db.execute(sql`
        SELECT oi.*, p.sku
        FROM order_items oi
        LEFT JOIN products p ON oi.product_id = p.id
        WHERE oi.order_id = ${orderId}
        ORDER BY oi.created_at ASC
      `);
      const items = (itemsResult as any).rows || itemsResult || [];

      // Get status history
      const historyResult = await db.execute(sql`
        SELECT sh.*, u.name as changed_by_name
        FROM order_status_history sh
        LEFT JOIN users u ON sh.changed_by = u.id
        WHERE sh.order_id = ${orderId}
        ORDER BY sh.created_at DESC
      `);
      const history = (historyResult as any).rows || historyResult || [];

      return { ...rows[0], items, status_history: history };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Failed to get order');
    }
  }

  async createOrder(companyId: string, userId: string, data: any) {
    await this.ensureMigrations();
    try {
      const orderId = uuid();

      // Generate order_number
      const numResult = await db.execute(sql`
        SELECT COALESCE(MAX(order_number), 0) + 1 as next_number FROM orders WHERE company_id = ${companyId}
      `);
      const numRows = (numResult as any).rows || numResult || [];
      const orderNumber = parseInt(numRows[0]?.next_number || '1');

      // Auto-resolve enterprise_id from customer if not provided
      let enterpriseId = data.enterprise_id || null;
      if (!enterpriseId && data.customer_id) {
        const custResult = await db.execute(sql`SELECT enterprise_id FROM customers WHERE id = ${data.customer_id}`);
        const custRows = (custResult as any).rows || custResult || [];
        if (custRows.length > 0 && custRows[0].enterprise_id) {
          enterpriseId = custRows[0].enterprise_id;
        }
      }

      // Calculate totals from items
      let subtotal = 0;
      let totalCost = 0;
      if (data.items && Array.isArray(data.items)) {
        for (const item of data.items) {
          subtotal += Number(item.unit_price) * Number(item.quantity);
          totalCost += Number(item.cost || 0) * Number(item.quantity);
        }
      } else {
        subtotal = Number(data.total_amount || 0);
      }

      const vatRate = Number(data.vat_rate || 21);
      const totalWithVat = subtotal * (1 + vatRate / 100);
      const estimatedProfit = subtotal - totalCost;

      // Derive order-level product_type from items
      let orderProductType = data.product_type || 'otro';
      if (data.items && Array.isArray(data.items) && data.items.length > 0) {
        const itemTypes = new Set(data.items.map((i: any) => i.product_type || 'otro'));
        orderProductType = itemTypes.size === 1 ? data.items[0].product_type || 'otro' : 'mixto';
      }

      await db.execute(sql`
        INSERT INTO orders (id, company_id, customer_id, enterprise_id, bank_id, order_number, title, description, product_type, status, priority, quantity, unit_price, total_amount, vat_rate, estimated_profit, estimated_delivery, payment_method, payment_status, notes, created_by)
        VALUES (${orderId}, ${companyId}, ${data.customer_id || null}, ${enterpriseId}, ${data.bank_id || null}, ${orderNumber}, ${data.title}, ${data.description || null}, ${orderProductType}, 'pendiente', ${data.priority || 'normal'}, ${data.quantity || 1}, ${subtotal.toString()}, ${totalWithVat.toString()}, ${vatRate.toString()}, ${estimatedProfit.toString()}, ${data.estimated_delivery || null}, ${data.payment_method || null}, 'pendiente', ${data.notes || null}, ${userId})
      `);

      // Insert items
      if (data.items && Array.isArray(data.items)) {
        for (const item of data.items) {
          const itemSubtotal = Number(item.unit_price) * Number(item.quantity);
          await db.execute(sql`
            INSERT INTO order_items (id, order_id, product_id, product_name, description, quantity, unit_price, cost, subtotal, product_type, deduct_stock)
            VALUES (${uuid()}, ${orderId}, ${item.product_id || null}, ${item.product_name}, ${item.description || null}, ${item.quantity}, ${item.unit_price.toString()}, ${(item.cost || 0).toString()}, ${itemSubtotal.toString()}, ${item.product_type || 'otro'}, ${item.deduct_stock || false})
          `);
        }
      }

      // Record initial status
      await db.execute(sql`
        INSERT INTO order_status_history (id, order_id, new_status, notes, changed_by)
        VALUES (${uuid()}, ${orderId}, 'pendiente', 'Pedido creado', ${userId})
      `);

      // Deduct stock for items where deduct_stock is true
      if (data.items && Array.isArray(data.items)) {
        const itemsToDeduct = data.items.filter((i: any) => i.deduct_stock);
        if (itemsToDeduct.length > 0) {
          await this.deductStockForOrder(companyId, orderId, userId, itemsToDeduct);
        }
      }

      // CRM Pipeline sync: order_created
      try {
        // If order has a quote_id, link both to same deal
        if (data.quote_id) {
          const existingDeal = await crmSyncService.findDealByRelatedDocument(companyId, data.quote_id, 'quote');
          if (existingDeal) {
            await crmSyncService.linkDocumentToDeal(existingDeal.id, 'order', orderId);
          }
        }
        await crmSyncService.handleEvent({
          companyId,
          event: 'order_created',
          enterpriseId: enterpriseId || undefined,
          customerId: data.customer_id || undefined,
          documentId: orderId,
          documentType: 'order',
          metadata: { title: `Pedido #${orderNumber}`, amount: totalWithVat },
        });
      } catch (e) { console.error('CRM sync error (order_created):', e); }

      return { id: orderId, status: 'pendiente' };
    } catch (error) {
      console.error('Create order error:', error);
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Failed to create order');
    }
  }

  async updateOrderStatus(companyId: string, userId: string, orderId: string, data: { status: string; notes?: string }) {
    try {
      // Verify order belongs to company
      const orderResult = await db.execute(sql`
        SELECT id, status FROM orders WHERE id = ${orderId} AND company_id = ${companyId}
      `);
      const orderRows = (orderResult as any).rows || orderResult || [];
      if (orderRows.length === 0) throw new ApiError(404, 'Order not found');

      const oldStatus = orderRows[0].status;
      const newStatus = data.status;

      await db.execute(sql`
        UPDATE orders SET status = ${newStatus}, updated_at = NOW()
        ${newStatus === 'entregado' ? sql`, actual_delivery = NOW()` : sql``}
        ${newStatus === 'en_produccion' ? sql`, production_started_at = NOW()` : sql``}
        WHERE id = ${orderId}
      `);

      await db.execute(sql`
        INSERT INTO order_status_history (id, order_id, old_status, new_status, notes, changed_by)
        VALUES (${uuid()}, ${orderId}, ${oldStatus}, ${newStatus}, ${data.notes || null}, ${userId})
      `);

      // BOM stock deduction
      if (newStatus === 'en_produccion') {
        await this.deductBOMFromStock(companyId, orderId, userId);
      }
      if (newStatus === 'cancelado' && oldStatus === 'en_produccion') {
        await this.reverseBOMStockDeduction(companyId, orderId, userId);
      }

      // CRM Pipeline sync: order status changes
      try {
        const orderData = await db.execute(sql`
          SELECT enterprise_id, customer_id, order_number, total_amount FROM orders WHERE id = ${orderId}
        `);
        const od = ((orderData as any).rows || [])[0];
        if (od) {
          let crmEvent: string | null = null;
          if (newStatus === 'en_produccion') crmEvent = 'order_in_production';
          else if (newStatus === 'entregado') crmEvent = 'order_delivered';
          else if (newStatus === 'cancelado') crmEvent = 'order_cancelled';

          if (crmEvent) {
            await crmSyncService.handleEvent({
              companyId,
              event: crmEvent,
              enterpriseId: od.enterprise_id || undefined,
              customerId: od.customer_id || undefined,
              documentId: orderId,
              documentType: 'order',
              metadata: { title: `Pedido #${od.order_number || ''}`, amount: parseFloat(od.total_amount || '0') },
            });
          }
        }
      } catch (e) { console.error('CRM sync error (order_status):', e); }

      return { id: orderId, old_status: oldStatus, new_status: newStatus };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Failed to update order status');
    }
  }

  async checkBOMAvailability(companyId: string, orderId: string) {
    try {
      const itemsResult = await db.execute(sql`
        SELECT product_id, CAST(quantity AS decimal) as quantity, product_name
        FROM order_items WHERE order_id = ${orderId} AND product_id IS NOT NULL
      `);
      const items = (itemsResult as any).rows || [];

      const checkItems: { product_name: string; required: number; available: number; sufficient: boolean }[] = [];

      for (const item of items) {
        const compsResult = await db.execute(sql`
          SELECT pc.component_product_id, CAST(pc.quantity_required AS decimal) as quantity_required, p.name as component_name
          FROM product_components pc
          JOIN products p ON pc.component_product_id = p.id
          WHERE pc.product_id = ${item.product_id} AND pc.company_id = ${companyId}
        `);
        const comps = (compsResult as any).rows || [];
        if (comps.length === 0) continue;

        // Get default warehouse
        const whResult = await db.execute(sql`SELECT id FROM warehouses WHERE company_id = ${companyId} LIMIT 1`);
        const warehouseId = ((whResult as any).rows || [])[0]?.id;
        if (!warehouseId) continue;

        for (const comp of comps) {
          const needed = parseFloat(comp.quantity_required) * parseFloat(item.quantity);
          const stockResult = await db.execute(sql`
            SELECT CAST(quantity AS decimal) as quantity FROM stock
            WHERE product_id = ${comp.component_product_id} AND warehouse_id = ${warehouseId}
          `);
          const stockRows = (stockResult as any).rows || [];
          const available = stockRows.length > 0 ? parseFloat(stockRows[0].quantity) : 0;

          checkItems.push({
            product_name: comp.component_name,
            required: needed,
            available,
            sufficient: available >= needed,
          });
        }
      }

      const allAvailable = checkItems.length === 0 || checkItems.every(i => i.sufficient);
      return { available: allAvailable, items: checkItems };
    } catch (error) {
      console.warn('BOM availability check warning:', error);
      return { available: true, items: [] };
    }
  }

  private async deductBOMFromStock(companyId: string, orderId: string, userId: string) {
    try {
      const itemsResult = await db.execute(sql`
        SELECT product_id, CAST(quantity AS decimal) as quantity
        FROM order_items WHERE order_id = ${orderId} AND product_id IS NOT NULL
      `);
      const items = (itemsResult as any).rows || [];

      for (const item of items) {
        const compsResult = await db.execute(sql`
          SELECT component_product_id, CAST(quantity_required AS decimal) as quantity_required
          FROM product_components
          WHERE product_id = ${item.product_id} AND company_id = ${companyId}
        `);
        const comps = (compsResult as any).rows || [];
        if (comps.length === 0) continue;

        for (const comp of comps) {
          const needed = parseFloat(comp.quantity_required) * parseFloat(item.quantity);
          // Get default warehouse
          const whResult = await db.execute(sql`SELECT id FROM warehouses WHERE company_id = ${companyId} LIMIT 1`);
          const warehouseId = ((whResult as any).rows || [])[0]?.id;
          if (!warehouseId) continue;

          // Create stock movement
          await db.execute(sql`
            INSERT INTO stock_movements (id, product_id, warehouse_id, movement_type, quantity, reference_type, reference_id, notes, created_by)
            VALUES (${uuid()}, ${comp.component_product_id}, ${warehouseId}, 'sale', ${needed.toString()}, 'order', ${orderId}, ${'BOM: descuento por produccion'}, ${userId})
          `);

          // Update stock
          await db.execute(sql`
            UPDATE stock SET quantity = CAST(GREATEST(CAST(quantity AS decimal) - ${needed}, 0) AS VARCHAR), updated_at = NOW()
            WHERE product_id = ${comp.component_product_id} AND warehouse_id = ${warehouseId}
          `);
        }
      }
    } catch (error) {
      console.warn('BOM stock deduction warning:', error);
    }
  }

  private async reverseBOMStockDeduction(companyId: string, orderId: string, userId: string) {
    try {
      const movementsResult = await db.execute(sql`
        SELECT product_id, warehouse_id, CAST(quantity AS decimal) as quantity
        FROM stock_movements
        WHERE reference_type = 'order' AND reference_id = ${orderId} AND movement_type = 'sale'
      `);
      const movements = (movementsResult as any).rows || [];

      for (const mov of movements) {
        await db.execute(sql`
          INSERT INTO stock_movements (id, product_id, warehouse_id, movement_type, quantity, reference_type, reference_id, notes, created_by)
          VALUES (${uuid()}, ${mov.product_id}, ${mov.warehouse_id}, 'adjustment', ${mov.quantity.toString()}, 'order_reversal', ${orderId}, ${'BOM: devolucion por cancelacion'}, ${userId})
        `);
        await db.execute(sql`
          UPDATE stock SET quantity = CAST(CAST(quantity AS decimal) + ${parseFloat(mov.quantity)} AS VARCHAR), updated_at = NOW()
          WHERE product_id = ${mov.product_id} AND warehouse_id = ${mov.warehouse_id}
        `);
      }
    } catch (error) {
      console.warn('BOM stock reversal warning:', error);
    }
  }

  private async deductStockForOrder(companyId: string, orderId: string, userId: string, items: any[]) {
    try {
      // Get default warehouse
      const whResult = await db.execute(sql`SELECT id FROM warehouses WHERE company_id = ${companyId} LIMIT 1`);
      const warehouseId = ((whResult as any).rows || [])[0]?.id;
      if (!warehouseId) return;

      for (const item of items) {
        if (!item.product_id || item.product_id === 'custom') continue;

        // Check if product has controls_stock=true
        const productResult = await db.execute(sql`
          SELECT id, controls_stock FROM products WHERE id = ${item.product_id} AND company_id = ${companyId}
        `);
        const productRows = (productResult as any).rows || productResult || [];
        if (productRows.length === 0 || !productRows[0].controls_stock) continue;

        const quantity = parseFloat(String(item.quantity)) || 0;
        if (quantity <= 0) continue;

        // Create stock movement
        await db.execute(sql`
          INSERT INTO stock_movements (id, product_id, warehouse_id, movement_type, quantity, reference_type, reference_id, notes, created_by)
          VALUES (${uuid()}, ${item.product_id}, ${warehouseId}, 'sale', ${quantity.toString()}, 'order', ${orderId}, ${'Descuento por pedido'}, ${userId})
        `);

        // Update stock
        await db.execute(sql`
          UPDATE stock SET quantity = CAST(GREATEST(CAST(quantity AS decimal) - ${quantity}, 0) AS VARCHAR), updated_at = NOW()
          WHERE product_id = ${item.product_id} AND warehouse_id = ${warehouseId}
        `);
      }
    } catch (error) {
      console.warn('Stock deduction for order warning:', error);
    }
  }

  async updateOrder(companyId: string, orderId: string, data: any) {
    await this.ensureMigrations();
    try {
      const orderResult = await db.execute(sql`
        SELECT id FROM orders WHERE id = ${orderId} AND company_id = ${companyId}
      `);
      const rows = (orderResult as any).rows || orderResult || [];
      if (rows.length === 0) throw new ApiError(404, 'Order not found');

      // Helper: undefined = keep old value, '' = set null, value = set value
      const v = (field: any) => field !== undefined ? (field === '' ? null : field) : undefined;

      await db.execute(sql`
        UPDATE orders SET
          title = CASE WHEN ${data.title !== undefined} THEN ${v(data.title)} ELSE title END,
          description = CASE WHEN ${data.description !== undefined} THEN ${v(data.description)} ELSE description END,
          product_type = CASE WHEN ${data.product_type !== undefined} THEN ${v(data.product_type)} ELSE product_type END,
          priority = CASE WHEN ${data.priority !== undefined} THEN ${v(data.priority)} ELSE priority END,
          customer_id = CASE WHEN ${data.customer_id !== undefined} THEN ${v(data.customer_id)} ELSE customer_id END,
          enterprise_id = CASE WHEN ${data.enterprise_id !== undefined} THEN ${v(data.enterprise_id)} ELSE enterprise_id END,
          bank_id = CASE WHEN ${data.bank_id !== undefined} THEN ${v(data.bank_id)} ELSE bank_id END,
          invoice_id = CASE WHEN ${data.invoice_id !== undefined} THEN ${v(data.invoice_id)} ELSE invoice_id END,
          has_invoice = CASE WHEN ${data.has_invoice !== undefined} THEN ${data.has_invoice ?? null} ELSE has_invoice END,
          estimated_delivery = CASE WHEN ${data.estimated_delivery !== undefined} THEN ${v(data.estimated_delivery)} ELSE estimated_delivery END,
          payment_method = CASE WHEN ${data.payment_method !== undefined} THEN ${v(data.payment_method)} ELSE payment_method END,
          payment_status = CASE WHEN ${data.payment_status !== undefined} THEN ${v(data.payment_status)} ELSE payment_status END,
          notes = CASE WHEN ${data.notes !== undefined} THEN ${v(data.notes)} ELSE notes END,
          production_started_at = CASE WHEN ${data.production_started_at !== undefined} THEN ${v(data.production_started_at)} ELSE production_started_at END,
          updated_at = NOW()
        WHERE id = ${orderId}
      `);

      // Update items if provided (delete + re-insert)
      if (data.items && Array.isArray(data.items) && data.items.length > 0) {
        // Unlink invoice_items before deleting order_items (FK constraint)
        await db.execute(sql`
          UPDATE invoice_items SET order_item_id = NULL
          WHERE order_item_id IN (SELECT id FROM order_items WHERE order_id = ${orderId})
        `).catch((err) => console.warn('Unlink invoice_items (non-critical):', err.message));
        await db.execute(sql`DELETE FROM order_items WHERE order_id = ${orderId}`);

        const validItems = data.items.filter((it: any) => it.product_name && String(it.product_name).trim());
        if (validItems.length === 0) throw new ApiError(400, 'At least one item with a product name is required');

        let subtotal = 0;
        for (const item of validItems) {
          const itemSubtotal = Number(item.unit_price || 0) * Number(item.quantity || 1);
          subtotal += itemSubtotal;
          const productId = item.product_id && item.product_id !== 'custom' ? item.product_id : null;
          await db.execute(sql`
            INSERT INTO order_items (id, order_id, product_id, product_name, description, quantity, unit_price, cost, subtotal, product_type, deduct_stock)
            VALUES (${uuid()}, ${orderId}, ${productId}, ${item.product_name}, ${item.description || null}, ${item.quantity || 1}, ${(item.unit_price || 0).toString()}, ${(item.cost || 0).toString()}, ${itemSubtotal.toString()}, ${item.product_type || 'otro'}, ${item.deduct_stock || false})
          `);
        }

        // Recalculate totals
        const vatRate = data.vat_rate !== undefined ? Number(data.vat_rate) : 21;
        const vatAmount = subtotal * vatRate / 100;
        const totalWithVat = subtotal + vatAmount;
        await db.execute(sql`
          UPDATE orders SET
            total_amount = ${totalWithVat.toString()},
            vat_rate = ${vatRate.toString()},
            updated_at = NOW()
          WHERE id = ${orderId}
        `);
      }

      return { id: orderId, updated: true };
    } catch (error) {
      console.error('Update order error:', error);
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Failed to update order');
    }
  }

  async linkInvoice(companyId: string, orderId: string, invoiceId: string) {
    try {
      await db.execute(sql`
        UPDATE orders SET invoice_id = ${invoiceId}, has_invoice = true, updated_at = NOW()
        WHERE id = ${orderId} AND company_id = ${companyId}
      `);
      return { id: orderId, invoice_id: invoiceId };
    } catch (error) {
      throw new ApiError(500, 'Failed to link invoice');
    }
  }

  async deleteOrder(companyId: string, orderId: string) {
    try {
      const orderResult = await db.execute(sql`
        SELECT id FROM orders WHERE id = ${orderId} AND company_id = ${companyId}
      `);
      const rows = (orderResult as any).rows || orderResult || [];
      if (rows.length === 0) throw new ApiError(404, 'Pedido no encontrado');

      await db.execute(sql`DELETE FROM order_status_history WHERE order_id = ${orderId}`);
      await db.execute(sql`DELETE FROM order_items WHERE order_id = ${orderId}`);
      await db.execute(sql`UPDATE cheques SET order_id = NULL WHERE order_id = ${orderId}`);
      await db.execute(sql`DELETE FROM orders WHERE id = ${orderId} AND company_id = ${companyId}`);

      return { id: orderId, deleted: true };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Failed to delete order');
    }
  }

  async getOrdersWithoutInvoice(companyId: string) {
    try {
      const result = await db.execute(sql`
        SELECT o.id, o.order_number, o.title, o.total_amount, c.name as customer_name,
          CASE WHEN e.id IS NOT NULL THEN json_build_object('id', e.id, 'name', e.name)
          ELSE CASE WHEN c.enterprise_id IS NOT NULL THEN (SELECT json_build_object('id', e2.id, 'name', e2.name) FROM enterprises e2 WHERE e2.id = c.enterprise_id) ELSE NULL END
          END as enterprise,
          COALESCE((SELECT json_agg(json_build_object('id',t.id,'name',t.name,'color',t.color)) FROM entity_tags et JOIN tags t ON et.tag_id=t.id WHERE et.entity_id=COALESCE(e.id, c.enterprise_id) AND et.entity_type='enterprise'),'[]'::json) as enterprise_tags
        FROM orders o
        LEFT JOIN customers c ON o.customer_id = c.id
        LEFT JOIN enterprises e ON o.enterprise_id = e.id
        WHERE o.company_id = ${companyId}
          AND (o.has_invoice = false OR o.has_invoice IS NULL)
          AND o.status != 'cancelado'
        ORDER BY o.created_at DESC
      `);
      return (result as any).rows || result || [];
    } catch (error) {
      throw new ApiError(500, 'Failed to get orders without invoice');
    }
  }

  async getInvoicingStatus(companyId: string, orderId: string) {
    await this.ensureMigrations();
    try {
      // Ensure invoice_items has order_item_id column
      await db.execute(sql`ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS order_item_id UUID REFERENCES order_items(id)`).catch(() => {});

      // Get all items with invoiced quantities
      const itemsResult = await db.execute(sql`
        SELECT oi.*,
          COALESCE((
            SELECT SUM(CAST(ii.quantity AS decimal))
            FROM invoice_items ii
            WHERE ii.order_item_id = oi.id
          ), 0) as invoiced_qty
        FROM order_items oi
        WHERE oi.order_id = ${orderId}
        ORDER BY oi.created_at ASC
      `);
      const items = (itemsResult as any).rows || [];

      // Get linked invoices
      const invoicesResult = await db.execute(sql`
        SELECT i.id, i.invoice_number, i.invoice_type, i.status, i.total_amount, i.cae,
          i.fiscal_type,
          (i.afip_response->'FeCabResp'->>'PtoVta')::int as punto_venta
        FROM invoices i
        WHERE i.order_id = ${orderId} AND i.company_id = ${companyId}
        ORDER BY i.created_at ASC
      `);
      const invoicesList = (invoicesResult as any).rows || [];

      // Calculate invoicing status
      const mappedItems = items.map((i: any) => ({
        ...i,
        quantity: parseFloat(i.quantity || '0'),
        invoiced_qty: parseFloat(i.invoiced_qty || '0'),
        pending_qty: Math.max(0, parseFloat(i.quantity || '0') - parseFloat(i.invoiced_qty || '0')),
      }));

      const allInvoiced = mappedItems.length > 0 && mappedItems.every((i: any) => i.invoiced_qty >= i.quantity);
      const anyInvoiced = mappedItems.some((i: any) => i.invoiced_qty > 0);
      const invoicingStatus = allInvoiced ? 'facturado' : anyInvoiced ? 'parcial' : 'sin_facturar';

      return {
        order_id: orderId,
        invoicing_status: invoicingStatus,
        items: mappedItems,
        invoices: invoicesList,
      };
    } catch (error) {
      console.error('Get invoicing status error:', error);
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Failed to get invoicing status');
    }
  }

  async getUninvoicedItems(companyId: string, orderId: string) {
    await this.ensureMigrations();
    try {
      await db.execute(sql`ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS order_item_id UUID REFERENCES order_items(id)`).catch(() => {});

      const result = await db.execute(sql`
        SELECT oi.*,
          COALESCE((
            SELECT SUM(CAST(ii.quantity AS decimal))
            FROM invoice_items ii
            WHERE ii.order_item_id = oi.id
          ), 0) as invoiced_qty,
          CAST(oi.quantity AS decimal) - COALESCE((
            SELECT SUM(CAST(ii.quantity AS decimal))
            FROM invoice_items ii
            WHERE ii.order_item_id = oi.id
          ), 0) as pending_qty
        FROM order_items oi
        WHERE oi.order_id = ${orderId}
        ORDER BY oi.created_at ASC
      `);
      const items = (result as any).rows || [];
      return items.map((i: any) => ({
        ...i,
        quantity: parseFloat(i.quantity || '0'),
        invoiced_qty: parseFloat(i.invoiced_qty || '0'),
        pending_qty: Math.max(0, parseFloat(i.pending_qty || '0')),
      }));
    } catch (error) {
      console.error('Get uninvoiced items error:', error);
      throw new ApiError(500, 'Failed to get uninvoiced items');
    }
  }
}

export const ordersService = new OrdersService();
