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

// Sub-actions per module for granular control
export const SUB_ACTIONS: Record<string, { key: string; label: string; description: string }[]> = {
  orders: [
    { key: 'view_costs', label: 'Ver costos/margen', description: 'Puede ver el costo y margen de los productos en pedidos' },
    { key: 'change_status', label: 'Cambiar estado', description: 'Puede cambiar el estado del pedido (pendiente, produccion, entregado)' },
    { key: 'authorize_discount', label: 'Autorizar descuentos', description: 'Puede autorizar descuentos mayores al limite configurado' },
  ],
  invoices: [
    { key: 'authorize_afip', label: 'Autorizar AFIP', description: 'Puede autorizar facturas con AFIP (separado de crear borrador)' },
    { key: 'import_manual', label: 'Importar manual', description: 'Puede importar facturas manuales ya autorizadas' },
    { key: 'download_pdf', label: 'Descargar PDF', description: 'Puede descargar PDF de facturas autorizadas' },
  ],
  products: [
    { key: 'view_costs', label: 'Ver costos/margen', description: 'Puede ver el costo y margen de los productos' },
    { key: 'edit_prices', label: 'Modificar precios', description: 'Puede modificar precios (separado de editar producto)' },
    { key: 'manage_categories', label: 'Gestionar categorias', description: 'Puede crear, editar y eliminar categorias' },
    { key: 'manage_materials', label: 'Gestionar materiales', description: 'Puede gestionar materiales y BOM' },
  ],
  cobros: [
    { key: 'send_reminders', label: 'Enviar recordatorios', description: 'Puede enviar recordatorios de cobro a clientes' },
  ],
  reports: [
    { key: 'view_financial', label: 'Ver reportes financieros', description: 'Puede ver reportes financieros (IVA, flujo de caja)' },
    { key: 'view_business', label: 'Ver reportes de negocio', description: 'Puede ver reportes de negocio (ventas, rentabilidad)' },
    { key: 'export_data', label: 'Exportar datos', description: 'Puede exportar datos en CSV/Excel' },
  ],
  crm: [
    { key: 'manage_stages', label: 'Configurar etapas', description: 'Puede configurar las etapas del pipeline de oportunidades' },
    { key: 'close_deals', label: 'Cerrar oportunidades', description: 'Puede cerrar o marcar como perdidas las oportunidades' },
  ],
  secretaria: [
    { key: 'configure', label: 'Configurar SecretarIA', description: 'Puede configurar la inteligencia artificial del asistente' },
    { key: 'use_chat', label: 'Usar chat IA', description: 'Puede usar el chat de inteligencia artificial' },
  ],
};

// All sub-action keys for validation
export const ALL_SUB_ACTION_KEYS: Set<string> = new Set(
  Object.entries(SUB_ACTIONS).flatMap(([mod, actions]) =>
    actions.map(a => `${mod}:${a.key}`)
  )
);

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
  cobros: { label: 'Recibos', section: 'Finanzas' },
  pagos: { label: 'Ordenes de Pago', section: 'Finanzas' },
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
    // Sub-actions
    'orders:view_costs': ['allowed'],
    'orders:change_status': ['allowed'],
    'invoices:authorize_afip': ['allowed'],
    'invoices:import_manual': ['allowed'],
    'invoices:download_pdf': ['allowed'],
    'products:view_costs': ['allowed'],
    'products:edit_prices': ['allowed'],
    'products:manage_categories': ['allowed'],
    'products:manage_materials': ['allowed'],
    'cobros:send_reminders': ['allowed'],
    'reports:view_business': ['allowed'],
    'reports:export_data': ['allowed'],
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
    // Sub-actions: vendedor NO ve costos, NO autoriza AFIP, NO ve financieros
    'orders:change_status': ['allowed'],
    'invoices:download_pdf': ['allowed'],
    'reports:view_business': ['allowed'],
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
    // Sub-actions: contable SI autoriza AFIP, SI ve financieros, NO cambia estado pedido
    'orders:view_costs': ['allowed'],
    'invoices:authorize_afip': ['allowed'],
    'invoices:import_manual': ['allowed'],
    'invoices:download_pdf': ['allowed'],
    'products:view_costs': ['allowed'],
    'cobros:send_reminders': ['allowed'],
    'reports:view_financial': ['allowed'],
    'reports:view_business': ['allowed'],
    'reports:export_data': ['allowed'],
  },
  stock_manager: {
    dashboard: ['view'],
    products: ['view', 'create', 'edit', 'delete'],
    inventory: ['view', 'create', 'edit'],
    purchases: ['view', 'create', 'edit', 'delete'],
    enterprises: ['view'],
    // Sub-actions
    'products:view_costs': ['allowed'],
    'products:edit_prices': ['allowed'],
    'products:manage_categories': ['allowed'],
    'products:manage_materials': ['allowed'],
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
    // Sub-actions: gerente tiene todo habilitado
    'orders:view_costs': ['allowed'],
    'orders:change_status': ['allowed'],
    'orders:authorize_discount': ['allowed'],
    'invoices:authorize_afip': ['allowed'],
    'invoices:import_manual': ['allowed'],
    'invoices:download_pdf': ['allowed'],
    'products:view_costs': ['allowed'],
    'products:edit_prices': ['allowed'],
    'products:manage_categories': ['allowed'],
    'products:manage_materials': ['allowed'],
    'cobros:send_reminders': ['allowed'],
    'reports:view_financial': ['allowed'],
    'reports:view_business': ['allowed'],
    'reports:export_data': ['allowed'],
    'crm:manage_stages': ['allowed'],
    'crm:close_deals': ['allowed'],
    'secretaria:configure': ['allowed'],
    'secretaria:use_chat': ['allowed'],
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
    // Sub-actions: viewer solo lectura, sin sub-acciones de escritura
    'invoices:download_pdf': ['allowed'],
    'reports:view_business': ['allowed'],
  },
};
