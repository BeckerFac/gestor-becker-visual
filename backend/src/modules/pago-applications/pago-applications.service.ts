import { db } from '../../config/db';
import { sql } from 'drizzle-orm';
import { ApiError } from '../../middlewares/errorHandler';
import { v4 as uuid } from 'uuid';

export class PagoApplicationsService {

  /**
   * Link a pago to a purchase invoice with a specific amount.
   */
  async linkPagoToPurchaseInvoice(
    companyId: string,
    userId: string,
    pagoId: string,
    purchaseInvoiceId: string,
    amountApplied: number,
    notes?: string
  ) {
    if (!amountApplied || amountApplied <= 0) {
      throw new ApiError(400, 'El monto a aplicar debe ser mayor a 0');
    }

    // Get pago
    const pagoResult = await db.execute(sql`
      SELECT id, company_id, enterprise_id, business_unit_id, amount, pending_status
      FROM pagos WHERE id = ${pagoId} AND company_id = ${companyId}
    `);
    const pago = ((pagoResult as any).rows || [])[0];
    if (!pago) throw new ApiError(404, 'Pago no encontrado');

    // Get purchase invoice
    const piResult = await db.execute(sql`
      SELECT id, company_id, enterprise_id, business_unit_id, total_amount, status
      FROM purchase_invoices WHERE id = ${purchaseInvoiceId} AND company_id = ${companyId}
    `);
    const pi = ((piResult as any).rows || [])[0];
    if (!pi) throw new ApiError(404, 'Factura de compra no encontrada');

    // V1: Same business unit
    if (pago.business_unit_id && pi.business_unit_id && pago.business_unit_id !== pi.business_unit_id) {
      throw new ApiError(400, 'Pago y factura de compra deben ser de la misma razon social');
    }

    // V2: Same enterprise (provider)
    if (pago.enterprise_id && pi.enterprise_id && pago.enterprise_id !== pi.enterprise_id) {
      throw new ApiError(400, 'Pago y factura de compra deben ser del mismo proveedor');
    }

    // V3: Purchase invoice not cancelled
    if (pi.status === 'cancelled') {
      throw new ApiError(400, 'No se puede vincular pago a factura de compra cancelada');
    }

    // V4: Check duplicate
    const existingResult = await db.execute(sql`
      SELECT id FROM pago_invoice_applications
      WHERE pago_id = ${pagoId} AND purchase_invoice_id = ${purchaseInvoiceId}
    `);
    if (((existingResult as any).rows || []).length > 0) {
      throw new ApiError(409, 'Este pago ya esta vinculado a esta factura de compra');
    }

    // V5: Check pago unallocated balance
    const pagoBalance = await this.getPagoUnallocatedBalance(pagoId);
    if (amountApplied > pagoBalance + 0.01) {
      throw new ApiError(400, `Solo quedan $${pagoBalance.toFixed(2)} sin asignar en este pago`);
    }

    // V6: Check purchase invoice remaining balance
    const piBalance = await this.getPurchaseInvoiceRemainingBalance(purchaseInvoiceId);
    if (amountApplied > piBalance + 0.01) {
      throw new ApiError(400, `Solo quedan $${piBalance.toFixed(2)} por pagar en esta factura de compra`);
    }

    // INSERT application
    const appId = uuid();
    await db.execute(sql`
      INSERT INTO pago_invoice_applications (id, pago_id, purchase_invoice_id, amount_applied, created_by)
      VALUES (${appId}, ${pagoId}, ${purchaseInvoiceId}, ${amountApplied.toString()}, ${userId})
    `);

    // Recalculate purchase invoice payment_status → cascade to purchase
    await this.recalculatePurchaseInvoicePaymentStatus(purchaseInvoiceId);
    await this.recalculatePurchaseStatusFromInvoice(purchaseInvoiceId);

    // Update pago pending_status
    const newPagoBalance = await this.getPagoUnallocatedBalance(pagoId);
    if (newPagoBalance <= 0.01) {
      await db.execute(sql`UPDATE pagos SET pending_status = NULL WHERE id = ${pagoId}`);
    }

    const result = await db.execute(sql`
      SELECT pia.*,
        pi.invoice_number, pi.invoice_type, pi.total_amount as pi_total,
        pi.payment_status as pi_payment_status
      FROM pago_invoice_applications pia
      JOIN purchase_invoices pi ON pia.purchase_invoice_id = pi.id
      WHERE pia.id = ${appId}
    `);
    return ((result as any).rows || [])[0];
  }

