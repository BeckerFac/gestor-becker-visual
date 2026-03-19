import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth';
import { db } from '../config/db';
import { sql } from 'drizzle-orm';
import { ApiError } from './errorHandler';
import { FULL_ACCESS_ROLES, ROLE_HIERARCHY } from '../shared/permissions.constants';

async function loadUserPermissions(userId: string): Promise<Map<string, Set<string>>> {
  const result = await db.execute(sql`
    SELECT module, action FROM permissions WHERE user_id = ${userId} AND allowed = true
  `);
  const rows = (result as any).rows || result || [];
  const map = new Map<string, Set<string>>();
  for (const row of rows) {
    const r = row as { module: string; action: string };
    if (!map.has(r.module)) map.set(r.module, new Set());
    map.get(r.module)!.add(r.action);
  }
  return map;
}

export const authorize = (module: string, action: string) => {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        throw new ApiError(401, 'No autenticado');
      }

      // Owner and Admin always have full access
      if (FULL_ACCESS_ROLES.includes(req.user.role as any)) {
        return next();
      }

      // Load permissions once per request (cached on req object)
      if (!(req as any)._userPermissions) {
        (req as any)._userPermissions = await loadUserPermissions(req.user.id);
      }

      const perms: Map<string, Set<string>> = (req as any)._userPermissions;
      const modulePerms = perms.get(module);
      if (!modulePerms || !modulePerms.has(action)) {
        throw new ApiError(403, 'No tiene permisos para esta accion');
      }

      next();
    } catch (error) {
      next(error);
    }
  };
};

// Require a minimum role level
export const requireRole = (...allowedRoles: string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return next(new ApiError(401, 'No autenticado'));
    }
    if (!allowedRoles.includes(req.user.role)) {
      return next(new ApiError(403, 'No tiene el rol requerido para esta accion'));
    }
    next();
  };
};

// Require minimum role hierarchy level
export const requireMinRole = (minRole: string) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return next(new ApiError(401, 'No autenticado'));
    }
    const userLevel = ROLE_HIERARCHY[req.user.role] ?? 0;
    const requiredLevel = ROLE_HIERARCHY[minRole] ?? 999;
    if (userLevel < requiredLevel) {
      return next(new ApiError(403, 'No tiene el nivel de acceso requerido'));
    }
    next();
  };
};

// Helper: check if user has ANY permission on a module (for filtering)
export async function userCanAccessModule(userId: string, role: string, module: string): Promise<boolean> {
  if (FULL_ACCESS_ROLES.includes(role as any)) return true;
  const result = await db.execute(sql`
    SELECT 1 FROM permissions WHERE user_id = ${userId} AND module = ${module} AND allowed = true LIMIT 1
  `);
  const rows = (result as any).rows || result || [];
  return rows.length > 0;
}
