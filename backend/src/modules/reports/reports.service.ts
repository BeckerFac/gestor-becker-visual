import { db } from '../../config/db';
import { invoices, invoice_items, customers, products, product_pricing, stock, payments } from '../../db/schema';
import { eq, and, gte, lte, sql, count, sum, desc } from 'drizzle-orm';
import { ApiError } from '../../middlewares/errorHandler';

export class ReportsService {
  async getDashboard(companyId: string, dateFrom?: string, dateTo?: string) {
    try {
      let periodStart: Date;
      if (dateFrom) {
        periodStart = new Date(dateFrom);
      } else {
        periodStart = new Date();
        periodStart.setDate(1);
      }
      periodStart.setHours(0, 0, 0, 0);

      const periodEnd = dateTo ? new Date(dateTo + 'T23:59:59') : new Date();

      // Sales in period (authorized invoices)
      const salesMonthResult = await db.execute(sql`
        SELECT COALESCE(SUM(CAST(total_amount AS decimal)), 0) as total
        FROM invoices
        WHERE company_id = ${companyId}
          AND status = 'authorized'
          AND invoice_date >= ${periodStart}
          AND invoice_date <= ${periodEnd}
      `);

      // Collections pending: total balance on unpaid authorized invoices
      const collectionsPendingResult = await db.execute(sql`
        SELECT COALESCE(SUM(
          CAST(i.total_amount AS decimal) - COALESCE(
            (SELECT SUM(CAST(p.amount AS decimal)) FROM payments p WHERE p.invoice_id = i.id), 0
          )
        ), 0) as total
        FROM invoices i
        WHERE i.company_id = ${companyId}
          AND i.status = 'authorized'
          AND CAST(i.total_amount AS decimal) > COALESCE(
            (SELECT SUM(CAST(p.amount AS decimal)) FROM payments p WHERE p.invoice_id = i.id), 0
          )
      `);

      // Cheques pending (a_cobrar)
      const chequesPendingResult = await db.execute(sql`
        SELECT COUNT(*) as count, COALESCE(SUM(CAST(amount AS decimal)), 0) as total
        FROM cheques
        WHERE company_id = ${companyId} AND status = 'a_cobrar'
      `);

      // Orders unpaid
      const ordersUnpaidResult = await db.execute(sql`
        SELECT COUNT(*) as count, COALESCE(SUM(CAST(total_amount AS decimal)), 0) as total
        FROM orders
        WHERE company_id = ${companyId} AND payment_status = 'pendiente'
      `);

      // Recent invoices (last 5)
      const recentInvoices = await db.execute(sql`
        SELECT i.id, i.invoice_type, i.invoice_number, i.invoice_date, i.total_amount, i.status, i.cae,
               c.name as customer_name
        FROM invoices i
        LEFT JOIN customers c ON i.customer_id = c.id
        WHERE i.company_id = ${companyId}
        ORDER BY i.created_at DESC
        LIMIT 5
      `);

      // Recent orders (last 5)
      const recentOrders = await db.execute(sql`
        SELECT o.id, o.order_number, o.title, o.total_amount, o.status, o.payment_status, o.payment_method, o.created_at,
               c.name as customer_name
        FROM orders o
        LEFT JOIN customers c ON o.customer_id = c.id
        WHERE o.company_id = ${companyId}
        ORDER BY o.created_at DESC
        LIMIT 5
      `);

      const salesMonthRows = (salesMonthResult as any).rows || salesMonthResult || [];
      const collectionsRows = (collectionsPendingResult as any).rows || collectionsPendingResult || [];
      const chequesRows = (chequesPendingResult as any).rows || chequesPendingResult || [];
      const ordersRows = (ordersUnpaidResult as any).rows || ordersUnpaidResult || [];

      return {
        sales_month: parseFloat(salesMonthRows[0]?.total || '0'),
        collections_pending: parseFloat(collectionsRows[0]?.total || '0'),
        cheques_pending_count: parseInt(chequesRows[0]?.count || '0'),
        cheques_pending_amount: parseFloat(chequesRows[0]?.total || '0'),
        orders_unpaid_count: parseInt(ordersRows[0]?.count || '0'),
        orders_unpaid_amount: parseFloat(ordersRows[0]?.total || '0'),
        recent_invoices: (recentInvoices as any).rows || recentInvoices || [],
        recent_orders: (recentOrders as any).rows || recentOrders || [],
      };
    } catch (error) {
      console.error('Dashboard report error:', error);
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Failed to generate dashboard report');
    }
  }

