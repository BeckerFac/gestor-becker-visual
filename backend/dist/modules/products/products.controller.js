"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.productsController = exports.ProductsController = void 0;
const products_service_1 = require("./products.service");
const errorHandler_1 = require("../../middlewares/errorHandler");
class ProductsController {
    async createProduct(req, res) {
        try {
            if (!req.user?.company_id || !req.body.sku || !req.body.name) {
                throw new errorHandler_1.ApiError(400, 'Missing required fields');
            }
            const product = await products_service_1.productsService.createProduct(req.user.company_id, req.body);
            res.status(201).json(product);
        }
        catch (error) {
            if (error instanceof errorHandler_1.ApiError) {
                return res.status(error.statusCode).json({ error: error.message });
            }
            res.status(500).json({ error: 'Failed to create product' });
        }
    }
    async getProducts(req, res) {
        try {
            if (!req.user?.company_id)
                throw new errorHandler_1.ApiError(401, 'Unauthorized');
            const { skip = '0', limit = '50' } = req.query;
            const products = await products_service_1.productsService.getProducts(req.user.company_id, {
                skip: parseInt(skip, 10),
                limit: parseInt(limit, 10),
            });
            res.json(products);
        }
        catch (error) {
            if (error instanceof errorHandler_1.ApiError) {
                return res.status(error.statusCode).json({ error: error.message });
            }
            res.status(500).json({ error: 'Failed to get products' });
        }
    }
    async getProduct(req, res) {
        try {
            if (!req.user?.company_id || !req.params.id)
                throw new errorHandler_1.ApiError(400, 'Missing product ID');
            const product = await products_service_1.productsService.getProduct(req.user.company_id, req.params.id);
            res.json(product);
        }
        catch (error) {
            if (error instanceof errorHandler_1.ApiError) {
                return res.status(error.statusCode).json({ error: error.message });
            }
            res.status(500).json({ error: 'Failed to get product' });
        }
    }
    async updateProduct(req, res) {
        try {
            if (!req.user?.company_id || !req.params.id)
                throw new errorHandler_1.ApiError(400, 'Missing product ID');
            const product = await products_service_1.productsService.updateProduct(req.user.company_id, req.params.id, req.body);
            res.json(product);
        }
        catch (error) {
            if (error instanceof errorHandler_1.ApiError) {
                return res.status(error.statusCode).json({ error: error.message });
            }
            res.status(500).json({ error: 'Failed to update product' });
        }
    }
    async deleteProduct(req, res) {
        try {
            if (!req.user?.company_id || !req.params.id)
                throw new errorHandler_1.ApiError(400, 'Missing product ID');
            await products_service_1.productsService.deleteProduct(req.user.company_id, req.params.id);
            res.json({ success: true });
        }
        catch (error) {
            if (error instanceof errorHandler_1.ApiError) {
                return res.status(error.statusCode).json({ error: error.message });
            }
            res.status(500).json({ error: 'Failed to delete product' });
        }
    }
}
exports.ProductsController = ProductsController;
exports.productsController = new ProductsController();
//# sourceMappingURL=products.controller.js.map