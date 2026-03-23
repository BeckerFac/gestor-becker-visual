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
export const userRoleEnum = pgEnum('user_role', ['owner', 'admin', 'gerente', 'editor', 'vendedor', 'contable', 'viewer']);
export const invoiceTypeEnum = pgEnum('invoice_type', ['A', 'B', 'C']);
export const invoiceStatusEnum = pgEnum('invoice_status', ['draft', 'pending', 'authorized', 'cancelled']);
export const stockMovementTypeEnum = pgEnum('stock_movement_type', ['purchase', 'sale', 'adjustment', 'transfer', 'return_customer', 'return_supplier']);
export const paymentMethodEnum = pgEnum('payment_method', ['efectivo', 'tarjeta', 'cheque', 'transferencia', 'mixto']);

// ============ COMPANIES & USERS ============

export const subscriptionStatusEnum = pgEnum('subscription_status', ['trial', 'active', 'grace', 'expired', 'cancelled']);

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
  // CBU for FCE MiPyME
  cbu: varchar('cbu', { length: 22 }),
  cbu_alias: varchar('cbu_alias', { length: 50 }),
  // Subscription / trial fields
  subscription_status: subscriptionStatusEnum('subscription_status').default('trial'),
  trial_ends_at: timestamp('trial_ends_at', { withTimezone: true }),
  grace_ends_at: timestamp('grace_ends_at', { withTimezone: true }),
  subscription_plan: varchar('subscription_plan', { length: 50 }),
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
  email_verified: boolean('email_verified').default(false),
  email_verification_token: varchar('email_verification_token', { length: 255 }),
  email_verification_expires: timestamp('email_verification_expires', { withTimezone: true }),
  password_reset_token: varchar('password_reset_token', { length: 255 }),
  password_reset_expires: timestamp('password_reset_expires', { withTimezone: true }),
  last_login: timestamp('last_login', { withTimezone: true }),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  emailIdx: uniqueIndex('unique_email_per_company').on(table.company_id, table.email),
}));

export const invitationStatusEnum = pgEnum('invitation_status', ['pending', 'accepted', 'expired', 'revoked']);

