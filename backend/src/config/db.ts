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
        vat_rate DECIMAL(5,2) DEFAULT 21,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);

    // Ensure vat_rate column exists on order_items (migration for existing DBs)
    await pool.query(`ALTER TABLE order_items ADD COLUMN IF NOT EXISTS vat_rate DECIMAL(5,2) DEFAULT 21`);

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

    // Add signed_pdf_url to remitos table (may not exist yet if remitos module hasn't initialised)
    try { await pool.query(`ALTER TABLE remitos ADD COLUMN IF NOT EXISTS signed_pdf_url TEXT`); } catch (_) {}

    // Performance indices
    await pool.query(`CREATE INDEX IF NOT EXISTS orders_status_idx ON orders(company_id, status)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS orders_enterprise_idx ON orders(enterprise_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS orders_created_idx ON orders(created_at DESC)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS orders_payment_idx ON orders(company_id, payment_status)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS invoices_company_idx ON invoices(company_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS invoices_status_idx ON invoices(company_id, status)`);

    // --- Account adjustments (manual balance adjustments for cuenta corriente) ---
    await pool.query(`
      CREATE TABLE IF NOT EXISTS account_adjustments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        enterprise_id UUID NOT NULL REFERENCES enterprises(id) ON DELETE CASCADE,
        amount DECIMAL(12,2) NOT NULL,
        reason TEXT NOT NULL,
        adjustment_type VARCHAR(20) NOT NULL,
        created_by UUID REFERENCES users(id),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_account_adjustments_company ON account_adjustments(company_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_account_adjustments_enterprise ON account_adjustments(company_id, enterprise_id)`);

    // --- Activity log columns ---
    await pool.query(`ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS module VARCHAR(50)`).catch(() => {});
    await pool.query(`ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS changes JSONB`).catch(() => {});
    await pool.query(`ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS metadata JSONB`).catch(() => {});
    await pool.query(`ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS checksum VARCHAR(64)`).catch(() => {});
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_audit_log_company_date ON audit_log(company_id, created_at DESC)`).catch(() => {});
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_audit_log_module ON audit_log(company_id, module)`).catch(() => {});
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_audit_company_date ON audit_log(company_id, created_at DESC)`).catch(() => {});
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_audit_company_module ON audit_log(company_id, module, created_at DESC)`).catch(() => {});

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

    // --- Materials (raw materials for production) ---
    await pool.query(`
      CREATE TABLE IF NOT EXISTS materials (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        sku VARCHAR(100),
        unit VARCHAR(50) NOT NULL DEFAULT 'unidad',
        cost DECIMAL(12,2) DEFAULT 0,
        stock DECIMAL(12,2) DEFAULT 0,
        min_stock DECIMAL(12,2) DEFAULT 0,
        description TEXT,
        active BOOLEAN DEFAULT true,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_materials_company ON materials(company_id)`);

    // --- Product materials (BOM with materials) ---
    await pool.query(`
      CREATE TABLE IF NOT EXISTS product_materials (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        material_id UUID NOT NULL REFERENCES materials(id) ON DELETE RESTRICT,
        quantity DECIMAL(12,4) NOT NULL DEFAULT 1,
        unit VARCHAR(50) DEFAULT 'unidad',
        notes TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        UNIQUE(product_id, material_id)
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_pm_product ON product_materials(product_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_pm_material ON product_materials(material_id)`);

    // --- Material stock movements ---
    await pool.query(`
      CREATE TABLE IF NOT EXISTS material_stock_movements (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        material_id UUID NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
        company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        quantity_change DECIMAL(12,2) NOT NULL,
        reason TEXT,
        created_by UUID REFERENCES users(id),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_msm_material ON material_stock_movements(material_id)`);

    // --- Warehouses ---
    await pool.query(`
      CREATE TABLE IF NOT EXISTS warehouses (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        address TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_warehouses_company ON warehouses(company_id)`);

    // --- Stock ---
    await pool.query(`
      CREATE TABLE IF NOT EXISTS stock (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
        quantity VARCHAR(50) DEFAULT '0',
        min_level VARCHAR(50) DEFAULT '0',
        max_level VARCHAR(50) DEFAULT '0',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        UNIQUE(product_id, warehouse_id)
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_stock_product ON stock(product_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_stock_warehouse ON stock(warehouse_id)`);

    // --- Stock movements ---
    await pool.query(`
      CREATE TABLE IF NOT EXISTS stock_movements (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
        movement_type VARCHAR(50) NOT NULL,
        quantity VARCHAR(50) NOT NULL DEFAULT '0',
        reference_type VARCHAR(50),
        reference_id UUID,
        notes TEXT,
        created_by UUID REFERENCES users(id),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_sm_product ON stock_movements(product_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_sm_warehouse ON stock_movements(warehouse_id)`);

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

    // --- Role templates ---
    await pool.query(`
      CREATE TABLE IF NOT EXISTS role_templates (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        role_name VARCHAR(50) NOT NULL,
        description TEXT,
        permissions JSONB NOT NULL DEFAULT '{}',
        is_system BOOLEAN DEFAULT false,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        UNIQUE(company_id, role_name)
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_role_templates_company ON role_templates(company_id)`);

    // --- Multi-currency support ---
    try { await pool.query(`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS currency VARCHAR(3) DEFAULT 'ARS'`); } catch (_) {}
    try { await pool.query(`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS exchange_rate DECIMAL(12,4)`); } catch (_) {}
    try { await pool.query(`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS amount_foreign DECIMAL(12,2)`); } catch (_) {}
    try { await pool.query(`ALTER TABLE cobros ADD COLUMN IF NOT EXISTS currency VARCHAR(3) DEFAULT 'ARS'`); } catch (_) {}
    try { await pool.query(`ALTER TABLE cobros ADD COLUMN IF NOT EXISTS exchange_rate DECIMAL(12,4)`); } catch (_) {}
    try { await pool.query(`ALTER TABLE pagos ADD COLUMN IF NOT EXISTS currency VARCHAR(3) DEFAULT 'ARS'`); } catch (_) {}
    try { await pool.query(`ALTER TABLE pagos ADD COLUMN IF NOT EXISTS exchange_rate DECIMAL(12,4)`); } catch (_) {}
    try { await pool.query(`ALTER TABLE purchase_invoices ADD COLUMN IF NOT EXISTS currency VARCHAR(3) DEFAULT 'ARS'`); } catch (_) {}
    try { await pool.query(`ALTER TABLE purchase_invoices ADD COLUMN IF NOT EXISTS exchange_rate DECIMAL(12,4)`); } catch (_) {}
    try { await pool.query(`ALTER TABLE purchase_invoices ADD COLUMN IF NOT EXISTS retenciones_previstas JSONB DEFAULT '[]'::jsonb`); } catch (_) {}

    // --- Accounting report indexes (tables may not exist yet on first boot) ---
    try { await pool.query(`CREATE INDEX IF NOT EXISTS idx_invoices_company_status_date ON invoices(company_id, status, invoice_date)`); } catch (_) {}
    try { await pool.query(`CREATE INDEX IF NOT EXISTS idx_purchases_company_status_date ON purchases(company_id, status, date)`); } catch (_) {}
    try { await pool.query(`CREATE INDEX IF NOT EXISTS idx_cobros_company_date ON cobros(company_id, payment_date)`); } catch (_) {}
    try { await pool.query(`CREATE INDEX IF NOT EXISTS idx_pagos_company_date ON pagos(company_id, payment_date)`); } catch (_) {}
    try { await pool.query(`CREATE INDEX IF NOT EXISTS idx_pagos_enterprise ON pagos(company_id, enterprise_id)`); } catch (_) {}
    try { await pool.query(`CREATE INDEX IF NOT EXISTS idx_pagos_bu ON pagos(company_id, business_unit_id)`); } catch (_) {}
    try { await pool.query(`CREATE INDEX IF NOT EXISTS idx_cobros_enterprise ON cobros(company_id, enterprise_id)`); } catch (_) {}
    try { await pool.query(`CREATE INDEX IF NOT EXISTS idx_cobros_bu ON cobros(company_id, business_unit_id)`); } catch (_) {}
    try { await pool.query(`CREATE INDEX IF NOT EXISTS idx_cheques_company_status_collected ON cheques(company_id, status, collected_date)`); } catch (_) {}

    // --- Onboarding wizard ---
    await pool.query(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN DEFAULT false`);
    await pool.query(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMP WITH TIME ZONE`);
    await pool.query(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS onboarding_current_step INTEGER DEFAULT 0`);
    await pool.query(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS enabled_modules TEXT[] DEFAULT ARRAY['orders','invoices','products','inventory','purchases','cobros','pagos','cheques','enterprises','banks','customers','quotes','remitos','reports','crm','secretaria']`);
    // Ensure existing companies have 'reports' in enabled_modules
    await pool.query(`UPDATE companies SET enabled_modules = array_append(enabled_modules, 'reports') WHERE enabled_modules IS NOT NULL AND NOT ('reports' = ANY(enabled_modules))`);
    // Ensure existing companies have 'crm' in enabled_modules
    await pool.query(`UPDATE companies SET enabled_modules = array_append(enabled_modules, 'crm') WHERE enabled_modules IS NOT NULL AND NOT ('crm' = ANY(enabled_modules))`);
    // Ensure existing companies have 'secretaria' in enabled_modules
    await pool.query(`UPDATE companies SET enabled_modules = array_append(enabled_modules, 'secretaria') WHERE enabled_modules IS NOT NULL AND NOT ('secretaria' = ANY(enabled_modules))`);
    await pool.query(`UPDATE companies SET enabled_modules = array_append(enabled_modules, 'audit_log') WHERE enabled_modules IS NOT NULL AND NOT ('audit_log' = ANY(enabled_modules))`);
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

    // ===== ROW LEVEL SECURITY (RLS) — second layer of multi-tenant isolation =====
    await applyRowLevelSecurity();

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

    // --- Admin: block/unblock with reason ---
    await pool.query(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS blocked BOOLEAN DEFAULT false`);
    await pool.query(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS block_reason VARCHAR(500)`);
    await pool.query(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS block_reason_category VARCHAR(50)`);
    await pool.query(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS blocked_at TIMESTAMP WITH TIME ZONE`);
    await pool.query(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS blocked_by UUID`);
    // Admin: billing_period on companies
    await pool.query(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS billing_period VARCHAR(20) DEFAULT 'monthly'`);
    // Admin: custom plan limits overrides
    await pool.query(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS plan_overrides JSONB`);
    // Admin: trial extension
    await pool.query(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS trial_extended_days INTEGER DEFAULT 0`);

    // Accounting module flag
    await pool.query(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS accounting_enabled BOOLEAN DEFAULT false`);

    // ===== PORTAL: Enterprise access code & invoice enterprise_id =====
    await pool.query(`ALTER TABLE enterprises ADD COLUMN IF NOT EXISTS access_code VARCHAR(20) UNIQUE`);
    await pool.query(`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS enterprise_id UUID REFERENCES enterprises(id)`);

    // ===== SECURITY: Two-Factor Authentication columns =====
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS two_factor_secret VARCHAR(255)`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS two_factor_enabled BOOLEAN DEFAULT false`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS two_factor_backup_codes TEXT`); // JSON array of backup codes

    // ===== SECURITY: API Keys table =====
    await pool.query(`
      CREATE TABLE IF NOT EXISTS api_keys (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        name VARCHAR(100) NOT NULL,
        key_hash VARCHAR(255) NOT NULL UNIQUE,
        key_prefix VARCHAR(20) NOT NULL,
        scope VARCHAR(20) NOT NULL DEFAULT 'read',
        created_by UUID REFERENCES users(id) ON DELETE SET NULL,
        last_used TIMESTAMP WITH TIME ZONE,
        revoked_at TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_api_keys_company ON api_keys(company_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash) WHERE revoked_at IS NULL`);

    // ===== SECURITY: Security events log (persistent, complements in-memory buffer) =====
    await pool.query(`
      CREATE TABLE IF NOT EXISTS security_events (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        event_type VARCHAR(50) NOT NULL,
        severity VARCHAR(20) NOT NULL DEFAULT 'low',
        message TEXT NOT NULL,
        ip_address VARCHAR(45),
        user_id UUID,
        company_id UUID,
        details JSONB,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_security_events_type ON security_events(event_type, created_at DESC)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_security_events_date ON security_events(created_at DESC)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_security_events_ip ON security_events(ip_address)`);

    // ===== SecretarIA: WhatsApp AI assistant tables =====
    await pool.query(`
      CREATE TABLE IF NOT EXISTS secretaria_config (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        enabled BOOLEAN DEFAULT false,
        morning_brief_enabled BOOLEAN DEFAULT false,
        morning_brief_time VARCHAR(5) DEFAULT '08:00',
        timezone VARCHAR(100) DEFAULT 'America/Argentina/Buenos_Aires',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        UNIQUE(company_id)
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS secretaria_linked_phones (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        phone_number VARCHAR(20) NOT NULL,
        linking_code VARCHAR(10),
        linking_code_expires TIMESTAMP WITH TIME ZONE,
        failed_attempts INTEGER DEFAULT 0,
        verified BOOLEAN DEFAULT false,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        UNIQUE(company_id, phone_number)
      )
    `);
    await pool.query(`ALTER TABLE secretaria_linked_phones ADD COLUMN IF NOT EXISTS failed_attempts INTEGER DEFAULT 0`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_secretaria_linked_phones_company ON secretaria_linked_phones(company_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_secretaria_linked_phones_phone ON secretaria_linked_phones(phone_number)`);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS secretaria_conversations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        user_id UUID REFERENCES users(id) ON DELETE SET NULL,
        phone_number VARCHAR(20) NOT NULL,
        role VARCHAR(10) NOT NULL,
        content TEXT NOT NULL,
        message_type VARCHAR(20) DEFAULT 'text',
        whatsapp_message_id VARCHAR(255),
        intent VARCHAR(50),
        tokens_used INTEGER DEFAULT 0,
        response_time_ms INTEGER,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_secretaria_conv_company ON secretaria_conversations(company_id, created_at DESC)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_secretaria_conv_phone ON secretaria_conversations(phone_number, created_at DESC)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_secretaria_conv_wa_id ON secretaria_conversations(whatsapp_message_id)`);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS secretaria_memory (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        user_id UUID REFERENCES users(id) ON DELETE SET NULL,
        memory_type VARCHAR(50) NOT NULL,
        key VARCHAR(255) NOT NULL,
        value TEXT NOT NULL,
        confidence DECIMAL(3,2) DEFAULT 1.00,
        source VARCHAR(50),
        times_used INTEGER DEFAULT 0,
        last_used TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        UNIQUE(company_id, user_id, memory_type, key)
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_secretaria_memory_company ON secretaria_memory(company_id, user_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_secretaria_memory_type ON secretaria_memory(company_id, memory_type)`);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS secretaria_usage (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        month VARCHAR(7) NOT NULL,
        messages_received INTEGER DEFAULT 0,
        messages_sent INTEGER DEFAULT 0,
        llm_tokens_input INTEGER DEFAULT 0,
        llm_tokens_output INTEGER DEFAULT 0,
        stt_minutes DECIMAL(10,2) DEFAULT 0,
        estimated_cost_usd DECIMAL(10,4) DEFAULT 0,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        UNIQUE(company_id, month)
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_secretaria_usage_company_month ON secretaria_usage(company_id, month)`);

    // SecretarIA: scheduler columns for morning brief
    await pool.query(`ALTER TABLE secretaria_config ADD COLUMN IF NOT EXISTS last_brief_date DATE`);
    await pool.query(`ALTER TABLE secretaria_config ADD COLUMN IF NOT EXISTS brief_sections TEXT[] DEFAULT ARRAY['ventas','pedidos','cobros','stock']`);

    // ===== SecretarIA: Safety guardrails tables =====
    await pool.query(`
      CREATE TABLE IF NOT EXISTS secretaria_pending_actions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        user_id UUID REFERENCES users(id) ON DELETE SET NULL,
        channel VARCHAR(20) NOT NULL DEFAULT 'web',
        channel_id VARCHAR(100) NOT NULL DEFAULT '',
        action_type VARCHAR(50) NOT NULL,
        action_data JSONB NOT NULL DEFAULT '{}',
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        expires_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() + INTERVAL '5 minutes'
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_secretaria_pending_company ON secretaria_pending_actions(company_id, status)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_secretaria_pending_channel ON secretaria_pending_actions(company_id, channel_id, status)`);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS secretaria_ai_errors (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        user_id UUID REFERENCES users(id) ON DELETE SET NULL,
        user_message TEXT,
        ai_response TEXT,
        correction TEXT,
        error_type VARCHAR(50) NOT NULL DEFAULT 'unknown',
        resolved BOOLEAN DEFAULT false,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_secretaria_ai_errors_company ON secretaria_ai_errors(company_id, created_at DESC)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_secretaria_ai_errors_type ON secretaria_ai_errors(error_type, resolved)`);

    // ===== Portal Config: per-company portal visibility settings =====
    await pool.query(`
      CREATE TABLE IF NOT EXISTS portal_config (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        show_orders BOOLEAN DEFAULT true,
        show_invoices BOOLEAN DEFAULT true,
        show_quotes BOOLEAN DEFAULT true,
        show_balance BOOLEAN DEFAULT true,
        show_remitos BOOLEAN DEFAULT false,
        orders_show_price BOOLEAN DEFAULT true,
        orders_show_total BOOLEAN DEFAULT true,
        orders_show_status BOOLEAN DEFAULT true,
        orders_show_delivery_date BOOLEAN DEFAULT true,
        orders_show_payment_status BOOLEAN DEFAULT true,
        orders_show_payment_method BOOLEAN DEFAULT false,
        orders_show_notes BOOLEAN DEFAULT false,
        orders_show_timeline BOOLEAN DEFAULT true,
        invoices_show_subtotal BOOLEAN DEFAULT true,
        invoices_show_iva BOOLEAN DEFAULT true,
        invoices_show_total BOOLEAN DEFAULT true,
        invoices_show_cae BOOLEAN DEFAULT false,
        invoices_show_download_pdf BOOLEAN DEFAULT true,
        quotes_show_price BOOLEAN DEFAULT true,
        quotes_show_validity BOOLEAN DEFAULT true,
        quotes_show_download_pdf BOOLEAN DEFAULT true,
        quotes_show_accept_reject BOOLEAN DEFAULT false,
        balance_show_total_orders BOOLEAN DEFAULT true,
        balance_show_total_invoiced BOOLEAN DEFAULT true,
        balance_show_pending BOOLEAN DEFAULT true,
        balance_show_payment_detail BOOLEAN DEFAULT false,
        portal_welcome_message TEXT DEFAULT 'Bienvenido a tu portal de cliente',
        portal_logo_url TEXT,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        UNIQUE(company_id)
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_portal_config_company ON portal_config(company_id)`);

    // ===== BUSINESS UNITS (Razones Sociales) =====
    await pool.query(`
      CREATE TABLE IF NOT EXISTS business_units (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        is_fiscal BOOLEAN DEFAULT false,
        cuit VARCHAR(20),
        address TEXT,
        iibb_number VARCHAR(30),
        afip_start_date TIMESTAMP WITH TIME ZONE,
        sort_order INTEGER DEFAULT 0,
        active BOOLEAN DEFAULT true,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        created_by UUID,
        UNIQUE(company_id, name)
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_business_units_company ON business_units(company_id)`);

    // ===== PURCHASE INVOICES (Facturas de Compra) =====
    await pool.query(`
      CREATE TABLE IF NOT EXISTS purchase_invoices (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        business_unit_id UUID NOT NULL REFERENCES business_units(id),
        enterprise_id UUID NOT NULL REFERENCES enterprises(id),
        purchase_id UUID REFERENCES purchases(id),
        invoice_type VARCHAR(5) NOT NULL,
        punto_venta VARCHAR(10),
        invoice_number VARCHAR(50) NOT NULL,
        invoice_date TIMESTAMP WITH TIME ZONE NOT NULL,
        cae VARCHAR(20),
        cae_expiry_date TIMESTAMP WITH TIME ZONE,
        subtotal DECIMAL(12,2) NOT NULL DEFAULT 0,
        vat_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
        other_taxes DECIMAL(12,2) DEFAULT 0,
        total_amount DECIMAL(12,2) NOT NULL,
        payment_status VARCHAR(20) DEFAULT 'pendiente',
        status VARCHAR(20) DEFAULT 'active',
        notes TEXT,
        created_by UUID,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_pi_company_bu ON purchase_invoices(company_id, business_unit_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_pi_enterprise ON purchase_invoices(enterprise_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_pi_purchase ON purchase_invoices(purchase_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_pi_payment_status ON purchase_invoices(company_id, payment_status)`);

    // ===== COBRO ↔ INVOICE APPLICATIONS (N:N) =====
    await pool.query(`
      CREATE TABLE IF NOT EXISTS cobro_invoice_applications (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        cobro_id UUID NOT NULL REFERENCES cobros(id) ON DELETE CASCADE,
        invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
        amount_applied DECIMAL(12,2) NOT NULL CHECK (amount_applied > 0),
        applied_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        created_by UUID,
        notes TEXT,
        UNIQUE(cobro_id, invoice_id)
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_cia_cobro ON cobro_invoice_applications(cobro_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_cia_invoice ON cobro_invoice_applications(invoice_id)`);

    // ===== PAGO ↔ PURCHASE INVOICE APPLICATIONS (N:N) =====
    await pool.query(`
      CREATE TABLE IF NOT EXISTS pago_invoice_applications (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        pago_id UUID NOT NULL REFERENCES pagos(id) ON DELETE CASCADE,
        purchase_invoice_id UUID NOT NULL REFERENCES purchase_invoices(id) ON DELETE CASCADE,
        amount_applied DECIMAL(12,2) NOT NULL CHECK (amount_applied > 0),
        applied_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        created_by UUID,
        UNIQUE(pago_id, purchase_invoice_id)
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_pia_pago ON pago_invoice_applications(pago_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_pia_purchase_invoice ON pago_invoice_applications(purchase_invoice_id)`);

    // ===== ADD business_unit_id TO EXISTING TABLES =====
    await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS business_unit_id UUID REFERENCES business_units(id)`);
    await pool.query(`ALTER TABLE purchases ADD COLUMN IF NOT EXISTS business_unit_id UUID REFERENCES business_units(id)`);
    await pool.query(`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS business_unit_id UUID REFERENCES business_units(id)`);
    await pool.query(`ALTER TABLE cobros ADD COLUMN IF NOT EXISTS business_unit_id UUID REFERENCES business_units(id)`);
    await pool.query(`ALTER TABLE pagos ADD COLUMN IF NOT EXISTS business_unit_id UUID REFERENCES business_units(id)`);
    await pool.query(`ALTER TABLE cheques ADD COLUMN IF NOT EXISTS business_unit_id UUID REFERENCES business_units(id)`);

    // ===== UNIFY: Add receipt_number to cobros (from receipts system) =====
    await pool.query(`ALTER TABLE cobros ADD COLUMN IF NOT EXISTS receipt_number INTEGER`);

    // Migrate receipts → cobros (one-time: copy receipt data that doesn't already exist in cobros)
    try {
      await pool.query(`
        INSERT INTO cobros (id, company_id, enterprise_id, amount, payment_method, bank_id, reference, payment_date, notes, receipt_number, created_by, created_at)
        SELECT r.id, r.company_id, r.enterprise_id, r.total_amount, r.payment_method, r.bank_id, r.reference, r.receipt_date, r.notes, r.receipt_number, r.created_by, r.created_at
        FROM receipts r
        WHERE NOT EXISTS (SELECT 1 FROM cobros c WHERE c.id = r.id)
          AND NOT EXISTS (SELECT 1 FROM cobros c WHERE c.company_id = r.company_id AND c.receipt_number = r.receipt_number AND r.receipt_number IS NOT NULL)
      `);
    } catch (e) { console.warn('Receipt migration (may already be done):', (e as any)?.message); }

    // Migrate receipt_items → cobro_invoice_applications
    try {
      await pool.query(`
        INSERT INTO cobro_invoice_applications (id, cobro_id, invoice_id, amount_applied, applied_at)
        SELECT gen_random_uuid(), r.id, ri.invoice_id, ri.amount, r.created_at
        FROM receipt_items ri
        JOIN receipts r ON ri.receipt_id = r.id
        WHERE ri.invoice_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM cobro_invoice_applications cia
            WHERE cia.cobro_id = r.id AND cia.invoice_id = ri.invoice_id
          )
      `);
    } catch (e) { console.warn('Receipt items migration (may already be done):', (e as any)?.message); }

    // Backfill receipt_number for cobros that were created directly (not from receipts)
    try {
      await pool.query(`
        WITH numbered AS (
          SELECT id, company_id,
            ROW_NUMBER() OVER (PARTITION BY company_id ORDER BY created_at ASC) + COALESCE(
              (SELECT MAX(receipt_number) FROM cobros WHERE company_id = c.company_id AND receipt_number IS NOT NULL), 0
            ) as new_number
          FROM cobros c WHERE receipt_number IS NULL
        )
        UPDATE cobros SET receipt_number = numbered.new_number
        FROM numbered WHERE cobros.id = numbered.id
      `);
    } catch (e) { console.warn('Receipt number backfill:', (e as any)?.message); }

    // ===== ADD payment_status TO INVOICES =====
    await pool.query(`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS payment_status VARCHAR(20) DEFAULT 'pendiente'`);

    // ===== ADD pending_status TO COBROS AND PAGOS =====
    await pool.query(`ALTER TABLE cobros ADD COLUMN IF NOT EXISTS pending_status VARCHAR(20)`);
    await pool.query(`ALTER TABLE pagos ADD COLUMN IF NOT EXISTS pending_status VARCHAR(20)`);

    // ===== ADD cheque_id TO PAGOS (for cheque endorsement) =====
    await pool.query(`ALTER TABLE pagos ADD COLUMN IF NOT EXISTS cheque_id UUID REFERENCES cheques(id)`);

    // ===== ADD endorsement fields TO CHEQUES =====
    await pool.query(`ALTER TABLE cheques ADD COLUMN IF NOT EXISTS endorsed_to_enterprise_id UUID REFERENCES enterprises(id)`);
    await pool.query(`ALTER TABLE cheques ADD COLUMN IF NOT EXISTS endorsed_pago_id UUID`);
    await pool.query(`ALTER TABLE cheques ADD COLUMN IF NOT EXISTS endorsed_at TIMESTAMP WITH TIME ZONE`);

    // ===== PURCHASE INVOICE ITEMS (line items of provider invoices) =====
    await pool.query(`
      CREATE TABLE IF NOT EXISTS purchase_invoice_items (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        purchase_invoice_id UUID NOT NULL REFERENCES purchase_invoices(id) ON DELETE CASCADE,
        product_name VARCHAR(255) NOT NULL,
        description TEXT,
        quantity DECIMAL(12,2) NOT NULL DEFAULT 1,
        unit_price DECIMAL(12,2) NOT NULL DEFAULT 0,
        subtotal DECIMAL(12,2) NOT NULL DEFAULT 0,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_pii_purchase_invoice ON purchase_invoice_items(purchase_invoice_id)`);
    // Add purchase_item_id FK for linking to specific purchase items
    await pool.query(`ALTER TABLE purchase_invoice_items ADD COLUMN IF NOT EXISTS purchase_item_id UUID`);

    // ===== COBRO INVOICE ITEM APPLICATIONS (item-level trazabilidad) =====
    await pool.query(`
      CREATE TABLE IF NOT EXISTS cobro_invoice_item_applications (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        cobro_id UUID NOT NULL REFERENCES cobros(id) ON DELETE CASCADE,
        invoice_item_id UUID NOT NULL REFERENCES invoice_items(id) ON DELETE CASCADE,
        amount_applied DECIMAL(12,2) NOT NULL CHECK (amount_applied > 0),
        applied_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        created_by UUID,
        UNIQUE(cobro_id, invoice_item_id)
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_ciia_cobro ON cobro_invoice_item_applications(cobro_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_ciia_invoice_item ON cobro_invoice_item_applications(invoice_item_id)`);

    // ===== RECEIPT PAYMENT METHODS (multi-method payments on cobros) =====
    await pool.query(`
      CREATE TABLE IF NOT EXISTS receipt_payment_methods (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        cobro_id UUID NOT NULL REFERENCES cobros(id) ON DELETE CASCADE,
        method VARCHAR(50) NOT NULL,
        amount DECIMAL(12,2) NOT NULL CHECK (amount > 0),
        bank_id UUID,
        reference VARCHAR(255),
        cheque_data JSONB,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_rpm_cobro ON receipt_payment_methods(cobro_id)`);

    // ===== PAGO PURCHASE INVOICE ITEM APPLICATIONS (item-level trazabilidad) =====
    await pool.query(`
      CREATE TABLE IF NOT EXISTS pago_invoice_item_applications (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        pago_id UUID NOT NULL REFERENCES pagos(id) ON DELETE CASCADE,
        purchase_invoice_item_id UUID NOT NULL REFERENCES purchase_invoice_items(id) ON DELETE CASCADE,
        amount_applied DECIMAL(12,2) NOT NULL CHECK (amount_applied > 0),
        applied_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        created_by UUID,
        UNIQUE(pago_id, purchase_invoice_item_id)
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_piia_pago ON pago_invoice_item_applications(pago_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_piia_pi_item ON pago_invoice_item_applications(purchase_invoice_item_id)`);

    // ===== SAFETY NET: Ensure FK constraints on N:N application tables =====
    // For DBs where tables were created before FK definitions were added inline
    await pool.query(`
      DO $$ BEGIN
        ALTER TABLE cobro_invoice_applications
          ADD CONSTRAINT fk_cia_cobro FOREIGN KEY (cobro_id) REFERENCES cobros(id) ON DELETE CASCADE;
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);
    await pool.query(`
      DO $$ BEGIN
        ALTER TABLE cobro_invoice_applications
          ADD CONSTRAINT fk_cia_invoice FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE;
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);
    await pool.query(`
      DO $$ BEGIN
        ALTER TABLE pago_invoice_applications
          ADD CONSTRAINT fk_pia_pago FOREIGN KEY (pago_id) REFERENCES pagos(id) ON DELETE CASCADE;
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);
    await pool.query(`
      DO $$ BEGIN
        ALTER TABLE pago_invoice_applications
          ADD CONSTRAINT fk_pia_purchase_invoice FOREIGN KEY (purchase_invoice_id) REFERENCES purchase_invoices(id) ON DELETE CASCADE;
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);
    await pool.query(`
      DO $$ BEGIN
        ALTER TABLE cobro_invoice_item_applications
          ADD CONSTRAINT fk_ciia_cobro FOREIGN KEY (cobro_id) REFERENCES cobros(id) ON DELETE CASCADE;
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);
    await pool.query(`
      DO $$ BEGIN
        ALTER TABLE cobro_invoice_item_applications
          ADD CONSTRAINT fk_ciia_invoice_item FOREIGN KEY (invoice_item_id) REFERENCES invoice_items(id) ON DELETE CASCADE;
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);
    await pool.query(`
      DO $$ BEGIN
        ALTER TABLE pago_invoice_item_applications
          ADD CONSTRAINT fk_piia_pago FOREIGN KEY (pago_id) REFERENCES pagos(id) ON DELETE CASCADE;
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);
    await pool.query(`
      DO $$ BEGIN
        ALTER TABLE pago_invoice_item_applications
          ADD CONSTRAINT fk_piia_pi_item FOREIGN KEY (purchase_invoice_item_id) REFERENCES purchase_invoice_items(id) ON DELETE CASCADE;
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);

    // ===== AUTO-CREATE DEFAULT BUSINESS UNIT FOR EXISTING COMPANIES =====
    // Only creates if the company doesn't have any business_units yet
    await pool.query(`
      INSERT INTO business_units (company_id, name, is_fiscal, sort_order, active)
      SELECT c.id, COALESCE(c.razon_social, c.name) || ' (Default)', false, 0, true
      FROM companies c
      WHERE NOT EXISTS (
        SELECT 1 FROM business_units bu WHERE bu.company_id = c.id
      )
    `);

    // ===== BACKFILL business_unit_id ON EXISTING ROWS =====
    // For each table, set business_unit_id to the company's default BU where NULL
    const tablesToBackfill = ['orders', 'purchases', 'invoices', 'cobros', 'pagos', 'cheques'];
    for (const tbl of tablesToBackfill) {
      try {
        await pool.query(`
          UPDATE ${tbl} SET business_unit_id = (
            SELECT bu.id FROM business_units bu
            WHERE bu.company_id = ${tbl}.company_id
            ORDER BY bu.sort_order ASC, bu.created_at ASC
            LIMIT 1
          )
          WHERE business_unit_id IS NULL
        `);
      } catch (_) {
        // Table may not have company_id or may not exist
      }
    }

    // ===== MIGRATE existing cobros with invoice_id to cobro_invoice_applications =====
    try {
      await pool.query(`
        INSERT INTO cobro_invoice_applications (cobro_id, invoice_id, amount_applied, applied_at)
        SELECT c.id, c.invoice_id, c.amount, c.created_at
        FROM cobros c
        WHERE c.invoice_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM cobro_invoice_applications cia
            WHERE cia.cobro_id = c.id AND cia.invoice_id = c.invoice_id
          )
      `);
    } catch (_) {}

    // ===== SET pending_status on cobros without invoice linkage =====
    try {
      await pool.query(`
        UPDATE cobros SET pending_status = 'pending_invoice'
        WHERE invoice_id IS NULL
          AND pending_status IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM cobro_invoice_applications cia WHERE cia.cobro_id = cobros.id
          )
      `);
    } catch (_) {}

    // ===== CALCULATE payment_status for existing invoices =====
    try {
      await pool.query(`
        UPDATE invoices SET payment_status = CASE
          WHEN COALESCE((SELECT SUM(amount_applied) FROM cobro_invoice_applications WHERE invoice_id = invoices.id), 0) = 0
            THEN 'pendiente'
          WHEN COALESCE((SELECT SUM(amount_applied) FROM cobro_invoice_applications WHERE invoice_id = invoices.id), 0) >= COALESCE(invoices.total_amount, 0)
            THEN 'pagado'
          ELSE 'parcial'
        END
        WHERE payment_status = 'pendiente' OR payment_status IS NULL
      `);
    } catch (_) {}

    // --- Retenciones (tax withholdings: IIBB, Ganancias, IVA, SUSS) ---
    await pool.query(`
      CREATE TABLE IF NOT EXISTS retenciones (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        type VARCHAR(20) NOT NULL,
        regime VARCHAR(100),
        enterprise_id UUID REFERENCES enterprises(id),
        pago_id UUID REFERENCES pagos(id) ON DELETE SET NULL,
        base_amount DECIMAL(12,2) NOT NULL,
        rate DECIMAL(8,4) NOT NULL,
        amount DECIMAL(12,2) NOT NULL,
        certificate_number VARCHAR(50),
        date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        period VARCHAR(7),
        created_by UUID,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_retenciones_company ON retenciones(company_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_retenciones_enterprise ON retenciones(enterprise_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_retenciones_pago ON retenciones(pago_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_retenciones_period ON retenciones(company_id, period)`);

    // -- Retenciones: soporte sufridas + vinculacion a cobros/facturas --
    try { await pool.query(`ALTER TABLE retenciones ADD COLUMN IF NOT EXISTS direction VARCHAR(20) DEFAULT 'practicada'`); } catch (_) {}
    try { await pool.query(`ALTER TABLE retenciones ADD COLUMN IF NOT EXISTS cobro_id UUID REFERENCES cobros(id) ON DELETE SET NULL`); } catch (_) {}
    try { await pool.query(`ALTER TABLE retenciones ADD COLUMN IF NOT EXISTS purchase_invoice_id UUID REFERENCES purchase_invoices(id) ON DELETE SET NULL`); } catch (_) {}
    try { await pool.query(`ALTER TABLE retenciones ADD COLUMN IF NOT EXISTS invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL`); } catch (_) {}
    try { await pool.query(`ALTER TABLE retenciones ADD COLUMN IF NOT EXISTS certificate_file TEXT`); } catch (_) {}
    await pool.query(`ALTER TABLE retenciones ADD COLUMN IF NOT EXISTS jurisdiction VARCHAR(50)`).catch(() => {});

    // ===== RETENCIONES ESPERADAS on invoices (expected withholdings by client) =====
    await pool.query(`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS retenciones_esperadas JSONB DEFAULT '[]'::jsonb`);

    try { await pool.query(`CREATE INDEX IF NOT EXISTS idx_retenciones_cobro ON retenciones(cobro_id) WHERE cobro_id IS NOT NULL`); } catch (_) {}
    try { await pool.query(`CREATE INDEX IF NOT EXISTS idx_retenciones_direction ON retenciones(direction)`); } catch (_) {}
    try { await pool.query(`CREATE INDEX IF NOT EXISTS idx_retenciones_invoice ON retenciones(invoice_id) WHERE invoice_id IS NOT NULL`); } catch (_) {}
    try { await pool.query(`CREATE INDEX IF NOT EXISTS idx_retenciones_pi ON retenciones(purchase_invoice_id) WHERE purchase_invoice_id IS NOT NULL`); } catch (_) {}

    // -- total_amount en cobros y pagos (amount + retenciones; NULL = backward compat) --
    try { await pool.query(`ALTER TABLE cobros ADD COLUMN IF NOT EXISTS total_amount DECIMAL(12,2)`); } catch (_) {}
    try { await pool.query(`ALTER TABLE pagos ADD COLUMN IF NOT EXISTS total_amount DECIMAL(12,2)`); } catch (_) {}

    await pool.query(`
      CREATE TABLE IF NOT EXISTS padron_retenciones (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        source VARCHAR(20) NOT NULL,
        cuit VARCHAR(20) NOT NULL,
        regime VARCHAR(100),
        rate DECIMAL(8,4),
        valid_from DATE,
        valid_to DATE,
        uploaded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        UNIQUE(company_id, source, cuit, regime)
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_padron_company ON padron_retenciones(company_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_padron_cuit ON padron_retenciones(company_id, cuit)`);

    // ===== BANK RECONCILIATION (conciliacion bancaria) =====
    await pool.query(`
      CREATE TABLE IF NOT EXISTS bank_statements (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id UUID NOT NULL REFERENCES companies(id),
        bank_id UUID REFERENCES banks(id),
        period VARCHAR(7),
        file_name VARCHAR(255),
        total_lines INTEGER DEFAULT 0,
        matched_lines INTEGER DEFAULT 0,
        uploaded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_bank_statements_company ON bank_statements(company_id)`);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS bank_statement_lines (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        statement_id UUID NOT NULL REFERENCES bank_statements(id) ON DELETE CASCADE,
        line_date DATE NOT NULL,
        description TEXT,
        amount DECIMAL(12,2) NOT NULL,
        reference VARCHAR(100),
        matched_type VARCHAR(20),
        matched_id UUID,
        match_confidence DECIMAL(3,2),
        status VARCHAR(20) DEFAULT 'pending',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_bsl_statement ON bank_statement_lines(statement_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_bsl_status ON bank_statement_lines(status)`);

    // Accounting module tables
    await pool.query(`
      CREATE TABLE IF NOT EXISTS chart_of_accounts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id UUID NOT NULL REFERENCES companies(id),
        code VARCHAR(20) NOT NULL,
        name VARCHAR(200) NOT NULL,
        type VARCHAR(20) NOT NULL,
        parent_id UUID REFERENCES chart_of_accounts(id),
        level INTEGER DEFAULT 1,
        is_header BOOLEAN DEFAULT false,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        UNIQUE(company_id, code)
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS journal_entries (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id UUID NOT NULL REFERENCES companies(id),
        entry_number SERIAL,
        date DATE NOT NULL,
        description TEXT,
        reference_type VARCHAR(30),
        reference_id UUID,
        is_auto BOOLEAN DEFAULT true,
        created_by UUID,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS journal_entry_lines (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        entry_id UUID NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
        account_id UUID NOT NULL REFERENCES chart_of_accounts(id),
        debit DECIMAL(12,2) DEFAULT 0,
        credit DECIMAL(12,2) DEFAULT 0,
        description TEXT
      )
    `);

    await pool.query(`CREATE INDEX IF NOT EXISTS idx_coa_company ON chart_of_accounts(company_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_je_company_date ON journal_entries(company_id, date)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_je_reference ON journal_entries(reference_type, reference_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_jel_entry ON journal_entry_lines(entry_id)`);

    // ===== INVOICE_ORDERS (N:N factura-pedido) =====
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS invoice_orders (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
          order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          UNIQUE(invoice_id, order_id)
        )
      `);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_invoice_orders_invoice ON invoice_orders(invoice_id)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_invoice_orders_order ON invoice_orders(order_id)`);
    } catch (_) {}

    // Backfill: migrate existing invoices.order_id → invoice_orders
    try {
      await pool.query(`
        INSERT INTO invoice_orders (id, invoice_id, order_id)
        SELECT gen_random_uuid(), id, order_id FROM invoices
        WHERE order_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM invoice_orders io
            WHERE io.invoice_id = invoices.id AND io.order_id = invoices.order_id
          )
        ON CONFLICT DO NOTHING
      `);
    } catch (_) {}

    // ===== PURCHASE_INVOICE_PURCHASES (N:N factura compra-compra) =====
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS purchase_invoice_purchases (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          purchase_invoice_id UUID NOT NULL REFERENCES purchase_invoices(id) ON DELETE CASCADE,
          purchase_id UUID NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          UNIQUE(purchase_invoice_id, purchase_id)
        )
      `);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_pip_pi ON purchase_invoice_purchases(purchase_invoice_id)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_pip_purchase ON purchase_invoice_purchases(purchase_id)`);
    } catch (_) {}

    // Backfill: migrate existing purchase_invoices.purchase_id → purchase_invoice_purchases
    try {
      await pool.query(`
        INSERT INTO purchase_invoice_purchases (id, purchase_invoice_id, purchase_id)
        SELECT gen_random_uuid(), id, purchase_id FROM purchase_invoices
        WHERE purchase_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM purchase_invoice_purchases pip
            WHERE pip.purchase_invoice_id = purchase_invoices.id AND pip.purchase_id = purchase_invoices.purchase_id
          )
        ON CONFLICT DO NOTHING
      `);
    } catch (_) {}

    console.log('Auto-migrations completed');
  } catch (error) {
    console.error('⚠️ Auto-migration warning:', error);
  }
}

/**
 * Apply Row Level Security policies to all tables that have company_id.
 * This is a SECOND LAYER of protection -- the primary layer is app-level
 * WHERE company_id = $companyId in every query.
 *
 * RLS uses the session variable 'app.company_id' set by middleware at
 * the start of each HTTP request.
 *
 * Tables WITHOUT company_id (order_items, quote_items, invoice_items, etc.)
 * are protected transitively through their parent FK with ON DELETE CASCADE.
 */
async function applyRowLevelSecurity() {
  // Tables with direct company_id column
  const tablesWithCompanyId = [
    'users',
    'enterprises',
    'orders',
    'quotes',
    'invoices',
    'cheques',
    'cobros',
    'pagos',
    'purchases',
    'remitos',
    'receipts',
    'banks',
    'products',
    'categories',
    'brands',
    'customers',
    'suppliers',
    'warehouses',
    'tags',
    'price_lists',
    'product_components',
    'product_types',
    'materials',
    'product_materials',
    'material_stock_movements',
    'subscriptions',
    'usage_tracking',
    'audit_log',
    'invitations',
    'pending_invitations',
    'crm_deals',
    'crm_activities',
    'crm_stages',
    'secretaria_config',
    'secretaria_linked_phones',
    'secretaria_conversations',
    'secretaria_memory',
    'secretaria_usage',
    'secretaria_pending_actions',
    'secretaria_ai_errors',
    'portal_config',
    'account_adjustments',
    'price_criteria',
    'product_prices',
    'business_units',
    'purchase_invoices',
    'retenciones',
    'padron_retenciones',
    'bank_statements',
    'chart_of_accounts',
    'journal_entries',
  ];

  for (const table of tablesWithCompanyId) {
    try {
      await pool.query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
      // Do NOT use FORCE -- we want the app DB user (which owns the tables)
      // to bypass RLS so migrations and admin queries still work.
      // RLS applies only to non-owner roles or when explicitly set.

      const policyName = `${table}_company_isolation`;
      await pool.query(`
        DO $$ BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_policies WHERE tablename = '${table}' AND policyname = '${policyName}'
          ) THEN
            EXECUTE format(
              'CREATE POLICY ${policyName} ON ${table} FOR ALL USING (company_id = current_setting(''app.company_id'', true)::uuid)'
            );
          END IF;
        END $$;
      `);
    } catch (err) {
      // Table may not exist yet on first boot
      console.warn(`RLS for ${table}: ${(err as any)?.message || err}`);
    }
  }

  // companies table uses 'id' not 'company_id'
  try {
    await pool.query(`ALTER TABLE companies ENABLE ROW LEVEL SECURITY`);
    await pool.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_policies WHERE tablename = 'companies' AND policyname = 'companies_self_isolation'
        ) THEN
          CREATE POLICY companies_self_isolation ON companies
            FOR ALL USING (id = current_setting('app.company_id', true)::uuid);
        END IF;
      END $$;
    `);
  } catch (err) {
    console.warn(`RLS for companies: ${(err as any)?.message || err}`);
  }

  console.log('  RLS policies applied');
}

/**
 * Set the company_id context for the current database connection.
 * Call at the start of each request via middleware.
 */
export async function setCompanyContext(companyId: string) {
  await pool.query(`SELECT set_config('app.company_id', $1, false)`, [companyId]);
}

/**
 * Clear the company_id context (for admin/superadmin routes).
 */
export async function clearCompanyContext() {
  await pool.query(`SELECT set_config('app.company_id', '', false)`);
}

/**
 * Export all data for a specific company as JSON.
 * Used by the per-company backup system.
 */
export async function exportCompanyData(companyId: string): Promise<{
  metadata: { company_id: string; exported_at: string; row_counts: Record<string, number> };
  data: Record<string, any[]>;
}> {
  const tables: Array<{ name: string; fk: string }> = [
    { name: 'companies', fk: 'id' },
    { name: 'users', fk: 'company_id' },
    { name: 'enterprises', fk: 'company_id' },
    { name: 'customers', fk: 'company_id' },
    { name: 'products', fk: 'company_id' },
    { name: 'categories', fk: 'company_id' },
    { name: 'brands', fk: 'company_id' },
    { name: 'orders', fk: 'company_id' },
    { name: 'quotes', fk: 'company_id' },
    { name: 'invoices', fk: 'company_id' },
    { name: 'cheques', fk: 'company_id' },
    { name: 'cobros', fk: 'company_id' },
    { name: 'pagos', fk: 'company_id' },
    { name: 'purchases', fk: 'company_id' },
    { name: 'remitos', fk: 'company_id' },
    { name: 'receipts', fk: 'company_id' },
    { name: 'banks', fk: 'company_id' },
    { name: 'tags', fk: 'company_id' },
    { name: 'price_lists', fk: 'company_id' },
    { name: 'product_components', fk: 'company_id' },
    { name: 'materials', fk: 'company_id' },
    { name: 'material_stock_movements', fk: 'company_id' },
    { name: 'subscriptions', fk: 'company_id' },
    { name: 'usage_tracking', fk: 'company_id' },
    { name: 'audit_log', fk: 'company_id' },
    { name: 'invitations', fk: 'company_id' },
    { name: 'pending_invitations', fk: 'company_id' },
    { name: 'crm_deals', fk: 'company_id' },
    { name: 'crm_activities', fk: 'company_id' },
    { name: 'crm_stages', fk: 'company_id' },
    { name: 'warehouses', fk: 'company_id' },
    { name: 'suppliers', fk: 'company_id' },
    { name: 'account_adjustments', fk: 'company_id' },
    { name: 'price_criteria', fk: 'company_id' },
    { name: 'product_prices', fk: 'company_id' },
    { name: 'business_units', fk: 'company_id' },
    { name: 'purchase_invoices', fk: 'company_id' },
    { name: 'chart_of_accounts', fk: 'company_id' },
    { name: 'journal_entries', fk: 'company_id' },
  ];

  // Child tables accessed via parent FK (no direct company_id)
  const childTables: Array<{ name: string; parentTable: string; parentFk: string }> = [
    { name: 'order_items', parentTable: 'orders', parentFk: 'order_id' },
    { name: 'order_status_history', parentTable: 'orders', parentFk: 'order_id' },
    { name: 'quote_items', parentTable: 'quotes', parentFk: 'quote_id' },
    { name: 'invoice_items', parentTable: 'invoices', parentFk: 'invoice_id' },
    { name: 'purchase_items', parentTable: 'purchases', parentFk: 'purchase_id' },
    { name: 'remito_items', parentTable: 'remitos', parentFk: 'remito_id' },
    { name: 'receipt_items', parentTable: 'receipts', parentFk: 'receipt_id' },
    { name: 'cobro_items', parentTable: 'cobros', parentFk: 'cobro_id' },
    { name: 'cheque_status_history', parentTable: 'cheques', parentFk: 'cheque_id' },
    { name: 'price_list_items', parentTable: 'price_lists', parentFk: 'price_list_id' },
    { name: 'entity_tags', parentTable: 'tags', parentFk: 'tag_id' },
    { name: 'permissions', parentTable: 'users', parentFk: 'user_id' },
    { name: 'sessions', parentTable: 'users', parentFk: 'user_id' },
    { name: 'product_pricing', parentTable: 'products', parentFk: 'product_id' },
    { name: 'product_materials', parentTable: 'products', parentFk: 'product_id' },
    { name: 'stock', parentTable: 'products', parentFk: 'product_id' },
    { name: 'stock_movements', parentTable: 'products', parentFk: 'product_id' },
    { name: 'payments', parentTable: 'invoices', parentFk: 'invoice_id' },
    { name: 'crm_deal_documents', parentTable: 'crm_deals', parentFk: 'deal_id' },
    { name: 'crm_deal_stage_history', parentTable: 'crm_deals', parentFk: 'deal_id' },
    { name: 'cobro_invoice_applications', parentTable: 'cobros', parentFk: 'cobro_id' },
    { name: 'pago_invoice_applications', parentTable: 'pagos', parentFk: 'pago_id' },
    { name: 'purchase_invoice_items', parentTable: 'purchase_invoices', parentFk: 'purchase_invoice_id' },
    { name: 'cobro_invoice_item_applications', parentTable: 'cobros', parentFk: 'cobro_id' },
    { name: 'pago_invoice_item_applications', parentTable: 'pagos', parentFk: 'pago_id' },
    { name: 'receipt_payment_methods', parentTable: 'cobros', parentFk: 'cobro_id' },
    { name: 'journal_entry_lines', parentTable: 'journal_entries', parentFk: 'entry_id' },
    { name: 'invoice_orders', parentTable: 'invoices', parentFk: 'invoice_id' },
    { name: 'purchase_invoice_purchases', parentTable: 'purchase_invoices', parentFk: 'purchase_invoice_id' },
  ];

  const result: Record<string, any[]> = {};
  const rowCounts: Record<string, number> = {};

  // Export direct tables
  for (const t of tables) {
    try {
      const res = await pool.query(
        `SELECT * FROM ${t.name} WHERE ${t.fk} = $1`,
        [companyId]
      );
      result[t.name] = res.rows;
      rowCounts[t.name] = res.rows.length;
    } catch (err) {
      result[t.name] = [];
      rowCounts[t.name] = 0;
    }
  }

  // Export child tables via parent
  for (const ct of childTables) {
    try {
      const parentRows = result[ct.parentTable] || [];
      if (parentRows.length === 0) {
        result[ct.name] = [];
        rowCounts[ct.name] = 0;
        continue;
      }
      const parentIds = parentRows.map((r: any) => r.id);
      const res = await pool.query(
        `SELECT * FROM ${ct.name} WHERE ${ct.parentFk} = ANY($1::uuid[])`,
        [parentIds]
      );
      result[ct.name] = res.rows;
      rowCounts[ct.name] = res.rows.length;
    } catch (err) {
      result[ct.name] = [];
      rowCounts[ct.name] = 0;
    }
  }

  return {
    metadata: {
      company_id: companyId,
      exported_at: new Date().toISOString(),
      row_counts: rowCounts,
    },
    data: result,
  };
}

export async function closeDb() {
  await pool.end();
}

export { pool };
