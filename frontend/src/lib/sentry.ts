// Sentry frontend initialization (Sentry-ready)
// Install when ready: npm install @sentry/react
// Then import and call initSentry() in main.tsx before React renders
//
// Usage in main.tsx:
//   import { initSentry } from '@/lib/sentry'
//   initSentry()

const SENTRY_DSN = import.meta.env.VITE_SENTRY_DSN || '';

export function initSentry(): void {
  if (!SENTRY_DSN) {
    console.log('[Sentry] VITE_SENTRY_DSN not configured. Frontend error tracking disabled.');
    return;
  }

  try {
    // Dynamic require-style import so TS doesn't resolve the module at compile time
    // This avoids build errors when @sentry/react is not installed
    const moduleName = '@sentry/react';
    import(/* @vite-ignore */ moduleName).then((Sentry: any) => {
      Sentry.init({
        dsn: SENTRY_DSN,
        environment: import.meta.env.MODE,
        tracesSampleRate: import.meta.env.PROD ? 0.1 : 1.0,
        replaysSessionSampleRate: 0,
        replaysOnErrorSampleRate: import.meta.env.PROD ? 0.5 : 0,
        beforeSend(event: any) {
          if (event.request?.headers) {
            delete event.request.headers.authorization;
            delete event.request.headers.cookie;
          }
          return event;
        },
      });

      // Make Sentry available globally for the ErrorBoundary
      (window as any).__SENTRY__ = Sentry;

      console.log('[Sentry] Frontend initialized successfully.');
    }).catch(() => {
      console.log('[Sentry] @sentry/react not installed. Skipping.');
    });
  } catch {
    console.log('[Sentry] Failed to initialize frontend error tracking.');
  }
}

// Set user context when user logs in
export function setSentryUser(user: { id: string; email: string; company_id: string } | null): void {
  try {
    const Sentry = (window as any).__SENTRY__;
    if (Sentry?.setUser) {
      Sentry.setUser(user ? { id: user.id, email: user.email, company_id: user.company_id } : null);
    }
  } catch {
    // Sentry not available
  }
}
