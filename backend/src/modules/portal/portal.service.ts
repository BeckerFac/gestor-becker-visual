import { db } from '../../config/db';
import { pool } from '../../config/db';
import { sql } from 'drizzle-orm';
import { ApiError } from '../../middlewares/errorHandler';

// All boolean config fields
const PORTAL_CONFIG_FIELDS = [
  'show_orders', 'show_invoices', 'show_quotes', 'show_balance', 'show_remitos',
  'orders_show_price', 'orders_show_total', 'orders_show_status',
  'orders_show_delivery_date', 'orders_show_payment_status',
  'orders_show_payment_method', 'orders_show_notes', 'orders_show_timeline',
  'invoices_show_subtotal', 'invoices_show_iva', 'invoices_show_total',
  'invoices_show_cae', 'invoices_show_download_pdf',
  'quotes_show_price', 'quotes_show_validity', 'quotes_show_download_pdf',
  'quotes_show_accept_reject',
  'balance_show_total_orders', 'balance_show_total_invoiced',
  'balance_show_pending', 'balance_show_payment_detail',
] as const;

const TEXT_CONFIG_FIELDS = ['portal_welcome_message', 'portal_logo_url'] as const;

export interface PortalConfig {
  id: string;
  company_id: string;
  show_orders: boolean;
  show_invoices: boolean;
  show_quotes: boolean;
  show_balance: boolean;
  show_remitos: boolean;
  orders_show_price: boolean;
  orders_show_total: boolean;
  orders_show_status: boolean;
  orders_show_delivery_date: boolean;
  orders_show_payment_status: boolean;
  orders_show_payment_method: boolean;
  orders_show_notes: boolean;
  orders_show_timeline: boolean;
  invoices_show_subtotal: boolean;
  invoices_show_iva: boolean;
  invoices_show_total: boolean;
  invoices_show_cae: boolean;
  invoices_show_download_pdf: boolean;
  quotes_show_price: boolean;
  quotes_show_validity: boolean;
  quotes_show_download_pdf: boolean;
  quotes_show_accept_reject: boolean;
  balance_show_total_orders: boolean;
  balance_show_total_invoiced: boolean;
  balance_show_pending: boolean;
  balance_show_payment_detail: boolean;
  portal_welcome_message: string;
  portal_logo_url: string | null;
  updated_at: string;
}

export class PortalService {
  // ==================== PORTAL CONFIG ====================

  async getPortalConfig(companyId: string): Promise<PortalConfig> {
    try {
      const result = await pool.query(
        `SELECT * FROM portal_config WHERE company_id = $1`,
        [companyId]
      );
      if (result.rows.length > 0) {
        return result.rows[0] as PortalConfig;
      }
      // Create default config
      const insertResult = await pool.query(
        `INSERT INTO portal_config (company_id) VALUES ($1)
         ON CONFLICT (company_id) DO NOTHING
         RETURNING *`,
        [companyId]
      );
      if (insertResult.rows.length > 0) {
        return insertResult.rows[0] as PortalConfig;
      }
      // Race condition: another request created it
      const retry = await pool.query(
        `SELECT * FROM portal_config WHERE company_id = $1`,
        [companyId]
      );
      return retry.rows[0] as PortalConfig;
    } catch (error) {
      console.error('Portal get config error:', error);
      throw new ApiError(500, 'Failed to get portal config');
    }
  }

  async updatePortalConfig(companyId: string, updates: Partial<PortalConfig>): Promise<PortalConfig> {
    try {
      // Validate only allowed fields
      const setClauses: string[] = [];
      const values: any[] = [];
      let paramIdx = 1;

      for (const field of PORTAL_CONFIG_FIELDS) {
        if (field in updates) {
          setClauses.push(`${field} = $${paramIdx}`);
          values.push(Boolean(updates[field as keyof PortalConfig]));
          paramIdx++;
        }
      }
      for (const field of TEXT_CONFIG_FIELDS) {
        if (field in updates) {
          setClauses.push(`${field} = $${paramIdx}`);
          values.push(updates[field as keyof PortalConfig] ?? null);
          paramIdx++;
        }
      }

      if (setClauses.length === 0) {
        return this.getPortalConfig(companyId);
      }

      setClauses.push(`updated_at = NOW()`);
      values.push(companyId);

      const query = `UPDATE portal_config SET ${setClauses.join(', ')} WHERE company_id = $${paramIdx} RETURNING *`;
      const result = await pool.query(query, values);

      if (result.rows.length === 0) {
        // Config doesn't exist yet, create then update
        await this.getPortalConfig(companyId);
        const retryResult = await pool.query(query, values);
        return retryResult.rows[0] as PortalConfig;
      }

      return result.rows[0] as PortalConfig;
    } catch (error) {
      console.error('Portal update config error:', error);
      throw new ApiError(500, 'Failed to update portal config');
    }
  }

