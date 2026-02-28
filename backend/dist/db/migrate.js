"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const migrator_1 = require("drizzle-orm/node-postgres/migrator");
const db_1 = require("../config/db");
async function runMigrations() {
    console.log('🔄 Running migrations...');
    try {
        await (0, migrator_1.migrate)(db_1.db, { migrationsFolder: './drizzle' });
        console.log('✅ Migrations completed');
    }
    catch (error) {
        console.error('❌ Migration failed:', error);
        throw error;
    }
    finally {
        await db_1.pool.end();
    }
}
runMigrations();
//# sourceMappingURL=migrate.js.map