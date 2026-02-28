"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.emailController = exports.EmailController = void 0;
const email_service_1 = require("./email.service");
const errorHandler_1 = require("../../middlewares/errorHandler");
class EmailController {
    async sendInvoiceEmail(req, res) {
        try {
            const { invoiceId, recipientEmail, message } = req.body;
            if (!invoiceId) {
                throw new errorHandler_1.ApiError(400, 'Invoice ID required');
            }
            if (!recipientEmail) {
                throw new errorHandler_1.ApiError(400, 'Recipient email required');
            }
            if (!req.user?.company_id) {
                throw new errorHandler_1.ApiError(401, 'Not authenticated');
            }
            // Send invoice email
            const success = await email_service_1.emailService.sendInvoiceEmail({
                invoiceId,
                recipientEmail,
                companyId: req.user.company_id,
                message,
            });
            if (!success) {
                throw new errorHandler_1.ApiError(500, 'Failed to send email');
            }
            return res.json({
                message: 'Invoice email sent successfully',
                recipientEmail,
                invoiceId,
            });
        }
        catch (error) {
            if (error instanceof errorHandler_1.ApiError) {
                return res.status(error.statusCode).json({ error: error.message });
            }
            return res.status(500).json({ error: 'Email sending failed' });
        }
    }
    async testEmail(req, res) {
        try {
            const { recipientEmail } = req.body;
            if (!recipientEmail) {
                throw new errorHandler_1.ApiError(400, 'Recipient email required');
            }
            if (!req.user?.id || !req.user?.company_id) {
                throw new errorHandler_1.ApiError(401, 'Not authenticated');
            }
            // Send test email
            const success = await email_service_1.emailService.sendWelcomeEmail(recipientEmail, req.user.email, 'Gestor BeckerVisual');
            if (!success) {
                throw new errorHandler_1.ApiError(500, 'Failed to send test email');
            }
            return res.json({
                message: 'Test email sent successfully',
                recipientEmail,
            });
        }
        catch (error) {
            if (error instanceof errorHandler_1.ApiError) {
                return res.status(error.statusCode).json({ error: error.message });
            }
            return res.status(500).json({ error: 'Email test failed' });
        }
    }
}
exports.EmailController = EmailController;
exports.emailController = new EmailController();
//# sourceMappingURL=email.controller.js.map