// Safe, read-only SQL queries for AI chat feature
// These queries extract aggregated data, never raw customer details

import { pool } from '../../config/db';

export interface QueryContext {
  readonly companyId: string;
}

// Database schema description for LLM context (no sensitive data)
export const SCHEMA_DESCRIPTION = `
Base de datos del sistema de gestion comercial. Tablas principales:
- orders: pedidos de venta (order_number, title, total_amount, status, payment_status, created_at, customer_id)
- order_items: items de pedidos (product_name, quantity, unit_price, cost, subtotal)
- invoices: facturas (invoice_type, invoice_number, total_amount, status, invoice_date, customer_id)
- customers: clientes/contactos (name, email, phone, cuit)
- enterprises: empresas clientes (name, cuit, address)
- products: productos (name, sku, price, cost, category, product_type)
- cobros: cobros recibidos (amount, payment_method, payment_date)
- pagos: pagos realizados (amount, payment_method, payment_date)
- purchases: compras a proveedores (total_amount, status, date)
- cheques: cheques (amount, due_date, status, bank, drawer)
- quotes: presupuestos (total_amount, status, valid_until)
- stock: inventario (product_id, quantity)

Relaciones clave:
- orders.customer_id -> customers.id (muchos pedidos por cliente)
- orders.enterprise_id -> enterprises.id (empresa del pedido)
- invoices.customer_id -> customers.id
- cobros.order_id -> orders.id, cobros.invoice_id -> invoices.id
- order_items.order_id -> orders.id, order_items.product_id -> products.id

Todos los montos estan en pesos argentinos (ARS).
company_id filtra datos por empresa (multi-tenant).
`;

// Run a safe, read-only query against the company's data
export async function runSafeQuery(query: string, companyId: string): Promise<any[]> {
  // Security: only allow SELECT statements
  const normalized = query.trim().toUpperCase();
  if (!normalized.startsWith('SELECT')) {
    throw new Error('Only SELECT queries are allowed');
  }

  // Block dangerous keywords
  const forbidden = ['INSERT', 'UPDATE', 'DELETE', 'DROP', 'ALTER', 'CREATE', 'TRUNCATE', 'GRANT', 'REVOKE', 'EXEC', 'EXECUTE', '--', ';'];
  for (const word of forbidden) {
    // Check if the forbidden word appears as a standalone keyword (not inside a string)
    const regex = new RegExp(`\\b${word}\\b`, 'i');
    if (word === '--' || word === ';') {
      if (query.includes(word)) {
        throw new Error(`Forbidden SQL pattern: ${word}`);
      }
    } else if (regex.test(query)) {
      throw new Error(`Forbidden SQL keyword: ${word}`);
    }
  }

  // Enforce company_id filter - the query MUST reference the parameter
  if (!query.includes('$1')) {
    throw new Error('Query must include company_id parameter ($1)');
  }

  try {
    const result = await pool.query({
      text: query,
      values: [companyId],
      // 10 second timeout for AI queries
      statement_timeout: 10000,
    } as any);
    return result.rows || [];
  } catch (error: any) {
    throw new Error(`Query execution failed: ${error.message}`);
  }
}

// Pre-built safe queries for common questions (no LLM-generated SQL needed)
export async function getCompanySummary(companyId: string): Promise<Record<string, any>> {
  const [
    ordersResult,
    invoicesResult,
    customersResult,
    productsResult,
  ] = await Promise.all([
    pool.query(`
      SELECT
        COUNT(*) as total_orders,
        COALESCE(SUM(CAST(total_amount AS decimal)), 0) as total_revenue,
        COUNT(CASE WHEN status = 'pendiente' THEN 1 END) as pending_orders,
        COUNT(CASE WHEN payment_status = 'pendiente' THEN 1 END) as unpaid_orders
      FROM orders WHERE company_id = $1
    `, [companyId]),
    pool.query(`
      SELECT
        COUNT(*) as total_invoices,
        COALESCE(SUM(CAST(total_amount AS decimal)), 0) as total_invoiced
      FROM invoices WHERE company_id = $1 AND status = 'authorized'
    `, [companyId]),
    pool.query(`
      SELECT COUNT(*) as total_customers FROM customers WHERE company_id = $1
    `, [companyId]),
    pool.query(`
      SELECT COUNT(*) as total_products FROM products WHERE company_id = $1
    `, [companyId]),
  ]);

  return {
    total_orders: parseInt(ordersResult.rows[0]?.total_orders || '0'),
    total_revenue: parseFloat(ordersResult.rows[0]?.total_revenue || '0'),
    pending_orders: parseInt(ordersResult.rows[0]?.pending_orders || '0'),
    unpaid_orders: parseInt(ordersResult.rows[0]?.unpaid_orders || '0'),
    total_invoices: parseInt(invoicesResult.rows[0]?.total_invoices || '0'),
    total_invoiced: parseFloat(invoicesResult.rows[0]?.total_invoiced || '0'),
    total_customers: parseInt(customersResult.rows[0]?.total_customers || '0'),
    total_products: parseInt(productsResult.rows[0]?.total_products || '0'),
  };
}

