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

// Detailed health check - includes DB, memory, uptime
router.get('/health/detailed', async (_req: Request, res: Response) => {
  const checks: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    uptime: Math.round(process.uptime()),
    version: process.env.npm_package_version || '1.0.0',
    node: process.version,
    environment: process.env.NODE_ENV || 'development',
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
  // Only admins can see full system status
  if (req.user?.role !== 'admin') {
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
