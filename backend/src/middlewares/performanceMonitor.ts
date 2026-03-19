// Performance monitoring middleware
// Tracks: request duration, memory usage, connection pool stats, slow queries

import { Request, Response, NextFunction } from 'express';
import { pool } from '../config/db';
import logger from '../config/logger';

// --- Request duration tracking ---

interface RequestMetrics {
  totalRequests: number;
  totalDuration: number;
  slowRequests: number;
  errorRequests: number;
  lastMinuteRequests: number[];
}

const metrics: RequestMetrics = {
  totalRequests: 0,
  totalDuration: 0,
  slowRequests: 0,
  errorRequests: 0,
  lastMinuteRequests: [],
};

const SLOW_REQUEST_THRESHOLD_MS = 3000;

export function performanceMiddleware(req: Request, res: Response, next: NextFunction): void {
  const start = process.hrtime.bigint();

  res.on('finish', () => {
    const end = process.hrtime.bigint();
    const durationMs = Number(end - start) / 1_000_000;

    metrics.totalRequests++;
    metrics.totalDuration += durationMs;
    metrics.lastMinuteRequests.push(Date.now());

    // Clean entries older than 1 minute
    const oneMinuteAgo = Date.now() - 60_000;
    metrics.lastMinuteRequests = metrics.lastMinuteRequests.filter(t => t > oneMinuteAgo);

    if (durationMs > SLOW_REQUEST_THRESHOLD_MS) {
      metrics.slowRequests++;
      logger.warn({
        type: 'slow_request',
        method: req.method,
        url: req.originalUrl,
        durationMs: Math.round(durationMs),
        requestId: req.requestId,
      }, `Slow request: ${req.method} ${req.originalUrl} took ${Math.round(durationMs)}ms`);
    }

    if (res.statusCode >= 500) {
      metrics.errorRequests++;
    }
  });

  next();
}

// --- Memory usage monitoring ---

export function getMemoryUsage(): Record<string, string> {
  const mem = process.memoryUsage();
  return {
    rss: formatBytes(mem.rss),
    heapTotal: formatBytes(mem.heapTotal),
    heapUsed: formatBytes(mem.heapUsed),
    external: formatBytes(mem.external),
    arrayBuffers: formatBytes(mem.arrayBuffers),
  };
}

function formatBytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

// --- Connection pool monitoring ---

export function getPoolStats(): Record<string, number> {
  return {
    totalCount: pool.totalCount,
    idleCount: pool.idleCount,
    waitingCount: pool.waitingCount,
  };
}

// --- Aggregated metrics ---

export function getPerformanceMetrics(): Record<string, unknown> {
  const avgDuration = metrics.totalRequests > 0
    ? Math.round(metrics.totalDuration / metrics.totalRequests)
    : 0;

  return {
    requests: {
      total: metrics.totalRequests,
      lastMinute: metrics.lastMinuteRequests.length,
      averageDurationMs: avgDuration,
      slowRequests: metrics.slowRequests,
      errorRequests: metrics.errorRequests,
    },
    memory: getMemoryUsage(),
    pool: getPoolStats(),
    uptime: Math.round(process.uptime()),
    nodeVersion: process.version,
  };
}

// --- Slow query wrapper ---

const SLOW_QUERY_THRESHOLD_MS = 1000;

export function logSlowQuery(query: string, durationMs: number, params?: unknown[]): void {
  if (durationMs > SLOW_QUERY_THRESHOLD_MS) {
    logger.warn({
      type: 'slow_query',
      query: query.substring(0, 200),
      durationMs: Math.round(durationMs),
      paramCount: params?.length ?? 0,
    }, `Slow query detected (${Math.round(durationMs)}ms)`);
  }
}

// --- Periodic memory check (log warning if memory is high) ---

const MEMORY_CHECK_INTERVAL_MS = 60_000;
const MEMORY_WARNING_THRESHOLD_MB = 512;

let memoryCheckInterval: NodeJS.Timeout | null = null;

export function startMemoryMonitoring(): void {
  if (memoryCheckInterval) return;

  memoryCheckInterval = setInterval(() => {
    const mem = process.memoryUsage();
    const heapUsedMB = mem.heapUsed / 1024 / 1024;

    if (heapUsedMB > MEMORY_WARNING_THRESHOLD_MB) {
      logger.warn({
        type: 'memory_warning',
        heapUsedMB: Math.round(heapUsedMB),
        threshold: MEMORY_WARNING_THRESHOLD_MB,
      }, `High memory usage: ${Math.round(heapUsedMB)}MB`);
    }
  }, MEMORY_CHECK_INTERVAL_MS);

  // Don't keep process alive just for monitoring
  memoryCheckInterval.unref();
}

export function stopMemoryMonitoring(): void {
  if (memoryCheckInterval) {
    clearInterval(memoryCheckInterval);
    memoryCheckInterval = null;
  }
}
