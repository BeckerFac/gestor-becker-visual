import { db } from '../../config/db';
import { sql } from 'drizzle-orm';
import { ApiError } from '../../middlewares/errorHandler';
import { v4 as uuid } from 'uuid';
import { crmSyncService } from '../crm/crm-sync.service';

/**
 * CobrosService handles payment collection (cobranzas).
 *
 * IMPORTANT: As of the Razones Sociales refactor (2026-03-23):
 * - cobros.order_id and cobros.invoice_id are DEPRECATED direct links
 * - New system uses cobro_invoice_applications table for N:N cobro↔invoice linking
 * - Use CobroApplicationsService for linking/unlinking cobros to invoices
 * - cobros.pending_status = 'pending_invoice' marks cobros not yet linked to any invoice
 * - CC calculation uses cobro_invoice_applications, not these direct fields
 * - The recalculateOrderPaymentStatus() here is LEGACY - new calculation is in
 *   CobroApplicationsService.recalculateOrderPaymentStatusFromInvoices()
 */
export class CobrosService {
  private tablesEnsured = false;

  async ensureTables() {
    if (this.tablesEnsured) return;
    try {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS cobros (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
          enterprise_id UUID REFERENCES enterprises(id),
          order_id UUID REFERENCES orders(id),
          invoice_id UUID REFERENCES invoices(id),
          amount DECIMAL(12,2) NOT NULL,
          payment_method VARCHAR(50) NOT NULL,
          bank_id UUID REFERENCES banks(id),
          reference VARCHAR(255),
          payment_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          notes TEXT,
          receipt_image TEXT,
          created_by UUID REFERENCES users(id),
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
      `);
      await db.execute(sql`ALTER TABLE cobros ADD COLUMN IF NOT EXISTS receipt_image TEXT`);
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS cobro_items (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          cobro_id UUID NOT NULL REFERENCES cobros(id) ON DELETE CASCADE,
          order_item_id UUID NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
          amount_paid DECIMAL(12,2) NOT NULL,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
      `);
      this.tablesEnsured = true;
    } catch (error) {
      console.error('Ensure cobros tables error:', error);
    }
  }

  async getCobros(companyId: string, filters: { enterprise_id?: string; business_unit_id?: string } = {}) {
    await this.ensureTables();
    try {
      let whereClause = sql`c.company_id = ${companyId}`;
      if (filters.business_unit_id) {
        whereClause = sql`${whereClause} AND c.business_unit_id = ${filters.business_unit_id}`;
      }
      if (filters.enterprise_id) {
        whereClause = sql`${whereClause} AND c.enterprise_id = ${filters.enterprise_id}`;
      }

      const result = await db.execute(sql`
        SELECT c.*,
          e.name as enterprise_name,
          o.order_number, o.title as order_title,
          b.bank_name,
          c.receipt_image IS NOT NULL as has_receipt,
          (SELECT COUNT(*) FROM cobro_items ci WHERE ci.cobro_id = c.id) as item_count,
          COALESCE((SELECT json_agg(json_build_object('id',t.id,'name',t.name,'color',t.color)) FROM entity_tags et JOIN tags t ON et.tag_id=t.id WHERE et.entity_id=e.id AND et.entity_type='enterprise'),'[]'::json) as enterprise_tags
        FROM cobros c
        LEFT JOIN enterprises e ON c.enterprise_id = e.id
        LEFT JOIN orders o ON c.order_id = o.id
        LEFT JOIN banks b ON c.bank_id = b.id
        WHERE ${whereClause}
        ORDER BY c.payment_date DESC
      `);
      return (result as any).rows || result || [];
    } catch (error) {
      throw new ApiError(500, 'Failed to get cobros');
    }
  }

