import { db } from '../../config/db';
import { invoices, invoice_items, customers } from '../../db/schema';
import { eq, and, sql, desc } from 'drizzle-orm';
import { ApiError } from '../../middlewares/errorHandler';
import { v4 as uuid } from 'uuid';
import { afipService, AfipService, AuthorizeInvoiceInput } from '../afip/afip.service';
import { crmSyncService } from '../crm/crm-sync.service';

function validateNumeric(value: unknown, fieldName: string, { min = 0, max = Infinity, allowZero = true } = {}): number {
  const num = Number(value);
  if (!Number.isFinite(num)) throw new ApiError(400, `${fieldName} debe ser un numero valido`);
  if (num < min) throw new ApiError(400, `${fieldName} no puede ser menor a ${min}`);
  if (num > max) throw new ApiError(400, `${fieldName} no puede ser mayor a ${max}`);
  if (!allowZero && num === 0) throw new ApiError(400, `${fieldName} no puede ser cero`);
  return num;
}

export class InvoicesService {
  private migrationsRun = false;

  async ensureMigrations() {
    if (this.migrationsRun) return;
    try {
      await db.execute(sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS order_id UUID REFERENCES orders(id)`);
      await db.execute(sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS enterprise_id UUID REFERENCES enterprises(id)`);
      await db.execute(sql`ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS order_item_id UUID REFERENCES order_items(id)`);
      await db.execute(sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS fiscal_type VARCHAR(20) DEFAULT 'fiscal'`);
      await db.execute(sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS source VARCHAR(30) DEFAULT 'system'`);
      // Add 'emitido' status value for internal vouchers
      await db.execute(sql`ALTER TYPE invoice_status ADD VALUE IF NOT EXISTS 'emitido'`).catch(() => {});

      // FCE MiPyME columns
      await db.execute(sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS is_fce BOOLEAN DEFAULT false`);
      await db.execute(sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS fce_payment_due_date DATE`);
      await db.execute(sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS fce_cbu VARCHAR(22)`);
      await db.execute(sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS fce_status VARCHAR(20) DEFAULT 'pendiente'`);

      // Company CBU fields for FCE
      await db.execute(sql`ALTER TABLE companies ADD COLUMN IF NOT EXISTS cbu VARCHAR(22)`);
      await db.execute(sql`ALTER TABLE companies ADD COLUMN IF NOT EXISTS cbu_alias VARCHAR(50)`);

      // Export invoice (Tipo E) columns
      await db.execute(sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS export_type VARCHAR(20)`);
      await db.execute(sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS destination_country VARCHAR(5)`);
      await db.execute(sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS incoterms VARCHAR(10)`);
      await db.execute(sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS export_permit VARCHAR(50)`);

      // MercadoPago payment link columns
      await db.execute(sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS payment_link_url TEXT`);
      await db.execute(sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS payment_link_id VARCHAR(100)`);

      // AFIP service concept fields
      await db.execute(sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS concepto INTEGER DEFAULT 1`);
      await db.execute(sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS fch_serv_desde DATE`);
      await db.execute(sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS fch_serv_hasta DATE`);
      await db.execute(sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS fch_vto_pago DATE`);

      this.migrationsRun = true;
    } catch (error) {
      console.error('Invoices migrations error:', error);
    }
  }

