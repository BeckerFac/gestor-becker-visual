// Graceful shutdown handler
// Handles SIGTERM/SIGINT, closes DB connections, finishes in-flight requests

import { Server } from 'http';
import { closeDb } from './db';
import { stopMemoryMonitoring } from '../middlewares/performanceMonitor';
import logger from './logger';

const SHUTDOWN_TIMEOUT_MS = 30_000;

let isShuttingDown = false;

export function setupGracefulShutdown(server: Server): void {
  const shutdown = async (signal: string) => {
    if (isShuttingDown) {
      logger.warn({ signal }, 'Shutdown already in progress, ignoring duplicate signal');
      return;
    }

    isShuttingDown = true;
    logger.info({ signal }, `Received ${signal}. Starting graceful shutdown...`);

    // Stop accepting new connections
    server.close(async () => {
      logger.info('HTTP server closed. No more incoming connections.');

      try {
        // Stop monitoring
        stopMemoryMonitoring();

        // Close database connections
        logger.info('Closing database connections...');
        await closeDb();
        logger.info('Database connections closed.');

        logger.info('Graceful shutdown complete.');
        process.exit(0);
      } catch (error) {
        logger.error({ error }, 'Error during graceful shutdown');
        process.exit(1);
      }
    });

    // Force shutdown after timeout
    setTimeout(() => {
      logger.error(`Forced shutdown after ${SHUTDOWN_TIMEOUT_MS / 1000}s timeout`);
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

// Middleware to reject requests during shutdown
export function shutdownGuard(req: unknown, res: { status: (code: number) => { json: (body: unknown) => void } }, next: () => void): void {
  if (isShuttingDown) {
    res.status(503).json({
      error: 'Server is shutting down',
      retryAfter: 30,
    });
    return;
  }
  next();
}

export function getIsShuttingDown(): boolean {
  return isShuttingDown;
}
