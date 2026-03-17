import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import 'express-async-errors';
import path from 'path';
import { env } from './config/env';
import { pool } from './config/db';
import { authMiddleware, optionalAuth } from './middlewares/auth';
import { errorHandler } from './middlewares/errorHandler';
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

export const app = express();

// Trust proxy (behind nginx)
app.set('trust proxy', 1);

// Middleware de seguridad
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      ...helmet.contentSecurityPolicy.getDefaultDirectives(),
      'frame-src': ["'self'", 'blob:'],
    },
  },
}));
const corsOrigin = process.env.CORS_ORIGIN
if (!corsOrigin) {
  console.warn('WARNING: CORS_ORIGIN not set, defaulting to localhost origins')
}
app.use(cors({
  origin: corsOrigin || ['http://localhost:5173', 'http://localhost:3000'],
  credentials: true,
}));

// Limiter de rate
const limiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: env.RATE_LIMIT_MAX_REQUESTS,
  message: 'Too many requests from this IP, please try again later.',
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

// Parsers
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Health check
app.get('/health', async (_req, res) => {
  try {
    const dbCheck = await pool.query('SELECT 1 as ok');
    const dbOk = dbCheck.rows?.[0]?.ok === 1;
    res.json({
      status: dbOk ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      database: dbOk ? 'connected' : 'disconnected',
      uptime: process.uptime(),
    });
  } catch (error) {
    res.status(503).json({
      status: 'error',
      timestamp: new Date().toISOString(),
      database: 'disconnected',
    });
  }
});

// API Routes
app.use('/api/auth', authLimiter, authRouter);
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
app.use('/api/receipts', authMiddleware, receiptsRouter);
app.use('/api/export', authMiddleware, exportRouter);

// Serve frontend static files (monolith deployment)
const publicPath = path.join(__dirname, '..', 'public');
app.use(express.static(publicPath));

// SPA catch-all: serve index.html for non-API routes
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Route not found' });
  }
  res.sendFile(path.join(publicPath, 'index.html'));
});

// Error handler (must be last)
app.use(errorHandler);

export default app;