  async createInvoice(companyId: string, userId: string, data: any) {
    await this.ensureMigrations();
    try {
      const invoiceId = uuid();
      const fiscalType = data.fiscal_type === 'interno' ? 'interno' : (data.fiscal_type === 'no_fiscal' ? 'no_fiscal' : 'fiscal');
      const invoiceType = (fiscalType === 'interno' || fiscalType === 'no_fiscal') ? null : (data.invoice_type || 'B');

      // Get next sequential invoice number — separate sequences for fiscal vs internal
      let nextNumber: number;
      if (fiscalType === 'interno' || fiscalType === 'no_fiscal') {
        const maxResult = await db.execute(sql`
          SELECT COALESCE(MAX(invoice_number), 0) + 1 as next_number
          FROM invoices WHERE company_id = ${companyId} AND fiscal_type = ${fiscalType}
        `);
        const rows = (maxResult as any).rows || maxResult || [];
        nextNumber = parseInt(rows[0]?.next_number || '1');
      } else {
        const maxResult = await db.execute(sql`
          SELECT COALESCE(MAX(invoice_number), 0) + 1 as next_number
          FROM invoices WHERE company_id = ${companyId} AND invoice_type = ${invoiceType}
            AND (fiscal_type = 'fiscal' OR fiscal_type IS NULL)
        `);
        const rows = (maxResult as any).rows || maxResult || [];
        nextNumber = parseInt(rows[0]?.next_number || '1');
      }

      // Resolve enterprise_id from customer if not provided
      let enterpriseId = data.enterprise_id || null;
      if (!enterpriseId && data.customer_id) {
        const custResult = await db.execute(sql`SELECT enterprise_id FROM customers WHERE id = ${data.customer_id}`);
        const custRows = (custResult as any).rows || custResult || [];
        if (custRows[0]?.enterprise_id) enterpriseId = custRows[0].enterprise_id;
      }

      if (fiscalType === 'interno' || fiscalType === 'no_fiscal') {
        // Internal/no-fiscal vouchers: raw SQL insert (invoice_type can be NULL, status = 'emitido')
        await db.execute(sql`
          INSERT INTO invoices (id, company_id, customer_id, invoice_type, invoice_number, invoice_date,
            subtotal, vat_amount, total_amount, status, fiscal_type, created_by, created_at, updated_at)
          VALUES (${invoiceId}, ${companyId}, ${data.customer_id || null}, NULL, ${nextNumber}, NOW(),
            '0', '0', '0', 'emitido', ${fiscalType}, ${userId}, NOW(), NOW())
        `);
      } else {
        await db.insert(invoices).values({
          id: invoiceId,
          company_id: companyId,
          customer_id: data.customer_id,
          invoice_type: invoiceType!,
          invoice_number: nextNumber,
          invoice_date: new Date(),
          subtotal: '0',
          vat_amount: '0',
          total_amount: '0',
          status: 'draft',
          created_by: userId,
        }).returning();
      }

      // Set order_id, enterprise_id and fiscal_type via raw SQL (columns added by migration)
      await db.execute(sql`
        UPDATE invoices SET order_id = ${data.order_id || null}, enterprise_id = ${enterpriseId},
          fiscal_type = ${fiscalType}
        WHERE id = ${invoiceId}
      `);

      // Add items
      if (data.items && Array.isArray(data.items)) {
        let subtotal = 0;
        let vatAmount = 0;

        for (const item of data.items) {
          // If creating from order_item, resolve product data from order_items
          let productId = item.product_id || null;
          let productName = item.product_name || '';
          let unitPrice = validateNumeric(item.unit_price || 0, 'Precio unitario', { min: 0, max: 999999999 });
          let vatRate = validateNumeric(item.vat_rate || 21, 'Tasa IVA', { min: 0, max: 100 });

          if (item.order_item_id) {
            const oiResult = await db.execute(sql`
              SELECT product_id, product_name, unit_price FROM order_items WHERE id = ${item.order_item_id}
            `);
            const oiRows = (oiResult as any).rows || oiResult || [];
            if (oiRows.length > 0) {
              const oi = oiRows[0];
              productId = productId || oi.product_id || null;
              productName = productName || oi.product_name || '';
              unitPrice = unitPrice || parseFloat(oi.unit_price || '0');
            }

            // Also resolve customer_id and enterprise_id from order if not set
            if (!data.customer_id && data.order_id) {
              const orderResult = await db.execute(sql`
                SELECT customer_id, enterprise_id FROM orders WHERE id = ${data.order_id}
              `);
              const orderRows = (orderResult as any).rows || orderResult || [];
              if (orderRows.length > 0) {
                if (!data.customer_id && orderRows[0].customer_id) {
                  data.customer_id = orderRows[0].customer_id;
                  // Update invoice with customer_id
                  await db.update(invoices).set({ customer_id: data.customer_id }).where(eq(invoices.id, invoiceId));
                }
                if (!enterpriseId && orderRows[0].enterprise_id) {
                  enterpriseId = orderRows[0].enterprise_id;
                  await db.execute(sql`UPDATE invoices SET enterprise_id = ${enterpriseId} WHERE id = ${invoiceId}`);
                }
              }
            }
          }

          const qty = validateNumeric(item.quantity, 'Cantidad', { min: 0.001, max: 999999, allowZero: false });
          const itemSubtotal = unitPrice * qty;
          const itemVat = itemSubtotal * (vatRate / 100);
          subtotal += itemSubtotal;
          vatAmount += itemVat;

          const itemId = uuid();
          await db.insert(invoice_items).values({
            id: itemId,
            invoice_id: invoiceId,
            product_id: productId,
            product_name: productName,
            quantity: qty.toString(),
            unit_price: unitPrice.toString(),
            vat_rate: vatRate.toString(),
            subtotal: itemSubtotal.toString(),
          });

          // Link invoice_item to order_item if provided
          if (item.order_item_id) {
            await db.execute(sql`
              UPDATE invoice_items SET order_item_id = ${item.order_item_id} WHERE id = ${itemId}
            `);
          }
        }

        // Update invoice totals
        const total = subtotal + vatAmount;
        await db.update(invoices)
          .set({
            subtotal: subtotal.toString(),
            vat_amount: vatAmount.toString(),
            total_amount: total.toString(),
          })
          .where(eq(invoices.id, invoiceId));
      }

      // Update order has_invoice flag if order_id provided
      if (data.order_id) {
        await db.execute(sql`
          UPDATE orders SET has_invoice = true, updated_at = NOW()
          WHERE id = ${data.order_id} AND company_id = ${companyId}
        `);
      }

      return { id: invoiceId, order_id: data.order_id || null, enterprise_id: enterpriseId, fiscal_type: fiscalType };
    } catch (error) {
      console.error('Create invoice error:', error);
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Failed to create invoice');
    }
  }