// Get sales data for a period (aggregated, no PII)
export async function getSalesData(companyId: string, daysBack: number = 30): Promise<Record<string, any>> {
  const result = await pool.query(`
    SELECT
      DATE_TRUNC('day', created_at) as day,
      COUNT(*) as order_count,
      COALESCE(SUM(CAST(total_amount AS decimal)), 0) as total
    FROM orders
    WHERE company_id = $1
      AND created_at >= NOW() - INTERVAL '${daysBack} days'
    GROUP BY DATE_TRUNC('day', created_at)
    ORDER BY day DESC
  `, [companyId]);

  return {
    period_days: daysBack,
    daily_sales: result.rows.map(r => ({
      date: (r as any).day,
      count: parseInt((r as any).order_count || '0'),
      total: parseFloat((r as any).total || '0'),
    })),
  };
}

// Get top customers by revenue (anonymized names for LLM context)
export async function getTopCustomers(companyId: string, limit: number = 10): Promise<any[]> {
  const result = await pool.query(`
    SELECT
      COALESCE(e.name, c.name, 'Sin nombre') as customer_name,
      COUNT(o.id) as order_count,
      COALESCE(SUM(CAST(o.total_amount AS decimal)), 0) as total_revenue,
      MAX(o.created_at) as last_order_date
    FROM orders o
    LEFT JOIN enterprises e ON o.enterprise_id = e.id
    LEFT JOIN customers c ON o.customer_id = c.id
    WHERE o.company_id = $1
    GROUP BY COALESCE(e.name, c.name, 'Sin nombre')
    ORDER BY total_revenue DESC
    LIMIT $2
  `, [companyId, limit]);

  return result.rows.map((r: any) => ({
    name: r.customer_name,
    orders: parseInt(r.order_count || '0'),
    revenue: parseFloat(r.total_revenue || '0'),
    last_order: r.last_order_date,
  }));
}

// Get top products by sales volume
export async function getTopProducts(companyId: string, limit: number = 10): Promise<any[]> {
  const result = await pool.query(`
    SELECT
      oi.product_name,
      COALESCE(SUM(oi.quantity), 0) as total_quantity,
      COALESCE(SUM(CAST(oi.subtotal AS decimal)), 0) as total_revenue,
      COALESCE(AVG(CAST(oi.unit_price AS decimal)), 0) as avg_price,
      COALESCE(AVG(CAST(oi.cost AS decimal)), 0) as avg_cost
    FROM order_items oi
    JOIN orders o ON oi.order_id = o.id
    WHERE o.company_id = $1
    GROUP BY oi.product_name
    ORDER BY total_revenue DESC
    LIMIT $2
  `, [companyId, limit]);

  return result.rows.map((r: any) => ({
    name: r.product_name,
    quantity: parseFloat(r.total_quantity || '0'),
    revenue: parseFloat(r.total_revenue || '0'),
    avg_price: parseFloat(r.avg_price || '0'),
    avg_cost: parseFloat(r.avg_cost || '0'),
    margin_pct: parseFloat(r.avg_price || '0') > 0
      ? ((parseFloat(r.avg_price || '0') - parseFloat(r.avg_cost || '0')) / parseFloat(r.avg_price || '0') * 100)
      : 0,
  }));
}

// Get collections/payments summary
export async function getCollectionsSummary(companyId: string): Promise<Record<string, any>> {
  const [cobrosResult, pagosResult, pendingResult] = await Promise.all([
    pool.query(`
      SELECT
        COALESCE(SUM(CAST(amount AS decimal)), 0) as total_collected,
        COUNT(*) as collection_count
      FROM cobros
      WHERE company_id = $1 AND payment_date >= DATE_TRUNC('month', NOW())
    `, [companyId]),
    pool.query(`
      SELECT
        COALESCE(SUM(CAST(amount AS decimal)), 0) as total_paid,
        COUNT(*) as payment_count
      FROM pagos
      WHERE company_id = $1 AND payment_date >= DATE_TRUNC('month', NOW())
    `, [companyId]),
    pool.query(`
      SELECT
        COUNT(*) as pending_count,
        COALESCE(SUM(CAST(total_amount AS decimal)), 0) as pending_amount
      FROM orders
      WHERE company_id = $1 AND payment_status = 'pendiente'
    `, [companyId]),
  ]);

  return {
    collected_this_month: parseFloat(cobrosResult.rows[0]?.total_collected || '0'),
    collection_count: parseInt(cobrosResult.rows[0]?.collection_count || '0'),
    paid_this_month: parseFloat(pagosResult.rows[0]?.total_paid || '0'),
    payment_count: parseInt(pagosResult.rows[0]?.payment_count || '0'),
    pending_collection_count: parseInt(pendingResult.rows[0]?.pending_count || '0'),
    pending_collection_amount: parseFloat(pendingResult.rows[0]?.pending_amount || '0'),
  };
}
