"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const app_1 = __importDefault(require("./app"));
const db_1 = require("./config/db");
const env_1 = require("./config/env");
async function start() {
    try {
        console.log('🚀 Starting Gestor BeckerVisual API...');
        console.log(`📍 Environment: ${env_1.env.NODE_ENV}`);
        // Connect to database
        await (0, db_1.initDb)();
        // Start server
        const server = app_1.default.listen(env_1.env.PORT, '0.0.0.0', () => {
            console.log(`✅ Server running on http://0.0.0.0:${env_1.env.PORT}`);
            console.log(`📚 API Documentation: http://localhost:${env_1.env.PORT}/api/docs`);
        });
        // Graceful shutdown
        const gracefulShutdown = async () => {
            console.log('\n🛑 Shutting down gracefully...');
            server.close(async () => {
                await (0, db_1.closeDb)();
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
    }
    catch (error) {
        console.error('❌ Failed to start server:', error);
        process.exit(1);
    }
}
start();
//# sourceMappingURL=index.js.map