  async getInvoices(companyId: string, filters: {
    skip?: number;
    limit?: number;
    enterprise_id?: string;
    status?: string;
    invoice_type?: string;
    search?: string;
    date_from?: string;
    date_to?: string;
    fiscal_type?: string;
  } = {}) {
    await this.ensureMigrations();
    try {
      const { enterprise_id, status, invoice_type, search, date_from, date_to, fiscal_type } = filters;
      const skip = Math.max(0, Math.min(Number(filters.skip) || 0, 100000));
      const limit = Math.max(1, Math.min(Number(filters.limit) || 50, 200));

      let whereClause = sql`i.company_id = ${companyId}`;
      // Filter by fiscal_type (default: 'fiscal' to preserve backward compatibility)
      if (fiscal_type === 'interno') {
        whereClause = sql`${whereClause} AND i.fiscal_type = 'interno'`;
      } else if (fiscal_type === 'no_fiscal') {
        whereClause = sql`${whereClause} AND i.fiscal_type = 'no_fiscal'`;
      } else if (fiscal_type === 'all') {
        // show all
      } else {
        whereClause = sql`${whereClause} AND (i.fiscal_type = 'fiscal' OR i.fiscal_type IS NULL)`;
      }
      if (enterprise_id) {
        whereClause = sql`${whereClause} AND (i.enterprise_id = ${enterprise_id} OR c.enterprise_id = ${enterprise_id})`;
      }
      if (status) {
        whereClause = sql`${whereClause} AND i.status = ${status}`;
      }
      if (invoice_type) {
        whereClause = sql`${whereClause} AND i.invoice_type = ${invoice_type}`;
      }
      if (search) {
        whereClause = sql`${whereClause} AND (c.name ILIKE ${'%' + search + '%'} OR c.cuit ILIKE ${'%' + search + '%'} OR CAST(i.invoice_number AS TEXT) ILIKE ${'%' + search + '%'} OR e.name ILIKE ${'%' + search + '%'})`;
      }
      if (date_from) {
        whereClause = sql`${whereClause} AND i.invoice_date >= ${date_from}`;
      }
      if (date_to) {
        whereClause = sql`${whereClause} AND i.invoice_date <= ${date_to + 'T23:59:59'}`;
      }

      const result = await db.execute(sql`
        SELECT i.*,
          CASE WHEN c.id IS NOT NULL THEN
            json_build_object('id', c.id, 'name', c.name, 'cuit', c.cuit)
          ELSE NULL END as customer,
          CASE WHEN e.id IS NOT NULL THEN
            json_build_object('id', e.id, 'name', e.name, 'cuit', e.cuit)
          ELSE
            CASE WHEN c.enterprise_id IS NOT NULL THEN
              (SELECT json_build_object('id', e2.id, 'name', e2.name, 'cuit', e2.cuit) FROM enterprises e2 WHERE e2.id = c.enterprise_id)
            ELSE NULL END
          END as enterprise,
          CASE WHEN o.id IS NOT NULL THEN
            json_build_object('id', o.id, 'order_number', o.order_number, 'title', o.title, 'total_amount', o.total_amount)
          ELSE NULL END as "order",
          COALESCE((SELECT json_agg(json_build_object('id',t.id,'name',t.name,'color',t.color)) FROM entity_tags et JOIN tags t ON et.tag_id=t.id WHERE et.entity_id=COALESCE(e.id, c.enterprise_id) AND et.entity_type='enterprise'),'[]'::json) as enterprise_tags,
          (i.afip_response->'FeCabResp'->>'PtoVta')::int as punto_venta,
          COALESCE((SELECT SUM(CAST(cb.amount AS decimal)) FROM cobros cb WHERE cb.invoice_id = i.id), 0) as total_cobrado,
          CASE
            WHEN CAST(i.total_amount AS decimal) > 0 AND COALESCE((SELECT SUM(CAST(cb.amount AS decimal)) FROM cobros cb WHERE cb.invoice_id = i.id), 0) >= CAST(i.total_amount AS decimal) THEN 'pagado'
            WHEN COALESCE((SELECT SUM(CAST(cb.amount AS decimal)) FROM cobros cb WHERE cb.invoice_id = i.id), 0) > 0 THEN 'parcial'
            ELSE 'pendiente'
          END as payment_status
        FROM invoices i
        LEFT JOIN customers c ON i.customer_id = c.id
        LEFT JOIN enterprises e ON i.enterprise_id = e.id
        LEFT JOIN orders o ON i.order_id = o.id
        WHERE ${whereClause}
        ORDER BY i.created_at DESC
        LIMIT ${limit} OFFSET ${skip}
      `);
      const items = (result as any).rows || result || [];

      // Get total count
      const countResult = await db.execute(sql`
        SELECT COUNT(*) as total
        FROM invoices i
        LEFT JOIN customers c ON i.customer_id = c.id
        LEFT JOIN enterprises e ON i.enterprise_id = e.id
        WHERE ${whereClause}
      `);
      const total = parseInt(((countResult as any).rows || [])[0]?.total || '0');

      return { items, total, skip, limit };
    } catch (error) {
      console.error('Get invoices error:', error);
      throw new ApiError(500, 'Failed to get invoices');
    }
  }

