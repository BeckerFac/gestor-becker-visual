import { db } from '../../config/db';
import { sql } from 'drizzle-orm';
import { ApiError } from '../../middlewares/errorHandler';

export class PortalService {
  // Get customer's orders with full details
  async getCustomerOrders(customerId: string, companyId: string) {
    try {
      const result = await db.execute(sql`
        SELECT o.*,
          json_build_object('id', c.id, 'name', c.name, 'cuit', c.cuit) as customer,
          CASE WHEN i.id IS NOT NULL THEN
            json_build_object('id', i.id, 'invoice_number', i.invoice_number, 'invoice_type', i.invoice_type, 'total_amount', i.total_amount, 'status', i.status)
          ELSE NULL END as invoice
        FROM orders o
        LEFT JOIN customers c ON o.customer_id = c.id
        LEFT JOIN invoices i ON o.invoice_id = i.id
        WHERE o.customer_id = ${customerId} AND o.company_id = ${companyId}
        ORDER BY o.created_at DESC
      `);
      const rows = (result as any).rows || result || [];
      return { items: rows, total: rows.length };
    } catch (error) {
      console.error('Portal get orders error:', error);
      throw new ApiError(500, 'Failed to get orders');
    }
  }

  // Get single order with status history
  async getCustomerOrder(customerId: string, orderId: string) {
    try {
      const result = await db.execute(sql`
        SELECT o.*,
          json_build_object('id', c.id, 'name', c.name, 'cuit', c.cuit) as customer,
          CASE WHEN i.id IS NOT NULL THEN
            json_build_object('id', i.id, 'invoice_number', i.invoice_number, 'invoice_type', i.invoice_type, 'total_amount', i.total_amount, 'status', i.status)
          ELSE NULL END as invoice
        FROM orders o
        LEFT JOIN customers c ON o.customer_id = c.id
        LEFT JOIN invoices i ON o.invoice_id = i.id
        WHERE o.customer_id = ${customerId} AND o.id = ${orderId}
      `);
      const rows = (result as any).rows || result || [];
      if (rows.length === 0) throw new ApiError(404, 'Order not found');

      // Get status history
      const historyResult = await db.execute(sql`
        SELECT * FROM order_status_history WHERE order_id = ${orderId} ORDER BY created_at DESC
      `);
      const history = (historyResult as any).rows || historyResult || [];

      // Get order items
      const itemsResult = await db.execute(sql`
        SELECT * FROM order_items WHERE order_id = ${orderId} ORDER BY created_at ASC
      `);
      const items = (itemsResult as any).rows || itemsResult || [];

      return { ...rows[0], status_history: history, items };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Failed to get order');
    }
  }

  // Get customer's invoices
  async getCustomerInvoices(customerId: string, companyId: string) {
    try {
      const result = await db.execute(sql`
        SELECT i.*
        FROM invoices i
        WHERE i.customer_id = ${customerId} AND i.company_id = ${companyId}
        ORDER BY i.created_at DESC
      `);
      const rows = (result as any).rows || result || [];
      return { items: rows, total: rows.length };
    } catch (error) {
      console.error('Portal get invoices error:', error);
      throw new ApiError(500, 'Failed to get invoices');
    }
  }

  // Get customer's quotes
  async getCustomerQuotes(customerId: string, companyId: string) {
    try {
      const result = await db.execute(sql`
        SELECT q.*
        FROM quotes q
        WHERE q.customer_id = ${customerId} AND q.company_id = ${companyId}
        ORDER BY q.created_at DESC
      `);
      const rows = (result as any).rows || result || [];
      return { items: rows, total: rows.length };
    } catch (error) {
      console.error('Portal get quotes error:', error);
      throw new ApiError(500, 'Failed to get quotes');
    }
  }

  // Get customer portal summary
  async getCustomerSummary(customerId: string, companyId: string) {
    try {
      const result = await db.execute(sql`
        SELECT
          (SELECT COUNT(*) FROM orders WHERE customer_id = ${customerId} AND company_id = ${companyId})::int as total_orders,
          (SELECT COUNT(*) FROM orders WHERE customer_id = ${customerId} AND company_id = ${companyId} AND status IN ('pendiente', 'en_produccion'))::int as active_orders,
          (SELECT COUNT(*) FROM orders WHERE customer_id = ${customerId} AND company_id = ${companyId} AND status = 'entregado')::int as delivered_orders,
          (SELECT COALESCE(SUM(total_amount::numeric), 0) FROM orders WHERE customer_id = ${customerId} AND company_id = ${companyId}) as total_spent,
          (SELECT COUNT(*) FROM invoices WHERE customer_id = ${customerId} AND company_id = ${companyId})::int as total_invoices,
          (SELECT COUNT(*) FROM quotes WHERE customer_id = ${customerId} AND company_id = ${companyId})::int as total_quotes
      `);
      const rows = (result as any).rows || result || [];
      return rows[0] || {};
    } catch (error) {
      console.error('Portal summary error:', error);
      throw new ApiError(500, 'Failed to get summary');
    }
  }

  // Get customer profile
  async getCustomerProfile(customerId: string) {
    try {
      const result = await db.execute(sql`
        SELECT c.*, comp.name as company_name, comp.cuit as company_cuit, comp.phone as company_phone, comp.email as company_email
        FROM customers c
        JOIN companies comp ON c.company_id = comp.id
        WHERE c.id = ${customerId}
      `);
      const rows = (result as any).rows || result || [];
      if (rows.length === 0) throw new ApiError(404, 'Customer not found');
      return rows[0];
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Failed to get profile');
    }
  }
}

export const portalService = new PortalService();