  async getPublicPortalConfig(companyId: string): Promise<Omit<PortalConfig, 'id' | 'company_id'>> {
    const config = await this.getPortalConfig(companyId);
    // Strip internal fields
    const { id: _id, company_id: _cid, ...publicConfig } = config;
    return publicConfig;
  }

  // ==================== ORDERS (config-filtered) ====================

  async getCustomerOrders(customerId: string, companyId: string) {
    try {
      const config = await this.getPortalConfig(companyId);

      if (!config.show_orders) {
        return { items: [], total: 0 };
      }

      // Build SELECT columns based on config
      const columns = [
        'o.id', 'o.order_number', 'o.title', 'o.product_type', 'o.quantity',
        'o.created_at', 'o.has_invoice',
      ];

      if (config.orders_show_status) columns.push('o.status');
      if (config.orders_show_price) columns.push('o.unit_price', 'o.vat_rate');
      if (config.orders_show_total) columns.push('o.total_amount');
      if (config.orders_show_delivery_date) columns.push('o.estimated_delivery', 'o.actual_delivery');
      if (config.orders_show_payment_status) columns.push('o.payment_status');
      if (config.orders_show_payment_method) columns.push('o.payment_method');
      if (config.orders_show_notes) columns.push('o.notes');

      const selectCols = columns.join(', ');

      const result = await db.execute(sql.raw(`
        SELECT ${selectCols},
          CASE WHEN i.id IS NOT NULL THEN
            json_build_object('id', i.id, 'invoice_number', i.invoice_number, 'invoice_type', i.invoice_type, 'total_amount', i.total_amount, 'status', i.status)
          ELSE NULL END as invoice
        FROM orders o
        LEFT JOIN invoices i ON o.invoice_id = i.id
        WHERE o.customer_id = '${customerId}' AND o.company_id = '${companyId}'
        ORDER BY o.created_at DESC
      `));
      const rows = (result as any).rows || result || [];
      return { items: rows, total: rows.length };
    } catch (error) {
      console.error('Portal get orders error:', error);
      throw new ApiError(500, 'Failed to get orders');
    }
  }

