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
    // Create core tables that are not in drizzle schema but used by services
    await pool.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
        enterprise_id UUID,
        bank_id UUID,
        order_number INTEGER,
        title VARCHAR(255),
        description TEXT,
        product_type VARCHAR(50) DEFAULT 'otro',
        status VARCHAR(30) DEFAULT 'pendiente',
        priority VARCHAR(20) DEFAULT 'normal',
        quantity INTEGER DEFAULT 1,
        unit_price DECIMAL(12,2) DEFAULT 0,
        total_amount DECIMAL(12,2) DEFAULT 0,
        vat_rate DECIMAL(5,2) DEFAULT 21,
        estimated_profit DECIMAL(12,2) DEFAULT 0,
        estimated_delivery TIMESTAMP WITH TIME ZONE,
        payment_method VARCHAR(50),
        payment_status VARCHAR(20) DEFAULT 'pendiente',
        invoice_id UUID,
        quote_id UUID,
        notes TEXT,
        created_by UUID REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS order_items (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        product_id UUID REFERENCES products(id) ON DELETE SET NULL,
        product_name VARCHAR(255) NOT NULL,
        description TEXT,
        quantity DECIMAL(12,2) DEFAULT 1,
        unit_price DECIMAL(12,2) DEFAULT 0,
        cost DECIMAL(12,2) DEFAULT 0,
        subtotal DECIMAL(12,2) DEFAULT 0,
        product_type VARCHAR(50) DEFAULT 'otro',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS quotes (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
        enterprise_id UUID,
        title VARCHAR(255),
        valid_until TIMESTAMP WITH TIME ZONE,
        subtotal DECIMAL(12,2) DEFAULT 0,
        vat_amount DECIMAL(12,2) DEFAULT 0,
        total_amount DECIMAL(12,2) DEFAULT 0,
        status VARCHAR(20) DEFAULT 'borrador',
        notes TEXT,
        created_by UUID REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS quote_items (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        quote_id UUID NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
        product_id UUID REFERENCES products(id) ON DELETE SET NULL,
        product_name VARCHAR(255) NOT NULL,
        description TEXT,
        quantity DECIMAL(12,2) DEFAULT 1,
        unit_price DECIMAL(12,2) DEFAULT 0,
        vat_rate DECIMAL(5,2) DEFAULT 21,
        subtotal DECIMAL(12,2) DEFAULT 0,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS order_status_history (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        old_status VARCHAR(30),
        new_status VARCHAR(30),
        notes TEXT,
        changed_by UUID REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);

    await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS actual_delivery TIMESTAMP WITH TIME ZONE`);

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

    // Add product_type to products table
    await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS product_type VARCHAR(50) DEFAULT 'otro'`);

    // Add signed_pdf_url to remitos table
    await pool.query(`ALTER TABLE remitos ADD COLUMN IF NOT EXISTS signed_pdf_url TEXT`);

    // Performance indices
    await pool.query(`CREATE INDEX IF NOT EXISTS orders_status_idx ON orders(company_id, status)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS orders_enterprise_idx ON orders(enterprise_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS orders_created_idx ON orders(created_at DESC)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS orders_payment_idx ON orders(company_id, payment_status)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS invoices_company_idx ON invoices(company_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS invoices_status_idx ON invoices(company_id, status)`);

    // --- Cobro items (partial payments) ---
    await pool.query(`
      CREATE TABLE IF NOT EXISTS cobro_items (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        cobro_id UUID NOT NULL REFERENCES cobros(id) ON DELETE CASCADE,
        order_item_id UUID NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
        amount_paid DECIMAL(12,2) NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_cobro_items_cobro ON cobro_items(cobro_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_cobro_items_item ON cobro_items(order_item_id)`);

    // --- Tags system ---
    await pool.query(`
      CREATE TABLE IF NOT EXISTS tags (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        name VARCHAR(100) NOT NULL,
        color VARCHAR(7) DEFAULT '#6B7280',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_tags_company ON tags(company_id)`);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS entity_tags (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        entity_id UUID NOT NULL,
        entity_type VARCHAR(20) NOT NULL,
        tag_id UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        UNIQUE(entity_id, tag_id)
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_entity_tags_entity ON entity_tags(entity_id, entity_type)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_entity_tags_tag ON entity_tags(tag_id)`);

    // --- Receipt image on cobros ---
    await pool.query(`ALTER TABLE cobros ADD COLUMN IF NOT EXISTS receipt_image TEXT`);

    // --- Product components (BOM) ---
    await pool.query(`
      CREATE TABLE IF NOT EXISTS product_components (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        component_product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        quantity_required DECIMAL(12,4) NOT NULL DEFAULT 1,
        unit VARCHAR(50) DEFAULT 'unidad',
        notes TEXT,
        company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        UNIQUE(product_id, component_product_id)
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_pc_product ON product_components(product_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_pc_component ON product_components(component_product_id)`);

    console.log('✅ Auto-migrations completed');
  } catch (error) {
    console.error('⚠️ Auto-migration warning:', error);
  }
}

export async function closeDb() {
  await pool.end();
}

export { pool };
