import app from './app';
import { initDb } from './config/db';
import { env, validateSecrets, isProduction } from './config/env';
import { initSentry, setupGlobalErrorHandlers } from './config/sentry';
import { setupGracefulShutdown } from './config/shutdown';
import { startMemoryMonitoring } from './middlewares/performanceMonitor';
import { secretariaScheduler } from './modules/secretaria/secretaria.scheduler';
import logger from './config/logger';

async function start() {
  try {
    // Initialize Sentry error tracking (no-op if SENTRY_DSN not set)
    initSentry();

    // Setup global error handlers (unhandled rejections, uncaught exceptions)
    setupGlobalErrorHandlers();

    // Comprehensive security validation
    if (!validateSecrets()) {
      if (isProduction) {
        logger.fatal('Security validation failed. Cannot start in production.');
        process.exit(1);
      }
      logger.warn('Security validation warnings detected. Review before deploying to production.');
    }

    // Validate critical environment variables — FATAL if missing
    // (PR1-T1: bump min to 32 chars, also validate DATABASE_URL explicitly)
    if (!env.JWT_SECRET || env.JWT_SECRET.length < 32) {
      logger.fatal('FATAL: JWT_SECRET must be set and at least 32 characters');
      process.exit(1);
    }
    if (!env.JWT_REFRESH_SECRET || env.JWT_REFRESH_SECRET.length < 32) {
      logger.fatal('FATAL: JWT_REFRESH_SECRET must be set and at least 32 characters');
      process.exit(1);
    }
    if (!env.DATABASE_URL) {
      logger.fatal('FATAL: DATABASE_URL must be set (no hardcoded fallback allowed)');
      process.exit(1);
    }

    logger.info({ environment: env.NODE_ENV }, 'Starting GoBecker API...');

    // Connect to database
    await initDb();

    // Start server
    const server = app.listen(env.PORT, '0.0.0.0', () => {
      logger.info({ port: env.PORT }, `Server running on http://0.0.0.0:${env.PORT}`);
    });

    // Setup graceful shutdown (SIGTERM/SIGINT with 30s timeout)
    setupGracefulShutdown(server);

    // Start periodic memory monitoring
    startMemoryMonitoring();

    // Start SecretarIA morning brief scheduler
    secretariaScheduler.start();

    // Keep Neon DB warm (prevent scale-to-zero cold starts).
    // Opt-IN via DB_KEEP_WARM=1 — by default we LET the DB scale to zero
    // because the previous unconditional 4-minute ping drained the Neon
    // free-tier compute-time quota and crashed the prod boot on 2026-04-25.
    // With initDb retries, a 1-2s cold start hit is acceptable; quota
    // exhaustion isn't.
    if (process.env.DB_KEEP_WARM === '1') {
      const intervalMin = parseInt(process.env.DB_KEEP_WARM_MINUTES || '15', 10);
      setInterval(async () => {
        try {
          const { pool } = await import('./config/db');
          await pool.query('SELECT 1');
        } catch { /* non-critical */ }
      }, Math.max(1, intervalMin) * 60 * 1000);
      logger.info({ intervalMin }, 'DB keep-warm enabled');
    }

    logger.info('All systems initialized successfully');
  } catch (error: any) {
    // 2026-04-25: pino serializes Error props as enumerable only — the prod
    // outage showed `{length:119, name:'error', code:'XX000'}` with no
    // `message`. Explicitly extract the diagnostic fields so logs are useful.
    logger.fatal(
      {
        message: error?.message || String(error),
        code: error?.code,
        severity: error?.severity,
        stack: error?.stack,
        cause: error?.cause?.message,
      },
      'Failed to start server'
    );
    process.exit(1);
  }
}

start();
