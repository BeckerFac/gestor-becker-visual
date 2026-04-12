import { db } from '../../config/db';
import { sql } from 'drizzle-orm';
import { ApiError } from '../../middlewares/errorHandler';
import { v4 as uuid } from 'uuid';

export class CobroApplicationsService {

  /**
   * Link a cobro to an invoice with a specific amount.
   * This is the CORE operation of the financial system.
   *
   * Validations:
   * - Same business_unit_id
   * - Same enterprise_id (client)
   * - amount_applied <= cobro unallocated balance
   * - amount_applied <= invoice remaining balance
   * - Invoice not cancelled
   * - No duplicate (cobro_id, invoice_id)
   */
  async linkCobroToInvoice(
    companyId: string,
    userId: string,
    cobroId: string,
    invoiceId: string,
    amountApplied: number,
    notes?: string
  ) {
    if (!amountApplied || amountApplied <= 0) {
      throw new ApiError(400, 'El monto a aplicar debe ser mayor a 0');
    }

    // Get cobro from unified cobros table (receipts migrated in auto-migration)
    const cobroResult = await db.execute(sql`
      SELECT id, company_id, enterprise_id, business_unit_id, amount, pending_status
      FROM cobros WHERE id = ${cobroId} AND company_id = ${companyId}
    `);
    const cobro = ((cobroResult as any).rows || [])[0];
    if (!cobro) throw new ApiError(404, 'Cobro no encontrado');

    // Get invoice
    const invoiceResult = await db.execute(sql`
      SELECT id, company_id, enterprise_id, business_unit_id, total_amount, status, payment_status, order_id
      FROM invoices WHERE id = ${invoiceId} AND company_id = ${companyId}
    `);
    const invoice = ((invoiceResult as any).rows || [])[0];
    if (!invoice) throw new ApiError(404, 'Factura no encontrada');

    // V1: Same business unit
    if (cobro.business_unit_id && invoice.business_unit_id && cobro.business_unit_id !== invoice.business_unit_id) {
      throw new ApiError(400, 'Cobro y factura deben ser de la misma razon social');
    }

    // V2: Same enterprise (client)
    if (cobro.enterprise_id && invoice.enterprise_id && cobro.enterprise_id !== invoice.enterprise_id) {
      throw new ApiError(400, 'Cobro y factura deben ser del mismo cliente');
    }

    // V3: Invoice not cancelled
    if (invoice.status === 'cancelled') {
      throw new ApiError(400, 'No se puede vincular cobro a factura cancelada');
    }

    // V4: Check duplicate
    const existingResult = await db.execute(sql`
      SELECT id FROM cobro_invoice_applications
      WHERE cobro_id = ${cobroId} AND invoice_id = ${invoiceId}
    `);
    if (((existingResult as any).rows || []).length > 0) {
      throw new ApiError(409, 'Este cobro ya esta vinculado a esta factura');
    }

    // V5: Check cobro unallocated balance
    const cobroBalance = await this.getCobroUnallocatedBalance(cobroId);
    if (amountApplied > cobroBalance + 0.01) { // 1 cent tolerance for rounding
      throw new ApiError(400, `Solo quedan $${cobroBalance.toFixed(2)} sin asignar en este cobro`);
    }

    // V6: Check invoice remaining balance
    const invoiceBalance = await this.getInvoiceRemainingBalance(invoiceId);
    if (amountApplied > invoiceBalance + 0.01) {
      throw new ApiError(400, `Solo quedan $${invoiceBalance.toFixed(2)} por cobrar en esta factura`);
    }

    // INSERT application
    const appId = uuid();
    await db.execute(sql`
      INSERT INTO cobro_invoice_applications (id, cobro_id, invoice_id, amount_applied, created_by, notes)
      VALUES (${appId}, ${cobroId}, ${invoiceId}, ${amountApplied.toString()}, ${userId}, ${notes || null})
    `);

    // Recalculate invoice payment_status
    await this.recalculateInvoicePaymentStatus(invoiceId);

    // Recalculate order payment_status for ALL linked orders (via invoice_orders + legacy order_id)
    const linkedOrderIds = await db.execute(sql`
      SELECT order_id FROM invoice_orders WHERE invoice_id = ${invoiceId}
      UNION
      SELECT order_id FROM invoices WHERE id = ${invoiceId} AND order_id IS NOT NULL
    `);
    for (const row of ((linkedOrderIds as any).rows || [])) {
      await this.recalculateOrderPaymentStatusFromInvoices(row.order_id);
    }

    // Update cobro pending_status: once ANY invoice is linked, it's no longer "pending_invoice"
    if (cobro.pending_status === 'pending_invoice') {
      await db.execute(sql`
        UPDATE cobros SET pending_status = NULL WHERE id = ${cobroId}
      `);
    }

    // Return the created application with context
    const result = await db.execute(sql`
      SELECT cia.*,
        i.invoice_number, i.invoice_type, i.total_amount as invoice_total,
        i.status as invoice_status, i.payment_status as invoice_payment_status
      FROM cobro_invoice_applications cia
      JOIN invoices i ON cia.invoice_id = i.id
      WHERE cia.id = ${appId}
    `);
    return ((result as any).rows || [])[0];
  }