export const invitations = pgTable('invitations', {
  id: uuid('id').primaryKey().defaultRandom(),
  company_id: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  email: varchar('email', { length: 100 }).notNull(),
  role: userRoleEnum('role').default('viewer'),
  token: varchar('token', { length: 255 }).notNull().unique(),
  status: invitationStatusEnum('status').default('pending'),
  invited_by: uuid('invited_by').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expires_at: timestamp('expires_at', { withTimezone: true }).notNull(),
  accepted_at: timestamp('accepted_at', { withTimezone: true }),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  emailCompanyIdx: uniqueIndex('unique_invitation_email_company').on(table.company_id, table.email),
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
  // FCE MiPyME fields
  is_fce: boolean('is_fce').default(false),
  fce_payment_due_date: timestamp('fce_payment_due_date'),
  fce_cbu: varchar('fce_cbu', { length: 22 }),
  fce_status: varchar('fce_status', { length: 20 }).default('pendiente'),
  // Export invoice (Tipo E) fields
  export_type: varchar('export_type', { length: 20 }),
  destination_country: varchar('destination_country', { length: 5 }),
  incoterms: varchar('incoterms', { length: 10 }),
  export_permit: varchar('export_permit', { length: 50 }),
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

// ============ RECURRING INVOICES (Abonos) ============

export const recurring_invoices = pgTable('recurring_invoices', {
  id: uuid('id').primaryKey().defaultRandom(),
  company_id: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  enterprise_id: uuid('enterprise_id'), // References enterprises(id) - FK added at runtime
  customer_id: uuid('customer_id').references(() => customers.id),
  invoice_type: varchar('invoice_type', { length: 5 }).notNull(), // 'A', 'B', 'C'
  frequency: varchar('frequency', { length: 20 }).notNull().default('monthly'), // monthly, weekly, biweekly, quarterly, yearly
  amount: decimal('amount', { precision: 12, scale: 2 }).notNull(),
  description: text('description'),
  next_invoice_date: timestamp('next_invoice_date').notNull(),
  end_date: timestamp('end_date'),
  active: boolean('active').default(true),
  auto_authorize: boolean('auto_authorize').default(false),
  items: jsonb('items'), // [{product_id, quantity, unit_price, vat_rate}]
  created_by: uuid('created_by').references(() => users.id),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

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

// ============ BUSINESS UNITS (Razones Sociales) ============

export const business_units = pgTable('business_units', {
  id: uuid('id').primaryKey().defaultRandom(),
  company_id: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(),
  is_fiscal: boolean('is_fiscal').default(false),
  cuit: varchar('cuit', { length: 20 }),
  address: text('address'),
  iibb_number: varchar('iibb_number', { length: 30 }),
  afip_start_date: timestamp('afip_start_date', { withTimezone: true }),
  sort_order: integer('sort_order').default(0),
  active: boolean('active').default(true),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  created_by: uuid('created_by'),
}, (table) => ({
  uniqueNamePerCompany: uniqueIndex('unique_bu_name_per_company').on(table.company_id, table.name),
  companyIdx: index('business_units_company_idx').on(table.company_id),
}));

// ============ PURCHASE INVOICES (Facturas de Compra) ============

export const purchase_invoices = pgTable('purchase_invoices', {
  id: uuid('id').primaryKey().defaultRandom(),
  company_id: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  business_unit_id: uuid('business_unit_id').notNull(),
  enterprise_id: uuid('enterprise_id').notNull(),
  purchase_id: uuid('purchase_id'), // nullable: can be standalone (services, rent, etc.)
  invoice_type: varchar('invoice_type', { length: 5 }).notNull(), // 'A', 'B', 'C'
  punto_venta: varchar('punto_venta', { length: 10 }),
  invoice_number: varchar('invoice_number', { length: 50 }).notNull(),
  invoice_date: timestamp('invoice_date', { withTimezone: true }).notNull(),
  cae: varchar('cae', { length: 20 }),
  cae_expiry_date: timestamp('cae_expiry_date', { withTimezone: true }),
  subtotal: decimal('subtotal', { precision: 12, scale: 2 }).notNull().default('0'),
  vat_amount: decimal('vat_amount', { precision: 12, scale: 2 }).notNull().default('0'),
  other_taxes: decimal('other_taxes', { precision: 12, scale: 2 }).default('0'),
  total_amount: decimal('total_amount', { precision: 12, scale: 2 }).notNull(),
  payment_status: varchar('payment_status', { length: 20 }).default('pendiente'),
  status: varchar('status', { length: 20 }).default('active'),
  notes: text('notes'),
  created_by: uuid('created_by'),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  companyBuIdx: index('pi_company_bu_idx').on(table.company_id, table.business_unit_id),
  enterpriseIdx: index('pi_enterprise_idx').on(table.enterprise_id),
  purchaseIdx: index('pi_purchase_idx').on(table.purchase_id),
  paymentStatusIdx: index('pi_payment_status_idx').on(table.company_id, table.payment_status),
}));

// ============ COBRO ↔ INVOICE APPLICATIONS (N:N) ============

export const cobro_invoice_applications = pgTable('cobro_invoice_applications', {
  id: uuid('id').primaryKey().defaultRandom(),
  cobro_id: uuid('cobro_id').notNull(),
  invoice_id: uuid('invoice_id').notNull().references(() => invoices.id, { onDelete: 'cascade' }),
  amount_applied: decimal('amount_applied', { precision: 12, scale: 2 }).notNull(),
  applied_at: timestamp('applied_at', { withTimezone: true }).defaultNow(),
  created_by: uuid('created_by'),
  notes: text('notes'),
}, (table) => ({
  uniqueCobroInvoice: uniqueIndex('unique_cobro_invoice').on(table.cobro_id, table.invoice_id),
  cobroIdx: index('cia_cobro_idx').on(table.cobro_id),
  invoiceIdx: index('cia_invoice_idx').on(table.invoice_id),
}));

// ============ PAGO ↔ PURCHASE INVOICE APPLICATIONS (N:N) ============

export const pago_invoice_applications = pgTable('pago_invoice_applications', {
  id: uuid('id').primaryKey().defaultRandom(),
  pago_id: uuid('pago_id').notNull(),
  purchase_invoice_id: uuid('purchase_invoice_id').notNull().references(() => purchase_invoices.id, { onDelete: 'cascade' }),
  amount_applied: decimal('amount_applied', { precision: 12, scale: 2 }).notNull(),
  applied_at: timestamp('applied_at', { withTimezone: true }).defaultNow(),
  created_by: uuid('created_by'),
}, (table) => ({
  uniquePagoPurchaseInvoice: uniqueIndex('unique_pago_purchase_invoice').on(table.pago_id, table.purchase_invoice_id),
  pagoIdx: index('pia_pago_idx').on(table.pago_id),
  purchaseInvoiceIdx: index('pia_purchase_invoice_idx').on(table.purchase_invoice_id),
}));

// Type exports for use in queries
export type Company = typeof companies.$inferSelect;
export type User = typeof users.$inferSelect;
export type Product = typeof products.$inferSelect;
export type Customer = typeof customers.$inferSelect;
export type Invoice = typeof invoices.$inferSelect;
export type Stock = typeof stock.$inferSelect;
export type Invitation = typeof invitations.$inferSelect;
export type BusinessUnit = typeof business_units.$inferSelect;
export type PurchaseInvoice = typeof purchase_invoices.$inferSelect;
export type CobroInvoiceApplication = typeof cobro_invoice_applications.$inferSelect;
export type PagoInvoiceApplication = typeof pago_invoice_applications.$inferSelect;