  async getInvoice(companyId: string, invoiceId: string) {
    await this.ensureMigrations();
    try {
      const result = await db.execute(sql`
        SELECT i.*,
          CASE WHEN c.id IS NOT NULL THEN
            json_build_object('id', c.id, 'name', c.name, 'cuit', c.cuit, 'email', c.email, 'phone', c.phone, 'address', c.address, 'tax_condition', c.tax_condition, 'condicion_iva', c.condicion_iva)
          ELSE NULL END as customer,
          CASE WHEN e.id IS NOT NULL THEN
            json_build_object('id', e.id, 'name', e.name, 'cuit', e.cuit)
          ELSE NULL END as enterprise,
          CASE WHEN o.id IS NOT NULL THEN
            json_build_object('id', o.id, 'order_number', o.order_number, 'title', o.title)
          ELSE NULL END as "order",
          COALESCE((SELECT json_agg(json_build_object('id',t.id,'name',t.name,'color',t.color)) FROM entity_tags et JOIN tags t ON et.tag_id=t.id WHERE et.entity_id=COALESCE(e.id, c.enterprise_id) AND et.entity_type='enterprise'),'[]'::json) as enterprise_tags,
          (i.afip_response->'FeCabResp'->>'PtoVta')::int as punto_venta
        FROM invoices i
        LEFT JOIN customers c ON i.customer_id = c.id
        LEFT JOIN enterprises e ON i.enterprise_id = e.id
        LEFT JOIN orders o ON i.order_id = o.id
        WHERE i.company_id = ${companyId} AND i.id = ${invoiceId}
      `);
      const rows = (result as any).rows || result || [];
      if (rows.length === 0) throw new ApiError(404, 'Invoice not found');

      // Get items
      const itemsResult = await db.execute(sql`
        SELECT ii.*, oi.product_name as order_product_name
        FROM invoice_items ii
        LEFT JOIN order_items oi ON ii.order_item_id = oi.id
        WHERE ii.invoice_id = ${invoiceId}
        ORDER BY ii.id ASC
      `);
      const items = (itemsResult as any).rows || itemsResult || [];

      return { ...rows[0], items };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Failed to get invoice');
    }
  }

  async linkOrder(companyId: string, invoiceId: string, orderId: string) {
    await this.ensureMigrations();
    try {
      // Verify invoice exists
      const invCheck = await db.execute(sql`SELECT id FROM invoices WHERE id = ${invoiceId} AND company_id = ${companyId}`);
      if (((invCheck as any).rows || []).length === 0) throw new ApiError(404, 'Factura no encontrada');

      // Verify order exists
      const ordCheck = await db.execute(sql`SELECT id FROM orders WHERE id = ${orderId} AND company_id = ${companyId}`);
      if (((ordCheck as any).rows || []).length === 0) throw new ApiError(404, 'Pedido no encontrado');

      await db.execute(sql`
        UPDATE invoices SET order_id = ${orderId}, updated_at = NOW()
        WHERE id = ${invoiceId} AND company_id = ${companyId}
      `);
      await db.execute(sql`
        UPDATE orders SET has_invoice = true, updated_at = NOW()
        WHERE id = ${orderId} AND company_id = ${companyId}
      `);

      return { invoice_id: invoiceId, order_id: orderId };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Failed to link order');
    }
  }

  async unlinkOrder(companyId: string, invoiceId: string) {
    await this.ensureMigrations();
    try {
      // Get current order_id
      const invResult = await db.execute(sql`
        SELECT order_id FROM invoices WHERE id = ${invoiceId} AND company_id = ${companyId}
      `);
      const rows = (invResult as any).rows || [];
      if (rows.length === 0) throw new ApiError(404, 'Factura no encontrada');
      const orderId = rows[0]?.order_id;

      await db.execute(sql`
        UPDATE invoices SET order_id = NULL, updated_at = NOW()
        WHERE id = ${invoiceId} AND company_id = ${companyId}
      `);

      // Recalculate has_invoice on the order
      if (orderId) {
        const remaining = await db.execute(sql`
          SELECT COUNT(*) as cnt FROM invoices WHERE order_id = ${orderId} AND company_id = ${companyId}
        `);
        const cnt = parseInt(((remaining as any).rows || [])[0]?.cnt || '0');
        if (cnt === 0) {
          await db.execute(sql`
            UPDATE orders SET has_invoice = false, updated_at = NOW()
            WHERE id = ${orderId} AND company_id = ${companyId}
          `);
        }
      }

      return { invoice_id: invoiceId, unlinked: true };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Failed to unlink order');
    }
  }

