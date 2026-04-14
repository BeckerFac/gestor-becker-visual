import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { db } from '../config/db';
import { sql } from 'drizzle-orm';

export interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
    company_id: string;
    role: string;
    impersonating?: boolean;
    readonly?: boolean;
    enterprise_id?: string;
    customer_id?: string;
    jti?: string;
  };
}

// CRIT-03: Legacy grace period — tokens issued before jti was added keep
// working for 7 days from this deploy. After that, tokens without jti are
// rejected. Update LEGACY_TOKEN_GRACE_UNTIL once rolled out.
const LEGACY_TOKEN_GRACE_UNTIL = new Date('2026-04-20T00:00:00Z');

/**
 * CRIT-03: Returns true if the given jti is present in `sessions`, not revoked
 * and not past its expires_at. Customer/portal tokens (no jti persisted) are
 * exempted by the caller.
 */
async function isSessionActive(jti: string): Promise<boolean> {
  try {
    const result: any = await db.execute(sql`
      SELECT 1 FROM sessions
      WHERE access_token_jti = ${jti}
        AND revoked_at IS NULL
        AND expires_at > NOW()
      LIMIT 1
    `);
    const rows = result?.rows ?? result ?? [];
    return rows.length > 0;
  } catch (err) {
    // Fail closed on DB errors, but log so ops sees the issue
    console.error('[auth] session lookup failed:', err);
    return false;
  }
}

// Only accept HS256 to prevent algorithm confusion attacks
const JWT_VERIFY_OPTIONS: jwt.VerifyOptions = {
  algorithms: ['HS256'],
};

export const authMiddleware = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.split(' ')[1];

    if (!token || token.length > 2048) {
      return res.status(401).json({ error: 'Invalid token format' });
    }

    const decoded = jwt.verify(token, env.JWT_SECRET, JWT_VERIFY_OPTIONS) as {
      id: string;
      email: string;
      company_id: string;
      role: string;
      impersonating?: boolean;
      readonly?: boolean;
      enterprise_id?: string;
      customer_id?: string;
      jti?: string;
    };

    // Validate required claims exist
    if (!decoded.id || !decoded.company_id || !decoded.role) {
      return res.status(401).json({ error: 'Invalid token claims' });
    }

    // CRIT-03: server-side session revocation check.
    // Skip for customer-portal / preview / impersonation tokens which are not
    // tracked in the sessions table (they have their own expiry controls).
    const isPortalOrEphemeral =
      decoded.role === 'customer' ||
      decoded.role === 'customer_preview' ||
      decoded.impersonating === true;

    if (!isPortalOrEphemeral) {
      if (decoded.jti) {
        const active = await isSessionActive(decoded.jti);
        if (!active) {
          return res.status(401).json({ error: 'Session invalida o expirada' });
        }
      } else {
        // Legacy token (issued before CRIT-03 fix). Accept during grace window.
        if (Date.now() > LEGACY_TOKEN_GRACE_UNTIL.getTime()) {
          return res.status(401).json({ error: 'Session invalida o expirada' });
        }
        console.warn('[auth] legacy token without jti accepted (grace period)', {
          user: decoded.id,
        });
      }
    }

    req.user = {
      id: decoded.id,
      email: decoded.email,
      company_id: decoded.company_id,
      role: decoded.role,
      impersonating: decoded.impersonating || false,
      readonly: decoded.readonly || false,
      enterprise_id: decoded.enterprise_id,
      customer_id: decoded.customer_id,
      jti: decoded.jti,
    };

    // Enforce read-only mode for impersonation tokens
    if (decoded.impersonating && decoded.readonly) {
      const writeMethod = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method);
      if (writeMethod) {
        return res.status(403).json({ error: 'Impersonation tokens are read-only. Write operations are not permitted.' });
      }
    }

    next();
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      return res.status(401).json({ error: 'Token expired' });
    }
    return res.status(401).json({ error: 'Invalid token' });
  }
};

export const optionalAuth = (req: AuthRequest, _res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      if (token && token.length <= 2048) {
        const decoded = jwt.verify(token, env.JWT_SECRET, JWT_VERIFY_OPTIONS) as AuthRequest['user'];
        if (decoded && decoded.id && decoded.company_id) {
          req.user = decoded;
        }
      }
    }
  } catch (_error) {
    // Silently fail for optional auth
  }
  next();
};
