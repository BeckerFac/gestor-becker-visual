import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { env } from './env';
import * as schema from '../db/schema';

const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 20,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
});

export const db = drizzle(pool, { schema });

export async function initDb() {
  try {
    await pool.query('SELECT 1');
    console.log('✅ Database connected successfully');
    await runAutoMigrations();
    return true;
  } catch (error) {
    console.error('❌ Database connection failed:', error);
    throw error;
  }
}

async function runAutoMigrations() {
  try {
    await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS order_number INTEGER`);
    await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_method VARCHAR(50)`);
    await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_status VARCHAR(20) DEFAULT 'pendiente'`);
    await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS quote_id UUID REFERENCES quotes(id) ON DELETE SET NULL`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS cheques (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        number VARCHAR(50) NOT NULL,
        bank VARCHAR(255) NOT NULL,
        drawer VARCHAR(255) NOT NULL,
        amount DECIMAL(12,2) NOT NULL,
        issue_date TIMESTAMP WITH TIME ZONE NOT NULL,
        due_date TIMESTAMP WITH TIME ZONE NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'a_cobrar',
        customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
        order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
        notes TEXT,
        collected_date TIMESTAMP WITH TIME ZONE,
        created_by UUID REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS cheques_company_idx ON cheques(company_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS cheques_status_idx ON cheques(company_id, status)`);
    try { await pool.query(`ALTER TYPE payment_method ADD VALUE IF NOT EXISTS 'mercado_pago'`); } catch (_) {}
    console.log('✅ Auto-migrations completed');
  } catch (error) {
    console.error('⚠️ Auto-migration warning:', error);
  }
}

export async function closeDb() {
  await pool.end();
}

export { pool };
