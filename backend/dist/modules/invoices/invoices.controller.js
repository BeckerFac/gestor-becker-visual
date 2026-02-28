"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.invoicesController = exports.InvoicesController = void 0;
const invoices_service_1 = require("./invoices.service");
const errorHandler_1 = require("../../middlewares/errorHandler");
class InvoicesController {
    async createInvoice(req, res) {
        try {
            if (!req.user?.company_id || !req.user.id)
                throw new errorHandler_1.ApiError(401, 'Unauthorized');
            const invoice = await invoices_service_1.invoicesService.createInvoice(req.user.company_id, req.user.id, req.body);
            res.status(201).json(invoice);
        }
        catch (error) {
            if (error instanceof errorHandler_1.ApiError) {
                return res.status(error.statusCode).json({ error: error.message });
            }
            res.status(500).json({ error: 'Failed to create invoice' });
        }
    }
    async getInvoices(req, res) {
        try {
            if (!req.user?.company_id)
                throw new errorHandler_1.ApiError(401, 'Unauthorized');
            const { skip = '0', limit = '50' } = req.query;
            const data = await invoices_service_1.invoicesService.getInvoices(req.user.company_id, {
                skip: parseInt(skip, 10),
                limit: parseInt(limit, 10),
            });
            res.json(data);
        }
        catch (error) {
            if (error instanceof errorHandler_1.ApiError) {
                return res.status(error.statusCode).json({ error: error.message });
            }
            res.status(500).json({ error: 'Failed to get invoices' });
        }
    }
    async getInvoice(req, res) {
        try {
            if (!req.user?.company_id || !req.params.id)
                throw new errorHandler_1.ApiError(400, 'Missing invoice ID');
            const invoice = await invoices_service_1.invoicesService.getInvoice(req.user.company_id, req.params.id);
            res.json(invoice);
        }
        catch (error) {
            if (error instanceof errorHandler_1.ApiError) {
                return res.status(error.statusCode).json({ error: error.message });
            }
            res.status(500).json({ error: 'Failed to get invoice' });
        }
    }
    async authorizeInvoice(req, res) {
        try {
            if (!req.user?.company_id || !req.params.id)
                throw new errorHandler_1.ApiError(400, 'Missing invoice ID');
            const invoice = await invoices_service_1.invoicesService.authorizeInvoice(req.user.company_id, req.params.id);
            res.json(invoice);
        }
        catch (error) {
            if (error instanceof errorHandler_1.ApiError) {
                return res.status(error.statusCode).json({ error: error.message });
            }
            res.status(500).json({ error: 'Failed to authorize invoice' });
        }
    }
}
exports.InvoicesController = InvoicesController;
exports.invoicesController = new InvoicesController();
//# sourceMappingURL=invoices.controller.js.map