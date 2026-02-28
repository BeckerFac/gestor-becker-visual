import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import 'express-async-errors';
import { env } from './config/env';
import { authMiddleware, optionalAuth } from './middlewares/auth';
import { errorHandler } from './middlewares/errorHandler';
import { authRouter } from './modules/auth/auth.router';
import { companiesRouter } from './modules/companies/companies.router';
import { productsRouter } from './modules/products/products.router';
import { pricingRouter } from './modules/pricing/pricing.router';
import { customersRouter } from './modules/customers/customers.router';
import { invoicesRouter } from './modules/invoices/invoices.router';
import { inventoryRouter } from './modules/inventory/inventory.router';
import { reportsRouter } from './modules/reports/reports.router';
import { catalogRouter } from './modules/catalog/catalog.router';
import { afipRouter } from './modules/afip/afip.router';
import { pdfRouter } from './modules/pdf/pdf.router';
import { emailRouter } from './modules/email/email.router';

export const app = express();

// Middleware de seguridad
app.use(helmet());
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  credentials: true,
}));

// Limiter de rate
const limiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: env.RATE_LIMIT_MAX_REQUESTS,
  message: 'Too many requests from this IP, please try again later.',
});

app.use('/api/', limiter);

// Parsers
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API Routes
app.use('/api/auth', authRouter);
app.use('/api/companies', authMiddleware, companiesRouter);
app.use('/api/products', authMiddleware, productsRouter);
app.use('/api/pricing', authMiddleware, pricingRouter);
app.use('/api/customers', authMiddleware, customersRouter);
app.use('/api/invoices', authMiddleware, invoicesRouter);
app.use('/api/inventory', authMiddleware, inventoryRouter);
app.use('/api/reports', authMiddleware, reportsRouter);
app.use('/api/catalog', authMiddleware, catalogRouter);
app.use('/api/afip', authMiddleware, afipRouter);
app.use('/api/pdf', authMiddleware, pdfRouter);
app.use('/api/email', authMiddleware, emailRouter);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Error handler (must be last)
app.use(errorHandler);

export default app;
