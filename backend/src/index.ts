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

    // Validate critical environment variables
    if (!env.JWT_SECRET || env.JWT_SECRET.length < 16) {
      logger.fatal('FATAL: JWT_SECRET must be set and at least 16 characters');
      process.exit(1);
    }
    if (!env.JWT_REFRESH_SECRET || env.JWT_REFRESH_SECRET.length < 16) {
      logger.fatal('FATAL: JWT_REFRESH_SECRET must be set and at least 16 characters');
      process.exit(1);
    }

    logger.info({ environment: env.NODE_ENV }, 'Starting Gestor BeckerVisual API...');

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

    logger.info('All systems initialized successfully');
  } catch (error) {
    logger.fatal({ error }, 'Failed to start server');
    process.exit(1);
  }
}

start();