  // Get single order with status history
  async getCustomerOrder(customerId: string, orderId: string, companyId?: string) {
    try {
      let config: PortalConfig | null = null;
      if (companyId) {
        config = await this.getPortalConfig(companyId);
        if (!config.show_orders) {
          throw new ApiError(403, 'Orders section is disabled');
        }
      }

      const columns = [
        'o.id', 'o.order_number', 'o.title', 'o.product_type', 'o.quantity',
        'o.created_at', 'o.has_invoice',
      ];

      if (!config || config.orders_show_status) columns.push('o.status');
      if (!config || config.orders_show_price) columns.push('o.unit_price', 'o.vat_rate');
      if (!config || config.orders_show_total) columns.push('o.total_amount');
      if (!config || config.orders_show_delivery_date) columns.push('o.estimated_delivery', 'o.actual_delivery');
      if (!config || config.orders_show_payment_status) columns.push('o.payment_status');
      if (!config || config.orders_show_payment_method) columns.push('o.payment_method');
      if (!config || config.orders_show_notes) columns.push('o.notes');

      const selectCols = columns.join(', ');

      const result = await db.execute(sql.raw(`
        SELECT ${selectCols},
          json_build_object('id', c.id, 'name', c.name, 'cuit', c.cuit) as customer,
          CASE WHEN i.id IS NOT NULL THEN
            json_build_object('id', i.id, 'invoice_number', i.invoice_number, 'invoice_type', i.invoice_type, 'total_amount', i.total_amount, 'status', i.status)
          ELSE NULL END as invoice
        FROM orders o
        LEFT JOIN customers c ON o.customer_id = c.id
        LEFT JOIN invoices i ON o.invoice_id = i.id
        WHERE o.customer_id = '${customerId}' AND o.id = '${orderId}'
      `));
      const rows = (result as any).rows || result || [];
      if (rows.length === 0) throw new ApiError(404, 'Order not found');

      // Get status history if timeline enabled
      let history: any[] = [];
      if (!config || config.orders_show_timeline) {
        const historyResult = await db.execute(sql`
          SELECT * FROM order_status_history WHERE order_id = ${orderId} ORDER BY created_at DESC
        `);
        history = (historyResult as any).rows || historyResult || [];
      }

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

  // ==================== INVOICES (config-filtered) ====================

  async getCustomerInvoices(customerId: string, companyId: string) {
    try {
      const config = await this.getPortalConfig(companyId);

      if (!config.show_invoices) {
        return { items: [], total: 0 };
      }

      const columns = [
        'i.id', 'i.invoice_number', 'i.invoice_type',
        'i.invoice_date', 'i.status', 'i.created_at',
      ];

      if (config.invoices_show_subtotal) columns.push('i.subtotal');
      if (config.invoices_show_iva) columns.push('i.vat_amount');
      if (config.invoices_show_total) columns.push('i.total_amount');
      if (config.invoices_show_cae) columns.push('i.cae', 'i.cae_expiration');

      const selectCols = columns.join(', ');

      const result = await db.execute(sql.raw(`
        SELECT ${selectCols}
        FROM invoices i
        WHERE i.customer_id = '${customerId}' AND i.company_id = '${companyId}'
        ORDER BY i.created_at DESC
      `));
      const rows = (result as any).rows || result || [];
      return { items: rows, total: rows.length };
    } catch (error) {
      console.error('Portal get invoices error:', error);
      throw new ApiError(500, 'Failed to get invoices');
    }
  }

  // ==================== QUOTES (config-filtered) ====================

  async getCustomerQuotes(customerId: string, companyId: string) {
    try {
      const config = await this.getPortalConfig(companyId);

      if (!config.show_quotes) {
        return { items: [], total: 0 };
      }

      const columns = [
        'q.id', 'q.quote_number', 'q.title', 'q.status', 'q.created_at',
      ];

      if (config.quotes_show_price) columns.push('q.subtotal', 'q.vat_amount', 'q.total_amount');
      if (config.quotes_show_validity) columns.push('q.valid_until');

      const selectCols = columns.join(', ');

      const result = await db.execute(sql.raw(`
        SELECT ${selectCols}
        FROM quotes q
        WHERE q.customer_id = '${customerId}' AND q.company_id = '${companyId}'
        ORDER BY q.created_at DESC
      `));
      const rows = (result as any).rows || result || [];
      return { items: rows, total: rows.length };
    } catch (error) {
      console.error('Portal get quotes error:', error);
      throw new ApiError(500, 'Failed to get quotes');
    }
  }

  // ==================== QUOTE ACCEPT/REJECT ====================

  async updateQuoteStatus(customerId: string, companyId: string, quoteId: string, newStatus: 'accepted' | 'rejected', reason?: string) {
    try {
      const config = await this.getPortalConfig(companyId);

      if (!config.quotes_show_accept_reject) {
        throw new ApiError(403, 'Quote accept/reject is not enabled');
      }

      // Verify quote belongs to customer
      const checkResult = await pool.query(
        `SELECT id, status FROM quotes WHERE id = $1 AND customer_id = $2 AND company_id = $3`,
        [quoteId, customerId, companyId]
      );
      if (checkResult.rows.length === 0) {
        throw new ApiError(404, 'Quote not found');
      }

      const currentStatus = checkResult.rows[0].status;
      if (currentStatus === 'accepted' || currentStatus === 'rejected') {
        throw new ApiError(400, `Quote is already ${currentStatus}`);
      }

      const notes = newStatus === 'rejected' && reason ? reason : null;

      await pool.query(
        `UPDATE quotes SET status = $1, notes = COALESCE($2, notes), updated_at = NOW() WHERE id = $3`,
        [newStatus, notes, quoteId]
      );

      return { success: true, status: newStatus };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      console.error('Portal update quote status error:', error);
      throw new ApiError(500, 'Failed to update quote status');
    }
  }

  // ==================== REMITOS (config-filtered) ====================

  async getCustomerRemitos(customerId: string, companyId: string) {
    try {
      const config = await this.getPortalConfig(companyId);

      if (!config.show_remitos) {
        return { items: [], total: 0 };
      }

      const result = await db.execute(sql`
        SELECT r.id, r.remito_number, r.date, r.status, r.created_at
        FROM remitos r
        WHERE r.customer_id = ${customerId} AND r.company_id = ${companyId}
        ORDER BY r.created_at DESC
      `);
      const rows = (result as any).rows || result || [];
      return { items: rows, total: rows.length };
    } catch (error) {
      console.error('Portal get remitos error:', error);
      throw new ApiError(500, 'Failed to get remitos');
    }
  }

  // ==================== SUMMARY (config-filtered) ====================

  async getCustomerSummary(customerId: string, companyId: string) {
    try {
      const config = await this.getPortalConfig(companyId);

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
      const summary = rows[0] || {};

      // Strip disabled sections from summary
      if (!config.show_orders) {
        summary.total_orders = 0;
        summary.active_orders = 0;
        summary.delivered_orders = 0;
        summary.total_spent = '0';
      }
      if (!config.show_invoices) {
        summary.total_invoices = 0;
      }
      if (!config.show_quotes) {
        summary.total_quotes = 0;
      }

      return summary;
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