  async unlinkPagoFromPurchaseInvoice(companyId: string, pagoId: string, purchaseInvoiceId: string) {
    const pagoCheck = await db.execute(sql`
      SELECT id FROM pagos WHERE id = ${pagoId} AND company_id = ${companyId}
    `);
    if (((pagoCheck as any).rows || []).length === 0) {
      throw new ApiError(404, 'Pago no encontrado');
    }

    const deleteResult = await db.execute(sql`
      DELETE FROM pago_invoice_applications
      WHERE pago_id = ${pagoId} AND purchase_invoice_id = ${purchaseInvoiceId}
      RETURNING id
    `);
    if (((deleteResult as any).rows || []).length === 0) {
      throw new ApiError(404, 'Vinculacion no encontrada');
    }

    await this.recalculatePurchaseInvoicePaymentStatus(purchaseInvoiceId);
    await this.recalculatePurchaseStatusFromInvoice(purchaseInvoiceId);

    // Mark pago as pending if fully unlinked
    const pagoBalance = await this.getPagoUnallocatedBalance(pagoId);
    const pagoAmount = await db.execute(sql`SELECT amount FROM pagos WHERE id = ${pagoId}`);
    const totalAmount = parseFloat(((pagoAmount as any).rows || [])[0]?.amount || '0');
    if (pagoBalance >= totalAmount) {
      await db.execute(sql`UPDATE pagos SET pending_status = 'pending_invoice' WHERE id = ${pagoId}`);
    }

    return { success: true };
  }

  async getPagoApplications(companyId: string, pagoId: string) {
    const result = await db.execute(sql`
      SELECT pia.*,
        pi.invoice_number, pi.invoice_type, pi.total_amount as pi_total,
        pi.payment_status as pi_payment_status, pi.invoice_date,
        e.name as enterprise_name
      FROM pago_invoice_applications pia
      JOIN purchase_invoices pi ON pia.purchase_invoice_id = pi.id
      JOIN pagos p ON pia.pago_id = p.id
      LEFT JOIN enterprises e ON pi.enterprise_id = e.id
      WHERE pia.pago_id = ${pagoId} AND p.company_id = ${companyId}
      ORDER BY pia.applied_at DESC
    `);
    return (result as any).rows || [];
  }

  async getPurchaseInvoicePagos(companyId: string, purchaseInvoiceId: string) {
    const result = await db.execute(sql`
      SELECT pia.*,
        p.amount as pago_total, p.payment_method, p.payment_date,
        p.reference, p.notes as pago_notes,
        b.bank_name
      FROM pago_invoice_applications pia
      JOIN pagos p ON pia.pago_id = p.id
      JOIN purchase_invoices pi ON pia.purchase_invoice_id = pi.id
      LEFT JOIN banks b ON p.bank_id = b.id
      WHERE pia.purchase_invoice_id = ${purchaseInvoiceId} AND pi.company_id = ${companyId}
      ORDER BY pia.applied_at DESC
    `);
    return (result as any).rows || [];
  }

  async getPurchaseInvoiceRemainingBalance(purchaseInvoiceId: string): Promise<number> {
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
    if (!row) return 0;
    return parseFloat(row.total) - parseFloat(row.applied);
  }