  /**
   * Unlink a cobro from an invoice.
   */
  async unlinkCobroFromInvoice(companyId: string, cobroId: string, invoiceId: string) {
    // Verify cobro belongs to company
    const cobroCheck = await db.execute(sql`
      SELECT id FROM cobros WHERE id = ${cobroId} AND company_id = ${companyId}
    `);
    if (((cobroCheck as any).rows || []).length === 0) {
      throw new ApiError(404, 'Cobro no encontrado');
    }

    // Delete application
    const deleteResult = await db.execute(sql`
      DELETE FROM cobro_invoice_applications
      WHERE cobro_id = ${cobroId} AND invoice_id = ${invoiceId}
      RETURNING id
    `);
    if (((deleteResult as any).rows || []).length === 0) {
      throw new ApiError(404, 'Vinculacion no encontrada');
    }

    // Recalculate invoice payment_status
    await this.recalculateInvoicePaymentStatus(invoiceId);

    // Recalculate order payment_status for ALL linked orders (via invoice_orders + legacy order_id)
    const orderIdsResult = await db.execute(sql`
      SELECT order_id FROM invoice_orders WHERE invoice_id = ${invoiceId}
      UNION
      SELECT order_id FROM invoices WHERE id = ${invoiceId} AND order_id IS NOT NULL
    `);
    const orderIds = ((orderIdsResult as any).rows || []).map((r: any) => r.order_id);
    for (const orderId of orderIds) {
      await this.recalculateOrderPaymentStatusFromInvoices(orderId);
    }

    // Check if cobro now has unallocated balance → mark as pending
    const cobroBalance = await this.getCobroUnallocatedBalance(cobroId);
    const cobroAmount = await db.execute(sql`SELECT amount FROM cobros WHERE id = ${cobroId}`);
    const totalAmount = parseFloat(((cobroAmount as any).rows || [])[0]?.amount || '0');

    if (cobroBalance >= totalAmount) {
      // Fully unlinked
      await db.execute(sql`
        UPDATE cobros SET pending_status = 'pending_invoice' WHERE id = ${cobroId}
      `);
    }

    return { success: true };
  }

  /**
   * Get all invoice applications for a cobro.
   */
  async getCobroApplications(companyId: string, cobroId: string) {
    const result = await db.execute(sql`
      SELECT cia.*,
        i.invoice_number, i.invoice_type, i.total_amount as invoice_total,
        i.status as invoice_status, i.payment_status as invoice_payment_status,
        i.invoice_date,
        e.name as enterprise_name
      FROM cobro_invoice_applications cia
      JOIN invoices i ON cia.invoice_id = i.id
      JOIN cobros c ON cia.cobro_id = c.id
      LEFT JOIN enterprises e ON i.enterprise_id = e.id
      WHERE cia.cobro_id = ${cobroId} AND c.company_id = ${companyId}
      ORDER BY cia.applied_at DESC
    `);
    return (result as any).rows || [];
  }

