import app from './app';
import { initDb, closeDb } from './config/db';
import { env } from './config/env';

async function start() {
  try {
    // Validate critical environment variables
    if (!env.JWT_SECRET || env.JWT_SECRET.length < 16) {
      console.error('FATAL: JWT_SECRET must be set and at least 16 characters');
      process.exit(1);
    }
    if (!env.JWT_REFRESH_SECRET || env.JWT_REFRESH_SECRET.length < 16) {
      console.error('FATAL: JWT_REFRESH_SECRET must be set and at least 16 characters');
      process.exit(1);
    }

    console.log('🚀 Starting Gestor BeckerVisual API...');
    console.log(`📍 Environment: ${env.NODE_ENV}`);

    // Connect to database
    await initDb();

    // Start server
    const server = app.listen(env.PORT, '0.0.0.0', () => {
      console.log(`✅ Server running on http://0.0.0.0:${env.PORT}`);
      console.log(`📚 API Documentation: http://localhost:${env.PORT}/api/docs`);
    });

    // Graceful shutdown
    const gracefulShutdown = async () => {
      console.log('\n🛑 Shutting down gracefully...');
      server.close(async () => {
        await closeDb();
        console.log('✅ Server shutdown complete');
        process.exit(0);
      });

      // Force shutdown after 10 seconds
      setTimeout(() => {
        console.error('❌ Forced shutdown');
        process.exit(1);
      }, 10000);
    };

    process.on('SIGTERM', gracefulShutdown);
    process.on('SIGINT', gracefulShutdown);
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

start();
