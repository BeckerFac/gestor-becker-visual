import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import 'express-async-errors';
import path from 'path';
import { env, isProduction } from './config/env';
import { authMiddleware } from './middlewares/auth';
import { errorHandler } from './middlewares/errorHandler';
import {
  requestSanitizer,
  auditLogger,
  bruteForceProtection,
  additionalSecurityHeaders,
} from './middlewares/security';
import { securityAutoBlockCheck } from './middlewares/security-autoblock';
import { requestIdMiddleware, requestLoggerMiddleware } from './config/logger';
import { performanceMiddleware } from './middlewares/performanceMonitor';
import { healthRouter } from './routes/health';
import { shutdownGuard } from './config/shutdown';
import { getSentryRequestHandler, getSentryErrorHandler } from './config/sentry';
import { authRouter } from './modules/auth/auth.router';
import { productsRouter } from './modules/products/products.router';
import { pricingRouter } from './modules/pricing/pricing.router';
import { customersRouter } from './modules/customers/customers.router';
import { invoicesRouter } from './modules/invoices/invoices.router';
import { catalogRouter } from './modules/catalog/catalog.router';
import { afipRouter } from './modules/afip/afip.router';
import { pdfRouter } from './modules/pdf/pdf.router';
import { emailRouter } from './modules/email/email.router';
import { companiesRouter } from './modules/companies/companies.router';
import { reportsRouter } from './modules/reports/reports.router';
import { inventoryRouter } from './modules/inventory/inventory.router';
import { collectionsRouter } from './modules/collections/collections.router';
import { ordersRouter } from './modules/orders/orders.router';
import { quotesRouter } from './modules/quotes/quotes.router';
import { portalRouter } from './modules/portal/portal.router';
import { chequesRouter } from './modules/cheques/cheques.router';
import { remitosRouter } from './modules/remitos/remitos.router';
import { banksRouter } from './modules/banks/banks.router';
import { enterprisesRouter } from './modules/enterprises/enterprises.router';
import { purchasesRouter } from './modules/purchases/purchases.router';
import { cobrosRouter } from './modules/cobros/cobros.router';
import { pagosRouter } from './modules/pagos/pagos.router';
import { cuentaCorrienteRouter } from './modules/cuenta-corriente/cuenta-corriente.router';
import { tagsRouter } from './modules/tags/tags.router';
import { usersRouter } from './modules/users/users.router';
import { priceListsRouter } from './modules/price-lists/price-lists.router';
import { receiptsRouter } from './modules/receipts/receipts.router';
import { exportRouter } from './modules/export/export.router';
import { crmRouter } from './modules/crm/crm.router';
import { onboardingRouter } from './modules/onboarding/onboarding.router';
import { adminRouter } from './modules/admin/admin.router';
import { billingRouter } from './modules/billing/billing.router';
import { activityRouter } from './modules/activity/activity.router';
import { invitationsRouter } from './modules/invitations/invitations.router';
import { accountRouter } from './modules/account/account.router';
import { aiRouter } from './modules/ai/ai.router';
import { apiKeysRouter } from './modules/apikeys/apikeys.router';
import { secretariaRouter } from './modules/secretaria/secretaria.router';
import { priceCriteriaRouter } from './modules/price-criteria/price-criteria.router';
import { materialsRouter } from './modules/materials/materials.router';
import { recurringInvoicesRouter } from './modules/recurring-invoices/recurring-invoices.router';
import { integrationsRouter } from './modules/integrations/integrations.router';
import { remindersRouter } from './modules/reminders/reminders.router';

export const app = express();

// Trust proxy (behind nginx/reverse proxy)
app.set('trust proxy', 1);

// Disable X-Powered-By header (information disclosure)
app.disable('x-powered-by');

// Shutdown guard - reject new requests during graceful shutdown
app.use(shutdownGuard as express.RequestHandler);

// Sentry request handler (must be early if configured)
const sentryRequestHandler = getSentryRequestHandler();
if (sentryRequestHandler) {
  app.use(sentryRequestHandler as express.RequestHandler);
}

// Request ID for distributed tracing
app.use(requestIdMiddleware);

// Structured request logging
app.use(requestLoggerMiddleware);

// Performance monitoring (request duration, metrics)
app.use(performanceMiddleware);

// Additional security headers (before helmet, to layer)
app.use(additionalSecurityHeaders);

// Helmet security headers (comprehensive)
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      ...helmet.contentSecurityPolicy.getDefaultDirectives(),
      'frame-src': ["'self'", 'blob:'],
    },
  },
  // Strict transport security for HTTPS
  hsts: isProduction ? {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true,
  } : false,
  // Prevent MIME type sniffing
  noSniff: true,
  // Prevent clickjacking
  frameguard: { action: 'deny' },
}));

// CORS configuration - never wildcard in production
const corsOrigin = process.env.CORS_ORIGIN;
if (!corsOrigin && isProduction) {
  console.error('SECURITY WARNING: CORS_ORIGIN not set in production - this is a critical misconfiguration');
}
app.use(cors({
  origin: corsOrigin
    ? corsOrigin.split(',').map(o => o.trim())
    : ['http://localhost:5173', 'http://localhost:3000'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
  maxAge: 86400, // Pre-flight cache for 24h
}));

// Global rate limiter
const limiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: env.RATE_LIMIT_MAX_REQUESTS,
  message: { error: 'Too many requests from this IP, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/api/', limiter);

// Auth-specific rate limiter (stricter)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 attempts per 15 min
  message: { error: 'Demasiados intentos de autenticacion, intente de nuevo en 15 minutos' },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
});

