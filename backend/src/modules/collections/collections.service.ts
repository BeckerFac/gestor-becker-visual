import { db } from '../../config/db';
import { sql } from 'drizzle-orm';
import { ApiError } from '../../middlewares/errorHandler';
import { v4 as uuid } from 'uuid';

export class CollectionsService {
  async getPendingInvoices(companyId: string) {
    try {
      const result = await db.execute(sql`
        SELECT
          i.id, i.invoice_type, i.invoice_number, i.invoice_date, i.due_date,
          i.total_amount, i.status,
          json_build_object('name', c.name, 'cuit', c.cuit) as customer,
          (SELECT COALESCE(SUM(CAST(cia.amount_applied AS decimal)), 0) FROM cobro_invoice_applications cia WHERE cia.invoice_id = i.id) as paid_amount,
          CAST(i.total_amount AS decimal) - (SELECT COALESCE(SUM(CAST(cia.amount_applied AS decimal)), 0) FROM cobro_invoice_applications cia WHERE cia.invoice_id = i.id) as balance,
          CASE
            WHEN i.due_date IS NOT NULL THEN
              EXTRACT(DAY FROM NOW() - i.due_date)::integer
            ELSE 0
          END as days_overdue
        FROM invoices i
        LEFT JOIN customers c ON i.customer_id = c.id
        WHERE i.company_id = ${companyId}
          AND i.status = 'authorized'
          AND CAST(i.total_amount AS decimal) > (SELECT COALESCE(SUM(CAST(cia.amount_applied AS decimal)), 0) FROM cobro_invoice_applications cia WHERE cia.invoice_id = i.id)
        ORDER BY i.due_date ASC NULLS LAST, i.invoice_date ASC
      `);

      const rows = (result as any).rows || result || [];
      return rows.map((r: any) => ({
        ...r,
        paid_amount: parseFloat(r.paid_amount || '0'),
        balance: parseFloat(r.balance || '0'),
        days_overdue: parseInt(r.days_overdue || '0'),
      }));
    } catch (error) {
      console.error('Get collections error:', error);
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Failed to get pending invoices');
    }
  }

  async registerPayment(companyId: string, userId: string, invoiceId: string, data: any) {
    try {
      // Verify invoice belongs to company
      const invoice = await db.execute(sql`
        SELECT id, total_amount, status, customer_id, enterprise_id, order_id FROM invoices
        WHERE id = ${invoiceId} AND company_id = ${companyId}
      `);
      const invoiceRows = (invoice as any).rows || invoice || [];
      if (invoiceRows.length === 0) {
        throw new ApiError(404, 'Invoice not found');
      }

      if (invoiceRows[0].status !== 'authorized') {
        throw new ApiError(400, 'Only authorized invoices can receive payments');
      }

      // Check current balance using cobro_invoice_applications (new system)
      const appliedResult = await db.execute(sql`
        SELECT COALESCE(SUM(CAST(amount_applied AS decimal)), 0) as total_applied
        FROM cobro_invoice_applications WHERE invoice_id = ${invoiceId}
      `);
      const appliedRows = (appliedResult as any).rows || appliedResult || [];
      const totalApplied = parseFloat(appliedRows[0]?.total_applied || '0');
      const invoiceTotal = parseFloat(invoiceRows[0].total_amount);
      const balance = invoiceTotal - totalApplied;

      const paymentAmount = parseFloat(data.amount);
      if (paymentAmount <= 0) {
        throw new ApiError(400, 'Payment amount must be positive');
      }
      if (paymentAmount > balance + 0.01) {
        throw new ApiError(400, `Payment amount ($${paymentAmount}) exceeds balance ($${balance.toFixed(2)})`);
      }

      // Auto-generate receipt_number (sequential per company)
      const nextNumResult = await db.execute(sql`
        SELECT COALESCE(MAX(receipt_number), 0) + 1 as next_number FROM cobros WHERE company_id = ${companyId}
      `);
      const receiptNumber = parseInt(((nextNumResult as any).rows || [])[0]?.next_number || '1');

      // Create cobro
      const cobroId = uuid();
      const paymentMethod = data.method || 'transferencia';
      await db.execute(sql`
        INSERT INTO cobros (id, company_id, enterprise_id, invoice_id, amount, payment_method, bank_id, reference, payment_date, notes, receipt_number, created_by)
        VALUES (${cobroId}, ${companyId}, ${invoiceRows[0].enterprise_id || null}, ${invoiceId}, ${paymentAmount.toString()}, ${paymentMethod}, ${data.bank_id || null}, ${data.reference || null}, ${data.payment_date || new Date().toISOString()}, ${data.notes || null}, ${receiptNumber}, ${userId})
      `);

      // Create cobro_invoice_application linking cobro to invoice
      await db.execute(sql`
        INSERT INTO cobro_invoice_applications (id, cobro_id, invoice_id, amount_applied, created_by)
        VALUES (${uuid()}, ${cobroId}, ${invoiceId}, ${paymentAmount.toString()}, ${userId})
      `);

      // Recalculate invoice payment status
      await this.recalculateInvoicePaymentStatus(invoiceId);

      // Recalculate order status if invoice is linked to an order
      const invoiceOrderId = invoiceRows[0].order_id;
      if (invoiceOrderId) {
        await this.recalculateOrderStatusFromInvoice(invoiceId);
      }

      const remainingBalance = Math.max(0, balance - paymentAmount);

      return {
        id: cobroId,
        invoice_id: invoiceId,
        amount: paymentAmount,
        method: paymentMethod,
        remaining_balance: remainingBalance,
      };
    } catch (error) {
      console.error('Register payment error:', error);
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Failed to register payment');
    }
  }

