// Health check endpoints
// GET /health - basic health (public)
// GET /health/detailed - DB, memory, uptime (public)
// GET /api/admin/health - full system status (admin only)

import { Router, Request, Response } from 'express';
import { pool } from '../config/db';
import { getPerformanceMetrics, getMemoryUsage, getPoolStats } from '../middlewares/performanceMonitor';
import { authMiddleware, AuthRequest } from '../middlewares/auth';

const router = Router();

// Basic health check - for load balancers, uptime monitors
router.get('/health', async (_req: Request, res: Response) => {
  try {
    const dbCheck = await pool.query('SELECT 1 as ok');
    const dbOk = dbCheck.rows?.[0]?.ok === 1;
    res.status(dbOk ? 200 : 503).json({
      status: dbOk ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      uptime: Math.round(process.uptime()),
    });
  } catch {
    res.status(503).json({
      status: 'error',
      timestamp: new Date().toISOString(),
    });
  }
});

// TEMPORARY: Diagnostic endpoint to debug order_items issue
router.get('/health/debug-orders', async (_req: Request, res: Response) => {
  try {
    const orders = await pool.query('SELECT id, order_number, title, status, enterprise_id, business_unit_id, created_at FROM orders ORDER BY created_at DESC LIMIT 5');
    const orderItems = await pool.query('SELECT oi.id, oi.order_id, oi.product_name, oi.quantity, oi.unit_price, oi.vat_rate, oi.deduct_stock FROM order_items oi ORDER BY oi.created_at DESC LIMIT 10');
    const invoiceItems = await pool.query('SELECT ii.order_item_id, ii.quantity, i.status as invoice_status FROM invoice_items ii JOIN invoices i ON ii.invoice_id = i.id WHERE ii.order_item_id IS NOT NULL LIMIT 20');
    const customers = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'customers' AND column_name = 'enterprise_id'");
    const orderItemsCols = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'order_items' ORDER BY ordinal_position");
    const bus = await pool.query('SELECT id, name, company_id FROM business_units LIMIT 5');

    res.json({
      recent_orders: orders.rows,
      recent_order_items: orderItems.rows,
      invoice_items_with_order_link: invoiceItems.rows,
      customers_has_enterprise_id: customers.rows.length > 0,
      order_items_columns: orderItemsCols.rows.map((r: any) => r.column_name),
      business_units: bus.rows,
      orders_without_items: (await pool.query('SELECT o.id, o.order_number FROM orders o WHERE NOT EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id = o.id) ORDER BY o.created_at DESC LIMIT 5')).rows,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message, stack: (err as Error).stack?.split('\n').slice(0, 5) });
  }
});

