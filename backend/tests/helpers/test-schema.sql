-- Test schema: minimal tables + enums matching production schema
-- Used by integration tests to verify queries parse and execute against real Postgres

-- ═══ ENUMS ═══
CREATE TYPE user_role AS ENUM ('owner', 'admin', 'gerente', 'editor', 'vendedor', 'contable', 'viewer');
CREATE TYPE invoice_type AS ENUM ('A', 'B', 'C', 'E', 'NC_E', 'ND_E');
CREATE TYPE invoice_status AS ENUM ('draft', 'pending', 'authorized', 'cancelled', 'emitido');
CREATE TYPE stock_movement_type AS ENUM ('purchase', 'sale', 'adjustment', 'transfer', 'return_customer', 'return_supplier');
CREATE TYPE payment_method AS ENUM ('efectivo', 'tarjeta', 'cheque', 'transferencia', 'mixto');

-- ═══ CORE TABLES ═══
CREATE TABLE companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id),
  email VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE enterprises (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id),
  name VARCHAR(255),
  razon_social VARCHAR(255),
  cuit VARCHAR(20),
  address TEXT,
  city VARCHAR(100),
  province VARCHAR(100),
  postal_code VARCHAR(20),
  tax_condition VARCHAR(50),
  price_list_id UUID,
  default_discount DECIMAL(5,2) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id),
  enterprise_id UUID REFERENCES enterprises(id),
  name VARCHAR(255),
  cuit VARCHAR(20),
  email VARCHAR(255),
  phone VARCHAR(50),
  address TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE business_units (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id),
  name VARCHAR(255),
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id),
  name VARCHAR(255),
  sku VARCHAR(100),
  controls_stock BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE warehouses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id),
  name VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE stock (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id),
  product_id UUID REFERENCES products(id),
  warehouse_id UUID REFERENCES warehouses(id),
  quantity DECIMAL(12,2) DEFAULT 0
);

CREATE TABLE stock_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id),
  product_id UUID REFERENCES products(id),
  warehouse_id UUID REFERENCES warehouses(id),
  quantity DECIMAL(12,2),
  movement_type VARCHAR(50),
  reference_type VARCHAR(50),
  reference_id UUID,
  notes TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ═══ ORDERS (VARCHAR status) ═══
CREATE TABLE orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id),
  customer_id UUID REFERENCES customers(id),
  enterprise_id UUID REFERENCES enterprises(id),
  business_unit_id UUID REFERENCES business_units(id),
  order_number INTEGER,
  title VARCHAR(255),
  status VARCHAR(30) DEFAULT 'pendiente',
  payment_status VARCHAR(20) DEFAULT 'pendiente',
  total_amount DECIMAL(12,2) DEFAULT 0,
  discount_percent DECIMAL(5,2) DEFAULT 0,
  priority VARCHAR(20) DEFAULT 'normal',
  bank_id UUID,
  quote_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID REFERENCES orders(id),
  product_id UUID REFERENCES products(id),
  product_name VARCHAR(255),
  description TEXT,
  quantity DECIMAL(12,2),
  unit_price DECIMAL(12,2),
  subtotal DECIMAL(12,2),
  vat_rate DECIMAL(5,2) DEFAULT 21,
  qty_delivered DECIMAL(12,2) DEFAULT 0,
  deduct_stock BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ═══ INVOICES (ENUM status) ═══
CREATE TABLE invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id),
  customer_id UUID REFERENCES customers(id),
  enterprise_id UUID REFERENCES enterprises(id),
  order_id UUID REFERENCES orders(id),
  business_unit_id UUID REFERENCES business_units(id),
  invoice_type invoice_type,
  invoice_number INTEGER,
  invoice_date TIMESTAMPTZ DEFAULT NOW(),
  subtotal DECIMAL(12,2) DEFAULT 0,
  vat_amount DECIMAL(12,2) DEFAULT 0,
  total_amount DECIMAL(12,2) DEFAULT 0,
  status invoice_status DEFAULT 'draft',
  payment_status VARCHAR(20) DEFAULT 'pendiente',
  fiscal_type VARCHAR(20) DEFAULT 'fiscal',
  related_invoice_id UUID REFERENCES invoices(id),
  currency VARCHAR(3) DEFAULT 'ARS',
  exchange_rate DECIMAL(12,4),
  cae VARCHAR(50),
  retenciones_esperadas JSONB DEFAULT '[]'::jsonb,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE invoice_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID REFERENCES invoices(id),
  order_item_id UUID REFERENCES order_items(id),
  product_id UUID REFERENCES products(id),
  product_name VARCHAR(255),
  quantity DECIMAL(12,2),
  unit_price DECIMAL(12,2),
  vat_rate DECIMAL(5,2) DEFAULT 21,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE invoice_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID REFERENCES invoices(id),
  order_id UUID REFERENCES orders(id),
  UNIQUE(invoice_id, order_id)
);