  async updateDraftInvoice(companyId: string, invoiceId: string, data: any) {
    await this.ensureMigrations();
    try {
      // Verify invoice exists and is draft
      const invResult = await db.execute(sql`
        SELECT id, status FROM invoices WHERE id = ${invoiceId} AND company_id = ${companyId}
      `);
      const invRows = (invResult as any).rows || [];
      if (invRows.length === 0) throw new ApiError(404, 'Factura no encontrada');
      const editableStatuses = ['draft', 'emitido'];
      if (!editableStatuses.includes(invRows[0].status)) throw new ApiError(400, 'Solo se pueden editar facturas en borrador o comprobantes internos');

      // Update invoice_type if provided
      if (data.invoice_type) {
        await db.update(invoices).set({ invoice_type: data.invoice_type, updated_at: new Date() }).where(eq(invoices.id, invoiceId));
      }

      // Update concepto and service date fields if provided
      if (data.concepto !== undefined) {
        const concepto = parseInt(data.concepto) || 1;
        await db.execute(sql`UPDATE invoices SET concepto = ${concepto}, updated_at = NOW() WHERE id = ${invoiceId}`);
      }
      if (data.fch_serv_desde) {
        await db.execute(sql`UPDATE invoices SET fch_serv_desde = ${data.fch_serv_desde}, updated_at = NOW() WHERE id = ${invoiceId}`);
      }
      if (data.fch_serv_hasta) {
        await db.execute(sql`UPDATE invoices SET fch_serv_hasta = ${data.fch_serv_hasta}, updated_at = NOW() WHERE id = ${invoiceId}`);
      }
      if (data.fch_vto_pago) {
        await db.execute(sql`UPDATE invoices SET fch_vto_pago = ${data.fch_vto_pago}, updated_at = NOW() WHERE id = ${invoiceId}`);
      }

      // Update items if provided
      if (data.items && Array.isArray(data.items)) {
        // Delete existing items
        await db.delete(invoice_items).where(eq(invoice_items.invoice_id, invoiceId));

        let subtotal = 0;
        let vatAmount = 0;

        for (const item of data.items) {
          const unitPrice = validateNumeric(item.unit_price || 0, 'Precio unitario', { min: 0, max: 999999999 });
          const vatRate = validateNumeric(item.vat_rate || 21, 'Tasa IVA', { min: 0, max: 100 });
          const qty = validateNumeric(item.quantity || 0, 'Cantidad', { min: 0.001, max: 999999, allowZero: false });
          const itemSubtotal = unitPrice * qty;
          const itemVat = itemSubtotal * (vatRate / 100);
          subtotal += itemSubtotal;
          vatAmount += itemVat;

          const itemId = uuid();
          await db.insert(invoice_items).values({
            id: itemId,
            invoice_id: invoiceId,
            product_id: item.product_id || null,
            product_name: item.product_name || '',
            quantity: qty.toString(),
            unit_price: unitPrice.toString(),
            vat_rate: vatRate.toString(),
            subtotal: itemSubtotal.toString(),
          });

          if (item.order_item_id) {
            await db.execute(sql`
              UPDATE invoice_items SET order_item_id = ${item.order_item_id} WHERE id = ${itemId}
            `);
          }
        }

        const total = subtotal + vatAmount;
        await db.update(invoices)
          .set({
            subtotal: subtotal.toString(),
            vat_amount: vatAmount.toString(),
            total_amount: total.toString(),
            updated_at: new Date(),
          })
          .where(eq(invoices.id, invoiceId));
      }

      return await this.getInvoice(companyId, invoiceId);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      console.error('Update draft invoice error:', error);
      throw new ApiError(500, 'Error al actualizar borrador');
    }
  }

  async deleteDraftInvoice(companyId: string, invoiceId: string) {
    await this.ensureMigrations();
    try {
      const invResult = await db.execute(sql`
        SELECT id, status, order_id FROM invoices WHERE id = ${invoiceId} AND company_id = ${companyId}
      `);
      const invRows = (invResult as any).rows || [];
      if (invRows.length === 0) throw new ApiError(404, 'Factura no encontrada');
      const deletableStatuses = ['draft', 'emitido'];
      if (!deletableStatuses.includes(invRows[0].status)) throw new ApiError(400, 'Solo se pueden eliminar facturas en borrador o comprobantes internos');

      const orderId = invRows[0].order_id;

      // Delete items first
      await db.delete(invoice_items).where(eq(invoice_items.invoice_id, invoiceId));
      // Delete invoice
      await db.delete(invoices).where(eq(invoices.id, invoiceId));

      // Recalculate has_invoice on the order
      if (orderId) {
        const remaining = await db.execute(sql`
          SELECT COUNT(*) as cnt FROM invoices WHERE order_id = ${orderId} AND company_id = ${companyId}
        `);
        const cnt = parseInt(((remaining as any).rows || [])[0]?.cnt || '0');
        if (cnt === 0) {
          await db.execute(sql`
            UPDATE orders SET has_invoice = false, updated_at = NOW()
            WHERE id = ${orderId} AND company_id = ${companyId}
          `);
        }
      }

      return { deleted: true };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Error al eliminar borrador');
    }
  }

