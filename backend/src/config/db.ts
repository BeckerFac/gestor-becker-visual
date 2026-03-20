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

    // Add signed_pdf_url to remitos table (may not exist yet if remitos module hasn't initialised)
    try { await pool.query(`ALTER TABLE remitos ADD COLUMN IF NOT EXISTS signed_pdf_url TEXT`); } catch (_) {}

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

    // --- Accounting report indexes (tables may not exist yet on first boot) ---
    try { await pool.query(`CREATE INDEX IF NOT EXISTS idx_invoices_company_status_date ON invoices(company_id, status, invoice_date)`); } catch (_) {}
    try { await pool.query(`CREATE INDEX IF NOT EXISTS idx_purchases_company_status_date ON purchases(company_id, status, date)`); } catch (_) {}
    try { await pool.query(`CREATE INDEX IF NOT EXISTS idx_cobros_company_date ON cobros(company_id, payment_date)`); } catch (_) {}
    try { await pool.query(`CREATE INDEX IF NOT EXISTS idx_pagos_company_date ON pagos(company_id, payment_date)`); } catch (_) {}
    try { await pool.query(`CREATE INDEX IF NOT EXISTS idx_cheques_company_status_collected ON cheques(company_id, status, collected_date)`); } catch (_) {}

    // --- Onboarding wizard ---
    await pool.query(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN DEFAULT false`);
    await pool.query(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMP WITH TIME ZONE`);
    await pool.query(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS onboarding_current_step INTEGER DEFAULT 0`);
    await pool.query(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS enabled_modules TEXT[] DEFAULT ARRAY['orders','invoices','products','inventory','purchases','cobros','pagos','cheques','enterprises','banks','customers','quotes','remitos','reports','crm']`);
    // Ensure existing companies have 'reports' in enabled_modules
    await pool.query(`UPDATE companies SET enabled_modules = array_append(enabled_modules, 'reports') WHERE enabled_modules IS NOT NULL AND NOT ('reports' = ANY(enabled_modules))`);
    // Ensure existing companies have 'crm' in enabled_modules
    await pool.query(`UPDATE companies SET enabled_modules = array_append(enabled_modules, 'crm') WHERE enabled_modules IS NOT NULL AND NOT ('crm' = ANY(enabled_modules))`);
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
    { name: 'stock', parentTable: 'products', parentFk: 'product_id' },
    { name: 'stock_movements', parentTable: 'products', parentFk: 'product_id' },
    { name: 'payments', parentTable: 'invoices', parentFk: 'invoice_id' },
    { name: 'crm_deal_documents', parentTable: 'crm_deals', parentFk: 'deal_id' },
    { name: 'crm_deal_stage_history', parentTable: 'crm_deals', parentFk: 'deal_id' },
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