-- ═══ PURCHASES (VARCHAR status) ═══
CREATE TABLE purchases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id),
  enterprise_id UUID REFERENCES enterprises(id),
  total_amount DECIMAL(12,2) DEFAULT 0,
  status VARCHAR(20) DEFAULT 'pendiente',
  payment_status VARCHAR(20) DEFAULT 'pendiente',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE purchase_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_id UUID REFERENCES purchases(id),
  product_id UUID REFERENCES products(id),
  quantity DECIMAL(12,2),
  unit_price DECIMAL(12,2)
);

CREATE TABLE purchase_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id),
  purchase_id UUID REFERENCES purchases(id),
  enterprise_id UUID REFERENCES enterprises(id),
  total_amount DECIMAL(12,2) DEFAULT 0,
  subtotal DECIMAL(12,2) DEFAULT 0,
  status VARCHAR(20) DEFAULT 'pendiente',
  payment_status VARCHAR(20) DEFAULT 'pendiente',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE purchase_invoice_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_invoice_id UUID REFERENCES purchase_invoices(id),
  purchase_item_id UUID REFERENCES purchase_items(id),
  quantity DECIMAL(12,2)
);

-- ═══ REMITOS (VARCHAR status) ═══
CREATE TABLE remitos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id),
  customer_id UUID REFERENCES customers(id),
  enterprise_id UUID REFERENCES enterprises(id),
  order_id UUID REFERENCES orders(id),
  remito_number INTEGER,
  punto_venta INTEGER DEFAULT 1,
  date TIMESTAMPTZ DEFAULT NOW(),
  delivery_address TEXT,
  receiver_name VARCHAR(255),
  transport VARCHAR(255),
  tipo VARCHAR(20) DEFAULT 'entrega',
  notes TEXT,
  status VARCHAR(50) DEFAULT 'pendiente',
  factura_ref TEXT,
  pedido_ref TEXT,
  signed_pdf_url TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE remito_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  remito_id UUID REFERENCES remitos(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id),
  order_item_id UUID REFERENCES order_items(id),
  product_name VARCHAR(255),
  description TEXT,
  quantity DECIMAL(12,2),
  unit VARCHAR(50) DEFAULT 'unidades',
  unit_price DECIMAL(12,2),
  vat_rate DECIMAL(5,2) DEFAULT 21,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE remito_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  remito_id UUID REFERENCES remitos(id) ON DELETE CASCADE,
  order_id UUID REFERENCES orders(id),
  UNIQUE(remito_id, order_id)
);

-- ═══ COBROS/PAGOS ═══
CREATE TABLE cobros (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id),
  enterprise_id UUID REFERENCES enterprises(id),
  total_amount DECIMAL(12,2),
  status VARCHAR(20) DEFAULT 'a_cobrar',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE cobro_invoice_applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cobro_id UUID REFERENCES cobros(id),
  invoice_id UUID REFERENCES invoices(id),
  amount_applied DECIMAL(12,2),
  applied_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE pagos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id),
  enterprise_id UUID REFERENCES enterprises(id),
  total_amount DECIMAL(12,2),
  status VARCHAR(20) DEFAULT 'pendiente',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE pago_invoice_applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pago_id UUID REFERENCES pagos(id),
  purchase_invoice_id UUID REFERENCES purchase_invoices(id),
  amount_applied DECIMAL(12,2)
);

-- Seed a minimal dataset for queries with parameters
INSERT INTO companies (id, name) VALUES ('11111111-1111-1111-1111-111111111111', 'Test Co');
INSERT INTO enterprises (id, company_id, name) VALUES ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'Test Ent');
