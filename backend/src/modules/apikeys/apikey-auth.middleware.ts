import { Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { apiKeysService, ApiKeyScope } from './apikeys.service';

/**
 * Request type for API-key-authenticated requests.
 * Unlike JWT auth, there's no specific user - just a company + scope.
 */
export interface ApiKeyRequest extends Request {
  apiKey?: {
    company_id: string;
    scope: ApiKeyScope;
    api_key_id: string;
  };
}

/**
 * Middleware: authenticate via X-API-Key header.
 * Use this on routes that should accept API key auth (integration endpoints).
 */
export const apiKeyAuthMiddleware = async (req: ApiKeyRequest, res: Response, next: NextFunction) => {
  try {
    const rawKey = req.headers['x-api-key'] as string | undefined;

    if (!rawKey) {
      return res.status(401).json({ error: 'X-API-Key header required' });
    }

    // Basic format validation
    if (typeof rawKey !== 'string' || rawKey.length > 200) {
      return res.status(401).json({ error: 'Invalid API key format' });
    }

    const result = await apiKeysService.authenticateByApiKey(rawKey);
    if (!result) {
      return res.status(401).json({ error: 'Invalid or revoked API key' });
    }

    req.apiKey = result;
    next();
  } catch (_error) {
    return res.status(500).json({ error: 'API key authentication failed' });
  }
};

/**
 * Middleware: require a specific scope on an API-key-authenticated request.
 */
export const requireApiKeyScope = (requiredScope: ApiKeyScope) => {
  return (req: ApiKeyRequest, res: Response, next: NextFunction) => {
    if (!req.apiKey) {
      return res.status(401).json({ error: 'API key authentication required' });
    }

    // 'full' scope includes 'read' access
    if (requiredScope === 'read' || req.apiKey.scope === 'full') {
      return next();
    }

    return res.status(403).json({
      error: 'API key does not have sufficient permissions. Required scope: ' + requiredScope,
    });
  };
};

/**
 * Separate rate limiter for API key requests.
 * More generous than user rate limits, but prevents abuse.
 * 1000 requests per 15 minutes per API key.
 */
export const apiKeyRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000,
  keyGenerator: (req: ApiKeyRequest) => {
    return req.apiKey?.api_key_id || req.ip || 'unknown';
  },
  message: { error: 'API key rate limit exceeded. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});
