"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.audit_log = exports.payments = exports.stock_movements = exports.stock = exports.warehouses = exports.invoice_items = exports.invoices = exports.suppliers = exports.customers = exports.price_list_items = exports.price_lists = exports.product_pricing = exports.products = exports.brands = exports.categories = exports.sessions = exports.users = exports.companies = exports.paymentMethodEnum = exports.stockMovementTypeEnum = exports.invoiceStatusEnum = exports.invoiceTypeEnum = exports.userRoleEnum = void 0;
const pg_core_1 = require("drizzle-orm/pg-core");
// Enums
exports.userRoleEnum = (0, pg_core_1.pgEnum)('user_role', ['admin', 'gerente', 'vendedor', 'contable', 'viewer']);
exports.invoiceTypeEnum = (0, pg_core_1.pgEnum)('invoice_type', ['A', 'B', 'C']);
exports.invoiceStatusEnum = (0, pg_core_1.pgEnum)('invoice_status', ['draft', 'pending', 'authorized', 'cancelled']);
exports.stockMovementTypeEnum = (0, pg_core_1.pgEnum)('stock_movement_type', ['purchase', 'sale', 'adjustment', 'transfer', 'return_customer', 'return_supplier']);
exports.paymentMethodEnum = (0, pg_core_1.pgEnum)('payment_method', ['efectivo', 'tarjeta', 'cheque', 'transferencia', 'mixto']);
// ============ COMPANIES & USERS ============
exports.companies = (0, pg_core_1.pgTable)('companies', {
    id: (0, pg_core_1.uuid)('id').primaryKey().defaultRandom(),
    name: (0, pg_core_1.varchar)('name', { length: 255 }).notNull(),
    cuit: (0, pg_core_1.varchar)('cuit', { length: 20 }).notNull().unique(),
    address: (0, pg_core_1.text)('address'),
    city: (0, pg_core_1.varchar)('city', { length: 100 }),
    province: (0, pg_core_1.varchar)('province', { length: 100 }),
    logo_url: (0, pg_core_1.text)('logo_url'),
    phone: (0, pg_core_1.varchar)('phone', { length: 20 }),
    email: (0, pg_core_1.varchar)('email', { length: 100 }),
    afip_cert: (0, pg_core_1.text)('afip_cert'), // PEM encoded
    afip_key: (0, pg_core_1.text)('afip_key'), // PEM encoded
    afip_env: (0, pg_core_1.varchar)('afip_env', { length: 20 }).default('homologacion'), // homologacion or produccion
    created_at: (0, pg_core_1.timestamp)('created_at', { withTimezone: true }).defaultNow(),
    updated_at: (0, pg_core_1.timestamp)('updated_at', { withTimezone: true }).defaultNow(),
});
exports.users = (0, pg_core_1.pgTable)('users', {
    id: (0, pg_core_1.uuid)('id').primaryKey().defaultRandom(),
    company_id: (0, pg_core_1.uuid)('company_id').notNull().references(() => exports.companies.id, { onDelete: 'cascade' }),
    email: (0, pg_core_1.varchar)('email', { length: 100 }).notNull(),
    password_hash: (0, pg_core_1.varchar)('password_hash', { length: 255 }).notNull(),
    name: (0, pg_core_1.varchar)('name', { length: 255 }).notNull(),
    role: (0, exports.userRoleEnum)('role').default('viewer'),
    active: (0, pg_core_1.boolean)('active').default(true),
    last_login: (0, pg_core_1.timestamp)('last_login', { withTimezone: true }),
    created_at: (0, pg_core_1.timestamp)('created_at', { withTimezone: true }).defaultNow(),
    updated_at: (0, pg_core_1.timestamp)('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
    emailIdx: (0, pg_core_1.uniqueIndex)('unique_email_per_company').on(table.company_id, table.email),
}));
exports.sessions = (0, pg_core_1.pgTable)('sessions', {
    id: (0, pg_core_1.uuid)('id').primaryKey().defaultRandom(),
    user_id: (0, pg_core_1.uuid)('user_id').notNull().references(() => exports.users.id, { onDelete: 'cascade' }),
    refresh_token: (0, pg_core_1.varchar)('refresh_token', { length: 500 }).notNull(),
    expires_at: (0, pg_core_1.timestamp)('expires_at', { withTimezone: true }).notNull(),
    created_at: (0, pg_core_1.timestamp)('created_at', { withTimezone: true }).defaultNow(),
});
// ============ PRODUCTS & PRICING ============
exports.categories = (0, pg_core_1.pgTable)('categories', {
    id: (0, pg_core_1.uuid)('id').primaryKey().defaultRandom(),
    company_id: (0, pg_core_1.uuid)('company_id').notNull().references(() => exports.companies.id, { onDelete: 'cascade' }),
    name: (0, pg_core_1.varchar)('name', { length: 255 }).notNull(),
    description: (0, pg_core_1.text)('description'),
    parent_id: (0, pg_core_1.uuid)('parent_id'),
    active: (0, pg_core_1.boolean)('active').default(true),
    created_at: (0, pg_core_1.timestamp)('created_at', { withTimezone: true }).defaultNow(),
    updated_at: (0, pg_core_1.timestamp)('updated_at', { withTimezone: true }).defaultNow(),
});
exports.brands = (0, pg_core_1.pgTable)('brands', {
    id: (0, pg_core_1.uuid)('id').primaryKey().defaultRandom(),
    company_id: (0, pg_core_1.uuid)('company_id').notNull().references(() => exports.companies.id, { onDelete: 'cascade' }),
    name: (0, pg_core_1.varchar)('name', { length: 255 }).notNull(),
    created_at: (0, pg_core_1.timestamp)('created_at', { withTimezone: true }).defaultNow(),
});
exports.products = (0, pg_core_1.pgTable)('products', {
    id: (0, pg_core_1.uuid)('id').primaryKey().defaultRandom(),
    company_id: (0, pg_core_1.uuid)('company_id').notNull().references(() => exports.companies.id, { onDelete: 'cascade' }),
    sku: (0, pg_core_1.varchar)('sku', { length: 100 }).notNull(),
    barcode: (0, pg_core_1.varchar)('barcode', { length: 50 }),
    name: (0, pg_core_1.varchar)('name', { length: 255 }).notNull(),
    description: (0, pg_core_1.text)('description'),
    category_id: (0, pg_core_1.uuid)('category_id').references(() => exports.categories.id, { onDelete: 'set null' }),
    brand_id: (0, pg_core_1.uuid)('brand_id').references(() => exports.brands.id, { onDelete: 'set null' }),
    image_url: (0, pg_core_1.text)('image_url'),
    active: (0, pg_core_1.boolean)('active').default(true),
    created_at: (0, pg_core_1.timestamp)('created_at', { withTimezone: true }).defaultNow(),
    updated_at: (0, pg_core_1.timestamp)('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
    skuIdx: (0, pg_core_1.uniqueIndex)('unique_sku_per_company').on(table.company_id, table.sku),
    categoryIdx: (0, pg_core_1.index)('products_category_idx').on(table.category_id),
}));
exports.product_pricing = (0, pg_core_1.pgTable)('product_pricing', {
    id: (0, pg_core_1.uuid)('id').primaryKey().defaultRandom(),
    product_id: (0, pg_core_1.uuid)('product_id').notNull().references(() => exports.products.id, { onDelete: 'cascade' }),
    cost: (0, pg_core_1.decimal)('cost', { precision: 12, scale: 2 }).notNull(),
    margin_percent: (0, pg_core_1.decimal)('margin_percent', { precision: 5, scale: 2 }).default('30'),
    vat_rate: (0, pg_core_1.decimal)('vat_rate', { precision: 5, scale: 2 }).default('21'), // 0, 2.5, 10.5, 21
    final_price: (0, pg_core_1.decimal)('final_price', { precision: 12, scale: 2 }).notNull(),
    created_at: (0, pg_core_1.timestamp)('created_at', { withTimezone: true }).defaultNow(),
    updated_at: (0, pg_core_1.timestamp)('updated_at', { withTimezone: true }).defaultNow(),
});
exports.price_lists = (0, pg_core_1.pgTable)('price_lists', {
    id: (0, pg_core_1.uuid)('id').primaryKey().defaultRandom(),
    company_id: (0, pg_core_1.uuid)('company_id').notNull().references(() => exports.companies.id, { onDelete: 'cascade' }),
    name: (0, pg_core_1.varchar)('name', { length: 255 }).notNull(),
    type: (0, pg_core_1.varchar)('type', { length: 50 }).default('default'), // default, customer, channel, promo
    valid_from: (0, pg_core_1.timestamp)('valid_from', { withTimezone: true }),
    valid_to: (0, pg_core_1.timestamp)('valid_to', { withTimezone: true }),
    active: (0, pg_core_1.boolean)('active').default(true),
    created_at: (0, pg_core_1.timestamp)('created_at', { withTimezone: true }).defaultNow(),
    updated_at: (0, pg_core_1.timestamp)('updated_at', { withTimezone: true }).defaultNow(),
});
exports.price_list_items = (0, pg_core_1.pgTable)('price_list_items', {
    id: (0, pg_core_1.uuid)('id').primaryKey().defaultRandom(),
    price_list_id: (0, pg_core_1.uuid)('price_list_id').notNull().references(() => exports.price_lists.id, { onDelete: 'cascade' }),
    product_id: (0, pg_core_1.uuid)('product_id').notNull().references(() => exports.products.id, { onDelete: 'cascade' }),
    price: (0, pg_core_1.decimal)('price', { precision: 12, scale: 2 }).notNull(),
    discount_percent: (0, pg_core_1.decimal)('discount_percent', { precision: 5, scale: 2 }).default('0'),
    created_at: (0, pg_core_1.timestamp)('created_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
    uniqueIdx: (0, pg_core_1.uniqueIndex)('unique_price_list_item').on(table.price_list_id, table.product_id),
}));
// ============ CUSTOMERS & SUPPLIERS ============
exports.customers = (0, pg_core_1.pgTable)('customers', {
    id: (0, pg_core_1.uuid)('id').primaryKey().defaultRandom(),
    company_id: (0, pg_core_1.uuid)('company_id').notNull().references(() => exports.companies.id, { onDelete: 'cascade' }),
    cuit: (0, pg_core_1.varchar)('cuit', { length: 20 }).notNull(),
    name: (0, pg_core_1.varchar)('name', { length: 255 }).notNull(),
    contact_name: (0, pg_core_1.varchar)('contact_name', { length: 255 }),
    address: (0, pg_core_1.text)('address'),
    city: (0, pg_core_1.varchar)('city', { length: 100 }),
    province: (0, pg_core_1.varchar)('province', { length: 100 }),
    postal_code: (0, pg_core_1.varchar)('postal_code', { length: 10 }),
    phone: (0, pg_core_1.varchar)('phone', { length: 20 }),
    email: (0, pg_core_1.varchar)('email', { length: 100 }),
    tax_condition: (0, pg_core_1.varchar)('tax_condition', { length: 50 }), // IVA, Monotributo, etc
    credit_limit: (0, pg_core_1.decimal)('credit_limit', { precision: 12, scale: 2 }),
    payment_terms: (0, pg_core_1.integer)('payment_terms'), // días
    status: (0, pg_core_1.varchar)('status', { length: 50 }).default('active'), // active, inactive, suspended
    created_at: (0, pg_core_1.timestamp)('created_at', { withTimezone: true }).defaultNow(),
    updated_at: (0, pg_core_1.timestamp)('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
    cuitIdx: (0, pg_core_1.uniqueIndex)('unique_customer_cuit').on(table.company_id, table.cuit),
}));
exports.suppliers = (0, pg_core_1.pgTable)('suppliers', {
    id: (0, pg_core_1.uuid)('id').primaryKey().defaultRandom(),
    company_id: (0, pg_core_1.uuid)('company_id').notNull().references(() => exports.companies.id, { onDelete: 'cascade' }),
    cuit: (0, pg_core_1.varchar)('cuit', { length: 20 }).notNull(),
    name: (0, pg_core_1.varchar)('name', { length: 255 }).notNull(),
    contact_name: (0, pg_core_1.varchar)('contact_name', { length: 255 }),
    address: (0, pg_core_1.text)('address'),
    phone: (0, pg_core_1.varchar)('phone', { length: 20 }),
    email: (0, pg_core_1.varchar)('email', { length: 100 }),
    payment_terms: (0, pg_core_1.integer)('payment_terms'),
    created_at: (0, pg_core_1.timestamp)('created_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
    cuitIdx: (0, pg_core_1.uniqueIndex)('unique_supplier_cuit').on(table.company_id, table.cuit),
}));
// ============ INVOICES ============
exports.invoices = (0, pg_core_1.pgTable)('invoices', {
    id: (0, pg_core_1.uuid)('id').primaryKey().defaultRandom(),
    company_id: (0, pg_core_1.uuid)('company_id').notNull().references(() => exports.companies.id, { onDelete: 'cascade' }),
    customer_id: (0, pg_core_1.uuid)('customer_id').references(() => exports.customers.id, { onDelete: 'set null' }),
    invoice_type: (0, exports.invoiceTypeEnum)('invoice_type'), // A, B, C
    invoice_number: (0, pg_core_1.integer)('invoice_number').notNull(),
    invoice_date: (0, pg_core_1.timestamp)('invoice_date', { withTimezone: true }).notNull(),
    due_date: (0, pg_core_1.timestamp)('due_date', { withTimezone: true }),
    subtotal: (0, pg_core_1.decimal)('subtotal', { precision: 12, scale: 2 }).notNull(),
    vat_amount: (0, pg_core_1.decimal)('vat_amount', { precision: 12, scale: 2 }).notNull(),
    total_amount: (0, pg_core_1.decimal)('total_amount', { precision: 12, scale: 2 }).notNull(),
    cae: (0, pg_core_1.varchar)('cae', { length: 20 }), // AFIP Authorization Code
    cae_expiry_date: (0, pg_core_1.timestamp)('cae_expiry_date', { withTimezone: true }),
    qr_code: (0, pg_core_1.text)('qr_code'),
    status: (0, exports.invoiceStatusEnum)('status').default('draft'),
    afip_response: (0, pg_core_1.jsonb)('afip_response'),
    created_by: (0, pg_core_1.uuid)('created_by').references(() => exports.users.id, { onDelete: 'set null' }),
    created_at: (0, pg_core_1.timestamp)('created_at', { withTimezone: true }).defaultNow(),
    updated_at: (0, pg_core_1.timestamp)('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
    invoiceNumberIdx: (0, pg_core_1.uniqueIndex)('unique_invoice_number').on(table.company_id, table.invoice_type, table.invoice_number),
    dateIdx: (0, pg_core_1.index)('invoices_date_idx').on(table.invoice_date),
    customerIdx: (0, pg_core_1.index)('invoices_customer_idx').on(table.customer_id),
}));
exports.invoice_items = (0, pg_core_1.pgTable)('invoice_items', {
    id: (0, pg_core_1.uuid)('id').primaryKey().defaultRandom(),
    invoice_id: (0, pg_core_1.uuid)('invoice_id').notNull().references(() => exports.invoices.id, { onDelete: 'cascade' }),
    product_id: (0, pg_core_1.uuid)('product_id').references(() => exports.products.id, { onDelete: 'set null' }),
    product_name: (0, pg_core_1.varchar)('product_name', { length: 255 }), // snapshot
    quantity: (0, pg_core_1.decimal)('quantity', { precision: 12, scale: 2 }).notNull(),
    unit_price: (0, pg_core_1.decimal)('unit_price', { precision: 12, scale: 2 }).notNull(),
    vat_rate: (0, pg_core_1.decimal)('vat_rate', { precision: 5, scale: 2 }).notNull(),
    subtotal: (0, pg_core_1.decimal)('subtotal', { precision: 12, scale: 2 }).notNull(),
    created_at: (0, pg_core_1.timestamp)('created_at', { withTimezone: true }).defaultNow(),
});
// ============ INVENTORY ============
exports.warehouses = (0, pg_core_1.pgTable)('warehouses', {
    id: (0, pg_core_1.uuid)('id').primaryKey().defaultRandom(),
    company_id: (0, pg_core_1.uuid)('company_id').notNull().references(() => exports.companies.id, { onDelete: 'cascade' }),
    name: (0, pg_core_1.varchar)('name', { length: 255 }).notNull(),
    address: (0, pg_core_1.text)('address'),
    active: (0, pg_core_1.boolean)('active').default(true),
    created_at: (0, pg_core_1.timestamp)('created_at', { withTimezone: true }).defaultNow(),
});
exports.stock = (0, pg_core_1.pgTable)('stock', {
    id: (0, pg_core_1.uuid)('id').primaryKey().defaultRandom(),
    product_id: (0, pg_core_1.uuid)('product_id').notNull().references(() => exports.products.id, { onDelete: 'cascade' }),
    warehouse_id: (0, pg_core_1.uuid)('warehouse_id').notNull().references(() => exports.warehouses.id, { onDelete: 'cascade' }),
    quantity: (0, pg_core_1.decimal)('quantity', { precision: 12, scale: 2 }).default('0'),
    min_level: (0, pg_core_1.decimal)('min_level', { precision: 12, scale: 2 }).default('0'),
    max_level: (0, pg_core_1.decimal)('max_level', { precision: 12, scale: 2 }).default('0'),
    updated_at: (0, pg_core_1.timestamp)('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
    uniqueIdx: (0, pg_core_1.uniqueIndex)('unique_product_warehouse').on(table.product_id, table.warehouse_id),
}));
exports.stock_movements = (0, pg_core_1.pgTable)('stock_movements', {
    id: (0, pg_core_1.uuid)('id').primaryKey().defaultRandom(),
    product_id: (0, pg_core_1.uuid)('product_id').notNull().references(() => exports.products.id, { onDelete: 'cascade' }),
    warehouse_id: (0, pg_core_1.uuid)('warehouse_id').notNull().references(() => exports.warehouses.id, { onDelete: 'cascade' }),
    movement_type: (0, exports.stockMovementTypeEnum)('movement_type'),
    quantity: (0, pg_core_1.decimal)('quantity', { precision: 12, scale: 2 }).notNull(),
    reference_type: (0, pg_core_1.varchar)('reference_type', { length: 50 }), // invoice, purchase_order, etc
    reference_id: (0, pg_core_1.uuid)('reference_id'),
    notes: (0, pg_core_1.text)('notes'),
    created_by: (0, pg_core_1.uuid)('created_by').references(() => exports.users.id, { onDelete: 'set null' }),
    created_at: (0, pg_core_1.timestamp)('created_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
    dateIdx: (0, pg_core_1.index)('stock_movements_date_idx').on(table.created_at),
}));
// ============ PAYMENTS (Cobranzas) ============
exports.payments = (0, pg_core_1.pgTable)('payments', {
    id: (0, pg_core_1.uuid)('id').primaryKey().defaultRandom(),
    invoice_id: (0, pg_core_1.uuid)('invoice_id').notNull().references(() => exports.invoices.id, { onDelete: 'cascade' }),
    amount: (0, pg_core_1.decimal)('amount', { precision: 12, scale: 2 }).notNull(),
    method: (0, exports.paymentMethodEnum)('method'),
    payment_date: (0, pg_core_1.timestamp)('payment_date', { withTimezone: true }).notNull(),
    reference: (0, pg_core_1.varchar)('reference', { length: 255 }), // cheque number, transfer ref, etc
    notes: (0, pg_core_1.text)('notes'),
    created_by: (0, pg_core_1.uuid)('created_by').references(() => exports.users.id, { onDelete: 'set null' }),
    created_at: (0, pg_core_1.timestamp)('created_at', { withTimezone: true }).defaultNow(),
});
// ============ AUDIT LOG ============
exports.audit_log = (0, pg_core_1.pgTable)('audit_log', {
    id: (0, pg_core_1.uuid)('id').primaryKey().defaultRandom(),
    company_id: (0, pg_core_1.uuid)('company_id').references(() => exports.companies.id, { onDelete: 'cascade' }),
    user_id: (0, pg_core_1.uuid)('user_id').references(() => exports.users.id, { onDelete: 'set null' }),
    action: (0, pg_core_1.varchar)('action', { length: 100 }).notNull(), // create, update, delete, etc
    resource: (0, pg_core_1.varchar)('resource', { length: 100 }).notNull(), // products, invoices, etc
    resource_id: (0, pg_core_1.uuid)('resource_id'),
    old_values: (0, pg_core_1.jsonb)('old_values'),
    new_values: (0, pg_core_1.jsonb)('new_values'),
    ip_address: (0, pg_core_1.varchar)('ip_address', { length: 45 }),
    created_at: (0, pg_core_1.timestamp)('created_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
    dateIdx: (0, pg_core_1.index)('audit_log_date_idx').on(table.created_at),
    userIdx: (0, pg_core_1.index)('audit_log_user_idx').on(table.user_id),
}));
//# sourceMappingURL=schema.js.map