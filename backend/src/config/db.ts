import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { env } from './env';
import * as schema from '../db/schema';

const pool = new Pool({
  connectionString: env.DATABASE_URL,
  // Connection pool configuration
  max: parseInt(process.env.DB_POOL_MAX || '20', 10),
  min: parseInt(process.env.DB_POOL_MIN || '2', 10),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  // Query timeout: 30 seconds max
  statement_timeout: 30_000,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
  // Automatic reconnection: pg Pool handles this internally.
  // On idle client errors, the pool removes the broken client
  // and creates a new one on next query. No manual intervention needed.
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
      CREATE TABLE IF NOT EXISTS enterprises (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        cuit VARCHAR(20),
        address TEXT,
        city VARCHAR(100),
        province VARCHAR(100),
        phone VARCHAR(20),
        email VARCHAR(100),
        tax_condition VARCHAR(50),
        notes TEXT,
        status VARCHAR(50) DEFAULT 'active',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);

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

    // Add product_type, controls_stock, low_stock_threshold to products table
    await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS product_type VARCHAR(50) DEFAULT 'otro'`);
    await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS controls_stock BOOLEAN DEFAULT false`);
    await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS low_stock_threshold DECIMAL(12,2) DEFAULT 0`);

    // Add signed_pdf_url to remitos table
    await pool.query(`ALTER TABLE remitos ADD COLUMN IF NOT EXISTS signed_pdf_url TEXT`);

    // Performance indices
    await pool.query(`CREATE INDEX IF NOT EXISTS orders_status_idx ON orders(company_id, status)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS orders_enterprise_idx ON orders(enterprise_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS orders_created_idx ON orders(created_at DESC)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS orders_payment_idx ON orders(company_id, payment_status)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS invoices_company_idx ON invoices(company_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS invoices_status_idx ON invoices(company_id, status)`);

    // --- Cobros table ---
    await pool.query(`
      CREATE TABLE IF NOT EXISTS cobros (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        enterprise_id UUID,
        order_id UUID REFERENCES orders(id),
        invoice_id UUID REFERENCES invoices(id),
        amount DECIMAL(12,2) NOT NULL,
        payment_method VARCHAR(50) NOT NULL,
        bank_id UUID,
        reference VARCHAR(255),
        payment_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        notes TEXT,
        receipt_image TEXT,
        created_by UUID REFERENCES users(id),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);

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

    // --- Cheque status history ---
    await pool.query(`
      CREATE TABLE IF NOT EXISTS cheque_status_history (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        cheque_id UUID NOT NULL REFERENCES cheques(id) ON DELETE CASCADE,
        old_status VARCHAR(30),
        new_status VARCHAR(30),
        notes TEXT,
        changed_by UUID REFERENCES users(id),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_cheque_history ON cheque_status_history(cheque_id)`);

    // AFIP/ARCA extra columns
    await pool.query(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS puntos_venta JSONB DEFAULT '[]'::jsonb`);
    await pool.query(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS afip_last_test TIMESTAMP WITH TIME ZONE`);
    await pool.query(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS afip_last_test_ok BOOLEAN DEFAULT false`);

    // --- RBAC permissions ---
    await pool.query(`
      CREATE TABLE IF NOT EXISTS permissions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        module VARCHAR(50) NOT NULL,
        action VARCHAR(20) NOT NULL,
        allowed BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        UNIQUE(user_id, module, action)
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_permissions_user ON permissions(user_id)`);

    // --- Accounting report indexes ---
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_invoices_company_status_date ON invoices(company_id, status, invoice_date)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_purchases_company_status_date ON purchases(company_id, status, date)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_cobros_company_date ON cobros(company_id, payment_date)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_pagos_company_date ON pagos(company_id, payment_date)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_cheques_company_status_collected ON cheques(company_id, status, collected_date)`);

    // --- Onboarding wizard ---
    await pool.query(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN DEFAULT false`);
    await pool.query(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMP WITH TIME ZONE`);
    await pool.query(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS onboarding_current_step INTEGER DEFAULT 0`);
    await pool.query(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS enabled_modules TEXT[] DEFAULT ARRAY['orders','invoices','products','inventory','purchases','cobros','pagos','cheques','enterprises','banks','customers','quotes','remitos','reports']`);
    // Ensure existing companies have 'reports' in enabled_modules
    await pool.query(`UPDATE companies SET enabled_modules = array_append(enabled_modules, 'reports') WHERE enabled_modules IS NOT NULL AND NOT ('reports' = ANY(enabled_modules))`);
    await pool.query(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS condicion_iva VARCHAR(100)`);
    await pool.query(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS razon_social VARCHAR(255)`);
    await pool.query(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS punto_venta INTEGER`);

    // --- Multi-tenant SaaS: subscription / trial ---
    try { await pool.query(`CREATE TYPE subscription_status AS ENUM ('trial', 'active', 'grace', 'expired', 'cancelled')`); } catch (_) {}
    await pool.query(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS subscription_status subscription_status DEFAULT 'trial'`);
    await pool.query(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMP WITH TIME ZONE`);
    await pool.query(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS grace_ends_at TIMESTAMP WITH TIME ZONE`);
    await pool.query(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS subscription_plan VARCHAR(50)`);

    // --- Email verification & password reset on users ---
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT false`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verification_token VARCHAR(255)`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verification_expires TIMESTAMP WITH TIME ZONE`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_token VARCHAR(255)`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_expires TIMESTAMP WITH TIME ZONE`);

    // --- Invitations ---
    try { await pool.query(`CREATE TYPE invitation_status AS ENUM ('pending', 'accepted', 'expired', 'revoked')`); } catch (_) {}
    await pool.query(`
      CREATE TABLE IF NOT EXISTS invitations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        email VARCHAR(100) NOT NULL,
        role user_role DEFAULT 'viewer',
        token VARCHAR(255) NOT NULL UNIQUE,
        status invitation_status DEFAULT 'pending',
        invited_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
        accepted_at TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_invitations_company ON invitations(company_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_invitations_token ON invitations(token)`);

    // Backfill existing companies: set trial_ends_at 15 days from now if missing
    await pool.query(`
      UPDATE companies
      SET trial_ends_at = NOW() + INTERVAL '15 days',
          subscription_status = 'trial'
      WHERE trial_ends_at IS NULL
    `);

    // Backfill existing users: mark as email_verified since they pre-date verification
    await pool.query(`
      UPDATE users SET email_verified = true WHERE email_verified IS NULL OR email_verified = false
    `);

    // --- Superadmin flag ---
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_superadmin BOOLEAN DEFAULT false`);
    // Set default superadmin (e2etest or first registered user)
    await pool.query(`
      UPDATE users SET is_superadmin = true
      WHERE email = 'e2etest@test.com' AND is_superadmin = false
    `);

    // --- Advanced Roles: add 'owner' and 'editor' to user_role enum ---
    try { await pool.query(`ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'owner' BEFORE 'admin'`); } catch (_) {}
    try { await pool.query(`ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'editor' AFTER 'gerente'`); } catch (_) {}

    // --- Pending Invitations table (separate from existing invitations table) ---
    await pool.query(`
      CREATE TABLE IF NOT EXISTS pending_invitations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        email VARCHAR(100) NOT NULL,
        name VARCHAR(255),
        role VARCHAR(50) NOT NULL DEFAULT 'viewer',
        token VARCHAR(255) NOT NULL UNIQUE,
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        invited_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_pending_invitations_company ON pending_invitations(company_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_pending_invitations_token ON pending_invitations(token)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_pending_invitations_email ON pending_invitations(email, company_id)`);

    // --- Backfill: migrate existing 'admin' company creators to 'owner' ---
    // For each company, the earliest admin becomes the owner (if no owner exists yet)
    await pool.query(`
      UPDATE users SET role = 'owner'
      WHERE id IN (
        SELECT DISTINCT ON (company_id) id
        FROM users
        WHERE role = 'admin' AND active = true
          AND company_id NOT IN (SELECT company_id FROM users WHERE role = 'owner')
        ORDER BY company_id, created_at ASC
      )
    `);

    // --- Audit log: ensure details_json column alias works ---
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_audit_log_company_date ON audit_log(company_id, created_at DESC)`);

    // --- Billing: subscriptions & usage_tracking (separate from legacy companies columns) ---
    await pool.query(`
      CREATE TABLE IF NOT EXISTS subscriptions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        plan VARCHAR(50) NOT NULL DEFAULT 'trial',
        status VARCHAR(50) NOT NULL DEFAULT 'trial',
        trial_ends_at TIMESTAMP WITH TIME ZONE,
        current_period_start TIMESTAMP WITH TIME ZONE,
        current_period_end TIMESTAMP WITH TIME ZONE,
        payment_provider VARCHAR(50),
        payment_provider_subscription_id VARCHAR(255),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        UNIQUE(company_id)
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS usage_tracking (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        month VARCHAR(7) NOT NULL,
        invoices_count INTEGER DEFAULT 0,
        orders_count INTEGER DEFAULT 0,
        users_count INTEGER DEFAULT 0,
        storage_mb DECIMAL(10,2) DEFAULT 0,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        UNIQUE(company_id, month)
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_subscriptions_company ON subscriptions(company_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_usage_tracking_company_month ON usage_tracking(company_id, month)`);

    console.log('✅ Auto-migrations completed');
  } catch (error) {
    console.error('⚠️ Auto-migration warning:', error);
  }
}

export async function closeDb() {
  await pool.end();
}

export { pool };