  async createCobro(companyId: string, userId: string, data: any) {
    await this.ensureTables();

    const methodsRequiringBank = ['transferencia', 'cheque'];
    if (methodsRequiringBank.includes(data.payment_method) && !data.bank_id) {
      throw new ApiError(400, 'Se requiere seleccionar un banco para transferencia o cheque');
    }

    try {
      const cobroId = uuid();
      // Determine pending_status: if no invoice linked, mark as pending_invoice
      const pendingStatus = data.invoice_id ? null : 'pending_invoice';
      await db.execute(sql`
        INSERT INTO cobros (id, company_id, enterprise_id, order_id, invoice_id, amount, payment_method, bank_id, reference, payment_date, notes, receipt_image, business_unit_id, pending_status, created_by)
        VALUES (${cobroId}, ${companyId}, ${data.enterprise_id || null}, ${data.order_id || null}, ${data.invoice_id || null}, ${data.amount}, ${data.payment_method}, ${data.bank_id || null}, ${data.reference || null}, ${data.payment_date || new Date().toISOString()}, ${data.notes || null}, ${data.receipt_image || null}, ${data.business_unit_id || null}, ${pendingStatus}, ${userId})
      `);

      // Insert cobro_items for partial payments
      if (data.items && Array.isArray(data.items) && data.items.length > 0) {
        for (const item of data.items) {
          if (!item.order_item_id || !item.amount_paid || Number(item.amount_paid) <= 0) continue;
          await db.execute(sql`
            INSERT INTO cobro_items (id, cobro_id, order_item_id, amount_paid)
            VALUES (${uuid()}, ${cobroId}, ${item.order_item_id}, ${Number(item.amount_paid).toString()})
          `);
        }
      }

      // Recalculate order payment status
      if (data.order_id) {
        await this.recalculateOrderPaymentStatus(data.order_id);
      }

      const result = await db.execute(sql`
        SELECT c.*, e.name as enterprise_name, o.order_number, b.bank_name
        FROM cobros c
        LEFT JOIN enterprises e ON c.enterprise_id = e.id
        LEFT JOIN orders o ON c.order_id = o.id
        LEFT JOIN banks b ON c.bank_id = b.id
        WHERE c.id = ${cobroId}
      `);
      const rows = (result as any).rows || result || [];
      const cobro = rows[0];

      // CRM Pipeline sync: check if fully paid, then trigger payment_received
      try {
        // Check if the linked order/invoice is now fully paid
        let isFullyPaid = false;
        if (data.order_id) {
          const orderPayStatus = await db.execute(sql`
            SELECT payment_status FROM orders WHERE id = ${data.order_id}
          `);
          const ps = ((orderPayStatus as any).rows || [])[0]?.payment_status;
          isFullyPaid = ps === 'pagado';
        }

        if (isFullyPaid) {
          // If order has an invoice, also link cobro to deal via invoice
          if (data.order_id) {
            const existingDeal = await crmSyncService.findDealByRelatedDocument(companyId, data.order_id, 'order');
            if (existingDeal) {
              await crmSyncService.linkDocumentToDeal(existingDeal.id, 'cobro', cobroId);
            }
          }
          if (data.invoice_id) {
            const existingDeal = await crmSyncService.findDealByRelatedDocument(companyId, data.invoice_id, 'invoice');
            if (existingDeal) {
              await crmSyncService.linkDocumentToDeal(existingDeal.id, 'cobro', cobroId);
            }
          }

          await crmSyncService.handleEvent({
            companyId,
            event: 'payment_received',
            enterpriseId: data.enterprise_id || undefined,
            documentId: cobroId,
            documentType: 'cobro',
            metadata: { amount: parseFloat(data.amount || '0') },
          });
        } else {
          // Partial payment: still link cobro to deal but don't trigger stage move
          if (data.order_id) {
            const existingDeal = await crmSyncService.findDealByRelatedDocument(companyId, data.order_id, 'order');
            if (existingDeal) {
              await crmSyncService.linkDocumentToDeal(existingDeal.id, 'cobro', cobroId);
            }
          }
          if (data.invoice_id) {
            const existingDeal = await crmSyncService.findDealByRelatedDocument(companyId, data.invoice_id, 'invoice');
            if (existingDeal) {
              await crmSyncService.linkDocumentToDeal(existingDeal.id, 'cobro', cobroId);
            }
          }
        }
      } catch (e) { console.error('CRM sync error (cobro_created):', e); }

      return cobro;
    } catch (error) {
      console.error('Create cobro error:', error);
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Failed to create cobro');
    }
  }

  async deleteCobro(companyId: string, cobroId: string) {
    await this.ensureTables();
    try {
      const check = await db.execute(sql`SELECT id, order_id FROM cobros WHERE id = ${cobroId} AND company_id = ${companyId}`);
      const rows = (check as any).rows || check || [];
      if (rows.length === 0) throw new ApiError(404, 'Cobro not found');
      const orderId = rows[0].order_id;

      await db.execute(sql`DELETE FROM cobros WHERE id = ${cobroId} AND company_id = ${companyId}`);

      if (orderId) {
        await this.recalculateOrderPaymentStatus(orderId);
      }

      return { success: true };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Failed to delete cobro');
    }
  }

