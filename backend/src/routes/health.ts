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