  async importInvoice(companyId: string, userId: string, data: any) {
    await this.ensureMigrations();
    try {
      // Validate required fields
      if (!data.invoice_type || !['A', 'B', 'C'].includes(data.invoice_type)) {
        throw new ApiError(400, 'Tipo de comprobante invalido (debe ser A, B o C)');
      }
      if (!data.invoice_number_full || !/^\d{5}-\d{8}$/.test(data.invoice_number_full)) {
        throw new ApiError(400, 'Numero de comprobante invalido (formato: 00003-00000001)');
      }
      if (!data.invoice_date) {
        throw new ApiError(400, 'Fecha de emision es requerida');
      }
      if (!data.cae || !/^\d{14}$/.test(data.cae)) {
        throw new ApiError(400, 'CAE invalido (debe ser de 14 digitos)');
      }
      if (!data.cae_expiry_date) {
        throw new ApiError(400, 'Fecha de vencimiento del CAE es requerida');
      }
      if (!data.enterprise_id) {
        throw new ApiError(400, 'Cliente/Empresa es requerido');
      }
      if (!data.customer_cuit || !/^\d{11}$/.test(data.customer_cuit.replace(/-/g, ''))) {
        throw new ApiError(400, 'CUIT del cliente invalido (debe ser de 11 digitos)');
      }
      if (!data.items || !Array.isArray(data.items) || data.items.length === 0) {
        throw new ApiError(400, 'Debe incluir al menos un item');
      }

      // Parse invoice number parts
      const [pvStr, nroStr] = data.invoice_number_full.split('-');
      const puntoVenta = parseInt(pvStr);
      const invoiceNumber = parseInt(nroStr);

      // Check for duplicate CAE
      const dupCheck = await db.execute(sql`
        SELECT id FROM invoices WHERE company_id = ${companyId} AND cae = ${data.cae}
      `);
      if (((dupCheck as any).rows || []).length > 0) {
        throw new ApiError(400, 'Ya existe una factura con este CAE');
      }

      const invoiceId = uuid();

      // Resolve enterprise_id and customer_id
      let enterpriseId = data.enterprise_id || null;
      let customerId = data.customer_id || null;

      // Calculate totals from items
      let subtotal = 0;
      let vatAmount = 0;

      for (const item of data.items) {
        const unitPrice = validateNumeric(item.unit_price || 0, 'Precio unitario', { min: 0, max: 999999999 });
        const vatRate = validateNumeric(item.vat_rate || 21, 'Tasa IVA', { min: 0, max: 100 });
        const qty = validateNumeric(item.quantity, 'Cantidad', { min: 0.001, max: 999999, allowZero: false });
        const itemSubtotal = unitPrice * qty;
        const itemVat = itemSubtotal * (vatRate / 100);
        subtotal += itemSubtotal;
        vatAmount += itemVat;
      }

      const total = subtotal + vatAmount;

      // Create invoice with status 'authorized' directly
      await db.insert(invoices).values({
        id: invoiceId,
        company_id: companyId,
        customer_id: customerId,
        invoice_type: data.invoice_type,
        invoice_number: invoiceNumber,
        invoice_date: new Date(data.invoice_date),
        subtotal: subtotal.toString(),
        vat_amount: vatAmount.toString(),
        total_amount: total.toString(),
        cae: data.cae,
        cae_expiry_date: new Date(data.cae_expiry_date),
        status: 'authorized',
        created_by: userId,
      }).returning();

      // Set enterprise_id, fiscal_type, and source via raw SQL (migration columns)
      await db.execute(sql`
        UPDATE invoices SET
          enterprise_id = ${enterpriseId},
          fiscal_type = 'fiscal',
          source = 'manual_import',
          afip_response = ${JSON.stringify({ PuntoVenta: puntoVenta, ManualImport: true })}::jsonb
        WHERE id = ${invoiceId}
      `);

      // Add items
      for (const item of data.items) {
        const unitPrice = validateNumeric(item.unit_price || 0, 'Precio unitario', { min: 0, max: 999999999 });
        const vatRate = validateNumeric(item.vat_rate || 21, 'Tasa IVA', { min: 0, max: 100 });
        const qty = validateNumeric(item.quantity, 'Cantidad', { min: 0.001, max: 999999, allowZero: false });
        const itemSubtotal = unitPrice * qty;

        const itemId = uuid();
        await db.insert(invoice_items).values({
          id: itemId,
          invoice_id: invoiceId,
          product_id: item.product_id || null,
          product_name: item.product_name || '',
          quantity: qty.toString(),
          unit_price: unitPrice.toString(),
          vat_rate: vatRate.toString(),
          subtotal: itemSubtotal.toString(),
        });
      }

      return {
        id: invoiceId,
        enterprise_id: enterpriseId,
        fiscal_type: 'fiscal',
        source: 'manual_import',
        status: 'authorized',
      };
    } catch (error) {
      console.error('Import invoice error:', error);
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Error al importar factura');
    }
  }

