import { Request, Response } from 'express'
import { emailService } from './email.service'
import { AuthRequest } from '../../middlewares/auth'
import { ApiError } from '../../middlewares/errorHandler'

export class EmailController {
  async sendInvoiceEmail(req: AuthRequest, res: Response) {
    try {
      const { invoiceId, recipientEmail, message } = req.body

      if (!invoiceId) {
        throw new ApiError(400, 'Invoice ID required')
      }

      if (!recipientEmail) {
        throw new ApiError(400, 'Recipient email required')
      }

      if (!req.user?.company_id) {
        throw new ApiError(401, 'Not authenticated')
      }

      // Send invoice email
      const success = await emailService.sendInvoiceEmail({
        invoiceId,
        recipientEmail,
        companyId: req.user.company_id,
        message,
      })

      if (!success) {
        throw new ApiError(500, 'Failed to send email')
      }

      return res.json({
        message: 'Invoice email sent successfully',
        recipientEmail,
        invoiceId,
      })
    } catch (error) {
      if (error instanceof ApiError) {
        return res.status(error.statusCode).json({ error: error.message })
      }
      return res.status(500).json({ error: 'Email sending failed' })
    }
  }

  async testEmail(req: AuthRequest, res: Response) {
    try {
      const { recipientEmail } = req.body

      if (!recipientEmail) {
        throw new ApiError(400, 'Recipient email required')
      }

      if (!req.user?.id || !req.user?.company_id) {
        throw new ApiError(401, 'Not authenticated')
      }

      // Send test email
      const success = await emailService.sendWelcomeEmail(
        recipientEmail,
        req.user.email,
        'Gestor BeckerVisual'
      )

      if (!success) {
        throw new ApiError(500, 'Failed to send test email')
      }

      return res.json({
        message: 'Test email sent successfully',
        recipientEmail,
      })
    } catch (error) {
      if (error instanceof ApiError) {
        return res.status(error.statusCode).json({ error: error.message })
      }
      return res.status(500).json({ error: 'Email test failed' })
    }
  }
}

export const emailController = new EmailController()
