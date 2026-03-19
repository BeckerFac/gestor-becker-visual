import { db } from '../../config/db';
import { invoices, invoice_items, customers, products, product_pricing, stock, payments } from '../../db/schema';
import { eq, and, gte, lte, sql, count, sum, desc } from 'drizzle-orm';
import { ApiError } from '../../middlewares/errorHandler';

// Helper: check if user has view access to a module (undefined permissions = admin = full access)
function canView(permissions: Map<string, Set<string>> | undefined, module: string): boolean {
  if (!permissions) return true; // Admin (permissions not loaded = bypassed authorize)
  const modulePerms = permissions.get(module);
  return !!modulePerms && modulePerms.has('view');
}

export class ReportsService {
  async getDashboard(
    companyId: string,
    dateFrom?: string,
    dateTo?: string,
    userPermissions?: Map<string, Set<string>>,
  ) {
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

      // Default empty values
      let salesMonth = 0;
      let collectionsPending = 0;
      let chequesPendingCount = 0;
      let chequesPendingAmount = 0;
      let ordersUnpaidCount = 0;
      let ordersUnpaidAmount = 0;
      let recentInvoicesList: any[] = [];
      let recentOrdersList: any[] = [];

      // Sales in period (authorized invoices) - requires invoices view
      if (canView(userPermissions, 'invoices')) {
        const salesMonthResult = await db.execute(sql`
          SELECT COALESCE(SUM(CAST(total_amount AS decimal)), 0) as total
          FROM invoices
          WHERE company_id = ${companyId}
            AND status = 'authorized'
            AND invoice_date >= ${periodStart}
            AND invoice_date <= ${periodEnd}
        `);

        const salesMonthRows = (salesMonthResult as any).rows || salesMonthResult || [];
        salesMonth = parseFloat(salesMonthRows[0]?.total || '0');

        // Collections pending - requires invoices view
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

        const collectionsRows = (collectionsPendingResult as any).rows || collectionsPendingResult || [];
        collectionsPending = parseFloat(collectionsRows[0]?.total || '0');

        // Recent invoices (last 5)
        const recentInvoicesResult = await db.execute(sql`
          SELECT i.id, i.invoice_type, i.invoice_number, i.invoice_date, i.total_amount, i.status, i.cae,
                 c.name as customer_name
          FROM invoices i
          LEFT JOIN customers c ON i.customer_id = c.id
          WHERE i.company_id = ${companyId}
          ORDER BY i.created_at DESC
          LIMIT 5
        `);
        recentInvoicesList = (recentInvoicesResult as any).rows || recentInvoicesResult || [];
      }

      // Cheques pending - requires cheques view
      if (canView(userPermissions, 'cheques')) {
        const chequesPendingResult = await db.execute(sql`
          SELECT COUNT(*) as count, COALESCE(SUM(CAST(amount AS decimal)), 0) as total
          FROM cheques
          WHERE company_id = ${companyId} AND status = 'a_cobrar'
        `);

        const chequesRows = (chequesPendingResult as any).rows || chequesPendingResult || [];
        chequesPendingCount = parseInt(chequesRows[0]?.count || '0');
        chequesPendingAmount = parseFloat(chequesRows[0]?.total || '0');
      }

      // Orders unpaid - requires orders view
      if (canView(userPermissions, 'orders')) {
        const ordersUnpaidResult = await db.execute(sql`
          SELECT COUNT(*) as count, COALESCE(SUM(CAST(total_amount AS decimal)), 0) as total
          FROM orders
          WHERE company_id = ${companyId} AND payment_status = 'pendiente'
        `);

        const ordersRows = (ordersUnpaidResult as any).rows || ordersUnpaidResult || [];
        ordersUnpaidCount = parseInt(ordersRows[0]?.count || '0');
        ordersUnpaidAmount = parseFloat(ordersRows[0]?.total || '0');

        // Recent orders (last 5)
        const recentOrdersResult = await db.execute(sql`
          SELECT o.id, o.order_number, o.title, o.total_amount, o.status, o.payment_status, o.payment_method, o.created_at,
                 c.name as customer_name
          FROM orders o
          LEFT JOIN customers c ON o.customer_id = c.id
          WHERE o.company_id = ${companyId}
          ORDER BY o.created_at DESC
          LIMIT 5
        `);
        recentOrdersList = (recentOrdersResult as any).rows || recentOrdersResult || [];
      }

      return {
        sales_month: salesMonth,
        collections_pending: collectionsPending,
        cheques_pending_count: chequesPendingCount,
        cheques_pending_amount: chequesPendingAmount,
        orders_unpaid_count: ordersUnpaidCount,
        orders_unpaid_amount: ordersUnpaidAmount,
        recent_invoices: recentInvoicesList,
        recent_orders: recentOrdersList,
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

  async globalSearch(
    companyId: string,
    query: string,
    userPermissions?: Map<string, Set<string>>,
  ) {
    if (!query || query.trim().length < 2) return { enterprises: [], customers: [], orders: [], purchases: [], products: [], invoices: [] };

    const q = `%${query.trim()}%`;
    try {
      // Build queries only for modules the user can access
      const queries: Record<string, Promise<any>> = {};

      if (canView(userPermissions, 'enterprises')) {
        queries.enterprises = db.execute(sql`
          SELECT id, name, cuit, 'enterprise' as _type FROM enterprises
          WHERE company_id = ${companyId} AND (name ILIKE ${q} OR cuit ILIKE ${q})
          ORDER BY name LIMIT 5
        `);
        queries.customers = db.execute(sql`
          SELECT id, name, email, cuit, 'customer' as _type FROM customers
          WHERE company_id = ${companyId} AND (name ILIKE ${q} OR email ILIKE ${q} OR cuit ILIKE ${q})
          ORDER BY name LIMIT 5
        `);
      }

      if (canView(userPermissions, 'orders')) {
        queries.orders = db.execute(sql`
          SELECT o.id, o.order_number, o.title, o.total_amount, o.status, c.name as customer_name, 'order' as _type
          FROM orders o LEFT JOIN customers c ON o.customer_id = c.id
          WHERE o.company_id = ${companyId} AND (o.title ILIKE ${q} OR CAST(o.order_number AS TEXT) ILIKE ${q} OR c.name ILIKE ${q})
          ORDER BY o.created_at DESC LIMIT 5
        `);
      }

      if (canView(userPermissions, 'purchases')) {
        queries.purchases = db.execute(sql`
          SELECT p.id, p.purchase_number, p.total_amount, p.status, e.name as enterprise_name, 'purchase' as _type
          FROM purchases p LEFT JOIN enterprises e ON p.enterprise_id = e.id
          WHERE p.company_id = ${companyId} AND (CAST(p.purchase_number AS TEXT) ILIKE ${q} OR e.name ILIKE ${q})
          ORDER BY p.created_at DESC LIMIT 5
        `);
      }

      if (canView(userPermissions, 'products')) {
        queries.products = db.execute(sql`
          SELECT id, name, sku, 'product' as _type FROM products
          WHERE company_id = ${companyId} AND (name ILIKE ${q} OR sku ILIKE ${q})
          ORDER BY name LIMIT 5
        `);
      }

      if (canView(userPermissions, 'invoices')) {
        queries.invoices = db.execute(sql`
          SELECT i.id, i.invoice_number, i.invoice_type, i.total_amount, i.status, c.name as customer_name, 'invoice' as _type
          FROM invoices i LEFT JOIN customers c ON i.customer_id = c.id
          WHERE i.company_id = ${companyId} AND (CAST(i.invoice_number AS TEXT) ILIKE ${q} OR c.name ILIKE ${q})
          ORDER BY i.created_at DESC LIMIT 5
        `);
      }

      const keys = Object.keys(queries);
      const results = await Promise.all(Object.values(queries));

      const resolved: Record<string, any[]> = {};
      keys.forEach((key, idx) => {
        resolved[key] = (results[idx] as any).rows || results[idx] || [];
      });

      return {
        enterprises: resolved.enterprises || [],
        customers: resolved.customers || [],
        orders: resolved.orders || [],
        purchases: resolved.purchases || [],
        products: resolved.products || [],
        invoices: resolved.invoices || [],
      };
    } catch (error) {
      console.error('Global search error:', error);
      throw new ApiError(500, 'Failed to perform search');
    }
  }

  async getInsights(
    companyId: string,
    userPermissions?: Map<string, Set<string>>,
  ) {
    const actions: Array<{ type: string; severity: 'critical' | 'warning' | 'info'; title: string; description: string; link: string; value?: string }> = [];

    // Each query wrapped independently so one failure doesn't break all

    // Draft invoices pending authorization
    if (canView(userPermissions, 'invoices')) {
      try {
        const draftsResult = await db.execute(sql`
          SELECT COUNT(*) as count
          FROM invoices
          WHERE company_id = ${companyId} AND status = 'draft'
        `);
        const draftRows = (draftsResult as any).rows || draftsResult || [];
        const draftCount = parseInt(draftRows[0]?.count || '0');
        if (draftCount > 0) {
          actions.push({
            type: 'draft_invoices',
            severity: 'warning',
            title: `${draftCount} factura${draftCount > 1 ? 's' : ''} en borrador`,
            description: 'Pendientes de enviar a AFIP',
            link: '/invoices',
          });
        }
      } catch (e) { console.error('Insights draft_invoices error:', e); }
    }

    // Orders pending
    if (canView(userPermissions, 'orders')) {
      try {
        const pendingOrdersResult = await db.execute(sql`
          SELECT COUNT(*) as count
          FROM orders
          WHERE company_id = ${companyId} AND status = 'pendiente'
        `);
        const pendingRows = (pendingOrdersResult as any).rows || pendingOrdersResult || [];
        const pendingCount = parseInt(pendingRows[0]?.count || '0');
        if (pendingCount > 0) {
          actions.push({
            type: 'pending_orders',
            severity: 'warning',
            title: `${pendingCount} pedido${pendingCount > 1 ? 's' : ''} pendiente${pendingCount > 1 ? 's' : ''}`,
            description: 'Esperando ser procesados',
            link: '/orders',
          });
        }
      } catch (e) { console.error('Insights pending_orders error:', e); }
    }

    // Low stock products
    if (canView(userPermissions, 'products')) {
      try {
        const lowStockResult = await db.execute(sql`
          SELECT COUNT(*) as count
          FROM products p
          LEFT JOIN stock s ON p.id = s.product_id
          WHERE p.company_id = ${companyId}
            AND p.controls_stock = true
            AND p.low_stock_threshold IS NOT NULL
            AND p.low_stock_threshold > 0
            AND COALESCE(s.quantity, 0) <= p.low_stock_threshold
        `);
        const lowStockRows = (lowStockResult as any).rows || lowStockResult || [];
        const lowStockCount = parseInt(lowStockRows[0]?.count || '0');
        if (lowStockCount > 0) {
          actions.push({
            type: 'low_stock',
            severity: lowStockCount > 3 ? 'critical' : 'warning',
            title: `${lowStockCount} producto${lowStockCount > 1 ? 's' : ''} con stock bajo`,
            description: 'Por debajo del minimo configurado',
            link: '/products',
          });
        }
      } catch (e) { console.error('Insights low_stock error:', e); }
    }

    // Cheques pending to collect
    if (canView(userPermissions, 'cheques')) {
      try {
        // Overdue cheques (deposit_date already passed)
        const chequesOverdueResult = await db.execute(sql`
          SELECT COUNT(*) as count, COALESCE(SUM(CAST(amount AS decimal)), 0) as total
          FROM cheques
          WHERE company_id = ${companyId}
            AND status = 'a_cobrar'
            AND deposit_date < NOW()
        `);
        const overdueRows = (chequesOverdueResult as any).rows || chequesOverdueResult || [];
        const overdueCount = parseInt(overdueRows[0]?.count || '0');
        const overdueTotal = parseFloat(overdueRows[0]?.total || '0');
        if (overdueCount > 0) {
          actions.push({
            type: 'cheques_overdue',
            severity: 'critical',
            title: `${overdueCount} cheque${overdueCount > 1 ? 's' : ''} vencido${overdueCount > 1 ? 's' : ''} sin cobrar`,
            description: 'Fecha de deposito ya paso',
            link: '/cheques',
            value: `$${overdueTotal.toLocaleString('es-AR', { minimumFractionDigits: 2 })}`,
          });
        }

        // Cheques coming up (next 7 days)
        const chequesUpcomingResult = await db.execute(sql`
          SELECT COUNT(*) as count, COALESCE(SUM(CAST(amount AS decimal)), 0) as total
          FROM cheques
          WHERE company_id = ${companyId}
            AND status = 'a_cobrar'
            AND deposit_date >= NOW()
            AND deposit_date <= NOW() + INTERVAL '7 days'
        `);
        const upcomingRows = (chequesUpcomingResult as any).rows || chequesUpcomingResult || [];
        const upcomingCount = parseInt(upcomingRows[0]?.count || '0');
        const upcomingTotal = parseFloat(upcomingRows[0]?.total || '0');
        if (upcomingCount > 0) {
          actions.push({
            type: 'cheques_upcoming',
            severity: 'info',
            title: `${upcomingCount} cheque${upcomingCount > 1 ? 's' : ''} a cobrar esta semana`,
            description: 'Proximos 7 dias',
            link: '/cheques',
            value: `$${upcomingTotal.toLocaleString('es-AR', { minimumFractionDigits: 2 })}`,
          });
        }
      } catch (e) { console.error('Insights cheques error:', e); }
    }

    // Invoices authorized but unpaid for 30+ days
    if (canView(userPermissions, 'invoices')) {
      try {
        const overdueInvResult = await db.execute(sql`
          SELECT COUNT(*) as count, COALESCE(SUM(
            CAST(i.total_amount AS decimal) - COALESCE(
              (SELECT SUM(CAST(p.amount AS decimal)) FROM payments p WHERE p.invoice_id = i.id), 0
            )
          ), 0) as total
          FROM invoices i
          WHERE i.company_id = ${companyId}
            AND i.status = 'authorized'
            AND i.invoice_date < NOW() - INTERVAL '30 days'
            AND CAST(i.total_amount AS decimal) > COALESCE(
              (SELECT SUM(CAST(p.amount AS decimal)) FROM payments p WHERE p.invoice_id = i.id), 0
            )
        `);
        const invRows = (overdueInvResult as any).rows || overdueInvResult || [];
        const invCount = parseInt(invRows[0]?.count || '0');
        const invTotal = parseFloat(invRows[0]?.total || '0');
        if (invCount > 0) {
          actions.push({
            type: 'overdue_invoices',
            severity: 'critical',
            title: `${invCount} factura${invCount > 1 ? 's' : ''} impaga${invCount > 1 ? 's' : ''} hace +30 dias`,
            description: 'Cobranza vencida',
            link: '/cobros',
            value: `$${invTotal.toLocaleString('es-AR', { minimumFractionDigits: 2 })}`,
          });
        }
      } catch (e) { console.error('Insights overdue_invoices error:', e); }
    }

    // Orders delivered but not invoiced
    if (canView(userPermissions, 'orders') && canView(userPermissions, 'invoices')) {
      try {
        const deliveredResult = await db.execute(sql`
          SELECT COUNT(*) as count
          FROM orders
          WHERE company_id = ${companyId}
            AND status = 'entregado'
            AND invoice_id IS NULL
        `);
        const deliveredRows = (deliveredResult as any).rows || deliveredResult || [];
        const deliveredCount = parseInt(deliveredRows[0]?.count || '0');
        if (deliveredCount > 0) {
          actions.push({
            type: 'delivered_not_invoiced',
            severity: 'warning',
            title: `${deliveredCount} pedido${deliveredCount > 1 ? 's' : ''} entregado${deliveredCount > 1 ? 's' : ''} sin facturar`,
            description: 'Entregados pero sin factura emitida',
            link: '/orders',
          });
        }
      } catch (e) { console.error('Insights delivered_not_invoiced error:', e); }
    }

    // Aging overview insight (replaces single overdue_invoices for richer data)
    if (canView(userPermissions, 'invoices')) {
      try {
        const agingInsightResult = await db.execute(sql`
          SELECT
            COALESCE(SUM(CASE WHEN days_over >= 1 AND days_over <= 30 THEN remaining ELSE 0 END), 0) as bucket_1_30,
            COALESCE(SUM(CASE WHEN days_over >= 31 AND days_over <= 60 THEN remaining ELSE 0 END), 0) as bucket_31_60,
            COALESCE(SUM(CASE WHEN days_over >= 61 AND days_over <= 90 THEN remaining ELSE 0 END), 0) as bucket_61_90,
            COALESCE(SUM(CASE WHEN days_over > 90 THEN remaining ELSE 0 END), 0) as bucket_90_plus,
            COALESCE(SUM(CASE WHEN days_over >= 1 THEN remaining ELSE 0 END), 0) as total_overdue,
            COUNT(CASE WHEN days_over >= 1 AND days_over <= 30 THEN 1 END) as count_1_30,
            COUNT(CASE WHEN days_over >= 31 AND days_over <= 60 THEN 1 END) as count_31_60,
            COUNT(CASE WHEN days_over >= 61 AND days_over <= 90 THEN 1 END) as count_61_90,
            COUNT(CASE WHEN days_over > 90 THEN 1 END) as count_90_plus
          FROM (
            SELECT
              CAST(i.total_amount AS decimal) - COALESCE(
                (SELECT SUM(CAST(p.amount AS decimal)) FROM payments p WHERE p.invoice_id = i.id), 0
              ) as remaining,
              GREATEST(0, EXTRACT(DAY FROM NOW() - COALESCE(i.due_date, i.invoice_date))::integer) as days_over
            FROM invoices i
            WHERE i.company_id = ${companyId}
              AND i.status = 'authorized'
              AND CAST(i.total_amount AS decimal) > COALESCE(
                (SELECT SUM(CAST(p.amount AS decimal)) FROM payments p WHERE p.invoice_id = i.id), 0
              )
          ) sub
          WHERE days_over >= 1
        `);
        const agingRows = (agingInsightResult as any).rows || agingInsightResult || [];
        const ar = agingRows[0] || {};
        const totalOverdue = parseFloat(ar.total_overdue || '0');
        const c130 = parseInt(ar.count_1_30 || '0');
        const c3160 = parseInt(ar.count_31_60 || '0');
        const c6190 = parseInt(ar.count_61_90 || '0');
        const c90p = parseInt(ar.count_90_plus || '0');

        if (totalOverdue > 0) {
          const parts: string[] = [];
          if (c130 > 0) parts.push(`${c130} de 1-30d`);
          if (c3160 > 0) parts.push(`${c3160} de 31-60d`);
          if (c6190 > 0) parts.push(`${c6190} de 61-90d`);
          if (c90p > 0) parts.push(`${c90p} de 90+d`);

          const hasCritical = (c6190 + c90p) > 0;
          actions.push({
            type: 'aging_overview',
            severity: hasCritical ? 'critical' : 'warning',
            title: `Facturas vencidas por cobrar`,
            description: parts.join(', '),
            link: '/cobros',
            value: `$${totalOverdue.toLocaleString('es-AR', { minimumFractionDigits: 2 })}`,
          });
        }
      } catch (e) { console.error('Insights aging_overview error:', e); }
    }

    // Worst client alert (enterprise with most overdue debt)
    if (canView(userPermissions, 'invoices') && canView(userPermissions, 'enterprises')) {
      try {
        const worstResult = await db.execute(sql`
          SELECT
            e.name as enterprise_name,
            COALESCE(SUM(
              CAST(i.total_amount AS decimal) - COALESCE(
                (SELECT SUM(CAST(p.amount AS decimal)) FROM payments p WHERE p.invoice_id = i.id), 0
              )
            ), 0) as total_overdue,
            MAX(GREATEST(0, EXTRACT(DAY FROM NOW() - COALESCE(i.due_date, i.invoice_date))::integer)) as oldest_days
          FROM invoices i
          JOIN customers c ON i.customer_id = c.id
          JOIN enterprises e ON c.enterprise_id = e.id
          WHERE i.company_id = ${companyId}
            AND i.status = 'authorized'
            AND CAST(i.total_amount AS decimal) > COALESCE(
              (SELECT SUM(CAST(p.amount AS decimal)) FROM payments p WHERE p.invoice_id = i.id), 0
            )
            AND EXTRACT(DAY FROM NOW() - COALESCE(i.due_date, i.invoice_date)) > 0
          GROUP BY e.id, e.name
          ORDER BY total_overdue DESC
          LIMIT 1
        `);
        const worstRows = (worstResult as any).rows || worstResult || [];
        if (worstRows.length > 0) {
          const w = worstRows[0];
          const wTotal = parseFloat(w.total_overdue || '0');
          const wDays = parseInt(w.oldest_days || '0');
          if (wTotal > 0 && wDays >= 15) {
            actions.push({
              type: 'worst_client_debt',
              severity: wDays >= 60 ? 'critical' : 'warning',
              title: `${w.enterprise_name} acumula deuda`,
              description: `Factura mas antigua: ${wDays} dias vencida`,
              link: '/cobros',
              value: `$${wTotal.toLocaleString('es-AR', { minimumFractionDigits: 2 })}`,
            });
          }
        }
      } catch (e) { console.error('Insights worst_client error:', e); }
    }

    // Invoices due this week (pre-due reminder)
    if (canView(userPermissions, 'invoices')) {
      try {
        const dueSoonResult = await db.execute(sql`
          SELECT COUNT(*) as count, COALESCE(SUM(
            CAST(i.total_amount AS decimal) - COALESCE(
              (SELECT SUM(CAST(p.amount AS decimal)) FROM payments p WHERE p.invoice_id = i.id), 0
            )
          ), 0) as total
          FROM invoices i
          WHERE i.company_id = ${companyId}
            AND i.status = 'authorized'
            AND i.due_date IS NOT NULL
            AND i.due_date >= NOW()
            AND i.due_date <= NOW() + INTERVAL '7 days'
            AND CAST(i.total_amount AS decimal) > COALESCE(
              (SELECT SUM(CAST(p.amount AS decimal)) FROM payments p WHERE p.invoice_id = i.id), 0
            )
        `);
        const dueSoonRows = (dueSoonResult as any).rows || dueSoonResult || [];
        const dueSoonCount = parseInt(dueSoonRows[0]?.count || '0');
        const dueSoonTotal = parseFloat(dueSoonRows[0]?.total || '0');
        if (dueSoonCount > 0) {
          actions.push({
            type: 'invoices_due_soon',
            severity: 'info',
            title: `${dueSoonCount} factura${dueSoonCount > 1 ? 's' : ''} vence${dueSoonCount > 1 ? 'n' : ''} esta semana`,
            description: 'Considerar enviar recordatorio',
            link: '/cobros',
            value: `$${dueSoonTotal.toLocaleString('es-AR', { minimumFractionDigits: 2 })}`,
          });
        }
      } catch (e) { console.error('Insights invoices_due_soon error:', e); }
    }

    // Sort actions: critical first, then warning, then info
    const severityOrder: Record<string, number> = { critical: 0, warning: 1, info: 2 };
    actions.sort((a, b) => (severityOrder[a.severity] ?? 2) - (severityOrder[b.severity] ?? 2));

    return { actions };
  }

  async getAgingReport(companyId: string) {
    try {
      // 1. Get all unpaid invoices with aging data
      const detailsResult = await db.execute(sql`
        SELECT
          e.name as enterprise_name,
          c.name as customer_name,
          'invoice' as document_type,
          CAST(i.invoice_number AS TEXT) as document_number,
          CAST(i.total_amount AS decimal) as total_amount,
          COALESCE(
            (SELECT SUM(CAST(p.amount AS decimal)) FROM payments p WHERE p.invoice_id = i.id), 0
          ) as paid_amount,
          CAST(i.total_amount AS decimal) - COALESCE(
            (SELECT SUM(CAST(p.amount AS decimal)) FROM payments p WHERE p.invoice_id = i.id), 0
          ) as remaining,
          COALESCE(i.due_date, i.invoice_date) as due_date,
          GREATEST(0, EXTRACT(DAY FROM NOW() - COALESCE(i.due_date, i.invoice_date))::integer) as days_overdue,
          e.id as enterprise_id
        FROM invoices i
        LEFT JOIN customers c ON i.customer_id = c.id
        LEFT JOIN enterprises e ON c.enterprise_id = e.id
        WHERE i.company_id = ${companyId}
          AND i.status = 'authorized'
          AND CAST(i.total_amount AS decimal) > COALESCE(
            (SELECT SUM(CAST(p.amount AS decimal)) FROM payments p WHERE p.invoice_id = i.id), 0
          )
        ORDER BY GREATEST(0, EXTRACT(DAY FROM NOW() - COALESCE(i.due_date, i.invoice_date))::integer) DESC
      `);

      // 2. Get unfactured orders with pending payment
      const ordersResult = await db.execute(sql`
        SELECT
          e.name as enterprise_name,
          c.name as customer_name,
          'order' as document_type,
          CAST(o.order_number AS TEXT) as document_number,
          CAST(o.total_amount AS decimal) as total_amount,
          COALESCE(
            (SELECT SUM(CAST(cb.amount AS decimal)) FROM cobros cb WHERE cb.order_id = o.id), 0
          ) as paid_amount,
          CAST(o.total_amount AS decimal) - COALESCE(
            (SELECT SUM(CAST(cb.amount AS decimal)) FROM cobros cb WHERE cb.order_id = o.id), 0
          ) as remaining,
          o.created_at as due_date,
          GREATEST(0, EXTRACT(DAY FROM NOW() - o.created_at)::integer) as days_overdue,
          e.id as enterprise_id
        FROM orders o
        LEFT JOIN customers c ON o.customer_id = c.id
        LEFT JOIN enterprises e ON COALESCE(o.enterprise_id, c.enterprise_id) = e.id
        WHERE o.company_id = ${companyId}
          AND o.payment_status IN ('pendiente', 'parcial')
          AND o.status != 'cancelado'
          AND o.invoice_id IS NULL
          AND CAST(o.total_amount AS decimal) > COALESCE(
            (SELECT SUM(CAST(cb.amount AS decimal)) FROM cobros cb WHERE cb.order_id = o.id), 0
          )
        ORDER BY GREATEST(0, EXTRACT(DAY FROM NOW() - o.created_at)::integer) DESC
      `);

      const invoiceRows = ((detailsResult as any).rows || detailsResult || []).map((r: any) => ({
        enterprise_name: r.enterprise_name || r.customer_name || 'Sin empresa',
        customer_name: r.customer_name || 'Sin cliente',
        document_type: r.document_type as 'invoice' | 'order',
        document_number: r.document_number,
        total_amount: parseFloat(r.total_amount || '0'),
        paid_amount: parseFloat(r.paid_amount || '0'),
        remaining: parseFloat(r.remaining || '0'),
        due_date: r.due_date,
        days_overdue: parseInt(r.days_overdue || '0'),
        bucket: getBucket(parseInt(r.days_overdue || '0')),
        enterprise_id: r.enterprise_id,
      }));

      const orderRows = ((ordersResult as any).rows || ordersResult || []).map((r: any) => ({
        enterprise_name: r.enterprise_name || r.customer_name || 'Sin empresa',
        customer_name: r.customer_name || 'Sin cliente',
        document_type: 'order' as const,
        document_number: r.document_number,
        total_amount: parseFloat(r.total_amount || '0'),
        paid_amount: parseFloat(r.paid_amount || '0'),
        remaining: parseFloat(r.remaining || '0'),
        due_date: r.due_date,
        days_overdue: parseInt(r.days_overdue || '0'),
        bucket: getBucket(parseInt(r.days_overdue || '0')),
        enterprise_id: r.enterprise_id,
      }));

      const allDetails = [...invoiceRows, ...orderRows].sort((a, b) => b.days_overdue - a.days_overdue);

      // 3. Calculate summary
      const summary = {
        current: 0,
        bucket_1_30: 0,
        bucket_31_60: 0,
        bucket_61_90: 0,
        bucket_90_plus: 0,
        total_overdue: 0,
      };
      for (const item of allDetails) {
        switch (item.bucket) {
          case 'current': summary.current += item.remaining; break;
          case '1-30': summary.bucket_1_30 += item.remaining; break;
          case '31-60': summary.bucket_31_60 += item.remaining; break;
          case '61-90': summary.bucket_61_90 += item.remaining; break;
          case '90+': summary.bucket_90_plus += item.remaining; break;
        }
        if (item.days_overdue > 0) {
          summary.total_overdue += item.remaining;
        }
      }

      // 4. Worst clients (top 5 by overdue amount)
      const clientMap = new Map<string, { enterprise_name: string; total_overdue: number; oldest_days: number }>();
      for (const item of allDetails) {
        if (item.days_overdue <= 0) continue;
        const key = item.enterprise_name;
        const existing = clientMap.get(key);
        if (existing) {
          existing.total_overdue += item.remaining;
          existing.oldest_days = Math.max(existing.oldest_days, item.days_overdue);
        } else {
          clientMap.set(key, {
            enterprise_name: key,
            total_overdue: item.remaining,
            oldest_days: item.days_overdue,
          });
        }
      }
      const worstClients = Array.from(clientMap.values())
        .sort((a, b) => b.total_overdue - a.total_overdue)
        .slice(0, 5);

      // 5. DSO calculation (last 90 days)
      const dsoResult = await db.execute(sql`
        SELECT AVG(
          EXTRACT(DAY FROM p.payment_date - i.invoice_date)
        )::integer as avg_dso
        FROM payments p
        JOIN invoices i ON p.invoice_id = i.id
        WHERE i.company_id = ${companyId}
          AND p.payment_date >= NOW() - INTERVAL '90 days'
          AND i.status = 'authorized'
      `);
      const dsoRows = (dsoResult as any).rows || dsoResult || [];
      const avgDso = parseInt(dsoRows[0]?.avg_dso || '0') || 0;

      return {
        summary,
        details: allDetails,
        worst_clients: worstClients,
        avg_dso: avgDso,
      };
    } catch (error) {
      console.error('Aging report error:', error);
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Failed to generate aging report');
    }
  }
}

function getBucket(daysOverdue: number): 'current' | '1-30' | '31-60' | '61-90' | '90+' {
  if (daysOverdue <= 0) return 'current';
  if (daysOverdue <= 30) return '1-30';
  if (daysOverdue <= 60) return '31-60';
  if (daysOverdue <= 90) return '61-90';
  return '90+';
}

export const reportsService = new ReportsService();