  async getPagoUnallocatedBalance(pagoId: string): Promise<number> {
    const result = await db.execute(sql`
      SELECT
        CAST(p.amount AS decimal) as total,
        COALESCE(SUM(CAST(pia.amount_applied AS decimal)), 0) as allocated
      FROM pagos p
      LEFT JOIN pago_invoice_applications pia ON pia.pago_id = p.id
      WHERE p.id = ${pagoId}
      GROUP BY p.id, p.amount
    `);
    const row = ((result as any).rows || [])[0];
    if (!row) return 0;
    return parseFloat(row.total) - parseFloat(row.allocated);
  }

  async recalculatePurchaseInvoicePaymentStatus(purchaseInvoiceId: string) {
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
      console.warn('Recalculate purchase invoice payment status error:', error);
    }
  }

  /**
   * Cascade: get purchase_id from PI and recalculate purchase.payment_status
   */
  private async recalculatePurchaseStatusFromInvoice(purchaseInvoiceId: string) {
    try {
      const piResult = await db.execute(sql`
        SELECT purchase_id FROM purchase_invoices WHERE id = ${purchaseInvoiceId}
      `);
      const purchaseId = ((piResult as any).rows || [])[0]?.purchase_id;
      if (!purchaseId) return; // standalone invoice

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

      await db.execute(sql`UPDATE purchases SET payment_status = ${status} WHERE id = ${purchaseId}`);
    } catch (error) {
      console.warn('Recalculate purchase status from invoice error:', error);
    }
  }

  async getPendingPagos(companyId: string, filters: {
    enterprise_id?: string;
    business_unit_id?: string;
  } = {}) {
    let whereClause = sql`p.company_id = ${companyId} AND p.pending_status = 'pending_invoice'`;
    if (filters.enterprise_id) {
      whereClause = sql`${whereClause} AND p.enterprise_id = ${filters.enterprise_id}`;
    }
    if (filters.business_unit_id) {
      whereClause = sql`${whereClause} AND p.business_unit_id = ${filters.business_unit_id}`;
    }

    const result = await db.execute(sql`
      SELECT p.*,
        e.name as enterprise_name,
        b.bank_name,
        p.amount - COALESCE((SELECT SUM(CAST(pia.amount_applied AS decimal)) FROM pago_invoice_applications pia WHERE pia.pago_id = p.id), 0) as unallocated_balance
      FROM pagos p
      LEFT JOIN enterprises e ON p.enterprise_id = e.id
      LEFT JOIN banks b ON p.bank_id = b.id
      WHERE ${whereClause}
      ORDER BY p.payment_date DESC
    `);
    return (result as any).rows || [];
  }

  async getAvailablePurchaseInvoicesForLinking(companyId: string, filters: {
    enterprise_id?: string;
    business_unit_id?: string;
  } = {}) {
    let whereClause = sql`pi.company_id = ${companyId} AND pi.status != 'cancelled' AND pi.payment_status != 'pagado'`;
    if (filters.enterprise_id) {
      whereClause = sql`${whereClause} AND pi.enterprise_id = ${filters.enterprise_id}`;
    }
    if (filters.business_unit_id) {
      whereClause = sql`${whereClause} AND pi.business_unit_id = ${filters.business_unit_id}`;
    }

    const result = await db.execute(sql`
      SELECT pi.id, pi.invoice_number, pi.invoice_type, pi.invoice_date,
        pi.total_amount, pi.payment_status, pi.status,
        e.name as enterprise_name,
        pi.total_amount - COALESCE((SELECT SUM(CAST(pia.amount_applied AS decimal)) FROM pago_invoice_applications pia WHERE pia.purchase_invoice_id = pi.id), 0) as remaining_balance
      FROM purchase_invoices pi
      LEFT JOIN enterprises e ON pi.enterprise_id = e.id
      WHERE ${whereClause}
      ORDER BY pi.invoice_date DESC
    `);
    return (result as any).rows || [];
  }
}

export const pagoApplicationsService = new PagoApplicationsService();
