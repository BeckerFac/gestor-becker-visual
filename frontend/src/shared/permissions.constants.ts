export const MODULES = {
  dashboard: 'dashboard',
  orders: 'orders',
  quotes: 'quotes',
  invoices: 'invoices',
  remitos: 'remitos',
  purchases: 'purchases',
  products: 'products',
  inventory: 'inventory',
  cobros: 'cobros',
  pagos: 'pagos',
  cuenta_corriente: 'cuenta_corriente',
  cheques: 'cheques',
  enterprises: 'enterprises',
  banks: 'banks',
  settings: 'settings',
  users: 'users',
  billing: 'billing',
  audit_log: 'audit_log',
} as const;

export type ModuleKey = keyof typeof MODULES;

export const ACTIONS = {
  view: 'view',
  create: 'create',
  edit: 'edit',
  delete: 'delete',
} as const;

export type ActionKey = keyof typeof ACTIONS;

// Role hierarchy: higher number = higher privilege
export const ROLE_HIERARCHY: Record<string, number> = {
  viewer: 1,
  editor: 2,
  vendedor: 2,
  contable: 2,
  stock_manager: 2,
  gerente: 3,
  admin: 4,
  owner: 5,
};

// Roles that have full access (no permission check needed)
export const FULL_ACCESS_ROLES = ['owner', 'admin'] as const;

// Spanish labels for the UI
export const MODULE_LABELS: Record<string, { label: string; section: string }> = {
  dashboard: { label: 'Dashboard', section: 'General' },
  orders: { label: 'Pedidos', section: 'Comercial' },
  quotes: { label: 'Cotizaciones', section: 'Comercial' },
  invoices: { label: 'Facturas', section: 'Comercial' },
  remitos: { label: 'Remitos', section: 'Comercial' },
  purchases: { label: 'Compras', section: 'Abastecimiento' },
  products: { label: 'Productos', section: 'Abastecimiento' },
  inventory: { label: 'Inventario', section: 'Abastecimiento' },
  cobros: { label: 'Cobros', section: 'Finanzas' },
  pagos: { label: 'Pagos', section: 'Finanzas' },
  cuenta_corriente: { label: 'Cuenta Corriente', section: 'Finanzas' },
  cheques: { label: 'Cheques', section: 'Finanzas' },
  enterprises: { label: 'Empresas', section: 'Directorio' },
  banks: { label: 'Bancos', section: 'Directorio' },
  settings: { label: 'Configuracion', section: 'Sistema' },
  users: { label: 'Usuarios', section: 'Sistema' },
  billing: { label: 'Facturacion/Planes', section: 'Sistema' },
  audit_log: { label: 'Registro de Auditoria', section: 'Sistema' },
};

export const ACTION_LABELS: Record<string, string> = {
  view: 'Ver',
  create: 'Crear',
  edit: 'Editar',
  delete: 'Eliminar',
};

// Which actions each module supports
export const MODULE_ACTIONS: Record<string, string[]> = {
  dashboard: ['view'],
  orders: ['view', 'create', 'edit', 'delete'],
  quotes: ['view', 'create', 'edit', 'delete'],
  invoices: ['view', 'create', 'edit', 'delete'],
  remitos: ['view', 'create', 'edit', 'delete'],
  purchases: ['view', 'create', 'edit', 'delete'],
  products: ['view', 'create', 'edit', 'delete'],
  inventory: ['view', 'create', 'edit'],
  cobros: ['view', 'create', 'delete'],
  pagos: ['view', 'create', 'delete'],
  cuenta_corriente: ['view'],
  cheques: ['view', 'create', 'edit', 'delete'],
  enterprises: ['view', 'create', 'edit', 'delete'],
  banks: ['view', 'create', 'edit', 'delete'],
  settings: ['view', 'edit'],
  users: ['view', 'create', 'edit', 'delete'],
  billing: ['view', 'edit'],
  audit_log: ['view'],
};

// Role templates
export const ROLE_TEMPLATES: Record<string, Record<string, string[]>> = {
  editor: {
    dashboard: ['view'],
    orders: ['view', 'create', 'edit', 'delete'],
    quotes: ['view', 'create', 'edit', 'delete'],
    invoices: ['view', 'create', 'edit', 'delete'],
    remitos: ['view', 'create', 'edit', 'delete'],
    purchases: ['view', 'create', 'edit', 'delete'],
    products: ['view', 'create', 'edit', 'delete'],
    inventory: ['view', 'create', 'edit'],
    cobros: ['view', 'create', 'delete'],
    pagos: ['view', 'create', 'delete'],
    cuenta_corriente: ['view'],
    cheques: ['view', 'create', 'edit', 'delete'],
    enterprises: ['view', 'create', 'edit', 'delete'],
    banks: ['view', 'create', 'edit', 'delete'],
  },
  vendedor: {
    dashboard: ['view'],
    orders: ['view', 'create', 'edit'],
    quotes: ['view', 'create', 'edit'],
    invoices: ['view'],
    remitos: ['view', 'create'],
    products: ['view'],
    inventory: ['view'],
    enterprises: ['view'],
  },
  contable: {
    dashboard: ['view'],
    invoices: ['view', 'create', 'edit', 'delete'],
    cobros: ['view', 'create', 'delete'],
    pagos: ['view', 'create', 'delete'],
    cuenta_corriente: ['view'],
    cheques: ['view', 'create', 'edit'],
    banks: ['view'],
    enterprises: ['view'],
    orders: ['view'],
  },
  stock_manager: {
    dashboard: ['view'],
    products: ['view', 'create', 'edit', 'delete'],
    inventory: ['view', 'create', 'edit'],
    purchases: ['view', 'create', 'edit', 'delete'],
    enterprises: ['view'],
  },
  gerente: {
    dashboard: ['view'],
    orders: ['view', 'create', 'edit', 'delete'],
    quotes: ['view', 'create', 'edit', 'delete'],
    invoices: ['view', 'create', 'edit', 'delete'],
    remitos: ['view', 'create', 'edit', 'delete'],
    purchases: ['view', 'create', 'edit', 'delete'],
    products: ['view', 'create', 'edit', 'delete'],
    inventory: ['view', 'create', 'edit'],
    cobros: ['view', 'create', 'delete'],
    pagos: ['view', 'create', 'delete'],
    cuenta_corriente: ['view'],
    cheques: ['view', 'create', 'edit', 'delete'],
    enterprises: ['view', 'create', 'edit', 'delete'],
    banks: ['view', 'create', 'edit', 'delete'],
    users: ['view'],
    audit_log: ['view'],
  },
  viewer: {
    dashboard: ['view'],
    orders: ['view'],
    quotes: ['view'],
    invoices: ['view'],
    remitos: ['view'],
    products: ['view'],
    inventory: ['view'],
    cobros: ['view'],
    pagos: ['view'],
    cuenta_corriente: ['view'],
    cheques: ['view'],
    enterprises: ['view'],
    banks: ['view'],
  },
};
