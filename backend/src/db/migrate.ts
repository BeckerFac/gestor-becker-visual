import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { db, pool } from '../config/db';

async function runMigrations() {
  console.log('🔄 Running migrations...');
  try {
    await migrate(db, { migrationsFolder: './drizzle' });
    console.log('✅ Migrations completed');
  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

runMigrations();
