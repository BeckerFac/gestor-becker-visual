"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.invoicesService = exports.InvoicesService = void 0;
const db_1 = require("../../config/db");
const schema_1 = require("../../db/schema");
const drizzle_orm_1 = require("drizzle-orm");
const errorHandler_1 = require("../../middlewares/errorHandler");
const uuid_1 = require("uuid");
class InvoicesService {
    async createInvoice(companyId, userId, data) {
        try {
            const invoiceId = (0, uuid_1.v4)();
            const invoice = await db_1.db.insert(schema_1.invoices).values({
                id: invoiceId,
                company_id: companyId,
                customer_id: data.customer_id,
                invoice_type: data.invoice_type || 'B',
                invoice_number: Math.floor(Math.random() * 1000000),
                invoice_date: new Date(),
                subtotal: '0',
                vat_amount: '0',
                total_amount: '0',
                status: 'draft',
                created_by: userId,
            }).returning();
            // Add items
            if (data.items && Array.isArray(data.items)) {
                let subtotal = 0;
                let vatAmount = 0;
                for (const item of data.items) {
                    const itemSubtotal = Number(item.unit_price) * Number(item.quantity);
                    const itemVat = itemSubtotal * (Number(item.vat_rate) / 100);
                    subtotal += itemSubtotal;
                    vatAmount += itemVat;
                    await db_1.db.insert(schema_1.invoice_items).values({
                        id: (0, uuid_1.v4)(),
                        invoice_id: invoiceId,
                        product_id: item.product_id,
                        product_name: item.product_name,
                        quantity: item.quantity,
                        unit_price: item.unit_price,
                        vat_rate: item.vat_rate,
                        subtotal: itemSubtotal.toString(),
                    });
                }
                // Update invoice totals
                const total = subtotal + vatAmount;
                await db_1.db.update(schema_1.invoices)
                    .set({
                    subtotal: subtotal.toString(),
                    vat_amount: vatAmount.toString(),
                    total_amount: total.toString(),
                })
                    .where((0, drizzle_orm_1.eq)(schema_1.invoices.id, invoiceId));
            }
            return invoice[0];
        }
        catch (error) {
            if (error instanceof errorHandler_1.ApiError)
                throw error;
            throw new errorHandler_1.ApiError(500, 'Failed to create invoice');
        }
    }
    async getInvoices(companyId, { skip = 0, limit = 50 } = {}) {
        try {
            const items = await db_1.db.select().from(schema_1.invoices)
                .where((0, drizzle_orm_1.eq)(schema_1.invoices.company_id, companyId))
                .limit(limit)
                .offset(skip);
            return { items, total: items.length, skip, limit };
        }
        catch (error) {
            throw new errorHandler_1.ApiError(500, 'Failed to get invoices');
        }
    }
    async getInvoice(companyId, invoiceId) {
        try {
            const invoice = await db_1.db.query.invoices.findFirst({
                where: (0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.invoices.company_id, companyId), (0, drizzle_orm_1.eq)(schema_1.invoices.id, invoiceId)),
            });
            if (!invoice)
                throw new errorHandler_1.ApiError(404, 'Invoice not found');
            return invoice;
        }
        catch (error) {
            if (error instanceof errorHandler_1.ApiError)
                throw error;
            throw new errorHandler_1.ApiError(500, 'Failed to get invoice');
        }
    }
    async authorizeInvoice(companyId, invoiceId) {
        try {
            const invoice = await this.getInvoice(companyId, invoiceId);
            if (invoice.status !== 'draft')
                throw new errorHandler_1.ApiError(400, 'Invoice cannot be authorized');
            // In real scenario: call AFIP WebService here
            const authorized = await db_1.db.update(schema_1.invoices)
                .set({ status: 'authorized', cae: 'CAE123456789' })
                .where((0, drizzle_orm_1.eq)(schema_1.invoices.id, invoiceId))
                .returning();
            return authorized[0];
        }
        catch (error) {
            if (error instanceof errorHandler_1.ApiError)
                throw error;
            throw new errorHandler_1.ApiError(500, 'Failed to authorize invoice');
        }
    }
}
exports.InvoicesService = InvoicesService;
exports.invoicesService = new InvoicesService();
//# sourceMappingURL=invoices.service.js.map