  /**
   * Get all cobro applications for an invoice.
   */
  async getInvoiceCobros(companyId: string, invoiceId: string) {
    const result = await db.execute(sql`
      SELECT cia.*,
        c.amount as cobro_total, c.payment_method, c.payment_date,
        c.reference, c.notes as cobro_notes,
        b.bank_name
      FROM cobro_invoice_applications cia
      JOIN cobros c ON cia.cobro_id = c.id
      JOIN invoices i ON cia.invoice_id = i.id
      LEFT JOIN banks b ON c.bank_id = b.id
      WHERE cia.invoice_id = ${invoiceId} AND i.company_id = ${companyId}
      ORDER BY cia.applied_at DESC
    `);
    return (result as any).rows || [];
  }

  /**
   * Get remaining balance for an invoice (total - applied cobros).
   */
  async getInvoiceRemainingBalance(invoiceId: string): Promise<number> {
    const result = await db.execute(sql`
      SELECT
        CAST(i.total_amount AS decimal) as total,
        COALESCE(SUM(CAST(cia.amount_applied AS decimal)), 0) as applied
      FROM invoices i
      LEFT JOIN cobro_invoice_applications cia ON cia.invoice_id = i.id
      WHERE i.id = ${invoiceId}
      GROUP BY i.id, i.total_amount
    `);
    const row = ((result as any).rows || [])[0];
    if (!row) return 0;
    return parseFloat(row.total) - parseFloat(row.applied);
  }

  /**
   * Get unallocated balance for a cobro (total - applied to invoices).
   */
  async getCobroUnallocatedBalance(cobroId: string): Promise<number> {
    const result = await db.execute(sql`
      SELECT
        CAST(COALESCE(c.total_amount, c.amount) AS decimal) as total,
        COALESCE(SUM(CAST(cia.amount_applied AS decimal)), 0) as allocated
      FROM cobros c
      LEFT JOIN cobro_invoice_applications cia ON cia.cobro_id = c.id
      WHERE c.id = ${cobroId}
      GROUP BY c.id, c.total_amount, c.amount
    `);
    const row = ((result as any).rows || [])[0];
    if (!row) return 0;
    return parseFloat(row.total) - parseFloat(row.allocated);
  }

  /**
   * Get invoice balance with full detail.
   */
  async getInvoiceBalanceDetail(companyId: string, invoiceId: string) {
    const invoiceResult = await db.execute(sql`
      SELECT i.id, i.invoice_number, i.invoice_type, i.total_amount, i.payment_status, i.status
      FROM invoices i
      WHERE i.id = ${invoiceId} AND i.company_id = ${companyId}
    `);
    const invoice = ((invoiceResult as any).rows || [])[0];
    if (!invoice) throw new ApiError(404, 'Factura no encontrada');

    const remaining = await this.getInvoiceRemainingBalance(invoiceId);
    const cobros = await this.getInvoiceCobros(companyId, invoiceId);

    const totalApplied = cobros.reduce((sum: number, c: any) => sum + parseFloat(c.amount_applied || '0'), 0);

    return {
      invoice_id: invoiceId,
      invoice_number: invoice.invoice_number,
      invoice_type: invoice.invoice_type,
      total_amount: parseFloat(invoice.total_amount),
      total_applied: totalApplied,
      remaining,
      payment_status: invoice.payment_status,
      cobros_count: cobros.length,
      cobros,
    };
  }

  /**
   * Get cobro balance with full detail.
   */
  async getCobroBalanceDetail(companyId: string, cobroId: string) {
    const cobroResult = await db.execute(sql`
      SELECT c.id, c.amount, c.total_amount, c.payment_method, c.payment_date, c.pending_status,
        e.name as enterprise_name
      FROM cobros c
      LEFT JOIN enterprises e ON c.enterprise_id = e.id
      WHERE c.id = ${cobroId} AND c.company_id = ${companyId}
    `);
    const cobro = ((cobroResult as any).rows || [])[0];
    if (!cobro) throw new ApiError(404, 'Cobro no encontrado');

    const unallocated = await this.getCobroUnallocatedBalance(cobroId);
    const applications = await this.getCobroApplications(companyId, cobroId);

    const totalAllocated = applications.reduce((sum: number, a: any) => sum + parseFloat(a.amount_applied || '0'), 0);

    return {
      cobro_id: cobroId,
      total_amount: parseFloat(cobro.total_amount || cobro.amount),
      total_allocated: totalAllocated,
      unallocated,
      pending_status: cobro.pending_status,
      enterprise_name: cobro.enterprise_name,
      applications_count: applications.length,
      applications,
    };
  }

