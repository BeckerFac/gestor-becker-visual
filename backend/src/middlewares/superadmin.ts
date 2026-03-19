import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth';
import { db } from '../config/db';
import { sql } from 'drizzle-orm';

/**
 * Middleware that checks if the authenticated user is a superadmin.
 * Returns 403 if the user does not have is_superadmin = true.
 * Also blocks POST/PUT/DELETE when in impersonation mode (read-only).
 */
export const superadminMiddleware = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'No autenticado' });
    }

    const result = await db.execute(sql`
      SELECT is_superadmin FROM users WHERE id = ${req.user.id}
    `);
    const rows = (result as any).rows || result || [];

    if (rows.length === 0 || !rows[0].is_superadmin) {
      console.warn(`[SUPERADMIN] Access denied for user ${req.user.id} (${req.user.email}) to ${req.method} ${req.originalUrl}`);
      return res.status(403).json({ error: 'Acceso denegado: se requiere superadmin' });
    }

    // Log all superadmin actions
    console.log(`[SUPERADMIN] ${req.user.email} -> ${req.method} ${req.originalUrl}`);

    next();
  } catch (error) {
    console.error('[SUPERADMIN] Error checking superadmin status:', error);
    return res.status(500).json({ error: 'Error interno al verificar permisos' });
  }
};

/**
 * Middleware for impersonation mode - blocks write operations.
 */
export const readOnlyMiddleware = (req: AuthRequest, res: Response, next: NextFunction) => {
  const method = req.method.toUpperCase();
  if (method === 'POST' || method === 'PUT' || method === 'DELETE' || method === 'PATCH') {
    return res.status(403).json({ error: 'Modo solo lectura: operaciones de escritura bloqueadas' });
  }
  next();
};
