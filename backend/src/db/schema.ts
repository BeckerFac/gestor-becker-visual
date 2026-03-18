import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  decimal,
  timestamp,
  boolean,
  jsonb,
  pgEnum,
  uniqueIndex,
  primaryKey,
  foreignKey,
  index,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// Enums
export const userRoleEnum = pgEnum('user_role', ['admin', 'gerente', 'vendedor', 'contable', 'viewer']);
export const invoiceTypeEnum = pgEnum('invoice_type', ['A', 'B', 'C']);
export const invoiceStatusEnum = pgEnum('invoice_status', ['draft', 'pending', 'authorized', 'cancelled']);
export const stockMovementTypeEnum = pgEnum('stock_movement_type', ['purchase', 'sale', 'adjustment', 'transfer', 'return_customer', 'return_supplier']);
export const paymentMethodEnum = pgEnum('payment_method', ['efectivo', 'tarjeta', 'cheque', 'transferencia', 'mixto']);

// ============ COMPANIES & USERS ============

export const companies = pgTable('companies', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull(),
  cuit: varchar('cuit', { length: 20 }).notNull().unique(),
  address: text('address'),
  city: varchar('city', { length: 100 }),
  province: varchar('province', { length: 100 }),
  logo_url: text('logo_url'),
  phone: varchar('phone', { length: 20 }),
  email: varchar('email', { length: 100 }),
  afip_cert: text('afip_cert'), // PEM encoded
  afip_key: text('afip_key'), // PEM encoded
  afip_env: varchar('afip_env', { length: 20 }).default('homologacion'), // homologacion or produccion
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  company_id: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  email: varchar('email', { length: 100 }).notNull(),
  password_hash: varchar('password_hash', { length: 255 }).notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  role: userRoleEnum('role').default('viewer'),
  active: boolean('active').default(true),
  last_login: timestamp('last_login', { withTimezone: true }),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  emailIdx: uniqueIndex('unique_email_per_company').on(table.company_id, table.email),
}));

export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  user_id: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  refresh_token: varchar('refresh_token', { length: 500 }).notNull(),
  expires_at: timestamp('expires_at', { withTimezone: true }).notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

// ============ PRODUCTS & PRICING ============

