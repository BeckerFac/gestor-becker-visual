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
      const description = buildDescription(action, module, req, body);

      activityService.log({
        companyId: req.user.company_id,
        userId: req.user.id || 'unknown',
        action,
        module,
        entityType: module,
        entityId,
        description,
        ipAddress: req.ip || undefined,
        metadata: { path: req.path, method: req.method },
      }).catch(() => {}); // fire-and-forget
    }

    return originalJson(body);
  } as any;

  next();
}

function buildDescription(action: string, module: string, req: AuthRequest, body: any): string {
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