  /**
   * Recalculate payment_status for an invoice based on applications.
   */
  async recalculateInvoicePaymentStatus(invoiceId: string) {
    try {
      const result = await db.execute(sql`
        SELECT
          CAST(i.total_amount AS decimal) as total,
          COALESCE(SUM(CAST(cia.amount_applied AS decimal)), 0) as applied
        FROM invoices i
        LEFT JOIN cobro_invoice_applications cia ON cia.invoice_id = i.id
        WHERE i.id = ${invoiceId}
        GROUP BY i.id, i.total_amount
      `);
      const row = ((result as any).rows || [])[0];
      if (!row) return;

      const total = parseFloat(row.total);
      const applied = parseFloat(row.applied);

      let status = 'pendiente';
      if (applied >= total && total > 0) status = 'pagado';
      else if (applied > 0) status = 'parcial';

      await db.execute(sql`
        UPDATE invoices SET payment_status = ${status} WHERE id = ${invoiceId}
      `);
    } catch (error) {
      console.warn('Recalculate invoice payment status error:', error);
    }
  }

  /**
   * Recalculate order payment_status derived from its invoices' cobro applications.
   * order.payment_status = sum of all cobro_invoice_applications for all invoices of this order.
   */
  async recalculateOrderPaymentStatusFromInvoices(orderId: string) {
    try {
      const result = await db.execute(sql`
        SELECT
          CAST(o.total_amount AS decimal) as order_total,
          COALESCE(SUM(CAST(cia.amount_applied AS decimal)), 0) as total_paid
        FROM orders o
        LEFT JOIN (
          SELECT DISTINCT io.order_id, i.id as invoice_id
          FROM invoices i
          JOIN invoice_orders io ON io.invoice_id = i.id
          WHERE i.status != 'cancelled'
          UNION
          SELECT i.order_id, i.id as invoice_id
          FROM invoices i
          WHERE i.order_id IS NOT NULL AND i.status != 'cancelled'
        ) inv ON inv.order_id = o.id
        LEFT JOIN cobro_invoice_applications cia ON cia.invoice_id = inv.invoice_id
        WHERE o.id = ${orderId}
        GROUP BY o.id, o.total_amount
      `);
      const row = ((result as any).rows || [])[0];
      if (!row) return;

      const orderTotal = parseFloat(row.order_total);
      const totalPaid = parseFloat(row.total_paid);

      let status = 'pendiente';
      if (totalPaid >= orderTotal && orderTotal > 0) status = 'pagado';
      else if (totalPaid > 0) status = 'parcial';

      await db.execute(sql`
        UPDATE orders SET payment_status = ${status} WHERE id = ${orderId}
      `);
    } catch (error) {
      console.warn('Recalculate order payment status from invoices error:', error);
    }
  }

  /**
   * Get available credit (unallocated cobro balance) for an enterprise.
   * Returns cobros with excess amounts not yet applied to invoices, ordered FIFO by date.
   */
  async getCreditoDisponible(companyId: string, enterpriseId: string) {
    const result = await db.execute(sql`
      SELECT c.id, c.receipt_number, c.payment_date, c.payment_method,
        CAST(COALESCE(c.total_amount, c.amount) AS decimal) as cobro_total,
        COALESCE(SUM(CAST(cia.amount_applied AS decimal)), 0) as aplicado,
        CAST(COALESCE(c.total_amount, c.amount) AS decimal) - COALESCE(SUM(CAST(cia.amount_applied AS decimal)), 0) as disponible
      FROM cobros c
      LEFT JOIN cobro_invoice_applications cia ON cia.cobro_id = c.id
      WHERE c.company_id = ${companyId} AND c.enterprise_id = ${enterpriseId}
      GROUP BY c.id
      HAVING CAST(COALESCE(c.total_amount, c.amount) AS decimal) - COALESCE(SUM(CAST(cia.amount_applied AS decimal)), 0) > 0.01
      ORDER BY c.payment_date ASC
    `);
    return (result as any).rows || [];
  }