// Capture raw body for SecretarIA webhook signature validation (must be before json parser)
app.use('/api/secretaria/webhook', express.json({
  limit: '1mb',
  verify: (req: any, _res, buf) => {
    req.rawBody = buf;
  },
}));

// Parsers with size limits
app.use(express.json({ limit: env.REQUEST_BODY_LIMIT }));
app.use(express.urlencoded({ limit: env.REQUEST_BODY_LIMIT, extended: true }));

// Request sanitization (trim + escape HTML in string inputs)
app.use(requestSanitizer);

// Auto-block check: deny requests from IPs with 20+ failed logins in 1h
app.use(securityAutoBlockCheck);

// Audit logging for state-changing operations
app.use(auditLogger);

// Activity logging (exhaustive - logs every CRUD operation)
import { activityLoggerMiddleware } from './middlewares/activityLogger';
app.use(activityLoggerMiddleware);

// Health check endpoints (no auth required for /health and /health/detailed)
// Admin health at /api/admin/health requires auth
app.use(healthRouter);

// API Routes
// Auth routes with brute force protection + rate limiting
app.use('/api/auth', bruteForceProtection, authLimiter, authRouter);
app.use('/api/products', authMiddleware, productsRouter);
app.use('/api/pricing', authMiddleware, pricingRouter);
app.use('/api/customers', authMiddleware, customersRouter);
app.use('/api/invoices', authMiddleware, invoicesRouter);
app.use('/api/catalog', authMiddleware, catalogRouter);
app.use('/api/afip', authMiddleware, afipRouter);
app.use('/api/pdf', authMiddleware, pdfRouter);
app.use('/api/email', authMiddleware, emailRouter);
app.use('/api/companies', authMiddleware, companiesRouter);
app.use('/api/reports', authMiddleware, reportsRouter);
app.use('/api/inventory', authMiddleware, inventoryRouter);
app.use('/api/collections', authMiddleware, collectionsRouter);
app.use('/api/orders', authMiddleware, ordersRouter);
app.use('/api/quotes', authMiddleware, quotesRouter);
app.use('/api/portal', portalRouter);
app.use('/api/cheques', authMiddleware, chequesRouter);
app.use('/api/remitos', authMiddleware, remitosRouter);
app.use('/api/banks', authMiddleware, banksRouter);
app.use('/api/enterprises', authMiddleware, enterprisesRouter);
app.use('/api/purchases', authMiddleware, purchasesRouter);
app.use('/api/cobros', authMiddleware, cobrosRouter);
app.use('/api/pagos', authMiddleware, pagosRouter);
app.use('/api/cuenta-corriente', authMiddleware, cuentaCorrienteRouter);
app.use('/api/tags', authMiddleware, tagsRouter);
app.use('/api/users', authMiddleware, usersRouter);
app.use('/api/price-lists', authMiddleware, priceListsRouter);
app.use('/api/price-criteria', authMiddleware, priceCriteriaRouter);
app.use('/api/materials', authMiddleware, materialsRouter);
app.use('/api/recurring-invoices', authMiddleware, recurringInvoicesRouter);
app.use('/api/integrations', authMiddleware, integrationsRouter);
app.use('/api/reminders', authMiddleware, remindersRouter);
app.use('/api/receipts', authMiddleware, receiptsRouter);
app.use('/api/export', authMiddleware, exportRouter);
app.use('/api/crm', authMiddleware, crmRouter);
app.use('/api/onboarding', authMiddleware, onboardingRouter);
app.use('/api/billing', billingRouter); // Mixed auth: some endpoints public (webhook)
app.use('/api/admin', authMiddleware, adminRouter);
app.use('/api/activity', activityRouter);
// Legacy /api/audit redirects to activity (backward compatibility)
app.use('/api/audit', activityRouter);
app.use('/api/invitations', invitationsRouter); // Mixed auth: validate/accept are public
app.use('/api/account', authMiddleware, accountRouter); // Data export & deletion (Ley 25.326)
app.use('/api/ai', authMiddleware, aiRouter); // AI features (Premium)
app.use('/api/apikeys', authMiddleware, apiKeysRouter); // API key management
app.use('/api/secretaria', secretariaRouter); // SecretarIA WhatsApp assistant (mixed auth: webhooks are public)

// Serve frontend static files (monolith deployment)
const publicPath = path.join(__dirname, '..', 'public');
// Assets with hash in filename are immutable — cache aggressively
app.use('/assets', express.static(path.join(publicPath, 'assets'), {
  maxAge: '1y',
  immutable: true,
}));
// Other static files (icons, manifest, sw.js) — short cache
app.use(express.static(publicPath, {
  maxAge: '1h',
  setHeaders: (res, filePath) => {
    // Service worker must never be cached
    if (filePath.endsWith('sw.js') || filePath.endsWith('workbox-4b126c97.js')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
  },
}));

// SPA catch-all: serve index.html for non-API routes — NEVER cache
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Route not found' });
  }
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(path.join(publicPath, 'index.html'));
});

// Sentry error handler (must be before custom error handler)
const sentryErrorHandler = getSentryErrorHandler();
if (sentryErrorHandler) {
  app.use(sentryErrorHandler as express.ErrorRequestHandler);
}

// Error handler (must be last)
app.use(errorHandler);

export default app;
