import { Request, Response, NextFunction } from 'express';
import { getClientIp } from './security';
import { isIpAutoBlocked } from '../lib/security-monitor';

/**
 * Early middleware that checks if an IP has been auto-blocked
 * by the security monitoring system (20+ failed logins in 1 hour).
 *
 * This supplements the existing bruteForceProtection middleware
 * which only applies to auth endpoints. This one blocks the IP
 * from ALL API endpoints.
 */
export function securityAutoBlockCheck(req: Request, res: Response, next: NextFunction): void {
  // Only apply to API routes
  if (!req.path.startsWith('/api/')) {
    return next();
  }

  // Skip health checks
  if (req.path === '/health' || req.path === '/health/detailed') {
    return next();
  }

  const ip = getClientIp(req);
  const blockStatus = isIpAutoBlocked(ip);

  if (blockStatus.blocked) {
    res.status(429).json({
      error: 'IP temporarily blocked due to suspicious activity',
      reason: blockStatus.reason,
      retry_after: blockStatus.expiresAt?.toISOString(),
    });
    return;
  }

  next();
}
