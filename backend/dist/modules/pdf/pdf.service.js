"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.pdfService = exports.PdfService = void 0;
const puppeteer_1 = __importDefault(require("puppeteer"));
const db_1 = require("../../config/db");
const schema_1 = require("../../db/schema");
const drizzle_orm_1 = require("drizzle-orm");
const errorHandler_1 = require("../../middlewares/errorHandler");
class PdfService {
    constructor() {
        this.browser = null;
    }
    async initialize() {
        if (!this.browser) {
            this.browser = await puppeteer_1.default.launch({
                headless: 'new',
                args: ['--no-sandbox', '--disable-setuid-sandbox'],
            });
        }
    }
    async generateInvoicePdf(input) {
        try {
            await this.initialize();
            // Get invoice data
            const invoice = await db_1.db.query.invoices.findFirst({
                where: (0, drizzle_orm_1.eq)(schema_1.invoices.id, input.invoiceId),
            });
            if (!invoice) {
                throw new errorHandler_1.ApiError(404, 'Invoice not found');
            }
            // Get invoice items
            const items = await db_1.db.query.invoice_items.findMany({
                where: (0, drizzle_orm_1.eq)(schema_1.invoice_items.invoice_id, input.invoiceId),
            });
            // Get customer data
            const customer = invoice.customer_id
                ? await db_1.db.query.customers.findFirst({
                    where: (0, drizzle_orm_1.eq)(schema_1.customers.id, invoice.customer_id),
                })
                : null;
            // Generate HTML
            const html = this.generateInvoiceHtml({
                invoice,
                items,
                customer,
                company: input,
            });
            // Convert to PDF using Puppeteer
            if (!this.browser) {
                throw new Error('Browser not initialized');
            }
            const page = await this.browser.newPage();
            await page.setContent(html, { waitUntil: 'networkidle0' });
            const pdf = await page.pdf({
                format: 'A4',
                margin: { top: '20px', right: '20px', bottom: '20px', left: '20px' },
            });
            await page.close();
            return pdf;
        }
        catch (error) {
            if (error instanceof errorHandler_1.ApiError)
                throw error;
            throw new errorHandler_1.ApiError(500, `PDF generation failed: ${error.message}`);
        }
    }
    generateInvoiceHtml(data) {
        const { invoice, items, customer, company } = data;
        return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>Factura ${invoice.invoice_number}</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 0; padding: 20px; }
          .header { border-bottom: 2px solid #333; padding-bottom: 20px; margin-bottom: 20px; }
          .company-info { float: left; width: 50%; }
          .invoice-info { float: right; width: 50%; text-align: right; }
          .customer-info { clear: both; margin: 20px 0; padding: 10px; background: #f9f9f9; }
          table { width: 100%; border-collapse: collapse; margin: 20px 0; }
          th { background: #333; color: white; padding: 10px; text-align: left; }
          td { padding: 10px; border-bottom: 1px solid #ddd; }
          .total-row { font-weight: bold; background: #f0f0f0; }
          .footer { margin-top: 40px; border-top: 1px solid #ddd; padding-top: 20px; font-size: 12px; color: #666; }
          h1 { margin: 0; color: #333; }
          .badge { display: inline-block; padding: 5px 10px; border-radius: 4px; font-weight: bold; }
          .authorized { background: #4CAF50; color: white; }
          .draft { background: #FFC107; color: black; }
        </style>
      </head>
      <body>
        <div class="header">
          <div class="company-info">
            <h1>${company.companyName}</h1>
            ${company.companyAddress ? `<p>${company.companyAddress}</p>` : ''}
            ${company.companyPhone ? `<p>Tel: ${company.companyPhone}</p>` : ''}
            ${company.companyEmail ? `<p>Email: ${company.companyEmail}</p>` : ''}
          </div>
          <div class="invoice-info">
            <h2>FACTURA ${invoice.invoice_type}</h2>
            <p><strong>Número:</strong> ${invoice.invoice_number}</p>
            <p><strong>Fecha:</strong> ${new Date(invoice.invoice_date).toLocaleDateString('es-AR')}</p>
            <p class="badge ${invoice.status === 'authorized' ? 'authorized' : 'draft'}">
              ${invoice.status.toUpperCase()}
            </p>
            ${invoice.cae ? `<p><strong>CAE:</strong> ${invoice.cae}</p>` : ''}
          </div>
        </div>

        <div class="customer-info">
          <h3>Cliente</h3>
          ${customer
            ? `
            <p><strong>${customer.name}</strong></p>
            <p>CUIT: ${customer.cuit}</p>
            ${customer.address ? `<p>${customer.address}</p>` : ''}
            ${customer.email ? `<p>Email: ${customer.email}</p>` : ''}
          `
            : '<p>Cliente: Consumidor Final</p>'}
        </div>

        <table>
          <thead>
            <tr>
              <th>Descripción</th>
              <th style="text-align: right;">Cantidad</th>
              <th style="text-align: right;">Precio Unitario</th>
              <th style="text-align: right;">Subtotal</th>
            </tr>
          </thead>
          <tbody>
            ${items
            .map((item) => `
              <tr>
                <td>${item.description}</td>
                <td style="text-align: right;">${item.quantity}</td>
                <td style="text-align: right;">$${parseFloat(item.unit_price).toFixed(2)}</td>
                <td style="text-align: right;">$${(item.quantity * item.unit_price).toFixed(2)}</td>
              </tr>
            `)
            .join('')}
            <tr class="total-row">
              <td colspan="3" style="text-align: right;">Subtotal:</td>
              <td style="text-align: right;">$${parseFloat(invoice.subtotal).toFixed(2)}</td>
            </tr>
            <tr class="total-row">
              <td colspan="3" style="text-align: right;">IVA (21%):</td>
              <td style="text-align: right;">$${parseFloat(invoice.vat_amount).toFixed(2)}</td>
            </tr>
            <tr class="total-row" style="font-size: 18px;">
              <td colspan="3" style="text-align: right;">TOTAL:</td>
              <td style="text-align: right;">$${parseFloat(invoice.total_amount).toFixed(2)}</td>
            </tr>
          </tbody>
        </table>

        <div class="footer">
          <p>Generado por Gestor BeckerVisual - ${new Date().toLocaleDateString('es-AR')} ${new Date().toLocaleTimeString('es-AR')}</p>
          ${invoice.cae ? `<p>Comprobante autorizado por AFIP. CAE: ${invoice.cae}</p>` : ''}
        </div>
      </body>
      </html>
    `;
    }
    async generateCatalogPdf(products, companyName) {
        try {
            await this.initialize();
            const html = this.generateCatalogHtml(products, companyName);
            if (!this.browser) {
                throw new Error('Browser not initialized');
            }
            const page = await this.browser.newPage();
            await page.setContent(html, { waitUntil: 'networkidle0' });
            const pdf = await page.pdf({
                format: 'A4',
                margin: { top: '20px', right: '20px', bottom: '20px', left: '20px' },
            });
            await page.close();
            return pdf;
        }
        catch (error) {
            throw new errorHandler_1.ApiError(500, `Catalog PDF generation failed: ${error.message}`);
        }
    }
    generateCatalogHtml(products, companyName) {
        return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>Catálogo - ${companyName}</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 0; padding: 20px; background: #f5f5f5; }
          h1 { text-align: center; color: #333; border-bottom: 3px solid #0066cc; padding-bottom: 20px; }
          .products-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 20px; }
          .product-card {
            background: white; padding: 15px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);
          }
          .product-name { font-weight: bold; font-size: 16px; color: #333; margin-bottom: 10px; }
          .product-sku { color: #999; font-size: 12px; margin-bottom: 10px; }
          .product-price { font-size: 20px; font-weight: bold; color: #0066cc; }
          .footer { margin-top: 40px; text-align: center; color: #666; font-size: 12px; border-top: 1px solid #ddd; padding-top: 20px; }
        </style>
      </head>
      <body>
        <h1>${companyName}</h1>
        <h2 style="text-align: center; color: #666;">Catálogo de Productos</h2>

        <div class="products-grid">
          ${products
            .map((p) => `
            <div class="product-card">
              <div class="product-name">${p.name}</div>
              <div class="product-sku">SKU: ${p.sku}</div>
              <div class="product-price">$${p.final_price || 'Consultar'}</div>
            </div>
          `)
            .join('')}
        </div>

        <div class="footer">
          <p>Catálogo vigente desde ${new Date().toLocaleDateString('es-AR')}</p>
          <p>Para más información, contacte con nosotros</p>
        </div>
      </body>
      </html>
    `;
    }
    async close() {
        if (this.browser) {
            await this.browser.close();
            this.browser = null;
        }
    }
}
exports.PdfService = PdfService;
exports.pdfService = new PdfService();
//# sourceMappingURL=pdf.service.js.map