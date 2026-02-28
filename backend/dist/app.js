"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.app = void 0;
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
require("express-async-errors");
const env_1 = require("./config/env");
const auth_1 = require("./middlewares/auth");
const errorHandler_1 = require("./middlewares/errorHandler");
const auth_router_1 = require("./modules/auth/auth.router");
const companies_router_1 = require("./modules/companies/companies.router");
const products_router_1 = require("./modules/products/products.router");
const pricing_router_1 = require("./modules/pricing/pricing.router");
const customers_router_1 = require("./modules/customers/customers.router");
const invoices_router_1 = require("./modules/invoices/invoices.router");
const inventory_router_1 = require("./modules/inventory/inventory.router");
const reports_router_1 = require("./modules/reports/reports.router");
const catalog_router_1 = require("./modules/catalog/catalog.router");
const afip_router_1 = require("./modules/afip/afip.router");
const pdf_router_1 = require("./modules/pdf/pdf.router");
const email_router_1 = require("./modules/email/email.router");
exports.app = (0, express_1.default)();
// Middleware de seguridad
exports.app.use((0, helmet_1.default)());
exports.app.use((0, cors_1.default)({
    origin: process.env.CORS_ORIGIN || '*',
    credentials: true,
}));
// Limiter de rate
const limiter = (0, express_rate_limit_1.default)({
    windowMs: env_1.env.RATE_LIMIT_WINDOW_MS,
    max: env_1.env.RATE_LIMIT_MAX_REQUESTS,
    message: 'Too many requests from this IP, please try again later.',
});
exports.app.use('/api/', limiter);
// Parsers
exports.app.use(express_1.default.json({ limit: '10mb' }));
exports.app.use(express_1.default.urlencoded({ limit: '10mb', extended: true }));
// Health check
exports.app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});
// API Routes
exports.app.use('/api/auth', auth_router_1.authRouter);
exports.app.use('/api/companies', auth_1.authMiddleware, companies_router_1.companiesRouter);
exports.app.use('/api/products', auth_1.authMiddleware, products_router_1.productsRouter);
exports.app.use('/api/pricing', auth_1.authMiddleware, pricing_router_1.pricingRouter);
exports.app.use('/api/customers', auth_1.authMiddleware, customers_router_1.customersRouter);
exports.app.use('/api/invoices', auth_1.authMiddleware, invoices_router_1.invoicesRouter);
exports.app.use('/api/inventory', auth_1.authMiddleware, inventory_router_1.inventoryRouter);
exports.app.use('/api/reports', auth_1.authMiddleware, reports_router_1.reportsRouter);
exports.app.use('/api/catalog', auth_1.authMiddleware, catalog_router_1.catalogRouter);
exports.app.use('/api/afip', auth_1.authMiddleware, afip_router_1.afipRouter);
exports.app.use('/api/pdf', auth_1.authMiddleware, pdf_router_1.pdfRouter);
exports.app.use('/api/email', auth_1.authMiddleware, email_router_1.emailRouter);
// 404 handler
exports.app.use((req, res) => {
    res.status(404).json({ error: 'Route not found' });
});
// Error handler (must be last)
exports.app.use(errorHandler_1.errorHandler);
exports.default = exports.app;
//# sourceMappingURL=app.js.map