  async getPendingOrders(companyId: string) {
    try {
      const result = await db.execute(sql`
        SELECT o.id, o.order_number, o.title, o.total_amount, o.payment_status, o.payment_method, o.created_at,
          c.name as customer_name
        FROM orders o
        LEFT JOIN customers c ON o.customer_id = c.id
        WHERE o.company_id = ${companyId}
          AND o.payment_status = 'pendiente'
        ORDER BY o.created_at DESC
      `);
      return (result as any).rows || result || [];
    } catch (error) {
      console.error('Get pending orders error:', error);
      throw new ApiError(500, 'Failed to get pending orders');
    }
  }

  async markOrderAsPaid(companyId: string, orderId: string, data: { payment_method: string }) {
    try {
      const result = await db.execute(sql`
        SELECT id FROM orders WHERE id = ${orderId} AND company_id = ${companyId}
      `);
      const rows = (result as any).rows || result || [];
      if (rows.length === 0) throw new ApiError(404, 'Order not found');

      await db.execute(sql`
        UPDATE orders SET payment_status = 'pagado', payment_method = ${data.payment_method || 'efectivo'}, updated_at = NOW()
        WHERE id = ${orderId}
      `);

      return { id: orderId, payment_status: 'pagado', payment_method: data.payment_method };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Failed to mark order as paid');
    }
  }

  private async recalculateInvoicePaymentStatus(invoiceId: string) {
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

  private async recalculateOrderStatusFromInvoice(invoiceId: string) {
    try {
      const invResult = await db.execute(sql`SELECT order_id FROM invoices WHERE id = ${invoiceId}`);
      const orderId = ((invResult as any).rows || [])[0]?.order_id;
      if (!orderId) return;

      const result = await db.execute(sql`
        SELECT
          CAST(o.total_amount AS decimal) as order_total,
          COALESCE(SUM(CAST(cia.amount_applied AS decimal)), 0) as total_paid
        FROM orders o
        LEFT JOIN invoices i ON i.order_id = o.id AND i.status != 'cancelled'
        LEFT JOIN cobro_invoice_applications cia ON cia.invoice_id = i.id
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

      await db.execute(sql`UPDATE orders SET payment_status = ${status} WHERE id = ${orderId}`);
    } catch (error) {
      console.warn('Recalculate order status from invoice error:', error);
    }
  }

  async getSummary(companyId: string) {
    try {
      const result = await db.execute(sql`
        SELECT
          COALESCE(SUM(
            CAST(i.total_amount AS decimal) - (SELECT COALESCE(SUM(CAST(cia.amount_applied AS decimal)), 0) FROM cobro_invoice_applications cia WHERE cia.invoice_id = i.id)
          ), 0) as total_pending,
          COALESCE(SUM(
            CASE WHEN i.due_date IS NOT NULL AND i.due_date < NOW() THEN
              CAST(i.total_amount AS decimal) - (SELECT COALESCE(SUM(CAST(cia.amount_applied AS decimal)), 0) FROM cobro_invoice_applications cia WHERE cia.invoice_id = i.id)
            ELSE 0 END
          ), 0) as total_overdue,
          COALESCE(SUM(
            CASE WHEN i.due_date IS NULL OR i.due_date >= NOW() THEN
              CAST(i.total_amount AS decimal) - (SELECT COALESCE(SUM(CAST(cia.amount_applied AS decimal)), 0) FROM cobro_invoice_applications cia WHERE cia.invoice_id = i.id)
            ELSE 0 END
          ), 0) as total_upcoming
        FROM invoices i
        WHERE i.company_id = ${companyId}
          AND i.status = 'authorized'
          AND CAST(i.total_amount AS decimal) > (SELECT COALESCE(SUM(CAST(cia.amount_applied AS decimal)), 0) FROM cobro_invoice_applications cia WHERE cia.invoice_id = i.id)
      `);

      const rows = (result as any).rows || result || [];
      const row = rows[0] || {};

      return {
        total_pending: parseFloat(row.total_pending || '0'),
        total_overdue: parseFloat(row.total_overdue || '0'),
        total_upcoming: parseFloat(row.total_upcoming || '0'),
      };
    } catch (error) {
      console.error('Collections summary error:', error);
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Failed to get collections summary');
    }
  }
}

export const collectionsService = new CollectionsService();
