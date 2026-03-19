import { Request, Response, NextFunction } from 'express';
import { isProduction } from '../config/env';
import { captureException } from '../config/sentry';
import logger from '../config/logger';

export class ApiError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

export const errorHandler = (err: Error, req: Request, res: Response, _next: NextFunction) => {
  const requestId = req.requestId || 'unknown';

  // Log with structured logger
  if (err instanceof ApiError) {
    logger.warn({
      requestId,
      statusCode: err.statusCode,
      path: req.path,
      method: req.method,
      error: err.message,
    }, `API Error: ${err.message}`);
  } else {
    logger.error({
      requestId,
      path: req.path,
      method: req.method,
      error: err.message,
      stack: isProduction ? undefined : err.stack,
    }, `Unhandled Error: ${err.message}`);

    // Report unhandled errors to Sentry
    captureException(err, {
      requestId,
      path: req.path,
      method: req.method,
    });
  }

  if (err instanceof ApiError) {
    return res.status(err.statusCode).json({
      error: err.message,
      requestId,
    });
  }

  if (err.message.includes('duplicate key')) {
    return res.status(409).json({
      error: 'Resource already exists',
      requestId,
    });
  }

  // Never leak internal error details to the client
  if (err.name === 'SyntaxError' && 'status' in err && (err as any).status === 400) {
    return res.status(400).json({
      error: 'Invalid request body',
      requestId,
    });
  }

  // Generic error - no internal details exposed
  res.status(500).json({
    error: 'Internal server error',
    requestId,
  });
};

export const asyncHandler = (fn: Function) => (req: Request, res: Response, next: NextFunction) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};