  async getSalesReport(companyId: string, days: number = 7) {
    try {
      const result = await db.execute(sql`
        SELECT
          DATE(i.invoice_date) as date,
          COALESCE(SUM(CAST(i.total_amount AS decimal)), 0) as total,
          COUNT(*) as invoice_count
        FROM invoices i
        WHERE i.company_id = ${companyId}
          AND i.status = 'authorized'
          AND i.invoice_date >= NOW() - INTERVAL '1 day' * ${days}
        GROUP BY DATE(i.invoice_date)
        ORDER BY DATE(i.invoice_date) ASC
      `);

      // Fill in missing dates with 0
      const salesByDate: Record<string, { total: number; invoice_count: number }> = {};
      const rows = (result as any).rows || result || [];
      for (const row of rows) {
        const dateStr = new Date(row.date).toISOString().split('T')[0];
        salesByDate[dateStr] = {
          total: parseFloat(row.total || '0'),
          invoice_count: parseInt(row.invoice_count || '0'),
        };
      }

      // Generate array for all days
      const salesData = [];
      for (let i = days - 1; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const dateStr = d.toISOString().split('T')[0];
        salesData.push({
          date: dateStr,
          total: salesByDate[dateStr]?.total || 0,
          invoice_count: salesByDate[dateStr]?.invoice_count || 0,
        });
      }

      return salesData;
    } catch (error) {
      console.error('Sales report error:', error);
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Failed to generate sales report');
    }
  }

  async getTopProducts(companyId: string, limit: number = 5) {
    try {
      const result = await db.execute(sql`
        SELECT
          ii.product_name as name,
          SUM(CAST(ii.quantity AS decimal)) as sold_qty,
          SUM(CAST(ii.subtotal AS decimal)) as revenue
        FROM invoice_items ii
        JOIN invoices i ON ii.invoice_id = i.id
        WHERE i.company_id = ${companyId}
          AND i.status = 'authorized'
        GROUP BY ii.product_name
        ORDER BY SUM(CAST(ii.subtotal AS decimal)) DESC
        LIMIT ${limit}
      `);

      const rows = (result as any).rows || result || [];
      return rows.map((r: any) => ({
        name: r.name || 'Sin nombre',
        sold_qty: parseFloat(r.sold_qty || '0'),
        revenue: parseFloat(r.revenue || '0'),
      }));
    } catch (error) {
      console.error('Top products report error:', error);
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Failed to generate top products report');
    }
  }
  async globalSearch(companyId: string, query: string) {
    if (!query || query.trim().length < 2) return { enterprises: [], customers: [], orders: [], purchases: [], products: [], invoices: [] };

    const q = `%${query.trim()}%`;
    try {
      const [entResult, custResult, ordResult, purResult, prodResult, invResult] = await Promise.all([
        db.execute(sql`
          SELECT id, name, cuit, 'enterprise' as _type FROM enterprises
          WHERE company_id = ${companyId} AND (name ILIKE ${q} OR cuit ILIKE ${q})
          ORDER BY name LIMIT 5
        `),
        db.execute(sql`
          SELECT id, name, email, cuit, 'customer' as _type FROM customers
          WHERE company_id = ${companyId} AND (name ILIKE ${q} OR email ILIKE ${q} OR cuit ILIKE ${q})
          ORDER BY name LIMIT 5
        `),
        db.execute(sql`
          SELECT o.id, o.order_number, o.title, o.total_amount, o.status, c.name as customer_name, 'order' as _type
          FROM orders o LEFT JOIN customers c ON o.customer_id = c.id
          WHERE o.company_id = ${companyId} AND (o.title ILIKE ${q} OR CAST(o.order_number AS TEXT) ILIKE ${q} OR c.name ILIKE ${q})
          ORDER BY o.created_at DESC LIMIT 5
        `),
        db.execute(sql`
          SELECT p.id, p.purchase_number, p.total_amount, p.status, e.name as enterprise_name, 'purchase' as _type
          FROM purchases p LEFT JOIN enterprises e ON p.enterprise_id = e.id
          WHERE p.company_id = ${companyId} AND (CAST(p.purchase_number AS TEXT) ILIKE ${q} OR e.name ILIKE ${q})
          ORDER BY p.created_at DESC LIMIT 5
        `),
        db.execute(sql`
          SELECT id, name, sku, 'product' as _type FROM products
          WHERE company_id = ${companyId} AND (name ILIKE ${q} OR sku ILIKE ${q})
          ORDER BY name LIMIT 5
        `),
        db.execute(sql`
          SELECT i.id, i.invoice_number, i.invoice_type, i.total_amount, i.status, c.name as customer_name, 'invoice' as _type
          FROM invoices i LEFT JOIN customers c ON i.customer_id = c.id
          WHERE i.company_id = ${companyId} AND (CAST(i.invoice_number AS TEXT) ILIKE ${q} OR c.name ILIKE ${q})
          ORDER BY i.created_at DESC LIMIT 5
        `),
      ]);

      return {
        enterprises: (entResult as any).rows || entResult || [],
        customers: (custResult as any).rows || custResult || [],
        orders: (ordResult as any).rows || ordResult || [],
        purchases: (purResult as any).rows || purResult || [],
        products: (prodResult as any).rows || prodResult || [],
        invoices: (invResult as any).rows || invResult || [],
      };
    } catch (error) {
      console.error('Global search error:', error);
      throw new ApiError(500, 'Failed to perform search');
    }
  }
}

export const reportsService = new ReportsService();
