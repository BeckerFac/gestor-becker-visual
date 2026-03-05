import { db } from '../../config/db';
import { invoices, payments, customers } from '../../db/schema';
import { eq, and, sql } from 'drizzle-orm';
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
          COALESCE(
            (SELECT SUM(CAST(p.amount AS decimal)) FROM payments p WHERE p.invoice_id = i.id),
            0
          ) as paid_amount,
          CAST(i.total_amount AS decimal) - COALESCE(
            (SELECT SUM(CAST(p.amount AS decimal)) FROM payments p WHERE p.invoice_id = i.id),
            0
          ) as balance,
          CASE
            WHEN i.due_date IS NOT NULL THEN
              EXTRACT(DAY FROM NOW() - i.due_date)::integer
            ELSE 0
          END as days_overdue
        FROM invoices i
        LEFT JOIN customers c ON i.customer_id = c.id
        WHERE i.company_id = ${companyId}
          AND i.status = 'authorized'
          AND CAST(i.total_amount AS decimal) > COALESCE(
            (SELECT SUM(CAST(p.amount AS decimal)) FROM payments p WHERE p.invoice_id = i.id),
            0
          )
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
        SELECT id, total_amount, status FROM invoices
        WHERE id = ${invoiceId} AND company_id = ${companyId}
      `);
      const invoiceRows = (invoice as any).rows || invoice || [];
      if (invoiceRows.length === 0) {
        throw new ApiError(404, 'Invoice not found');
      }

      if (invoiceRows[0].status !== 'authorized') {
        throw new ApiError(400, 'Only authorized invoices can receive payments');
      }

      // Check current balance
      const paymentsResult = await db.execute(sql`
        SELECT COALESCE(SUM(CAST(amount AS decimal)), 0) as total_paid
        FROM payments WHERE invoice_id = ${invoiceId}
      `);
      const paidRows = (paymentsResult as any).rows || paymentsResult || [];
      const totalPaid = parseFloat(paidRows[0]?.total_paid || '0');
      const invoiceTotal = parseFloat(invoiceRows[0].total_amount);
      const balance = invoiceTotal - totalPaid;

      const paymentAmount = parseFloat(data.amount);
      if (paymentAmount <= 0) {
        throw new ApiError(400, 'Payment amount must be positive');
      }
      if (paymentAmount > balance + 0.01) {
        throw new ApiError(400, `Payment amount ($${paymentAmount}) exceeds balance ($${balance.toFixed(2)})`);
      }

      // Create payment
      const paymentId = uuid();
      await db.insert(payments).values({
        id: paymentId,
        invoice_id: invoiceId,
        amount: paymentAmount.toString(),
        method: data.method || 'transferencia',
        payment_date: data.payment_date ? new Date(data.payment_date) : new Date(),
        reference: data.reference || null,
        notes: data.notes || null,
        created_by: userId,
      });

      const remainingBalance = Math.max(0, balance - paymentAmount);

      // If fully paid, update linked order's payment_status
      if (remainingBalance < 0.01) {
        await db.execute(sql`
          UPDATE orders SET payment_status = 'pagado', payment_method = ${data.method || 'transferencia'}, updated_at = NOW()
          WHERE invoice_id = ${invoiceId} AND company_id = ${companyId}
        `);
      }

      return {
        id: paymentId,
        invoice_id: invoiceId,
        amount: paymentAmount,
        method: data.method,
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

  async getSummary(companyId: string) {
    try {
      const result = await db.execute(sql`
        SELECT
          COALESCE(SUM(
            CAST(i.total_amount AS decimal) - COALESCE(
              (SELECT SUM(CAST(p.amount AS decimal)) FROM payments p WHERE p.invoice_id = i.id),
              0
            )
          ), 0) as total_pending,
          COALESCE(SUM(
            CASE WHEN i.due_date IS NOT NULL AND i.due_date < NOW() THEN
              CAST(i.total_amount AS decimal) - COALESCE(
                (SELECT SUM(CAST(p.amount AS decimal)) FROM payments p WHERE p.invoice_id = i.id),
                0
              )
            ELSE 0 END
          ), 0) as total_overdue,
          COALESCE(SUM(
            CASE WHEN i.due_date IS NULL OR i.due_date >= NOW() THEN
              CAST(i.total_amount AS decimal) - COALESCE(
                (SELECT SUM(CAST(p.amount AS decimal)) FROM payments p WHERE p.invoice_id = i.id),
                0
              )
            ELSE 0 END
          ), 0) as total_upcoming
        FROM invoices i
        WHERE i.company_id = ${companyId}
          AND i.status = 'authorized'
          AND CAST(i.total_amount AS decimal) > COALESCE(
            (SELECT SUM(CAST(p.amount AS decimal)) FROM payments p WHERE p.invoice_id = i.id),
            0
          )
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