  async authorizeInvoice(companyId: string, invoiceId: string, puntoVenta: number = 1, overrideCondicionIva?: number) {
    try {
      // Block internal vouchers from AFIP authorization
      const ftCheck = await db.execute(sql`SELECT fiscal_type FROM invoices WHERE id = ${invoiceId} AND company_id = ${companyId}`);
      const ft = ((ftCheck as any).rows || [])[0]?.fiscal_type;
      if (ft === 'interno' || ft === 'no_fiscal') {
        throw new ApiError(400, 'Los comprobantes internos/no fiscales no pueden autorizarse en AFIP');
      }

      validateNumeric(puntoVenta, 'Punto de venta', { min: 1, max: 99999, allowZero: false });
      const invoice = await this.getInvoice(companyId, invoiceId);
      if (invoice.status !== 'draft') throw new ApiError(400, 'La factura no puede ser autorizada (estado: ' + invoice.status + ')');

      // Validate invoice has items and non-zero total
      const totalAmount = parseFloat(invoice.total_amount?.toString() || '0');
      if (totalAmount <= 0) {
        throw new ApiError(400, 'La factura no tiene importe. Verifique que los items tengan precios.');
      }

      // Get customer CUIT and condicion_iva
      let customerCuit = '';
      let customerCondicionIva: number | null = null;
      if (invoice.customer_id) {
        const custRow = await db.execute(sql`SELECT cuit, condicion_iva, tax_condition FROM customers WHERE id = ${invoice.customer_id}`);
        const custData = ((custRow as any).rows || [])[0];
        if (custData) {
          customerCuit = custData.cuit || '';
          customerCondicionIva = custData.condicion_iva ? parseInt(custData.condicion_iva) : null;
        }
      }

      // Get invoice items for IVA breakdown
      const itemsList = invoice.items || [];
      if (itemsList.length === 0) {
        const items = await db.query.invoice_items.findMany({
          where: eq(invoice_items.invoice_id, invoiceId),
        });
        itemsList.push(...items);
      }

      // ---- Pre-authorization validations ----

      // Determine concepto: 1=Productos, 2=Servicios, 3=Ambos
      // Default to 1 (productos) - can be overridden by invoice metadata
      const concepto: 1 | 2 | 3 = (invoice as any).concepto || 1;

      // (a) Date validation: max 5 days back for productos, 10 for servicios
      const invoiceDate = new Date(invoice.invoice_date || invoice.created_at);
      const now = new Date();
      const diffDays = Math.floor((now.getTime() - invoiceDate.getTime()) / (1000 * 60 * 60 * 24));
      if (invoiceDate > now) {
        throw new ApiError(400, 'La fecha de la factura no puede ser futura');
      }
      const maxDays = concepto === 1 ? 5 : 10; // 5 for products, 10 for services/both
      if (diffDays > maxDays) {
        throw new ApiError(400, `La fecha de la factura excede el limite permitido por AFIP (${diffDays} dias atras, max ${maxDays} para ${concepto === 1 ? 'productos' : 'servicios'})`);
      }

      // (b) Amount consistency: recalculate neto + iva and fix if needed
      const neto = itemsList.reduce((sum: number, i: any) => sum + (Number(i.quantity) * parseFloat(i.unit_price?.toString() || '0')), 0);
      const iva = itemsList.reduce((sum: number, i: any) => sum + (Number(i.quantity) * parseFloat(i.unit_price?.toString() || '0') * parseFloat((i.vat_rate || '21').toString()) / 100), 0);
      const calculatedTotal = neto + iva;
      const invoiceTotal = parseFloat(invoice.total_amount?.toString() || '0');
      if (Math.abs(calculatedTotal - invoiceTotal) > 0.01 && invoiceTotal > 0) {
        await db.execute(sql`UPDATE invoices SET subtotal = ${neto.toFixed(2)}, vat_amount = ${iva.toFixed(2)}, total_amount = ${calculatedTotal.toFixed(2)} WHERE id = ${invoice.id}`);
      }

      // (d) Factura A requires valid CUIT
      if ((invoice.invoice_type || 'B') === 'A') {
        if (!customerCuit || !AfipService.isValidCuit(customerCuit)) {
          throw new ApiError(400, 'Factura A requiere un CUIT valido del cliente (verificacion modulo 11)');
        }
      }

      // (e) Validate invoice type vs IVA condition (backend guard)
      // Get company tax condition
      const companyResult = await db.execute(sql`SELECT tax_condition FROM companies WHERE id = ${companyId}`);
      const companyTaxCondition = ((companyResult as any).rows || [])[0]?.tax_condition || '';
      const invoiceType = (invoice.invoice_type || 'B') as 'A' | 'B' | 'C';

      if (companyTaxCondition.toLowerCase().includes('monotribut')) {
        if (invoiceType !== 'C') {
          throw new ApiError(400, `Monotributistas solo pueden emitir Factura C (seleccionada: ${invoiceType})`);
        }
      } else if (companyTaxCondition.toLowerCase().includes('responsable inscripto')) {
        if (invoiceType === 'C') {
          throw new ApiError(400, 'Responsables Inscriptos no pueden emitir Factura C');
        }
        // Get customer tax condition to validate A vs B
        if (invoice.customer_id) {
          const custResult = await db.execute(sql`SELECT tax_condition FROM customers WHERE id = ${invoice.customer_id}`);
          const custTaxCond = ((custResult as any).rows || [])[0]?.tax_condition || '';
          const isRI = custTaxCond.toLowerCase().includes('responsable inscripto');
          const isMono = custTaxCond.toLowerCase().includes('monotribut');
          if (invoiceType === 'A' && !isRI && !isMono) {
            throw new ApiError(400, `Factura A solo para Responsables Inscriptos o Monotributistas. El cliente es: ${custTaxCond || 'sin condicion definida'}`);
          }
          if (invoiceType === 'B' && (isRI || isMono)) {
            throw new ApiError(400, `Factura B no corresponde para clientes RI/Monotributistas. Use Factura A.`);
          }
        }
      }

      // Resolve CondicionIVAReceptorId: explicit override > customer setting > derive from context
      let condicionIvaReceptorId: number | undefined = overrideCondicionIva ?? customerCondicionIva ?? undefined;
      if (!condicionIvaReceptorId) {
        // Default logic based on invoice type and customer document
        const cleanCustCuit = customerCuit?.replace(/-/g, '') || '';
        const isConsumidorFinal = !cleanCustCuit || cleanCustCuit.length !== 11;
        if (isConsumidorFinal) {
          condicionIvaReceptorId = 5; // Consumidor Final
        } else if (invoiceType === 'A') {
          condicionIvaReceptorId = 1; // RI (default for Factura A)
        } else if (invoiceType === 'C') {
          condicionIvaReceptorId = 5; // CF (default for Factura C)
        } else {
          condicionIvaReceptorId = 5; // CF (default for Factura B)
        }
      }

      // Read service date fields from invoice for concepto 2/3
      let fchServDesde: string | undefined;
      let fchServHasta: string | undefined;
      let fchVtoPago: string | undefined;
      if (concepto !== 1) {
        const dateFields = await db.execute(sql`SELECT fch_serv_desde, fch_serv_hasta, fch_vto_pago FROM invoices WHERE id = ${invoiceId}`);
        const dateRow = ((dateFields as any).rows || [])[0];
        if (dateRow) {
          const formatDate = (d: any) => {
            if (!d) return undefined;
            const dt = new Date(d);
            if (isNaN(dt.getTime())) return undefined;
            return dt.toISOString().slice(0, 10).replace(/-/g, '');
          };
          fchServDesde = formatDate(dateRow.fch_serv_desde);
          fchServHasta = formatDate(dateRow.fch_serv_hasta);
          fchVtoPago = formatDate(dateRow.fch_vto_pago);
        }
      }

      const authInput: AuthorizeInvoiceInput = {
        invoiceId,
        invoiceNumber: invoice.invoice_number,
        invoiceType: invoiceType,
        concepto,
        customerCuit,
        condicionIvaReceptorId,
        fchServDesde,
        fchServHasta,
        fchVtoPago,
        subtotal: Math.abs(calculatedTotal - invoiceTotal) > 0.01 && invoiceTotal > 0 ? neto : parseFloat(invoice.subtotal?.toString() || '0'),
        vat: Math.abs(calculatedTotal - invoiceTotal) > 0.01 && invoiceTotal > 0 ? iva : parseFloat(invoice.vat_amount?.toString() || '0'),
        total: Math.abs(calculatedTotal - invoiceTotal) > 0.01 && invoiceTotal > 0 ? calculatedTotal : parseFloat(invoice.total_amount?.toString() || '0'),
        invoiceDate: invoice.invoice_date ? new Date(invoice.invoice_date) : new Date(),
        puntoVenta,
        items: itemsList.map((i: any) => ({
          quantity: Number(i.quantity),
          unitPrice: parseFloat(i.unit_price?.toString() || '0'),
          vatRate: parseFloat((i.vat_rate || '21').toString()),
          description: i.product_name || '',
        })),
      };

      // Authorize with AFIP (real or mock)
      const authorization = await afipService.authorizeInvoice(companyId, authInput);

      // Save authorization result
      await afipService.saveAuthorizedInvoice(invoiceId, authorization);

      // Return updated invoice
      const updated = await this.getInvoice(companyId, invoiceId);

      // CRM Pipeline sync: invoice_authorized
      try {
        // If invoice has order_id, link to same deal as that order
        if (invoice.order_id) {
          const existingDeal = await crmSyncService.findDealByRelatedDocument(companyId, invoice.order_id, 'order');
          if (existingDeal) {
            await crmSyncService.linkDocumentToDeal(existingDeal.id, 'invoice', invoiceId);
          }
        }

        const invEnterpriseId = updated.enterprise_id || (updated.enterprise ? updated.enterprise.id : null);
        await crmSyncService.handleEvent({
          companyId,
          event: 'invoice_authorized',
          enterpriseId: invEnterpriseId || undefined,
          customerId: invoice.customer_id || undefined,
          documentId: invoiceId,
          documentType: 'invoice',
          metadata: {
            title: `Factura #${invoice.invoice_number || ''}`,
            amount: parseFloat(updated.total_amount?.toString() || '0'),
          },
        });
      } catch (e) { console.error('CRM sync error (invoice_authorized):', e); }

      return updated;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      console.error('Authorize invoice error:', error);
      throw new ApiError(500, 'Error al autorizar factura');
    }
  }
}

export const invoicesService = new InvoicesService();
