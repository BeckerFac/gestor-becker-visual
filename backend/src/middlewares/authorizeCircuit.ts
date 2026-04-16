import { Request, Response, NextFunction } from 'express';
import { ApiError } from './errorHandler';

/**
 * Sol/Luna dual-circuit authorization.
 *
 * Source tells the middleware where to look for the circuit discriminator
 * on the request. For row-level checks (where the circuit lives in the DB
 * row, not the request), use `assertCanAccessCircuit` from inside services.
 */
export type CircuitSource =
  | 'body'
  | 'query'
  | ((req: Request) => 'fiscal' | 'no_fiscal' | null | undefined);

/**
 * Middleware factory. Blocks requests that specify a circuit the caller
 * cannot access. If the request carries no explicit circuit, the middleware
 * falls through — the downstream service is expected to filter results by
 * `req.user.visibleCircuits` (see useCircuitAccess on the frontend mirror).
 *
 * Security notes:
 * - Throws 401 when there is no authenticated user on the request.
 * - Throws 403 when a user without Luna access attempts `no_fiscal`.
 * - Never throws 404 at the middleware layer: existence leakage is handled
 *   by `assertCanAccessCircuit(leak404=true)` on the row-level check.
 */
export const authorizeCircuit = (source: CircuitSource = 'query') =>
  (req: Request, _res: Response, next: NextFunction) => {
    let circuit: string | null | undefined;
    if (typeof source === 'function') {
      circuit = source(req);
    } else if (source === 'body') {
      circuit = (req.body && (req.body as any).fiscal_type) as any;
    } else {
      circuit = (req.query && (req.query as any).fiscal_type) as any;
    }

    // No circuit specified → fall through. Service layer is responsible
    // for filtering results based on the caller's visibleCircuits.
    if (circuit === undefined || circuit === null || circuit === '') {
      return next();
    }

    // Reject unknown circuit values fast — prevents typos and probing.
    if (circuit !== 'fiscal' && circuit !== 'no_fiscal') {
      return next(new ApiError(400, 'Circuito invalido'));
    }

    const user = (req as any).user;
    if (!user) return next(new ApiError(401, 'No autenticado'));

    if (circuit === 'no_fiscal' && !user.can_access_luna) {
      return next(new ApiError(403, 'Sin acceso al circuito Luna'));
    }

    return next();
  };

/**
 * Row-level circuit guard for use inside services after loading a DB row.
 *
 * `leak404 = true` (default) hides the existence of Luna rows from users
 * without Luna access: rather than 403, we return 404 to avoid leaking
 * that a Luna invoice/cheque/etc exists with that id.
 */
export function assertCanAccessCircuit(
  user: any,
  circuit: 'fiscal' | 'no_fiscal',
  leak404: boolean = true,
): void {
  if (circuit === 'no_fiscal' && !user?.can_access_luna) {
    if (leak404) {
      throw new ApiError(404, 'No encontrado');
    }
    throw new ApiError(403, 'Sin acceso al circuito Luna');
  }
}