  /**
   * Apply credit from existing cobros (FIFO by date) to an invoice.
   * Uses linkCobroToInvoice for each application so all validations and side-effects run.
   */
  async applyCredit(
    companyId: string,
    userId: string,
    enterpriseId: string,
    invoiceId: string,
    maxAmount: number
  ) {
    if (!maxAmount || maxAmount <= 0) {
      throw new ApiError(400, 'El monto maximo debe ser mayor a 0');
    }

    const creditos = await this.getCreditoDisponible(companyId, enterpriseId);
    let remaining = maxAmount;
    const applications: Array<{ cobro_id: string; receipt_number: string; amount: number }> = [];

    for (const credito of creditos) {
      if (remaining <= 0.01) break;
      const disponible = parseFloat(credito.disponible);
      const toApply = Math.min(disponible, remaining);

      try {
        await this.linkCobroToInvoice(companyId, userId, credito.id, invoiceId, toApply);
        applications.push({
          cobro_id: credito.id,
          receipt_number: credito.receipt_number,
          amount: toApply,
        });
        remaining -= toApply;
      } catch (err: any) {
        // Skip cobros that fail validation (e.g. different business unit, duplicate)
        console.warn(`Skipping credit from cobro ${credito.id}: ${err.message}`);
      }
    }

    return {
      applied: maxAmount - remaining,
      remaining,
      applications,
    };
  }

  /**
   * Get pending cobros (without invoice linkage) for an enterprise + business unit.
   * Used in CC and linking UI.
   */
  async getPendingCobros(companyId: string, filters: {
    enterprise_id?: string;
    business_unit_id?: string;
  } = {}) {
    let whereClause = sql`c.company_id = ${companyId} AND c.pending_status = 'pending_invoice'`;

    if (filters.enterprise_id) {
      whereClause = sql`${whereClause} AND c.enterprise_id = ${filters.enterprise_id}`;
    }
    if (filters.business_unit_id) {
      whereClause = sql`${whereClause} AND c.business_unit_id = ${filters.business_unit_id}`;
    }

    const result = await db.execute(sql`
      SELECT c.*,
        e.name as enterprise_name,
        b.bank_name,
        COALESCE(c.total_amount, c.amount) - COALESCE((SELECT SUM(CAST(cia.amount_applied AS decimal)) FROM cobro_invoice_applications cia WHERE cia.cobro_id = c.id), 0) as unallocated_balance
      FROM cobros c
      LEFT JOIN enterprises e ON c.enterprise_id = e.id
      LEFT JOIN banks b ON c.bank_id = b.id
      WHERE ${whereClause}
      ORDER BY c.payment_date DESC
    `);
    return (result as any).rows || [];
  }

  /**
   * Get invoices available for linking (pending or partial payment) for an enterprise.
   */
  async getAvailableInvoicesForLinking(companyId: string, filters: {
    enterprise_id?: string;
    business_unit_id?: string;
  } = {}) {
    // Show all non-cancelled, non-fully-paid invoices (including drafts for testing)
    let whereClause = sql`i.company_id = ${companyId} AND i.status != 'cancelled' AND (i.payment_status IS NULL OR i.payment_status != 'pagado')`;

    if (filters.enterprise_id) {
      // Match by enterprise_id on invoice OR via customer's enterprise
      whereClause = sql`${whereClause} AND (i.enterprise_id = ${filters.enterprise_id} OR i.customer_id IN (SELECT id FROM customers WHERE enterprise_id = ${filters.enterprise_id}))`;
    }
    // Don't filter by business_unit_id for now — show all available invoices
    // if (filters.business_unit_id) {
    //   whereClause = sql`${whereClause} AND i.business_unit_id = ${filters.business_unit_id}`;
    // }

    const result = await db.execute(sql`
      SELECT i.id, i.invoice_number, i.invoice_type, i.invoice_date,
        i.total_amount, i.payment_status, i.status, i.fiscal_type,
        e.name as enterprise_name,
        i.total_amount - COALESCE((SELECT SUM(CAST(cia.amount_applied AS decimal)) FROM cobro_invoice_applications cia WHERE cia.invoice_id = i.id), 0) as remaining_balance
      FROM invoices i
      LEFT JOIN enterprises e ON i.enterprise_id = e.id
      WHERE ${whereClause}
      ORDER BY i.invoice_date DESC
    `);
    return (result as any).rows || [];
  }
}

export const cobroApplicationsService = new CobroApplicationsService();
