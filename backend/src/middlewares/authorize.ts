import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth';
import { db } from '../config/db';
import { sql } from 'drizzle-orm';
import { ApiError } from './errorHandler';
import { FULL_ACCESS_ROLES, ROLE_HIERARCHY } from '../shared/permissions.constants';

// PR1-T4: scope permissions lookup by company_id via JOIN users.
// Defense-in-depth: if a JWT is forged with a user_id belonging to a different
// company (or an orphan user_id), permissions for cross-tenant rows won't load.
async function loadUserPermissions(userId: string, companyId: string): Promise<Map<string, Set<string>>> {
  const result = await db.execute(sql`
    SELECT p.module, p.action
    FROM permissions p
    JOIN users u ON u.id = p.user_id
    WHERE p.user_id = ${userId}
      AND u.company_id = ${companyId}
      AND p.allowed = true
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
        (req as any)._userPermissions = await loadUserPermissions(req.user.id, req.user.company_id);
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

// Authorize a sub-action (e.g., orders:view_costs)
export const authorizeSubAction = (module: string, subAction: string) => {
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
        (req as any)._userPermissions = await loadUserPermissions(req.user.id, req.user.company_id);
      }

      const perms: Map<string, Set<string>> = (req as any)._userPermissions;
      const subActionKey = `${module}:${subAction}`;
      const subPerms = perms.get(subActionKey);
      if (!subPerms || !subPerms.has('allowed')) {
        throw new ApiError(403, 'No tiene permisos para esta sub-accion');
      }

      next();
    } catch (error) {
      next(error);
    }
  };
};

// Helper: check if user has ANY permission on a module (for filtering)
// PR1-T4: scoped by company_id for defense-in-depth.
export async function userCanAccessModule(userId: string, companyId: string, role: string, module: string): Promise<boolean> {
  if (FULL_ACCESS_ROLES.includes(role as any)) return true;
  const result = await db.execute(sql`
    SELECT 1 FROM permissions p
    JOIN users u ON u.id = p.user_id
    WHERE p.user_id = ${userId}
      AND u.company_id = ${companyId}
      AND p.module = ${module}
      AND p.allowed = true
    LIMIT 1
  `);
  const rows = (result as any).rows || result || [];
  return rows.length > 0;
}
