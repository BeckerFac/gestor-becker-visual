"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.emailService = exports.EmailService = void 0;
const nodemailer_1 = __importDefault(require("nodemailer"));
const env_1 = require("../../config/env");
const errorHandler_1 = require("../../middlewares/errorHandler");
const pdf_service_1 = require("../pdf/pdf.service");
const db_1 = require("../../config/db");
const schema_1 = require("../../db/schema");
const drizzle_orm_1 = require("drizzle-orm");
class EmailService {
    constructor() {
        this.initializeTransporter();
    }
    initializeTransporter() {
        // Use environment variables for email config
        const emailConfig = {
            host: env_1.env.SMTP_HOST || 'smtp.gmail.com',
            port: parseInt(process.env.SMTP_PORT || '587', 10),
            secure: false, // true for 465, false for 587
            auth: {
                user: env_1.env.SMTP_USER,
                pass: env_1.env.SMTP_PASS,
            },
        };
        // For testing without real email, use nodemailer test account
        if (!env_1.env.SMTP_USER || !env_1.env.SMTP_PASS) {
            console.warn('⚠️  Email config not complete. Using test mode.');
            this.transporter = null;
        }
        else {
            this.transporter = nodemailer_1.default.createTransport(emailConfig);
        }
    }
    async sendInvoiceEmail(input) {
        try {
            // Get invoice data
            const invoice = await db_1.db.query.invoices.findFirst({
                where: (0, drizzle_orm_1.eq)(schema_1.invoices.id, input.invoiceId),
            });
            if (!invoice) {
                throw new errorHandler_1.ApiError(404, 'Invoice not found');
            }
            if (invoice.company_id !== input.companyId) {
                throw new errorHandler_1.ApiError(403, 'Unauthorized');
            }
            // Get company data
            const company = await db_1.db.query.companies.findFirst({
                where: (0, drizzle_orm_1.eq)(schema_1.companies.id, input.companyId),
            });
            if (!company) {
                throw new errorHandler_1.ApiError(404, 'Company not found');
            }
            // Generate PDF
            const pdfBuffer = await pdf_service_1.pdfService.generateInvoicePdf({
                invoiceId: input.invoiceId,
                companyName: company.name,
                companyAddress: company.address || undefined,
                companyPhone: company.phone || undefined,
                companyEmail: company.email || undefined,
            });
            // Get customer email
            let recipientEmail = input.recipientEmail;
            if (invoice.customer_id) {
                const customer = await db_1.db.query.customers.findFirst({
                    where: (0, drizzle_orm_1.eq)(schema_1.customers.id, invoice.customer_id),
                });
                if (customer?.email) {
                    recipientEmail = customer.email;
                }
            }
            // Send email
            if (!this.transporter) {
                console.log('📧 Test Mode: Email would be sent to', recipientEmail);
                console.log('📎 Attachment: Factura', invoice.invoice_number);
                return true;
            }
            const mailOptions = {
                from: env_1.env.SMTP_FROM || env_1.env.SMTP_USER,
                to: recipientEmail,
                subject: `Factura ${invoice.invoice_type}${invoice.invoice_number} - ${company.name}`,
                html: this.generateEmailBody({
                    invoiceNumber: invoice.invoice_number,
                    invoiceType: invoice.invoice_type,
                    companyName: company.name,
                    cae: invoice.cae,
                    message: input.message,
                }),
                attachments: [
                    {
                        filename: `factura-${invoice.invoice_number}.pdf`,
                        content: pdfBuffer,
                        contentType: 'application/pdf',
                    },
                ],
            };
            await this.transporter.sendMail(mailOptions);
            return true;
        }
        catch (error) {
            if (error instanceof errorHandler_1.ApiError)
                throw error;
            throw new errorHandler_1.ApiError(500, `Email sending failed: ${error.message}`);
        }
    }
    async sendWelcomeEmail(email, name, companyName) {
        try {
            if (!this.transporter) {
                console.log('📧 Test Mode: Welcome email to', email);
                return true;
            }
            const mailOptions = {
                from: env_1.env.SMTP_FROM || env_1.env.SMTP_USER,
                to: email,
                subject: `¡Bienvenido a Gestor BeckerVisual! - ${companyName}`,
                html: `
          <h1>¡Bienvenido a Gestor BeckerVisual!</h1>
          <p>Hola <strong>${name}</strong>,</p>
          <p>Tu cuenta ha sido creada exitosamente para <strong>${companyName}</strong>.</p>
          <p>Ahora puedes:</p>
          <ul>
            <li>Gestionar tus productos y precios</li>
            <li>Administrar clientes</li>
            <li>Crear facturas electrónicas autorizadas por AFIP</li>
            <li>Generar catálogos en PDF</li>
            <li>Enviar facturas por email</li>
          </ul>
          <p><a href="http://localhost:5173" style="background: #0066cc; color: white; padding: 10px 20px; text-decoration: none; border-radius: 4px; display: inline-block;">Inicia Sesión Ahora</a></p>
          <p>Si tienes dudas, contacta con nuestro equipo de soporte.</p>
          <p>Saludos,<br/>Gestor BeckerVisual</p>
        `,
            };
            await this.transporter.sendMail(mailOptions);
            return true;
        }
        catch (error) {
            console.error('Welcome email failed:', error);
            return false;
        }
    }
    generateEmailBody(data) {
        return `
      <html>
      <body style="font-family: Arial, sans-serif; color: #333;">
        <h2>Factura ${data.invoiceType}${data.invoiceNumber}</h2>
        <p>Estimado cliente,</p>
        <p>Le adjuntamos la factura por su compra en <strong>${data.companyName}</strong>.</p>

        ${data.cae
            ? `
          <div style="background: #f0f0f0; padding: 15px; border-radius: 4px; margin: 20px 0;">
            <p><strong>Estado:</strong> Autorizada por AFIP</p>
            <p><strong>CAE:</strong> ${data.cae}</p>
          </div>
        `
            : ''}

        ${data.message
            ? `
          <div style="background: #fff3cd; padding: 15px; border-left: 4px solid #ffc107; margin: 20px 0;">
            <p>${data.message}</p>
          </div>
        `
            : ''}

        <p>Puede revisar los detalles de la factura en el archivo PDF adjunto.</p>
        <p>Gracias por su compra.</p>
        <hr style="border: none; border-top: 1px solid #ddd; margin: 30px 0;">
        <p style="font-size: 12px; color: #999;">
          Este es un correo automático. Por favor no responda a este mensaje.
        </p>
      </body>
      </html>
    `;
    }
}
exports.EmailService = EmailService;
exports.emailService = new EmailService();
//# sourceMappingURL=email.service.js.map