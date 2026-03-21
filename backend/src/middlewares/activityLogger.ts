// Middleware that automatically logs POST/PUT/PATCH/DELETE requests as activity
import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth';
import { activityService } from '../modules/activity/activity.service';

// Map route patterns to module names
const ROUTE_MODULE_MAP: Record<string, string> = {
  '/api/orders': 'orders',
  '/api/invoices': 'invoices',
  '/api/products': 'products',
  '/api/quotes': 'quotes',
  '/api/remitos': 'remitos',
  '/api/purchases': 'purchases',
  '/api/cobros': 'cobros',
  '/api/receipts': 'cobros',
  '/api/pagos': 'pagos',
  '/api/cheques': 'cheques',
  '/api/enterprises': 'enterprises',
  '/api/banks': 'banks',
  '/api/users': 'users',
  '/api/inventory': 'inventory',
  '/api/materials': 'materials',
  '/api/crm': 'crm',
  '/api/billing': 'billing',
  '/api/secretaria': 'secretaria',
  '/api/cuenta-corriente': 'cuenta_corriente',
  '/api/onboarding': 'settings',
  '/api/portal': 'portal',
};

const METHOD_ACTION_MAP: Record<string, string> = {
  POST: 'create',
  PUT: 'update',
  PATCH: 'update',
  DELETE: 'delete',
};

// Module-specific enrichment functions for human-readable descriptions
const DESCRIPTION_ENRICHERS: Record<string, (body: any, action: string, userName: string) => string> = {
  orders: (body, action, userName) => {
    const order = body.order || body;
    const num = order.order_number ? `#${String(order.order_number).padStart(4, '0')}` : '';
    const enterprise = order.enterprise_name || order.customer_name || '';
    const total = order.total_amount ? `$${Number(order.total_amount).toLocaleString('es-AR')}` : '';
    if (action === 'create') return `${userName} creo pedido ${num} ${enterprise ? 'para ' + enterprise : ''} ${total ? 'por ' + total : ''}`.trim();
    if (action === 'update') return `${userName} modifico pedido ${num}`;
    if (action === 'delete') return `${userName} elimino pedido ${num}`;
    return `${userName} ${action} pedido ${num}`;
  },
  invoices: (body, action, userName) => {
    const inv = body.invoice || body;
    const tipo = inv.invoice_type || '';
    const num = inv.invoice_number ? String(inv.invoice_number).padStart(8, '0') : '';
    const pv = inv.punto_venta ? String(inv.punto_venta).padStart(5, '0') : '';
    const fullNum = pv && num ? `${tipo} ${pv}-${num}` : '';
    const cae = inv.cae || '';
    if (action === 'create') return `${userName} creo factura ${fullNum}`;
    if (cae) return `${userName} autorizo factura ${fullNum} — CAE: ${cae}`;
    return `${userName} ${action} factura ${fullNum}`;
  },
  products: (body, action, userName) => {
    const prod = body.product || body;
    const name = prod.name || '';
    const sku = prod.sku || '';
    if (action === 'create') return `${userName} creo producto ${name} (${sku})`;
    if (action === 'update') return `${userName} modifico producto ${name}`;
    if (action === 'delete') return `${userName} elimino producto ${name}`;
    return `${userName} ${action} producto ${name}`;
  },
  cobros: (body, action, userName) => {
    const receipt = body.receipt || body.cobro || body;
    const amount = receipt.amount ? `$${Number(receipt.amount).toLocaleString('es-AR')}` : '';
    const method = receipt.payment_method || '';
    if (action === 'create') return `${userName} registro cobro ${amount} ${method ? 'por ' + method : ''}`.trim();
    return `${userName} ${action} cobro ${amount}`;
  },
  purchases: (body, action, userName) => {
    const purchase = body.purchase || body;
    const num = purchase.purchase_number ? `#${String(purchase.purchase_number).padStart(4, '0')}` : '';
    const total = purchase.total_amount ? `$${Number(purchase.total_amount).toLocaleString('es-AR')}` : '';
    if (action === 'create') return `${userName} registro compra ${num} ${total ? 'por ' + total : ''}`.trim();
    return `${userName} ${action} compra ${num}`;
  },
  quotes: (body, action, userName) => {
    const quote = body.quote || body;
    const num = quote.quote_number ? `#${String(quote.quote_number).padStart(4, '0')}` : '';
    if (action === 'create') return `${userName} creo cotizacion ${num}`;
    return `${userName} ${action} cotizacion ${num}`;
  },
  users: (body, action, userName) => {
    const user = body.user || body;
    const targetName = user.name || user.email || '';
    const role = user.role || '';
    if (action === 'create') return `${userName} creo usuario ${targetName} ${role ? 'con rol ' + role : ''}`.trim();
    if (action === 'update') return `${userName} modifico usuario ${targetName}`;
    if (action === 'delete') return `${userName} desactivo usuario ${targetName}`;
    return `${userName} ${action} usuario ${targetName}`;
  },
  inventory: (body, action, userName) => {
    return `${userName} ajusto stock`;
  },
  materials: (body, action, userName) => {
    const mat = body.material || body;
    const name = mat.name || '';
    if (action === 'create') return `${userName} creo material ${name}`;
    return `${userName} ${action} material ${name}`;
  },
  cheques: (body, action, userName) => {
    const cheque = body.cheque || body;
    const num = cheque.cheque_number || '';
    const amount = cheque.amount ? `$${Number(cheque.amount).toLocaleString('es-AR')}` : '';
    return `${userName} ${action === 'create' ? 'cargo' : action} cheque ${num} ${amount}`.trim();
  },
  enterprises: (body, action, userName) => {
    const ent = body.enterprise || body;
    const name = ent.name || '';
    if (action === 'create') return `${userName} creo empresa ${name}`;
    return `${userName} ${action} empresa ${name}`;
  },
};