export const categories = pgTable('categories', {
  id: uuid('id').primaryKey().defaultRandom(),
  company_id: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  parent_id: uuid('parent_id'),
  active: boolean('active').default(true),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export const brands = pgTable('brands', {
  id: uuid('id').primaryKey().defaultRandom(),
  company_id: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const products = pgTable('products', {
  id: uuid('id').primaryKey().defaultRandom(),
  company_id: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  sku: varchar('sku', { length: 100 }).notNull(),
  barcode: varchar('barcode', { length: 50 }),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  category_id: uuid('category_id').references(() => categories.id, { onDelete: 'set null' }),
  brand_id: uuid('brand_id').references(() => brands.id, { onDelete: 'set null' }),
  image_url: text('image_url'),
  active: boolean('active').default(true),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  skuIdx: uniqueIndex('unique_sku_per_company').on(table.company_id, table.sku),
  categoryIdx: index('products_category_idx').on(table.category_id),
}));

export const product_pricing = pgTable('product_pricing', {
  id: uuid('id').primaryKey().defaultRandom(),
  product_id: uuid('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
  cost: decimal('cost', { precision: 12, scale: 2 }).notNull(),
  margin_percent: decimal('margin_percent', { precision: 5, scale: 2 }).default('30'),
  vat_rate: decimal('vat_rate', { precision: 5, scale: 2 }).default('21'), // 0, 2.5, 10.5, 21
  final_price: decimal('final_price', { precision: 12, scale: 2 }).notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export const price_lists = pgTable('price_lists', {
  id: uuid('id').primaryKey().defaultRandom(),
  company_id: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(),
  type: varchar('type', { length: 50 }).default('default'), // default, customer, channel, promo
  valid_from: timestamp('valid_from', { withTimezone: true }),
  valid_to: timestamp('valid_to', { withTimezone: true }),
  active: boolean('active').default(true),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export const price_list_items = pgTable('price_list_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  price_list_id: uuid('price_list_id').notNull().references(() => price_lists.id, { onDelete: 'cascade' }),
  product_id: uuid('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
  price: decimal('price', { precision: 12, scale: 2 }).notNull(),
  discount_percent: decimal('discount_percent', { precision: 5, scale: 2 }).default('0'),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  uniqueIdx: uniqueIndex('unique_price_list_item').on(table.price_list_id, table.product_id),
}));

// ============ CUSTOMERS & SUPPLIERS ============

export const customers = pgTable('customers', {
  id: uuid('id').primaryKey().defaultRandom(),
  company_id: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  cuit: varchar('cuit', { length: 20 }).notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  contact_name: varchar('contact_name', { length: 255 }),
  address: text('address'),
  city: varchar('city', { length: 100 }),
  province: varchar('province', { length: 100 }),
  postal_code: varchar('postal_code', { length: 10 }),
  phone: varchar('phone', { length: 20 }),
  email: varchar('email', { length: 100 }),
  tax_condition: varchar('tax_condition', { length: 50 }), // IVA, Monotributo, etc
  condicion_iva: integer('condicion_iva'), // AFIP CondicionIVAReceptorId (RG 5616)
  credit_limit: decimal('credit_limit', { precision: 12, scale: 2 }),
  payment_terms: integer('payment_terms'), // días
  status: varchar('status', { length: 50 }).default('active'), // active, inactive, suspended
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  cuitIdx: uniqueIndex('unique_customer_cuit').on(table.company_id, table.cuit),
}));

export const suppliers = pgTable('suppliers', {
  id: uuid('id').primaryKey().defaultRandom(),
  company_id: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  cuit: varchar('cuit', { length: 20 }).notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  contact_name: varchar('contact_name', { length: 255 }),
  address: text('address'),
  phone: varchar('phone', { length: 20 }),
  email: varchar('email', { length: 100 }),
  payment_terms: integer('payment_terms'),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  cuitIdx: uniqueIndex('unique_supplier_cuit').on(table.company_id, table.cuit),
}));

// ============ INVOICES ============

export const invoices = pgTable('invoices', {
  id: uuid('id').primaryKey().defaultRandom(),
  company_id: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  customer_id: uuid('customer_id').references(() => customers.id, { onDelete: 'set null' }),
  invoice_type: invoiceTypeEnum('invoice_type'), // A, B, C
  invoice_number: integer('invoice_number').notNull(),
  invoice_date: timestamp('invoice_date', { withTimezone: true }).notNull(),
  due_date: timestamp('due_date', { withTimezone: true }),
  subtotal: decimal('subtotal', { precision: 12, scale: 2 }).notNull(),
  vat_amount: decimal('vat_amount', { precision: 12, scale: 2 }).notNull(),
  total_amount: decimal('total_amount', { precision: 12, scale: 2 }).notNull(),
  cae: varchar('cae', { length: 20 }), // AFIP Authorization Code
  cae_expiry_date: timestamp('cae_expiry_date', { withTimezone: true }),
  qr_code: text('qr_code'),
  status: invoiceStatusEnum('status').default('draft'),
  afip_response: jsonb('afip_response'),
  created_by: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  invoiceNumberIdx: uniqueIndex('unique_invoice_number').on(table.company_id, table.invoice_type, table.invoice_number),
  dateIdx: index('invoices_date_idx').on(table.invoice_date),
  customerIdx: index('invoices_customer_idx').on(table.customer_id),
}));

export const invoice_items = pgTable('invoice_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  invoice_id: uuid('invoice_id').notNull().references(() => invoices.id, { onDelete: 'cascade' }),
  product_id: uuid('product_id').references(() => products.id, { onDelete: 'set null' }),
  product_name: varchar('product_name', { length: 255 }), // snapshot
  quantity: decimal('quantity', { precision: 12, scale: 2 }).notNull(),
  unit_price: decimal('unit_price', { precision: 12, scale: 2 }).notNull(),
  vat_rate: decimal('vat_rate', { precision: 5, scale: 2 }).notNull(),
  subtotal: decimal('subtotal', { precision: 12, scale: 2 }).notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

// ============ INVENTORY ============

export const warehouses = pgTable('warehouses', {
  id: uuid('id').primaryKey().defaultRandom(),
  company_id: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(),
  address: text('address'),
  active: boolean('active').default(true),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const stock = pgTable('stock', {
  id: uuid('id').primaryKey().defaultRandom(),
  product_id: uuid('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
  warehouse_id: uuid('warehouse_id').notNull().references(() => warehouses.id, { onDelete: 'cascade' }),
  quantity: decimal('quantity', { precision: 12, scale: 2 }).default('0'),
  min_level: decimal('min_level', { precision: 12, scale: 2 }).default('0'),
  max_level: decimal('max_level', { precision: 12, scale: 2 }).default('0'),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  uniqueIdx: uniqueIndex('unique_product_warehouse').on(table.product_id, table.warehouse_id),
}));

export const stock_movements = pgTable('stock_movements', {
  id: uuid('id').primaryKey().defaultRandom(),
  product_id: uuid('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
  warehouse_id: uuid('warehouse_id').notNull().references(() => warehouses.id, { onDelete: 'cascade' }),
  movement_type: stockMovementTypeEnum('movement_type'),
  quantity: decimal('quantity', { precision: 12, scale: 2 }).notNull(),
  reference_type: varchar('reference_type', { length: 50 }), // invoice, purchase_order, etc
  reference_id: uuid('reference_id'),
  notes: text('notes'),
  created_by: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  dateIdx: index('stock_movements_date_idx').on(table.created_at),
}));

// ============ PAYMENTS (Cobranzas) ============

export const payments = pgTable('payments', {
  id: uuid('id').primaryKey().defaultRandom(),
  invoice_id: uuid('invoice_id').notNull().references(() => invoices.id, { onDelete: 'cascade' }),
  amount: decimal('amount', { precision: 12, scale: 2 }).notNull(),
  method: paymentMethodEnum('method'),
  payment_date: timestamp('payment_date', { withTimezone: true }).notNull(),
  reference: varchar('reference', { length: 255 }), // cheque number, transfer ref, etc
  notes: text('notes'),
  created_by: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

// ============ AUDIT LOG ============

export const audit_log = pgTable('audit_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  company_id: uuid('company_id').references(() => companies.id, { onDelete: 'cascade' }),
  user_id: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  action: varchar('action', { length: 100 }).notNull(), // create, update, delete, etc
  resource: varchar('resource', { length: 100 }).notNull(), // products, invoices, etc
  resource_id: uuid('resource_id'),
  old_values: jsonb('old_values'),
  new_values: jsonb('new_values'),
  ip_address: varchar('ip_address', { length: 45 }),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  dateIdx: index('audit_log_date_idx').on(table.created_at),
  userIdx: index('audit_log_user_idx').on(table.user_id),
}));

// Type exports for use in queries
export type Company = typeof companies.$inferSelect;
export type User = typeof users.$inferSelect;
export type Product = typeof products.$inferSelect;
export type Customer = typeof customers.$inferSelect;
export type Invoice = typeof invoices.$inferSelect;
export type Stock = typeof stock.$inferSelect;
