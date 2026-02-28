"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.productsService = exports.ProductsService = void 0;
const db_1 = require("../../config/db");
const schema_1 = require("../../db/schema");
const drizzle_orm_1 = require("drizzle-orm");
const errorHandler_1 = require("../../middlewares/errorHandler");
const uuid_1 = require("uuid");
class ProductsService {
    async createProduct(companyId, data) {
        try {
            const existingSku = await db_1.db.query.products.findFirst({
                where: (0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.products.company_id, companyId), (0, drizzle_orm_1.eq)(schema_1.products.sku, data.sku)),
            });
            if (existingSku)
                throw new errorHandler_1.ApiError(409, 'SKU already exists');
            const product = await db_1.db.insert(schema_1.products).values({
                id: (0, uuid_1.v4)(),
                company_id: companyId,
                sku: data.sku,
                name: data.name,
                description: data.description,
                category_id: data.category_id,
                brand_id: data.brand_id,
            }).returning();
            if (data.cost !== undefined && data.margin_percent !== undefined) {
                const vat_rate = data.vat_rate || 21;
                const final_price = Number(data.cost) * (1 + Number(data.margin_percent) / 100) * (1 + Number(vat_rate) / 100);
                await db_1.db.insert(schema_1.product_pricing).values({
                    id: (0, uuid_1.v4)(),
                    product_id: product[0].id,
                    cost: data.cost,
                    margin_percent: data.margin_percent,
                    vat_rate: vat_rate,
                    final_price: final_price.toString(),
                });
            }
            return product[0];
        }
        catch (error) {
            if (error instanceof errorHandler_1.ApiError)
                throw error;
            throw new errorHandler_1.ApiError(500, 'Failed to create product');
        }
    }
    async getProducts(companyId, { skip = 0, limit = 50, search = '' } = {}) {
        try {
            let query = db_1.db.query.products;
            const where = (0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.products.company_id, companyId));
            const items = await db_1.db.select().from(schema_1.products)
                .where(where)
                .limit(limit)
                .offset(skip);
            return {
                items,
                total: items.length,
                skip,
                limit,
            };
        }
        catch (error) {
            throw new errorHandler_1.ApiError(500, 'Failed to get products');
        }
    }
    async getProduct(companyId, productId) {
        try {
            const product = await db_1.db.query.products.findFirst({
                where: (0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.products.company_id, companyId), (0, drizzle_orm_1.eq)(schema_1.products.id, productId)),
            });
            if (!product)
                throw new errorHandler_1.ApiError(404, 'Product not found');
            return product;
        }
        catch (error) {
            if (error instanceof errorHandler_1.ApiError)
                throw error;
            throw new errorHandler_1.ApiError(500, 'Failed to get product');
        }
    }
    async updateProduct(companyId, productId, data) {
        try {
            const product = await this.getProduct(companyId, productId);
            const updated = await db_1.db.update(schema_1.products)
                .set({
                name: data.name || product.name,
                description: data.description !== undefined ? data.description : product.description,
                category_id: data.category_id || product.category_id,
                updated_at: new Date(),
            })
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.products.company_id, companyId), (0, drizzle_orm_1.eq)(schema_1.products.id, productId)))
                .returning();
            return updated[0];
        }
        catch (error) {
            if (error instanceof errorHandler_1.ApiError)
                throw error;
            throw new errorHandler_1.ApiError(500, 'Failed to update product');
        }
    }
    async deleteProduct(companyId, productId) {
        try {
            const product = await this.getProduct(companyId, productId);
            await db_1.db.delete(schema_1.products)
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.products.company_id, companyId), (0, drizzle_orm_1.eq)(schema_1.products.id, productId)));
            return { success: true };
        }
        catch (error) {
            if (error instanceof errorHandler_1.ApiError)
                throw error;
            throw new errorHandler_1.ApiError(500, 'Failed to delete product');
        }
    }
}
exports.ProductsService = ProductsService;
exports.productsService = new ProductsService();
//# sourceMappingURL=products.service.js.map