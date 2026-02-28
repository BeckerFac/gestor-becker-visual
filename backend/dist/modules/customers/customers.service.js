"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.customersService = exports.CustomersService = void 0;
const db_1 = require("../../config/db");
const schema_1 = require("../../db/schema");
const drizzle_orm_1 = require("drizzle-orm");
const errorHandler_1 = require("../../middlewares/errorHandler");
const uuid_1 = require("uuid");
class CustomersService {
    async createCustomer(companyId, data) {
        try {
            const existingCuit = await db_1.db.query.customers.findFirst({
                where: (0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.customers.company_id, companyId), (0, drizzle_orm_1.eq)(schema_1.customers.cuit, data.cuit)),
            });
            if (existingCuit)
                throw new errorHandler_1.ApiError(409, 'Customer CUIT already exists');
            const customer = await db_1.db.insert(schema_1.customers).values({
                id: (0, uuid_1.v4)(),
                company_id: companyId,
                cuit: data.cuit,
                name: data.name,
                contact_name: data.contact_name,
                address: data.address,
                email: data.email,
                phone: data.phone,
                credit_limit: data.credit_limit,
                payment_terms: data.payment_terms,
            }).returning();
            return customer[0];
        }
        catch (error) {
            if (error instanceof errorHandler_1.ApiError)
                throw error;
            throw new errorHandler_1.ApiError(500, 'Failed to create customer');
        }
    }
    async getCustomers(companyId, { skip = 0, limit = 50 } = {}) {
        try {
            const items = await db_1.db.select().from(schema_1.customers)
                .where((0, drizzle_orm_1.eq)(schema_1.customers.company_id, companyId))
                .limit(limit)
                .offset(skip);
            return { items, total: items.length, skip, limit };
        }
        catch (error) {
            throw new errorHandler_1.ApiError(500, 'Failed to get customers');
        }
    }
    async getCustomer(companyId, customerId) {
        try {
            const customer = await db_1.db.query.customers.findFirst({
                where: (0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.customers.company_id, companyId), (0, drizzle_orm_1.eq)(schema_1.customers.id, customerId)),
            });
            if (!customer)
                throw new errorHandler_1.ApiError(404, 'Customer not found');
            return customer;
        }
        catch (error) {
            if (error instanceof errorHandler_1.ApiError)
                throw error;
            throw new errorHandler_1.ApiError(500, 'Failed to get customer');
        }
    }
    async updateCustomer(companyId, customerId, data) {
        try {
            const customer = await this.getCustomer(companyId, customerId);
            const updated = await db_1.db.update(schema_1.customers)
                .set({ ...data, updated_at: new Date() })
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.customers.company_id, companyId), (0, drizzle_orm_1.eq)(schema_1.customers.id, customerId)))
                .returning();
            return updated[0];
        }
        catch (error) {
            if (error instanceof errorHandler_1.ApiError)
                throw error;
            throw new errorHandler_1.ApiError(500, 'Failed to update customer');
        }
    }
    async deleteCustomer(companyId, customerId) {
        try {
            await this.getCustomer(companyId, customerId);
            await db_1.db.delete(schema_1.customers)
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.customers.company_id, companyId), (0, drizzle_orm_1.eq)(schema_1.customers.id, customerId)));
            return { success: true };
        }
        catch (error) {
            if (error instanceof errorHandler_1.ApiError)
                throw error;
            throw new errorHandler_1.ApiError(500, 'Failed to delete customer');
        }
    }
}
exports.CustomersService = CustomersService;
exports.customersService = new CustomersService();
//# sourceMappingURL=customers.service.js.map