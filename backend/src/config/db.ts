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
    return true;
  } catch (error) {
    console.error('❌ Database connection failed:', error);
    throw error;
  }
}

export async function closeDb() {
  await pool.end();
}

export { pool };
