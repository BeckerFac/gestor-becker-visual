"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.customersController = exports.CustomersController = void 0;
const customers_service_1 = require("./customers.service");
const errorHandler_1 = require("../../middlewares/errorHandler");
class CustomersController {
    async createCustomer(req, res) {
        try {
            if (!req.user?.company_id || !req.body.cuit || !req.body.name) {
                throw new errorHandler_1.ApiError(400, 'Missing required fields');
            }
            const customer = await customers_service_1.customersService.createCustomer(req.user.company_id, req.body);
            res.status(201).json(customer);
        }
        catch (error) {
            if (error instanceof errorHandler_1.ApiError) {
                return res.status(error.statusCode).json({ error: error.message });
            }
            res.status(500).json({ error: 'Failed to create customer' });
        }
    }
    async getCustomers(req, res) {
        try {
            if (!req.user?.company_id)
                throw new errorHandler_1.ApiError(401, 'Unauthorized');
            const { skip = '0', limit = '50' } = req.query;
            const data = await customers_service_1.customersService.getCustomers(req.user.company_id, {
                skip: parseInt(skip, 10),
                limit: parseInt(limit, 10),
            });
            res.json(data);
        }
        catch (error) {
            if (error instanceof errorHandler_1.ApiError) {
                return res.status(error.statusCode).json({ error: error.message });
            }
            res.status(500).json({ error: 'Failed to get customers' });
        }
    }
    async getCustomer(req, res) {
        try {
            if (!req.user?.company_id || !req.params.id)
                throw new errorHandler_1.ApiError(400, 'Missing customer ID');
            const customer = await customers_service_1.customersService.getCustomer(req.user.company_id, req.params.id);
            res.json(customer);
        }
        catch (error) {
            if (error instanceof errorHandler_1.ApiError) {
                return res.status(error.statusCode).json({ error: error.message });
            }
            res.status(500).json({ error: 'Failed to get customer' });
        }
    }
    async updateCustomer(req, res) {
        try {
            if (!req.user?.company_id || !req.params.id)
                throw new errorHandler_1.ApiError(400, 'Missing customer ID');
            const customer = await customers_service_1.customersService.updateCustomer(req.user.company_id, req.params.id, req.body);
            res.json(customer);
        }
        catch (error) {
            if (error instanceof errorHandler_1.ApiError) {
                return res.status(error.statusCode).json({ error: error.message });
            }
            res.status(500).json({ error: 'Failed to update customer' });
        }
    }
    async deleteCustomer(req, res) {
        try {
            if (!req.user?.company_id || !req.params.id)
                throw new errorHandler_1.ApiError(400, 'Missing customer ID');
            await customers_service_1.customersService.deleteCustomer(req.user.company_id, req.params.id);
            res.json({ success: true });
        }
        catch (error) {
            if (error instanceof errorHandler_1.ApiError) {
                return res.status(error.statusCode).json({ error: error.message });
            }
            res.status(500).json({ error: 'Failed to delete customer' });
        }
    }
}
exports.CustomersController = CustomersController;
exports.customersController = new CustomersController();
//# sourceMappingURL=customers.controller.js.map