// TEMPORARY: Test the exact query that available-order-items uses
router.get('/health/test-available-items', async (req: Request, res: Response) => {
  try {
    const companyId = req.query.company_id as string || '2ce2b767-145b-460f-a153-64c2aeee578c';
    const enterpriseId = req.query.enterprise_id as string;

    // Ensure columns exist
    await pool.query('ALTER TABLE customers ADD COLUMN IF NOT EXISTS enterprise_id UUID').catch(() => {});
    await pool.query('ALTER TABLE order_items ADD COLUMN IF NOT EXISTS vat_rate DECIMAL(5,2) DEFAULT 21').catch(() => {});
    await pool.query('ALTER TABLE order_items ADD COLUMN IF NOT EXISTS deduct_stock BOOLEAN DEFAULT FALSE').catch(() => {});

    const params: any[] = [companyId];
    let enterpriseFilter = '';
    if (enterpriseId) {
      params.push(enterpriseId);
      enterpriseFilter = ` AND (o.enterprise_id = $${params.length} OR EXISTS (SELECT 1 FROM customers c WHERE c.id = o.customer_id AND c.enterprise_id = $${params.length}))`;
    }

    const { rows } = await pool.query(`
      WITH item_invoiced AS (
        SELECT ii.order_item_id, COALESCE(SUM(CAST(ii.quantity AS decimal)), 0) as qty_invoiced
        FROM invoice_items ii
        JOIN invoices i ON ii.invoice_id = i.id
        WHERE i.status != 'cancelled' AND ii.order_item_id IS NOT NULL
        GROUP BY ii.order_item_id
      )
      SELECT
        o.id as order_id, o.order_number, o.title as order_title, o.enterprise_id,
        e.name as enterprise_name,
        oi.id as order_item_id, oi.product_id, oi.product_name, oi.description,
        CAST(oi.quantity AS decimal) as quantity,
        CAST(oi.unit_price AS decimal) as unit_price,
        CAST(oi.subtotal AS decimal) as subtotal,
        COALESCE(CAST(oi.vat_rate AS decimal), 21) as vat_rate,
        COALESCE(inv.qty_invoiced, 0) as qty_invoiced,
        CAST(oi.quantity AS decimal) - COALESCE(inv.qty_invoiced, 0) as qty_remaining
      FROM order_items oi
      JOIN orders o ON oi.order_id = o.id
      LEFT JOIN enterprises e ON o.enterprise_id = e.id
      LEFT JOIN item_invoiced inv ON inv.order_item_id = oi.id
      WHERE o.company_id = $1 AND o.status NOT IN ('cancelado', 'cancelled')
        ${enterpriseFilter}
        AND (CAST(oi.quantity AS decimal) - COALESCE(inv.qty_invoiced, 0)) > 0
        AND oi.quantity IS NOT NULL AND CAST(oi.quantity AS decimal) > 0
      ORDER BY o.order_number DESC, oi.created_at ASC
    `, params);

    res.json({ count: rows.length, params, enterpriseFilter, rows: rows.slice(0, 5) });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message, stack: (err as Error).stack?.split('\n').slice(0, 5) });
  }
});

// Detailed health check - includes DB, memory, uptime
// In production, limit information disclosed to prevent reconnaissance
router.get('/health/detailed', async (_req: Request, res: Response) => {
  const isProduction = process.env.NODE_ENV === 'production';
  const checks: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    uptime: Math.round(process.uptime()),
    ...(isProduction ? {} : {
      version: process.env.npm_package_version || '1.0.0',
      node: process.version,
      environment: process.env.NODE_ENV || 'development',
    }),
  };

  // Database check
  try {
    const start = Date.now();
    await pool.query('SELECT 1 as ok');
    const dbLatency = Date.now() - start;
    checks.database = {
      status: 'connected',
      latencyMs: dbLatency,
      pool: getPoolStats(),
    };
  } catch (error) {
    checks.database = {
      status: 'disconnected',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }

  // Memory
  checks.memory = getMemoryUsage();

  // Determine overall status
  const dbConnected = (checks.database as Record<string, unknown>).status === 'connected';
  const status = dbConnected ? 'healthy' : 'unhealthy';

  res.status(dbConnected ? 200 : 503).json({
    status,
    ...checks,
  });
});

// Admin-only full system status
router.get('/api/admin/health', authMiddleware, async (req: AuthRequest, res: Response) => {
  // Only admins/owners can see full system status
  if (req.user?.role !== 'admin' && req.user?.role !== 'owner') {
    return res.status(403).json({ error: 'Admin access required' });
  }

  const metrics = getPerformanceMetrics();

  // Database detailed check
  let dbDetails: Record<string, unknown> = {};
  try {
    const start = Date.now();
    const sizeResult = await pool.query(`
      SELECT pg_size_pretty(pg_database_size(current_database())) as db_size
    `);
    const connResult = await pool.query(`
      SELECT count(*) as active_connections FROM pg_stat_activity WHERE state = 'active'
    `);
    const dbLatency = Date.now() - start;

    dbDetails = {
      status: 'connected',
      latencyMs: dbLatency,
      size: sizeResult.rows[0]?.db_size,
      activeConnections: parseInt(connResult.rows[0]?.active_connections || '0', 10),
      pool: getPoolStats(),
    };
  } catch (error) {
    dbDetails = {
      status: 'disconnected',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }

  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    system: {
      uptime: Math.round(process.uptime()),
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      pid: process.pid,
      environment: process.env.NODE_ENV || 'development',
    },
    database: dbDetails,
    performance: metrics,
    sentry: {
      configured: !!process.env.SENTRY_DSN,
    },
  });
});

export { router as healthRouter };
