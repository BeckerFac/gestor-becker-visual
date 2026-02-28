"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pdfController = exports.PdfController = void 0;
const pdf_service_1 = require("./pdf.service");
const errorHandler_1 = require("../../middlewares/errorHandler");
const db_1 = require("../../config/db");
const schema_1 = require("../../db/schema");
const drizzle_orm_1 = require("drizzle-orm");
class PdfController {
    async generateInvoicePdf(req, res) {
        try {
            const { invoiceId } = req.params;
            if (!invoiceId || !req.user?.company_id) {
                throw new errorHandler_1.ApiError(400, 'Invoice ID and company required');
            }
            // Get invoice to verify ownership
            const invoice = await db_1.db.query.invoices.findFirst({
                where: (0, drizzle_orm_1.eq)(schema_1.invoices.id, invoiceId),
            });
            if (!invoice || invoice.company_id !== req.user.company_id) {
                throw new errorHandler_1.ApiError(403, 'Unauthorized to access this invoice');
            }
            // Get company data
            const company = await db_1.db.query.companies.findFirst({
                where: (0, drizzle_orm_1.eq)(schema_1.companies.id, req.user.company_id),
            });
            if (!company) {
                throw new errorHandler_1.ApiError(404, 'Company not found');
            }
            // Generate PDF
            const pdfBuffer = await pdf_service_1.pdfService.generateInvoicePdf({
                invoiceId,
                companyName: company.name,
                companyAddress: company.address || undefined,
                companyPhone: company.phone || undefined,
                companyEmail: company.email || undefined,
            });
            // Send PDF
            res.contentType('application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename="factura-${invoice.invoice_number}.pdf"`);
            res.send(pdfBuffer);
        }
        catch (error) {
            if (error instanceof errorHandler_1.ApiError) {
                return res.status(error.statusCode).json({ error: error.message });
            }
            return res.status(500).json({ error: 'PDF generation failed' });
        }
    }
    async generateCatalogPdf(req, res) {
        try {
            if (!req.user?.company_id) {
                throw new errorHandler_1.ApiError(401, 'Not authenticated');
            }
            // Get company
            const company = await db_1.db.query.companies.findFirst({
                where: (0, drizzle_orm_1.eq)(schema_1.companies.id, req.user.company_id),
            });
            if (!company) {
                throw new errorHandler_1.ApiError(404, 'Company not found');
            }
            // Get all active products
            const allProducts = await db_1.db.query.products.findMany({
                where: (0, drizzle_orm_1.eq)(schema_1.products.company_id, req.user.company_id),
            });
            // Filter by request body if provided
            const { productIds } = req.body;
            const productsToInclude = productIds
                ? allProducts.filter((p) => productIds.includes(p.id))
                : allProducts;
            // Generate PDF
            const pdfBuffer = await pdf_service_1.pdfService.generateCatalogPdf(productsToInclude, company.name);
            // Send PDF
            res.contentType('application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename="catalogo-${company.name}.pdf"`);
            res.send(pdfBuffer);
        }
        catch (error) {
            if (error instanceof errorHandler_1.ApiError) {
                return res.status(error.statusCode).json({ error: error.message });
            }
            return res.status(500).json({ error: 'Catalog PDF generation failed' });
        }
    }
}
exports.PdfController = PdfController;
exports.pdfController = new PdfController();
//# sourceMappingURL=pdf.controller.js.map