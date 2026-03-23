import { db } from '../../config/db';
import { sql } from 'drizzle-orm';
import { ApiError } from '../../middlewares/errorHandler';
import { v4 as uuid } from 'uuid';

export class PagosService {
  private tablesEnsured = false;

  async ensureTables() {
    if (this.tablesEnsured) return;
    try {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS pagos (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
          enterprise_id UUID REFERENCES enterprises(id),
          purchase_id UUID REFERENCES purchases(id),
          amount DECIMAL(12,2) NOT NULL,
          payment_method VARCHAR(50) NOT NULL,
          bank_id UUID REFERENCES banks(id),
          reference VARCHAR(255),
          payment_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          notes TEXT,
          created_by UUID REFERENCES users(id),
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
      `);
      this.tablesEnsured = true;
    } catch (error) {
      console.error('Ensure pagos tables error:', error);
    }
  }

  async getPagos(companyId: string, filters: { enterprise_id?: string; business_unit_id?: string } = {}) {
    await this.ensureTables();
    try {
      let whereClause = sql`p.company_id = ${companyId}`;
      if (filters.business_unit_id) {
        whereClause = sql`${whereClause} AND p.business_unit_id = ${filters.business_unit_id}`;
      }
      if (filters.enterprise_id) {
        whereClause = sql`${whereClause} AND p.enterprise_id = ${filters.enterprise_id}`;
      }

      const result = await db.execute(sql`
        SELECT p.*,
          e.name as enterprise_name,
          pu.purchase_number,
          b.bank_name,
          -- Linked purchase invoices
          COALESCE((
            SELECT json_agg(json_build_object(
              'id', pia.id,
              'purchase_invoice_id', pia.purchase_invoice_id,
              'amount', pia.amount_applied,
              'invoice_number', pi.invoice_number,
              'invoice_type', pi.invoice_type,
              'invoice_total', pi.total_amount
            ))
            FROM pago_invoice_applications pia
            JOIN purchase_invoices pi ON pia.purchase_invoice_id = pi.id
            WHERE pia.pago_id = p.id
          ), '[]'::json) as linked_purchase_invoices,
          COALESCE((SELECT SUM(CAST(pia2.amount_applied AS decimal)) FROM pago_invoice_applications pia2 WHERE pia2.pago_id = p.id), 0) as total_assigned,
          COALESCE((SELECT json_agg(json_build_object('id',t.id,'name',t.name,'color',t.color))
            FROM entity_tags et JOIN tags t ON et.tag_id=t.id
            WHERE et.entity_id=e.id AND et.entity_type='enterprise'),'[]'::json) as enterprise_tags
        FROM pagos p
        LEFT JOIN enterprises e ON p.enterprise_id = e.id
        LEFT JOIN purchases pu ON p.purchase_id = pu.id
        LEFT JOIN banks b ON p.bank_id = b.id
        WHERE ${whereClause}
        ORDER BY p.payment_date DESC
      `);
      return (result as any).rows || result || [];
    } catch (error) {
      throw new ApiError(500, 'Failed to get pagos');
    }
  }

  async createPago(companyId: string, userId: string, data: any) {
    await this.ensureTables();

    const methodsRequiringBank = ['transferencia', 'cheque'];
    if (methodsRequiringBank.includes(data.payment_method) && !data.bank_id) {
      throw new ApiError(400, 'Se requiere seleccionar un banco para transferencia o cheque');
    }

    try {
      const pagoId = uuid();
      // Determine pending_status based on whether purchase_invoice_items are provided
      const hasInvoiceItems = data.purchase_invoice_items && Array.isArray(data.purchase_invoice_items) && data.purchase_invoice_items.length > 0;
      const pendingStatus = hasInvoiceItems ? null : 'pending_invoice';

      await db.execute(sql`
        INSERT INTO pagos (id, company_id, enterprise_id, purchase_id, amount, payment_method, bank_id, reference, payment_date, notes, business_unit_id, pending_status, created_by)
        VALUES (${pagoId}, ${companyId}, ${data.enterprise_id || null}, ${data.purchase_id || null}, ${data.amount}, ${data.payment_method}, ${data.bank_id || null}, ${data.reference || null}, ${data.payment_date || new Date().toISOString()}, ${data.notes || null}, ${data.business_unit_id || null}, ${pendingStatus}, ${userId})
      `);

      // Link pago to purchase invoices if items provided (N:N)
      if (hasInvoiceItems) {
        const piTotals = new Map<string, number>();

        for (const item of data.purchase_invoice_items) {
          if (!item.purchase_invoice_id) continue;

          // If item has sub-items (item-level detail), process each
          if (item.item_details && Array.isArray(item.item_details)) {
            for (const detail of item.item_details) {
              if (!detail.purchase_invoice_item_id || !detail.amount || parseFloat(detail.amount) <= 0) continue;
              await db.execute(sql`
                INSERT INTO pago_invoice_item_applications (id, pago_id, purchase_invoice_item_id, amount_applied, created_by)
                VALUES (${uuid()}, ${pagoId}, ${detail.purchase_invoice_item_id}, ${parseFloat(detail.amount).toString()}, ${userId})
                ON CONFLICT (pago_id, purchase_invoice_item_id) DO NOTHING
              `);
              const current = piTotals.get(item.purchase_invoice_id) || 0;
              piTotals.set(item.purchase_invoice_id, current + parseFloat(detail.amount));
            }
          } else if (item.amount && parseFloat(item.amount) > 0) {
            const current = piTotals.get(item.purchase_invoice_id) || 0;
            piTotals.set(item.purchase_invoice_id, current + parseFloat(item.amount));
          }
        }

        // Create invoice-level applications from totals
        for (const [piId, totalAmount] of piTotals.entries()) {
          await db.execute(sql`
            INSERT INTO pago_invoice_applications (id, pago_id, purchase_invoice_id, amount_applied, created_by)
            VALUES (${uuid()}, ${pagoId}, ${piId}, ${totalAmount.toString()}, ${userId})
            ON CONFLICT (pago_id, purchase_invoice_id) DO NOTHING
          `);
          await this.recalculatePurchaseInvoiceStatus(piId);
          await this.recalculatePurchaseStatusFromInvoices(piId);
        }
      }

      const result = await db.execute(sql`
        SELECT p.*, e.name as enterprise_name, pu.purchase_number, b.bank_name,
          COALESCE((SELECT json_agg(json_build_object('id',t.id,'name',t.name,'color',t.color))
            FROM entity_tags et JOIN tags t ON et.tag_id=t.id
            WHERE et.entity_id=e.id AND et.entity_type='enterprise'),'[]'::json) as enterprise_tags
        FROM pagos p
        LEFT JOIN enterprises e ON p.enterprise_id = e.id
        LEFT JOIN purchases pu ON p.purchase_id = pu.id
        LEFT JOIN banks b ON p.bank_id = b.id
        WHERE p.id = ${pagoId}
      `);
      const rows = (result as any).rows || result || [];
      return rows[0];
    } catch (error) {
      console.error('Create pago error:', error);
      throw new ApiError(500, 'Failed to create pago');
    }
  }

  async deletePago(companyId: string, pagoId: string) {
    await this.ensureTables();
    try {
      const check = await db.execute(sql`SELECT id FROM pagos WHERE id = ${pagoId} AND company_id = ${companyId}`);
      const rows = (check as any).rows || check || [];
      if (rows.length === 0) throw new ApiError(404, 'Pago not found');

      // Get linked purchase invoices before deleting (for recalculation)
      const linkedPIs = await db.execute(sql`
        SELECT purchase_invoice_id FROM pago_invoice_applications WHERE pago_id = ${pagoId}
      `);
      const piIds = ((linkedPIs as any).rows || []).map((r: any) => r.purchase_invoice_id);

      // Delete pago (CASCADE will delete pago_invoice_applications)
      await db.execute(sql`DELETE FROM pagos WHERE id = ${pagoId} AND company_id = ${companyId}`);

      // Recalculate payment_status for affected purchase invoices + cascade to purchases
      for (const piId of piIds) {
        await this.recalculatePurchaseInvoiceStatus(piId);
        await this.recalculatePurchaseStatusFromInvoices(piId);
      }

      return { success: true };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Failed to delete pago');
    }
  }

  private async recalculatePurchaseInvoiceStatus(purchaseInvoiceId: string) {
    try {
      const result = await db.execute(sql`
        SELECT
          CAST(pi.total_amount AS decimal) as total,
          COALESCE(SUM(CAST(pia.amount_applied AS decimal)), 0) as applied
        FROM purchase_invoices pi
        LEFT JOIN pago_invoice_applications pia ON pia.purchase_invoice_id = pi.id
        WHERE pi.id = ${purchaseInvoiceId}
        GROUP BY pi.id, pi.total_amount
      `);
      const row = ((result as any).rows || [])[0];
      if (!row) return;

      const total = parseFloat(row.total);
      const applied = parseFloat(row.applied);

      let status = 'pendiente';
      if (applied >= total && total > 0) status = 'pagado';
      else if (applied > 0) status = 'parcial';

      await db.execute(sql`
        UPDATE purchase_invoices SET payment_status = ${status} WHERE id = ${purchaseInvoiceId}
      `);
    } catch (error) {
      console.warn('Recalculate purchase invoice status error:', error);
    }
  }

  /**
   * Recalculate purchase.payment_status from ALL its purchase_invoices' pago applications.
   * Chain: pagos → purchase_invoices → purchase (cascada completa)
   */
  private async recalculatePurchaseStatusFromInvoices(purchaseInvoiceId: string) {
    try {
      // Get the purchase_id from this invoice
      const piResult = await db.execute(sql`
        SELECT purchase_id FROM purchase_invoices WHERE id = ${purchaseInvoiceId}
      `);
      const purchaseId = ((piResult as any).rows || [])[0]?.purchase_id;
      if (!purchaseId) return; // standalone invoice, no purchase to update

      // Calculate total paid across ALL purchase_invoices of this purchase
      const result = await db.execute(sql`
        SELECT
          CAST(p.total_amount AS decimal) as purchase_total,
          COALESCE((
            SELECT SUM(CAST(pia.amount_applied AS decimal))
            FROM pago_invoice_applications pia
            JOIN purchase_invoices pi ON pia.purchase_invoice_id = pi.id
            WHERE pi.purchase_id = ${purchaseId} AND pi.status != 'cancelled'
          ), 0) as total_paid
        FROM purchases p
        WHERE p.id = ${purchaseId}
      `);
      const row = ((result as any).rows || [])[0];
      if (!row) return;

      const purchaseTotal = parseFloat(row.purchase_total);
      const totalPaid = parseFloat(row.total_paid);

      let status = 'pendiente';
      if (totalPaid >= purchaseTotal && purchaseTotal > 0) status = 'pagada';
      else if (totalPaid > 0) status = 'parcial';

      await db.execute(sql`
        UPDATE purchases SET payment_status = ${status} WHERE id = ${purchaseId}
      `);
    } catch (error) {
      console.warn('Recalculate purchase status from invoices error:', error);
    }
  }

  async getSummary(companyId: string) {
    await this.ensureTables();
    try {
      const result = await db.execute(sql`
        SELECT COALESCE(SUM(CAST(amount AS decimal)), 0) as total_pagado, COUNT(*) as count
        FROM pagos WHERE company_id = ${companyId}
      `);
      const rows = (result as any).rows || result || [];
      return {
        total_pagado: parseFloat(rows[0]?.total_pagado || '0'),
        count: parseInt(rows[0]?.count || '0'),
      };
    } catch (error) {
      throw new ApiError(500, 'Failed to get pagos summary');
    }
  }
}

export const pagosService = new PagosService();
