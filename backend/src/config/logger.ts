// Structured JSON logging with pino
// Features: request ID tracing, sensitive data redaction, log rotation config

import pino from 'pino';
import { env } from './env';
import { randomUUID } from 'crypto';
import { Request, Response, NextFunction } from 'express';

// Sensitive field patterns to redact
const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'password',
  'token',
  'accessToken',
  'refreshToken',
  'jwt',
  'secret',
  'cuit',
  'apiKey',
  'creditCard',
];

export const logger = pino({
  level: env.LOG_LEVEL || 'info',
  redact: {
    paths: REDACT_PATHS,
    censor: '[REDACTED]',
  },
  transport: env.NODE_ENV === 'development'
    ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:HH:MM:ss' } }
    : undefined,
  formatters: {
    level: (label: string) => ({ level: label }),
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  serializers: {
    req: (req: Record<string, unknown>) => ({
      method: req.method,
      url: req.url,
      requestId: req.id,
    }),
    res: (res: Record<string, unknown>) => ({
      statusCode: res.statusCode,
    }),
    err: pino.stdSerializers.err,
  },
});

// Extend Express Request to include requestId
declare global {
  namespace Express {
    interface Request {
      requestId?: string;
    }
  }
}

// Middleware: attach request ID for tracing
export function requestIdMiddleware(req: Request, _res: Response, next: NextFunction): void {
  req.requestId = (req.headers['x-request-id'] as string) || randomUUID();
  next();
}

// Middleware: log request duration
export function requestLoggerMiddleware(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;
    const logData = {
      requestId: req.requestId,
      method: req.method,
      url: req.originalUrl,
      statusCode: res.statusCode,
      durationMs: duration,
      userAgent: req.headers['user-agent'],
      ip: req.ip,
    };

    if (duration > 3000) {
      logger.warn(logData, 'Slow request detected');
    } else if (res.statusCode >= 500) {
      logger.error(logData, 'Server error response');
    } else if (res.statusCode >= 400) {
      logger.warn(logData, 'Client error response');
    } else {
      logger.info(logData, 'Request completed');
    }
  });

  next();
}

// Log rotation configuration hint (for production, use pino-roll or logrotate)
// Production: pipe output to pino-roll
// Example: node dist/index.js | pino-roll --file /var/log/gestor/app.log --frequency daily --limit 10
// Or use system logrotate:
// /var/log/gestor/*.log {
//   daily
//   missingok
//   rotate 14
//   compress
//   delaycompress
//   notifempty
//   copytruncate
// }

export default logger;