function getModuleFromPath(path: string): string | null {
  for (const [route, module] of Object.entries(ROUTE_MODULE_MAP)) {
    if (path.startsWith(route)) return module;
  }
  return null;
}

export function activityLoggerMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  // Only log state-changing requests
  const action = METHOD_ACTION_MAP[req.method];
  if (!action) return next();

  const module = getModuleFromPath(req.path);
  if (!module) return next();

  // Skip health checks, auth endpoints (logged separately), and activity itself
  if (req.path.includes('/health') || req.path.includes('/auth/') || req.path.includes('/activity/')) {
    return next();
  }

  // Capture the original res.json to log after success
  const originalJson = res.json.bind(res);

  res.json = function (body: any) {
    // Only log successful operations (2xx status)
    if (res.statusCode >= 200 && res.statusCode < 300 && req.user?.company_id) {
      const entityId = req.params?.id || body?.id || body?.user?.id || null;
      const userName = (req.user as any)?.name || req.user?.email || 'Sistema';
      const simpleDescription = buildDescription(action, module, req, body);

      // Build rich description via enricher (with fallback)
      let richDescription: string | null = null;
      try {
        const enricher = DESCRIPTION_ENRICHERS[module];
        if (enricher) {
          richDescription = enricher(body, action, userName);
        }
      } catch {
        // Enrichment failed, fallback to simple description
      }

      const details: Record<string, any> = {
        description: simpleDescription,
      };
      if (richDescription) {
        details.description_rich = richDescription;
      }

      activityService.log({
        companyId: req.user.company_id,
        userId: req.user.id || 'unknown',
        action,
        module,
        entityType: module,
        entityId,
        description: simpleDescription,
        ipAddress: req.ip || undefined,
        metadata: {
          path: req.path,
          method: req.method,
          description_rich: richDescription || undefined,
        },
      }).catch(() => {}); // fire-and-forget
    }

    return originalJson(body);
  } as any;

  next();
}

function buildDescription(action: string, module: string, _req: AuthRequest, body: any): string {
  const moduleLabels: Record<string, string> = {
    orders: 'pedido', invoices: 'factura', products: 'producto', quotes: 'cotizacion',
    remitos: 'remito', purchases: 'compra', cobros: 'cobro', pagos: 'pago',
    cheques: 'cheque', enterprises: 'empresa', banks: 'banco', users: 'usuario',
    inventory: 'stock', materials: 'material', crm: 'oportunidad', billing: 'suscripcion',
    secretaria: 'SecretarIA', cuenta_corriente: 'cuenta corriente', portal: 'portal',
    settings: 'configuracion',
  };

  const actionLabels: Record<string, string> = {
    create: 'Creo', update: 'Modifico', delete: 'Elimino',
  };

  const label = moduleLabels[module] || module;
  const actionLabel = actionLabels[action] || action;
  const name = body?.name || body?.title || body?.user?.name || body?.sku || '';

  return `${actionLabel} ${label}${name ? ': ' + name : ''}`;
}
