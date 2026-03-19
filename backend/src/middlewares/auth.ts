import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';

export interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
    company_id: string;
    role: string;
    impersonating?: boolean;
    readonly?: boolean;
  };
}

// Only accept HS256 to prevent algorithm confusion attacks
const JWT_VERIFY_OPTIONS: jwt.VerifyOptions = {
  algorithms: ['HS256'],
};

export const authMiddleware = (req: AuthRequest, res: Response, next: NextFunction) => {
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
    };

    // Validate required claims exist
    if (!decoded.id || !decoded.company_id || !decoded.role) {
      return res.status(401).json({ error: 'Invalid token claims' });
    }

    req.user = {
      id: decoded.id,
      email: decoded.email,
      company_id: decoded.company_id,
      role: decoded.role,
      impersonating: decoded.impersonating || false,
      readonly: decoded.readonly || false,
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
