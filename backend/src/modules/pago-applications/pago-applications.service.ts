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
      SELECT id, company_id, enterprise_id, business_unit_id, amount, pending_status, status
      FROM pagos WHERE id = ${pagoId} AND company_id = ${companyId}
    `);
    const pago = ((pagoResult as any).rows || [])[0];
    if (!pago) throw new ApiError(404, 'Pago no encontrado');

    // V0: pago not anulado
    if (pago.status === 'anulado') {
      throw new ApiError(409, 'No se puede vincular un pago anulado');
    }

    // Get purchase invoice
    const piResult = await db.execute(sql`
      SELECT id, company_id, enterprise_id, business_unit_id, total_amount, status
      FROM purchase_invoices WHERE id = ${purchaseInvoiceId} AND company_id = ${companyId}
    `);
    const pi = ((piResult as any).rows || [])[0];
    if (!pi) throw new ApiError(404, 'Factura de compra no encontrada');

    // V0b: purchase invoice not anulado
    if (pi.status === 'anulado' || pi.status === 'anulada') {
      throw new ApiError(409, 'No se puede vincular pago a factura de compra anulada');
    }

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

  /**
   * Remaining balance on a purchase invoice.
   * Includes retenciones practicadas via 3 paths:
   *   1) retenciones.purchase_invoice_id direct (preferred)
   *   2) retenciones.pago_id → pago_invoice_applications → purchase_invoice_id
   *      (only when retenciones.purchase_invoice_id IS NULL to avoid double counting)
   * Excludes anulado pagos in both paths.
   * Uses decimal arithmetic in SQL + epsilon-safe comparisons upstream.
   * TODO: unify with pagos.service.ts recalculatePurchaseInvoiceStatus in a later PR.
   */
  async getPurchaseInvoiceRemainingBalance(purchaseInvoiceId: string): Promise<number> {
    const result = await db.execute(sql`
      SELECT
        CAST(pi.total_amount AS decimal) as total,
        COALESCE((
          SELECT SUM(CAST(pia.amount_applied AS decimal))
          FROM pago_invoice_applications pia
          LEFT JOIN pagos p ON p.id = pia.pago_id
          WHERE pia.purchase_invoice_id = pi.id
            AND (p.status IS NULL OR p.status != 'anulado')
        ), 0) as applied_cash,
        COALESCE((
          SELECT SUM(CAST(r.amount AS decimal))
          FROM retenciones r
          LEFT JOIN pagos p2 ON p2.id = r.pago_id
          WHERE r.purchase_invoice_id = pi.id
            AND r.direction = 'practicada'
            AND (p2.status IS NULL OR p2.status != 'anulado')
        ), 0) as retenciones_total,
        COALESCE((
          SELECT SUM(CAST(r2.amount AS decimal))
          FROM retenciones r2
          JOIN pagos p3 ON p3.id = r2.pago_id
          JOIN pago_invoice_applications pia2 ON pia2.pago_id = p3.id
          WHERE pia2.purchase_invoice_id = pi.id
            AND r2.direction = 'practicada'
            AND r2.purchase_invoice_id IS NULL
            AND (p3.status IS NULL OR p3.status != 'anulado')
        ), 0) as retenciones_via_pago
      FROM purchase_invoices pi
      WHERE pi.id = ${purchaseInvoiceId}
    `);
    const row = ((result as any).rows || [])[0];
    if (!row) return 0;
    const total = parseFloat(row.total || '0');
    const applied =
      parseFloat(row.applied_cash || '0') +
      parseFloat(row.retenciones_total || '0') +
      parseFloat(row.retenciones_via_pago || '0');
    return total - applied;
  }

  /**
   * Unallocated cash in a pago.
   * IMPORTANT: uses pagos.amount (raw cash), NOT pagos.total_amount.
   * Since PR7-T19, pagos.total_amount = cash + retenciones practicadas.
   * Retenciones are NOT unallocatable cash — they are already tied to specific
   * invoices (or to the pago as a whole). Treating total_amount as the pool would
   * let a user over-allocate by the retention portion.
   */
  async getPagoUnallocatedBalance(pagoId: string): Promise<number> {
    const result = await db.execute(sql`
      SELECT
        CAST(p.amount AS decimal) as pago_cash,
        COALESCE(SUM(CAST(pia.amount_applied AS decimal)), 0) as allocated
      FROM pagos p
      LEFT JOIN pago_invoice_applications pia ON pia.pago_id = p.id
      WHERE p.id = ${pagoId}
      GROUP BY p.id, p.amount
    `);
    const row = ((result as any).rows || [])[0];
    if (!row) return 0;
    return parseFloat(row.pago_cash || '0') - parseFloat(row.allocated || '0');
  }

  /**
   * Recalculate purchase_invoices.payment_status after linking/unlinking a pago.
   *
   * Bug: previously only summed pago_invoice_applications.amount_applied, missing
   * retenciones practicadas. A PI of 121k paid with 100k cash + 21k retencion stayed
   * 'parcial' forever when this code path ran (POST /pago-applications).
   *
   * Fix: mirror pagos.service.ts recalculatePurchaseInvoiceStatus (FIX-03) and extend
   * it with a second retencion path (via pago_id) for legacy/mis-linked retenciones.
   * Also use an epsilon-safe comparison to survive decimal/float drift
   * (e.g. applied=99999.99999 vs total=100000 → pagado).
   *
   * TODO: consolidate this with pagos.service.ts version in a follow-up PR.
   */
  async recalculatePurchaseInvoicePaymentStatus(purchaseInvoiceId: string) {
    try {
      const result = await db.execute(sql`
        SELECT
          CAST(pi.total_amount AS decimal) as total,
          COALESCE((
            SELECT SUM(CAST(pia.amount_applied AS decimal))
            FROM pago_invoice_applications pia
            LEFT JOIN pagos p ON p.id = pia.pago_id
            WHERE pia.purchase_invoice_id = pi.id
              AND (p.status IS NULL OR p.status != 'anulado')
          ), 0) as applied_cash,
          COALESCE((
            SELECT SUM(CAST(r.amount AS decimal))
            FROM retenciones r
            LEFT JOIN pagos p2 ON p2.id = r.pago_id
            WHERE r.purchase_invoice_id = pi.id
              AND r.direction = 'practicada'
              AND (p2.status IS NULL OR p2.status != 'anulado')
          ), 0) as retenciones_total,
          COALESCE((
            SELECT SUM(CAST(r2.amount AS decimal))
            FROM retenciones r2
            JOIN pagos p3 ON p3.id = r2.pago_id
            JOIN pago_invoice_applications pia2 ON pia2.pago_id = p3.id
            WHERE pia2.purchase_invoice_id = pi.id
              AND r2.direction = 'practicada'
              AND r2.purchase_invoice_id IS NULL
              AND (p3.status IS NULL OR p3.status != 'anulado')
          ), 0) as retenciones_via_pago
        FROM purchase_invoices pi
        WHERE pi.id = ${purchaseInvoiceId}
      `);
      const row = ((result as any).rows || [])[0];
      if (!row) return;

      const total = parseFloat(row.total || '0');
      const applied =
        parseFloat(row.applied_cash || '0') +
        parseFloat(row.retenciones_total || '0') +
        parseFloat(row.retenciones_via_pago || '0');

      const EPSILON = 0.01;
      let status = 'pendiente';
      if (total > 0 && applied + EPSILON >= total) status = 'pagado';
      else if (applied > EPSILON) status = 'parcial';

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
            WHERE pi.purchase_id = ${purchaseId} AND pi.status NOT IN ('cancelled', 'cancelado')
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

  /**
   * Get available credit (unallocated pago balance) for a provider enterprise.
   * Returns pagos with excess amounts not yet applied to purchase invoices, ordered FIFO by date.
   */
  async getCreditoProveedorDisponible(companyId: string, enterpriseId: string) {
    const result = await db.execute(sql`
      SELECT p.id, p.receipt_number, p.payment_date, p.payment_method,
        CAST(COALESCE(p.total_amount, p.amount) AS decimal) as pago_total,
        COALESCE(SUM(CAST(pia.amount_applied AS decimal)), 0) as aplicado,
        CAST(COALESCE(p.total_amount, p.amount) AS decimal) - COALESCE(SUM(CAST(pia.amount_applied AS decimal)), 0) as disponible
      FROM pagos p
      LEFT JOIN pago_invoice_applications pia ON pia.pago_id = p.id
      WHERE p.company_id = ${companyId} AND p.enterprise_id = ${enterpriseId}
      GROUP BY p.id
      HAVING CAST(COALESCE(p.total_amount, p.amount) AS decimal) - COALESCE(SUM(CAST(pia.amount_applied AS decimal)), 0) > 0.01
      ORDER BY p.payment_date ASC
    `);
    return (result as any).rows || [];
  }

  /**
   * Apply credit from existing pagos (FIFO by date) to a purchase invoice.
   * Uses linkPagoToPurchaseInvoice for each application so all validations and side-effects run.
   */
  async applyCreditProveedor(
    companyId: string,
    userId: string,
    enterpriseId: string,
    purchaseInvoiceId: string,
    maxAmount: number
  ) {
    if (!maxAmount || maxAmount <= 0) {
      throw new ApiError(400, 'El monto maximo debe ser mayor a 0');
    }

    const creditos = await this.getCreditoProveedorDisponible(companyId, enterpriseId);
    let remaining = maxAmount;
    const applications: Array<{ pago_id: string; receipt_number: string; amount: number }> = [];

    for (const credito of creditos) {
      if (remaining <= 0.01) break;
      const disponible = parseFloat(credito.disponible);
      const toApply = Math.min(disponible, remaining);

      try {
        await this.linkPagoToPurchaseInvoice(companyId, userId, credito.id, purchaseInvoiceId, toApply);
        applications.push({
          pago_id: credito.id,
          receipt_number: credito.receipt_number,
          amount: toApply,
        });
        remaining -= toApply;
      } catch (err: any) {
        console.warn(`Skipping credit from pago ${credito.id}: ${err.message}`);
      }
    }

    return {
      applied: maxAmount - remaining,
      remaining,
      applications,
    };
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
        COALESCE(p.total_amount, p.amount) - COALESCE((SELECT SUM(CAST(pia.amount_applied AS decimal)) FROM pago_invoice_applications pia WHERE pia.pago_id = p.id), 0) as unallocated_balance
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
    let whereClause = sql`pi.company_id = ${companyId} AND pi.status NOT IN ('cancelled', 'cancelado') AND pi.payment_status != 'pagado'`;
    if (filters.enterprise_id) {
      whereClause = sql`${whereClause} AND pi.enterprise_id = ${filters.enterprise_id}`;
    }
    if (filters.business_unit_id) {
      whereClause = sql`${whereClause} AND pi.business_unit_id = ${filters.business_unit_id}`;
    }

    const result = await db.execute(sql`
      SELECT pi.id, pi.invoice_number, pi.invoice_type, pi.invoice_date,
        pi.total_amount, pi.payment_status, pi.status,
        pi.retenciones_previstas,
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