  async recalculateOrderPaymentStatus(orderId: string) {
    try {
      const itemPaidResult = await db.execute(sql`
        SELECT COALESCE(SUM(CAST(ci.amount_paid AS decimal)), 0) as total
        FROM cobro_items ci JOIN cobros c ON ci.cobro_id = c.id
        WHERE c.order_id = ${orderId}
      `);
      const totalItemPaid = parseFloat(((itemPaidResult as any).rows || itemPaidResult)?.[0]?.total || '0');

      const genericResult = await db.execute(sql`
        SELECT COALESCE(SUM(CAST(c.amount AS decimal)), 0) as total
        FROM cobros c
        WHERE c.order_id = ${orderId}
          AND NOT EXISTS (SELECT 1 FROM cobro_items ci WHERE ci.cobro_id = c.id)
      `);
      const totalGeneric = parseFloat(((genericResult as any).rows || genericResult)?.[0]?.total || '0');

      const totalPaid = totalItemPaid + totalGeneric;

      const orderResult = await db.execute(sql`
        SELECT CAST(total_amount AS decimal) as total FROM orders WHERE id = ${orderId}
      `);
      const orderTotal = parseFloat(((orderResult as any).rows || orderResult)?.[0]?.total || '0');

      let status = 'pendiente';
      if (totalPaid >= orderTotal && orderTotal > 0) status = 'pagado';
      else if (totalPaid > 0) status = 'parcial';

      // Also propagate payment_method from most recent cobro
      const latestCobroResult = await db.execute(sql`
        SELECT payment_method FROM cobros
        WHERE order_id = ${orderId}
        ORDER BY payment_date DESC, created_at DESC LIMIT 1
      `);
      const latestMethod = ((latestCobroResult as any).rows || latestCobroResult)?.[0]?.payment_method || null;

      await db.execute(sql`
        UPDATE orders SET
          payment_status = ${status},
          payment_method = COALESCE(${latestMethod}, payment_method)
        WHERE id = ${orderId}
      `);
    } catch (error) {
      console.warn('Recalculate payment status error:', error);
    }
  }

  async getOrderPaymentDetails(companyId: string, orderId: string) {
    await this.ensureTables();
    try {
      const orderCheck = await db.execute(sql`
        SELECT id, CAST(total_amount AS decimal) as total_amount
        FROM orders WHERE id = ${orderId} AND company_id = ${companyId}
      `);
      const orderRows = (orderCheck as any).rows || orderCheck || [];
      if (orderRows.length === 0) throw new ApiError(404, 'Order not found');

      const items = await db.execute(sql`
        SELECT oi.id as order_item_id, oi.product_name, oi.description,
          CAST(oi.quantity AS decimal) as quantity,
          CAST(oi.unit_price AS decimal) as unit_price,
          CAST(oi.subtotal AS decimal) as subtotal,
          COALESCE((SELECT SUM(CAST(ci.amount_paid AS decimal)) FROM cobro_items ci WHERE ci.order_item_id = oi.id), 0) as total_paid
        FROM order_items oi WHERE oi.order_id = ${orderId} ORDER BY oi.created_at
      `);
      const itemRows = (items as any).rows || items || [];

      const cobros = await db.execute(sql`
        SELECT c.id, c.amount, c.payment_method, c.payment_date, c.reference, c.notes,
          (SELECT COUNT(*) FROM cobro_items ci WHERE ci.cobro_id = c.id) as item_count
        FROM cobros c WHERE c.order_id = ${orderId} ORDER BY c.payment_date DESC
      `);
      const cobroRows = (cobros as any).rows || cobros || [];

      const orderTotal = parseFloat(orderRows[0].total_amount || '0');
      const totalItemPaid = itemRows.reduce((s: number, it: any) => s + parseFloat(it.total_paid || '0'), 0);
      const totalGeneric = cobroRows.filter((c: any) => parseInt(c.item_count) === 0).reduce((s: number, c: any) => s + parseFloat(c.amount || '0'), 0);

      return {
        order_total: orderTotal,
        total_paid: totalItemPaid + totalGeneric,
        remaining: Math.max(0, orderTotal - totalItemPaid - totalGeneric),
        items: itemRows.map((it: any) => ({
          ...it,
          quantity: parseFloat(it.quantity),
          unit_price: parseFloat(it.unit_price),
          subtotal: parseFloat(it.subtotal),
          total_paid: parseFloat(it.total_paid),
          remaining: Math.max(0, parseFloat(it.subtotal) - parseFloat(it.total_paid)),
        })),
        cobros: cobroRows,
      };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Failed to get order payment details');
    }
  }

  async getCobroReceipt(companyId: string, cobroId: string) {
    await this.ensureTables();
    try {
      const result = await db.execute(sql`
        SELECT receipt_image FROM cobros WHERE id = ${cobroId} AND company_id = ${companyId}
      `);
      const rows = (result as any).rows || result || [];
      if (rows.length === 0) throw new ApiError(404, 'Cobro not found');
      if (!rows[0].receipt_image) throw new ApiError(404, 'No receipt found');
      return { receipt_image: rows[0].receipt_image };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Failed to get receipt');
    }
  }

  async getSummary(companyId: string) {
    await this.ensureTables();
    try {
      const result = await db.execute(sql`
        SELECT COALESCE(SUM(CAST(amount AS decimal)), 0) as total_cobrado, COUNT(*) as count
        FROM cobros WHERE company_id = ${companyId}
      `);
      const rows = (result as any).rows || result || [];
      return {
        total_cobrado: parseFloat(rows[0]?.total_cobrado || '0'),
        count: parseInt(rows[0]?.count || '0'),
      };
    } catch (error) {
      throw new ApiError(500, 'Failed to get cobros summary');
    }
  }
}

export const cobrosService = new CobrosService();
