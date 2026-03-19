// Sentry error tracking configuration
// Install packages when ready: npm install @sentry/node @sentry/profiling-node
// Then uncomment the imports below and the initialization code.

import { env } from './env';

// Placeholder types for when Sentry is installed
interface SentryLike {
  init: (options: Record<string, unknown>) => void;
  setUser: (user: Record<string, unknown> | null) => void;
  captureException: (error: unknown, context?: Record<string, unknown>) => void;
  captureMessage: (message: string, level?: string) => void;
  Handlers: {
    requestHandler: () => unknown;
    errorHandler: () => unknown;
  };
}

const SENTRY_DSN = process.env.SENTRY_DSN || '';

let sentryInstance: SentryLike | null = null;

function loadSentry(): SentryLike | null {
  if (!SENTRY_DSN) {
    return null;
  }
  try {
    // Dynamic import so it doesn't fail if @sentry/node isn't installed
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Sentry = require('@sentry/node');
    return Sentry as SentryLike;
  } catch {
    console.warn('[Sentry] @sentry/node not installed. Error tracking disabled.');
    return null;
  }
}

export function initSentry(): void {
  sentryInstance = loadSentry();
  if (!sentryInstance) {
    console.log('[Sentry] DSN not configured or package not installed. Skipping initialization.');
    return;
  }

  sentryInstance.init({
    dsn: SENTRY_DSN,
    environment: env.NODE_ENV,
    tracesSampleRate: env.NODE_ENV === 'production' ? 0.2 : 1.0,
    profilesSampleRate: env.NODE_ENV === 'production' ? 0.1 : 0,
    integrations: [],
    beforeSend(event: Record<string, unknown>) {
      // Redact sensitive fields before sending to Sentry
      const request = event.request as Record<string, unknown> | undefined;
      if (request?.headers) {
        const headers = request.headers as Record<string, string>;
        if (headers.authorization) {
          headers.authorization = '[REDACTED]';
        }
        if (headers.cookie) {
          headers.cookie = '[REDACTED]';
        }
      }
      return event;
    },
  });

  console.log('[Sentry] Initialized successfully.');
}

export function setSentryUser(user: { id: string; company_id: string; email: string } | null): void {
  if (!sentryInstance) return;
  if (user) {
    sentryInstance.setUser({
      id: user.id,
      company_id: user.company_id,
      email: user.email,
    });
  } else {
    sentryInstance.setUser(null);
  }
}

export function captureException(error: unknown, context?: Record<string, unknown>): void {
  if (!sentryInstance) return;
  sentryInstance.captureException(error, context ? { extra: context } : undefined);
}

export function captureMessage(message: string, level: string = 'info'): void {
  if (!sentryInstance) return;
  sentryInstance.captureMessage(message, level);
}

export function getSentryRequestHandler(): ReturnType<typeof Function> | null {
  if (!sentryInstance) return null;
  try {
    return sentryInstance.Handlers.requestHandler() as ReturnType<typeof Function>;
  } catch {
    return null;
  }
}

export function getSentryErrorHandler(): ReturnType<typeof Function> | null {
  if (!sentryInstance) return null;
  try {
    return sentryInstance.Handlers.errorHandler() as ReturnType<typeof Function>;
  } catch {
    return null;
  }
}

// Capture unhandled promise rejections
export function setupGlobalErrorHandlers(): void {
  process.on('unhandledRejection', (reason: unknown) => {
    console.error('[UnhandledRejection]', reason);
    captureException(reason, { type: 'unhandledRejection' });
  });

  process.on('uncaughtException', (error: Error) => {
    console.error('[UncaughtException]', error);
    captureException(error, { type: 'uncaughtException' });
    // Give Sentry time to send the event before crashing
    setTimeout(() => process.exit(1), 2000);
  });
}
