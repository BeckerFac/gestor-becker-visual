import { db } from '../../config/db';
import { sql } from 'drizzle-orm';
import { ApiError } from '../../middlewares/errorHandler';
import { v4 as uuid } from 'uuid';

export class OrdersService {
  private migrationsRun = false;

  async ensureMigrations() {
    if (this.migrationsRun) return;
    try {
      await db.execute(sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS enterprise_id UUID REFERENCES enterprises(id)`);
      await db.execute(sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS bank_id UUID REFERENCES banks(id)`);
      await db.execute(sql`ALTER TABLE order_items ADD COLUMN IF NOT EXISTS product_type VARCHAR(50) DEFAULT 'otro'`);
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

      const result = await db.execute(sql`
        SELECT o.*,
          json_build_object('id', c.id, 'name', c.name, 'cuit', c.cuit) as customer,
          CASE WHEN e.id IS NOT NULL THEN json_build_object('id', e.id, 'name', e.name) ELSE
            CASE WHEN c.enterprise_id IS NOT NULL THEN (SELECT json_build_object('id', e2.id, 'name', e2.name) FROM enterprises e2 WHERE e2.id = c.enterprise_id) ELSE NULL END
          END as enterprise,
          CASE WHEN o.invoice_id IS NOT NULL THEN
            json_build_object('id', i.id, 'invoice_number', i.invoice_number, 'invoice_type', i.invoice_type, 'status', i.status, 'punto_venta', (i.afip_response->'FeCabResp'->>'PtoVta')::int, 'cae', i.cae)
          ELSE NULL END as invoice,
          CASE WHEN o.bank_id IS NOT NULL THEN json_build_object('id', bk.id, 'bank_name', bk.bank_name) ELSE NULL END as bank
        FROM orders o
        LEFT JOIN customers c ON o.customer_id = c.id
        LEFT JOIN enterprises e ON o.enterprise_id = e.id
        LEFT JOIN invoices i ON o.invoice_id = i.id
        LEFT JOIN banks bk ON o.bank_id = bk.id
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
          COALESCE(SUM(total_amount), 0) as total_facturado,
          COALESCE(SUM(estimated_profit), 0) as ganancia_total
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
    } catch (error) {
      console.error('Get orders error:', error);
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Failed to get orders');
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
          CASE WHEN o.bank_id IS NOT NULL THEN json_build_object('id', bk.id, 'bank_name', bk.bank_name) ELSE NULL END as bank
        FROM orders o
        LEFT JOIN customers c ON o.customer_id = c.id
        LEFT JOIN enterprises e ON o.enterprise_id = e.id
        LEFT JOIN invoices i ON o.invoice_id = i.id
        LEFT JOIN banks bk ON o.bank_id = bk.id
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
            INSERT INTO order_items (id, order_id, product_id, product_name, description, quantity, unit_price, cost, subtotal, product_type)
            VALUES (${uuid()}, ${orderId}, ${item.product_id || null}, ${item.product_name}, ${item.description || null}, ${item.quantity}, ${item.unit_price.toString()}, ${(item.cost || 0).toString()}, ${itemSubtotal.toString()}, ${item.product_type || 'otro'})
          `);
        }
      }

      // Record initial status
      await db.execute(sql`
        INSERT INTO order_status_history (id, order_id, new_status, notes, changed_by)
        VALUES (${uuid()}, ${orderId}, 'pendiente', 'Pedido creado', ${userId})
      `);

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
        WHERE id = ${orderId}
      `);

      await db.execute(sql`
        INSERT INTO order_status_history (id, order_id, old_status, new_status, notes, changed_by)
        VALUES (${uuid()}, ${orderId}, ${oldStatus}, ${newStatus}, ${data.notes || null}, ${userId})
      `);

      return { id: orderId, old_status: oldStatus, new_status: newStatus };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Failed to update order status');
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

      await db.execute(sql`
        UPDATE orders SET
          title = COALESCE(${data.title || null}, title),
          description = COALESCE(${data.description || null}, description),
          product_type = COALESCE(${data.product_type || null}, product_type),
          priority = COALESCE(${data.priority || null}, priority),
          customer_id = COALESCE(${data.customer_id || null}, customer_id),
          enterprise_id = COALESCE(${data.enterprise_id || null}, enterprise_id),
          bank_id = COALESCE(${data.bank_id || null}, bank_id),
          invoice_id = COALESCE(${data.invoice_id || null}, invoice_id),
          has_invoice = COALESCE(${data.has_invoice ?? null}, has_invoice),
          estimated_delivery = COALESCE(${data.estimated_delivery || null}, estimated_delivery),
          payment_method = COALESCE(${data.payment_method || null}, payment_method),
          payment_status = COALESCE(${data.payment_status || null}, payment_status),
          notes = COALESCE(${data.notes || null}, notes),
          updated_at = NOW()
        WHERE id = ${orderId}
      `);

      return { id: orderId, updated: true };
    } catch (error) {
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
          END as enterprise
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
