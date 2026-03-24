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

      // NC/ND: related invoice (the original invoice being corrected)
      await db.execute(sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS related_invoice_id UUID REFERENCES invoices(id)`);

      // Multi-currency support
      await db.execute(sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS currency VARCHAR(3) DEFAULT 'ARS'`);
      await db.execute(sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS exchange_rate DECIMAL(12,4)`);
      await db.execute(sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS amount_foreign DECIMAL(12,2)`);

      this.migrationsRun = true;
    } catch (error) {
      console.error('Invoices migrations error:', error);
    }
  }

  async createInvoice(companyId: string, userId: string, data: any) {
    await this.ensureMigrations();
    try {
      const invoiceId = uuid();
      // Validate: if items have order_item_id, check that we don't invoice more than available
      if (data.items && Array.isArray(data.items)) {
        for (const item of data.items) {
          if (item.order_item_id) {
            const checkResult = await db.execute(sql`
              SELECT
                CAST(oi.quantity AS decimal) as total_qty,
                COALESCE((
                  SELECT SUM(CAST(ii.quantity AS decimal))
                  FROM invoice_items ii JOIN invoices i ON ii.invoice_id = i.id
                  WHERE ii.order_item_id = ${item.order_item_id} AND i.status != 'cancelled'
                ), 0) as invoiced_qty
              FROM order_items oi WHERE oi.id = ${item.order_item_id}
            `);
            const check = ((checkResult as any).rows || [])[0];
            if (check) {
              const available = parseFloat(check.total_qty) - parseFloat(check.invoiced_qty);
              const requesting = parseFloat(item.quantity) || 0;
              if (requesting > available + 0.01) {
                const oiName = item.product_name || 'Item';
                throw new ApiError(400, `${oiName}: solo quedan ${available.toFixed(2)} unidades disponibles para facturar (pediste ${requesting})`);
              }
            }
          }
        }
      }

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

      // -- BEGIN TRANSACTION: all DB writes from here until COMMIT --
      await db.execute(sql`BEGIN`);

      if (fiscalType === 'interno' || fiscalType === 'no_fiscal') {
        // Internal/no-fiscal vouchers: raw SQL insert (invoice_type can be NULL, status = 'emitido')
        await db.execute(sql`
          INSERT INTO invoices (id, company_id, customer_id, invoice_type, invoice_number, invoice_date,
            subtotal, vat_amount, total_amount, status, fiscal_type, business_unit_id, created_by, created_at, updated_at)
          VALUES (${invoiceId}, ${companyId}, ${data.customer_id || null}, NULL, ${nextNumber}, NOW(),
            '0', '0', '0', 'emitido', ${fiscalType}, ${data.business_unit_id || null}, ${userId}, NOW(), NOW())
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

      // Set order_id, enterprise_id, fiscal_type, business_unit_id, related_invoice_id, and currency via raw SQL (columns added by migration)
      const currency = data.currency || 'ARS';
      const exchangeRate = data.exchange_rate ? parseFloat(data.exchange_rate) : null;
      await db.execute(sql`
        UPDATE invoices SET order_id = ${data.order_id || null}, enterprise_id = ${enterpriseId},
          fiscal_type = ${fiscalType}, business_unit_id = ${data.business_unit_id || null},
          related_invoice_id = ${data.related_invoice_id || null},
          currency = ${currency}, exchange_rate = ${exchangeRate}
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
        // If foreign currency, store original amount and convert total to ARS
        if (currency !== 'ARS' && exchangeRate && exchangeRate > 0) {
          const totalArs = total * exchangeRate;
          const subtotalArs = subtotal * exchangeRate;
          const vatArs = vatAmount * exchangeRate;
          await db.update(invoices)
            .set({
              subtotal: subtotalArs.toString(),
              vat_amount: vatArs.toString(),
              total_amount: totalArs.toString(),
            })
            .where(eq(invoices.id, invoiceId));
          await db.execute(sql`UPDATE invoices SET amount_foreign = ${total.toString()} WHERE id = ${invoiceId}`);
        } else {
          await db.update(invoices)
            .set({
              subtotal: subtotal.toString(),
              vat_amount: vatAmount.toString(),
              total_amount: total.toString(),
            })
            .where(eq(invoices.id, invoiceId));
        }
      }

      // Update order has_invoice flag if order_id provided
      if (data.order_id) {
        await db.execute(sql`
          UPDATE orders SET has_invoice = true, updated_at = NOW()
          WHERE id = ${data.order_id} AND company_id = ${companyId}
        `);
      }

      await db.execute(sql`COMMIT`);
      // -- END TRANSACTION --

      return { id: invoiceId, order_id: data.order_id || null, enterprise_id: enterpriseId, fiscal_type: fiscalType };
    } catch (error) {
      await db.execute(sql`ROLLBACK`).catch(() => {});
      console.error('Create invoice error:', error);
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Failed to create invoice');
    }
  }

  async getInvoices(companyId: string, filters: {
    skip?: number;
    limit?: number;
    enterprise_id?: string;
    business_unit_id?: string;
    status?: string;
    invoice_type?: string;
    search?: string;
    date_from?: string;
    date_to?: string;
    fiscal_type?: string;
  } = {}) {
    await this.ensureMigrations();
    try {
      const { enterprise_id, business_unit_id, status, invoice_type, search, date_from, date_to, fiscal_type } = filters;
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
      if (business_unit_id) {
        whereClause = sql`${whereClause} AND i.business_unit_id = ${business_unit_id}`;
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
          -- total_cobrado using cobro_invoice_applications (N:N correct system)
          COALESCE((SELECT SUM(CAST(cia.amount_applied AS decimal)) FROM cobro_invoice_applications cia WHERE cia.invoice_id = i.id), 0) as total_cobrado,
          CASE
            WHEN CAST(i.total_amount AS decimal) > 0 AND COALESCE((SELECT SUM(CAST(cia2.amount_applied AS decimal)) FROM cobro_invoice_applications cia2 WHERE cia2.invoice_id = i.id), 0) >= CAST(i.total_amount AS decimal) THEN 'pagado'
            WHEN COALESCE((SELECT SUM(CAST(cia3.amount_applied AS decimal)) FROM cobro_invoice_applications cia3 WHERE cia3.invoice_id = i.id), 0) > 0 THEN 'parcial'
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

      // (d) Comprobante tipo A requires valid CUIT
      const rawInvType = invoice.invoice_type || 'B';
      const baseLetterForCuit = rawInvType.replace(/^(NC_|ND_)/, '');
      if (baseLetterForCuit === 'A') {
        if (!customerCuit || !AfipService.isValidCuit(customerCuit)) {
          throw new ApiError(400, 'Comprobante tipo A requiere un CUIT valido del cliente (verificacion modulo 11)');
        }
      }

      // (e) Validate invoice type vs IVA condition (backend guard)
      // Get company tax condition
      const companyResult = await db.execute(sql`SELECT tax_condition FROM companies WHERE id = ${companyId}`);
      const companyTaxCondition = ((companyResult as any).rows || [])[0]?.tax_condition || '';
      const invoiceType = (invoice.invoice_type || 'B') as string;

      // Extract base letter from invoice type (e.g. NC_A -> A, ND_B -> B)
      const baseLetter = invoiceType.replace(/^(NC_|ND_)/, '');
      const isNcNd = invoiceType.startsWith('NC_') || invoiceType.startsWith('ND_');

      if (companyTaxCondition.toLowerCase().includes('monotribut')) {
        if (baseLetter !== 'C') {
          throw new ApiError(400, `Monotributistas solo pueden emitir comprobantes tipo C (seleccionado: ${invoiceType})`);
        }
      } else if (companyTaxCondition.toLowerCase().includes('responsable inscripto')) {
        if (baseLetter === 'C') {
          throw new ApiError(400, 'Responsables Inscriptos no pueden emitir comprobantes tipo C');
        }
        // Get customer tax condition to validate A vs B
        if (invoice.customer_id) {
          const custResult = await db.execute(sql`SELECT tax_condition FROM customers WHERE id = ${invoice.customer_id}`);
          const custTaxCond = ((custResult as any).rows || [])[0]?.tax_condition || '';
          const isRI = custTaxCond.toLowerCase().includes('responsable inscripto');
          const isMono = custTaxCond.toLowerCase().includes('monotribut');
          if (baseLetter === 'A' && !isRI && !isMono) {
            throw new ApiError(400, `Comprobante tipo A solo para Responsables Inscriptos o Monotributistas. El cliente es: ${custTaxCond || 'sin condicion definida'}`);
          }
          if (baseLetter === 'B' && (isRI || isMono)) {
            throw new ApiError(400, `Comprobante tipo B no corresponde para clientes RI/Monotributistas. Use tipo A.`);
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
        } else if (baseLetter === 'A') {
          condicionIvaReceptorId = 1; // RI (default for tipo A)
        } else if (baseLetter === 'C') {
          condicionIvaReceptorId = 5; // CF (default for tipo C)
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

      // NC/ND: build CbtesAsoc from related invoice
      let cbtesAsoc: AuthorizeInvoiceInput['cbtesAsoc'] = undefined;
      if (isNcNd) {
        // Load related_invoice_id
        const relResult = await db.execute(sql`SELECT related_invoice_id FROM invoices WHERE id = ${invoiceId}`);
        const relInvoiceId = ((relResult as any).rows || [])[0]?.related_invoice_id;
        if (!relInvoiceId) {
          throw new ApiError(400, 'NC/ND requiere una factura original asociada (related_invoice_id)');
        }
        // Get the original invoice data for CbtesAsoc
        const origResult = await db.execute(sql`
          SELECT i.invoice_type, i.invoice_number, i.invoice_date, i.cae,
            (i.afip_response->'FeCabResp'->>'PtoVta')::int as punto_venta,
            c.cuit as customer_cuit
          FROM invoices i
          LEFT JOIN customers c ON i.customer_id = c.id
          WHERE i.id = ${relInvoiceId}
        `);
        const origInv = ((origResult as any).rows || [])[0];
        if (!origInv) {
          throw new ApiError(404, 'Factura original asociada no encontrada');
        }
        if (!origInv.cae) {
          throw new ApiError(400, 'La factura original debe estar autorizada en AFIP para emitir NC/ND');
        }

        // Validate NC amount doesn't exceed original invoice total
        if (invoiceType.startsWith('NC_')) {
          const origTotal = await db.execute(sql`SELECT CAST(total_amount AS decimal) as total FROM invoices WHERE id = ${relInvoiceId}`);
          const origTotalAmt = parseFloat(((origTotal as any).rows || [])[0]?.total || '0');
          const ncAmt = parseFloat(invoice.total_amount?.toString() || '0');
          if (ncAmt > origTotalAmt) {
            throw new ApiError(400, `El monto de la NC ($${ncAmt}) no puede exceder el total de la factura original ($${origTotalAmt})`);
          }
        }

        // Map original invoice_type to AFIP CbteTipo code
        const ORIG_TYPE_MAP: Record<string, number> = { 'A': 1, 'B': 6, 'C': 11 };
        const origCbteTipo = ORIG_TYPE_MAP[origInv.invoice_type] || 6;
        const origPtoVta = origInv.punto_venta || puntoVenta;
        const origDate = new Date(origInv.invoice_date);
        const origFch = `${origDate.getFullYear()}${String(origDate.getMonth() + 1).padStart(2, '0')}${String(origDate.getDate()).padStart(2, '0')}`;
        const origCuit = (origInv.customer_cuit || customerCuit || '').replace(/-/g, '');

        cbtesAsoc = [{
          tipo: origCbteTipo,
          ptoVta: origPtoVta,
          nro: origInv.invoice_number,
          cuit: origCuit,
          cbteFch: origFch,
        }];
      }

      // Multi-currency: resolve AFIP currency codes
      const invoiceCurrency = invoice.currency || 'ARS';
      const AFIP_CURRENCY_MAP: Record<string, string> = { ARS: 'PES', USD: 'DOL', EUR: '060' };
      const monId = AFIP_CURRENCY_MAP[invoiceCurrency] || 'PES';
      const monCotiz = invoiceCurrency !== 'ARS' && invoice.exchange_rate ? parseFloat(invoice.exchange_rate.toString()) : 1;

      const authInput: AuthorizeInvoiceInput = {
        invoiceId,
        invoiceNumber: invoice.invoice_number,
        invoiceType: invoiceType as AuthorizeInvoiceInput['invoiceType'],
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
        monId,
        monCotiz,
        items: itemsList.map((i: any) => ({
          quantity: Number(i.quantity),
          unitPrice: parseFloat(i.unit_price?.toString() || '0'),
          vatRate: parseFloat((i.vat_rate || '21').toString()),
          description: i.product_name || '',
        })),
        cbtesAsoc,
      };

      // Authorize with AFIP (real or mock)
      const authorization = await afipService.authorizeInvoice(companyId, authInput);

      // Save authorization result
      await afipService.saveAuthorizedInvoice(invoiceId, authorization);

      // NC impact on saldos: create cobro_invoice_application to reduce original invoice balance
      if (isNcNd && invoiceType.startsWith('NC_')) {
        const relResult2 = await db.execute(sql`SELECT related_invoice_id FROM invoices WHERE id = ${invoiceId}`);
        const relInvoiceId2 = ((relResult2 as any).rows || [])[0]?.related_invoice_id;
        if (relInvoiceId2) {
          const ncTotal = Math.abs(parseFloat(invoice.total_amount?.toString() || '0'));
          if (ncTotal > 0) {
            const appId = require('uuid').v4();
            await db.execute(sql`
              INSERT INTO cobro_invoice_applications (id, cobro_id, invoice_id, amount_applied, created_at)
              VALUES (${appId}, ${invoiceId}, ${relInvoiceId2}, ${ncTotal.toString()}, NOW())
            `);
          }
        }
      }

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
  /**
   * Get remaining amount to invoice for an order.
   * order.total - SUM(invoices.total_amount) for non-cancelled invoices.
   */
  async getOrderRemainingToInvoice(companyId: string, orderId: string) {
    const result = await db.execute(sql`
      SELECT
        CAST(o.total_amount AS decimal) as order_total,
        COALESCE(SUM(CAST(i.total_amount AS decimal)), 0) as invoiced_total
      FROM orders o
      LEFT JOIN invoices i ON i.order_id = o.id AND i.status != 'cancelled'
      WHERE o.id = ${orderId} AND o.company_id = ${companyId}
      GROUP BY o.id, o.total_amount
    `);
    const row = ((result as any).rows || [])[0];
    if (!row) throw new ApiError(404, 'Pedido no encontrado');

    const orderTotal = parseFloat(row.order_total);
    const invoicedTotal = parseFloat(row.invoiced_total);

    return {
      order_id: orderId,
      order_total: orderTotal,
      invoiced_total: invoicedTotal,
      remaining: Math.max(0, orderTotal - invoicedTotal),
    };
  }

  /**
   * Get all invoices for a specific order.
   */
  async getInvoicesByOrder(companyId: string, orderId: string) {
    const result = await db.execute(sql`
      SELECT i.id, i.invoice_number, i.invoice_type, i.invoice_date,
        i.subtotal, i.vat_amount, i.total_amount, i.status, i.fiscal_type,
        i.payment_status, i.cae,
        e.name as enterprise_name
      FROM invoices i
      LEFT JOIN enterprises e ON i.enterprise_id = e.id
      WHERE i.order_id = ${orderId} AND i.company_id = ${companyId}
      ORDER BY i.invoice_date DESC
    `);
    return (result as any).rows || [];
  }
  /**
   * Get order items available for invoicing (not yet fully invoiced).
   * Supports multi-order: returns items from all orders of a company/enterprise.
   */
  async getAvailableOrderItemsForInvoicing(companyId: string, filters: {
    enterprise_id?: string;
    business_unit_id?: string;
  } = {}) {
    let whereClause = sql`o.company_id = ${companyId} AND o.status != 'cancelado'`;
    if (filters.enterprise_id) {
      whereClause = sql`${whereClause} AND o.enterprise_id = ${filters.enterprise_id}`;
    }

    // Use CTE to calculate invoiced quantities, then filter for remaining > 0
    const result = await db.execute(sql`
      WITH item_invoiced AS (
        SELECT ii.order_item_id, COALESCE(SUM(CAST(ii.quantity AS decimal)), 0) as qty_invoiced
        FROM invoice_items ii
        JOIN invoices i ON ii.invoice_id = i.id
        WHERE i.status != 'cancelled' AND ii.order_item_id IS NOT NULL
        GROUP BY ii.order_item_id
      )
      SELECT
        o.id as order_id, o.order_number, o.title as order_title, o.enterprise_id,
        e.name as enterprise_name,
        oi.id as order_item_id, oi.product_id, oi.product_name, oi.description,
        CAST(oi.quantity AS decimal) as quantity,
        CAST(oi.unit_price AS decimal) as unit_price,
        CAST(oi.subtotal AS decimal) as subtotal,
        COALESCE(inv.qty_invoiced, 0) as qty_invoiced,
        CAST(oi.quantity AS decimal) - COALESCE(inv.qty_invoiced, 0) as qty_remaining
      FROM order_items oi
      JOIN orders o ON oi.order_id = o.id
      LEFT JOIN enterprises e ON o.enterprise_id = e.id
      LEFT JOIN item_invoiced inv ON inv.order_item_id = oi.id
      WHERE ${whereClause}
        AND (CAST(oi.quantity AS decimal) - COALESCE(inv.qty_invoiced, 0)) > 0
      ORDER BY o.order_number DESC, oi.created_at ASC
    `);
    return (result as any).rows || [];
  }

  /**
   * Get invoice items with payment remaining per item.
   */
  async getInvoiceItemsWithRemaining(companyId: string, invoiceId: string) {
    const result = await db.execute(sql`
      SELECT ii.*,
        CAST(ii.subtotal AS decimal) as item_total,
        COALESCE((
          SELECT SUM(CAST(ciia.amount_applied AS decimal))
          FROM cobro_invoice_item_applications ciia
          WHERE ciia.invoice_item_id = ii.id
        ), 0) as paid,
        CAST(ii.subtotal AS decimal) - COALESCE((
          SELECT SUM(CAST(ciia.amount_applied AS decimal))
          FROM cobro_invoice_item_applications ciia
          WHERE ciia.invoice_item_id = ii.id
        ), 0) as remaining
      FROM invoice_items ii
      JOIN invoices i ON ii.invoice_id = i.id
      WHERE ii.invoice_id = ${invoiceId} AND i.company_id = ${companyId}
      ORDER BY ii.created_at ASC
    `);
    return (result as any).rows || [];
  }
}

export const invoicesService = new InvoicesService();
