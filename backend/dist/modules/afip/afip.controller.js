"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.afipController = exports.AfipController = void 0;
const afip_service_1 = require("./afip.service");
const errorHandler_1 = require("../../middlewares/errorHandler");
const db_1 = require("../../config/db");
const schema_1 = require("../../db/schema");
const drizzle_orm_1 = require("drizzle-orm");
class AfipController {
    async authorizeInvoice(req, res) {
        try {
            const { invoiceId } = req.params;
            if (!invoiceId || !req.user?.id) {
                throw new errorHandler_1.ApiError(400, 'Invoice ID and user required');
            }
            // Get invoice from database
            const invoice = await db_1.db.query.invoices.findFirst({
                where: (0, drizzle_orm_1.eq)(schema_1.invoices.id, invoiceId),
            });
            if (!invoice) {
                throw new errorHandler_1.ApiError(404, 'Invoice not found');
            }
            if (invoice.company_id !== req.user.company_id) {
                throw new errorHandler_1.ApiError(403, 'Unauthorized to access this invoice');
            }
            if (invoice.status === 'authorized') {
                return res.json({
                    message: 'Invoice already authorized',
                    cae: invoice.cae,
                });
            }
            // Prepare authorization request
            const authInput = {
                invoiceId,
                invoiceNumber: invoice.invoice_number,
                invoiceType: (invoice.invoice_type || 'B'),
                customerId: invoice.customer_id || '',
                subtotal: parseFloat(invoice.subtotal.toString()),
                vat: parseFloat(invoice.vat_amount.toString()),
                total: parseFloat(invoice.total_amount.toString()),
            };
            // Authorize with AFIP
            const authorization = await afip_service_1.afipService.authorizeInvoice(authInput);
            // Save authorization to database
            await afip_service_1.afipService.saveAuthorizedInvoice(invoiceId, authorization);
            return res.json({
                message: 'Invoice authorized successfully',
                authorization,
            });
        }
        catch (error) {
            if (error instanceof errorHandler_1.ApiError) {
                return res.status(error.statusCode).json({ error: error.message });
            }
            return res.status(500).json({ error: 'Authorization failed' });
        }
    }
    async verifyCuit(req, res) {
        try {
            const { cuit } = req.body;
            if (!cuit) {
                throw new errorHandler_1.ApiError(400, 'CUIT required');
            }
            const result = await afip_service_1.afipService.verifyCuit(cuit);
            return res.json({
                cuit,
                valid: result.valid,
                name: result.name,
            });
        }
        catch (error) {
            if (error instanceof errorHandler_1.ApiError) {
                return res.status(error.statusCode).json({ error: error.message });
            }
            return res.status(500).json({ error: 'Verification failed' });
        }
    }
    async getAuthorizedInvoices(req, res) {
        try {
            if (!req.user?.company_id) {
                throw new errorHandler_1.ApiError(401, 'Not authenticated');
            }
            // Get all authorized invoices for company
            const authorized = await db_1.db.query.invoices.findMany({
                where: (0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.invoices.company_id, req.user.company_id), (0, drizzle_orm_1.eq)(schema_1.invoices.status, 'authorized')),
            });
            return res.json({
                items: authorized,
                total: authorized.length,
            });
        }
        catch (error) {
            if (error instanceof errorHandler_1.ApiError) {
                return res.status(error.statusCode).json({ error: error.message });
            }
            return res.status(500).json({ error: 'Failed to get authorized invoices' });
        }
    }
}
exports.AfipController = AfipController;
exports.afipController = new AfipController();
//# sourceMappingURL=afip.controller.js.map