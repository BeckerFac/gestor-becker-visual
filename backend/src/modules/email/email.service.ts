import { Resend } from 'resend'
import nodemailer from 'nodemailer'
import { env } from '../../config/env'
import { ApiError } from '../../middlewares/errorHandler'
import { pdfService } from '../pdf/pdf.service'
import { db } from '../../config/db'
import { invoices, customers, companies } from '../../db/schema'
import { eq } from 'drizzle-orm'
import {
  verificationEmailHtml,
  passwordResetEmailHtml,
  invitationEmailHtml,
  welcomeEmailHtml,
  invoiceEmailHtml,
} from './templates'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SendInvoiceEmailInput {
  invoiceId: string
  recipientEmail: string
  companyId: string
  message?: string
}

interface SendEmailParams {
  to: string
  subject: string
  html: string
  attachments?: Array<{
    filename: string
    content: Buffer
    contentType?: string
  }>
}

// ---------------------------------------------------------------------------
// Transport abstraction: Resend > SMTP (nodemailer) > Console (dev)
// ---------------------------------------------------------------------------

type TransportMode = 'resend' | 'smtp' | 'console'

function resolveTransportMode(): TransportMode {
  if (env.RESEND_API_KEY) return 'resend'
  if (env.SMTP_USER && env.SMTP_PASS) return 'smtp'
  return 'console'
}

// ---------------------------------------------------------------------------
// EmailService
// ---------------------------------------------------------------------------

export class EmailService {
  private readonly mode: TransportMode
  private readonly resend: Resend | null
  private readonly smtpTransporter: any // nodemailer transporter
  private readonly fromAddress: string

  constructor() {
    this.mode = resolveTransportMode()
    this.fromAddress = env.RESEND_FROM || env.SMTP_FROM || 'Gestor BeckerVisual <noreply@gestorbecker.com>'

    if (this.mode === 'resend') {
      this.resend = new Resend(env.RESEND_API_KEY)
      this.smtpTransporter = null
      console.log('[Email] Using Resend API')
    } else if (this.mode === 'smtp') {
      this.resend = null
      this.smtpTransporter = nodemailer.createTransport({
        host: env.SMTP_HOST || 'smtp.gmail.com',
        port: env.SMTP_PORT,
        secure: false,
        auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
      })
      console.log('[Email] Using SMTP (nodemailer)')
    } else {
      this.resend = null
      this.smtpTransporter = null
      console.warn('[Email] No email provider configured. Emails will be logged to console (dev mode).')
    }
  }

  // -------------------------------------------------------------------------
  // Core send method - routes to the active transport
  // -------------------------------------------------------------------------

  private async send(params: SendEmailParams): Promise<boolean> {
    if (this.mode === 'console') {
      console.log('[Email Dev] To:', params.to)
      console.log('[Email Dev] Subject:', params.subject)
      if (params.attachments?.length) {
        console.log('[Email Dev] Attachments:', params.attachments.map(a => a.filename).join(', '))
      }
      return true
    }

    if (this.mode === 'resend' && this.resend) {
      const resendPayload: any = {
        from: this.fromAddress,
        to: [params.to],
        subject: params.subject,
        html: params.html,
      }

      if (params.attachments?.length) {
        resendPayload.attachments = params.attachments.map(a => ({
          filename: a.filename,
          content: a.content,
        }))
      }

      const { error } = await this.resend.emails.send(resendPayload)
      if (error) {
        console.error('[Email] Resend error:', error)
        throw new Error(`Resend: ${error.message}`)
      }
      return true
    }

    if (this.mode === 'smtp' && this.smtpTransporter) {
      const mailOptions: any = {
        from: this.fromAddress,
        to: params.to,
        subject: params.subject,
        html: params.html,
      }

      if (params.attachments?.length) {
        mailOptions.attachments = params.attachments.map(a => ({
          filename: a.filename,
          content: a.content,
          contentType: a.contentType || 'application/octet-stream',
        }))
      }

      await this.smtpTransporter.sendMail(mailOptions)
      return true
    }

    return false
  }

  // -------------------------------------------------------------------------
  // Transactional emails
  // -------------------------------------------------------------------------

  async sendVerificationEmail(email: string, name: string, token: string): Promise<boolean> {
    try {
      const verifyUrl = `${env.FRONTEND_URL}/verify-email?token=${token}`
      const html = verificationEmailHtml({ name, verifyUrl })

      return await this.send({
        to: email,
        subject: 'Verifica tu email - Gestor BeckerVisual',
        html,
      })
    } catch (error) {
      console.error('[Email] Verification email failed:', error)
      return false
    }
  }

  async sendPasswordResetEmail(email: string, name: string, token: string): Promise<boolean> {
    try {
      const resetUrl = `${env.FRONTEND_URL}/reset-password?token=${token}`
      const html = passwordResetEmailHtml({ name, resetUrl })

      return await this.send({
        to: email,
        subject: 'Restablecer contrasena - Gestor BeckerVisual',
        html,
      })
    } catch (error) {
      console.error('[Email] Password reset email failed:', error)
      return false
    }
  }

  async sendInvitationEmail(
    email: string,
    inviterName: string,
    companyName: string,
    role: string,
    token: string,
  ): Promise<boolean> {
    try {
      const inviteUrl = `${env.FRONTEND_URL}/accept-invite?token=${token}`
      const html = invitationEmailHtml({ inviterName, companyName, role, inviteUrl })

      return await this.send({
        to: email,
        subject: `Te invitaron a ${companyName} - Gestor BeckerVisual`,
        html,
      })
    } catch (error) {
      console.error('[Email] Invitation email failed:', error)
      return false
    }
  }

  async sendWelcomeEmail(email: string, name: string, companyName: string): Promise<boolean> {
    try {
      const loginUrl = `${env.FRONTEND_URL}/login`
      const html = welcomeEmailHtml({ name, companyName, loginUrl })

      return await this.send({
        to: email,
        subject: `Bienvenido a Gestor BeckerVisual! - ${companyName}`,
        html,
      })
    } catch (error) {
      console.error('[Email] Welcome email failed:', error)
      return false
    }
  }

  // -------------------------------------------------------------------------
  // Invoice email (with PDF attachment)
  // -------------------------------------------------------------------------

  async sendInvoiceEmail(input: SendInvoiceEmailInput): Promise<boolean> {
    try {
      // Get invoice data
      const invoice = await db.query.invoices.findFirst({
        where: eq(invoices.id, input.invoiceId),
      })

      if (!invoice) {
        throw new ApiError(404, 'Invoice not found')
      }

      if (invoice.company_id !== input.companyId) {
        throw new ApiError(403, 'Unauthorized')
      }

      // Get company data
      const company = await db.query.companies.findFirst({
        where: eq(companies.id, input.companyId),
      })

      if (!company) {
        throw new ApiError(404, 'Company not found')
      }

      // Generate PDF
      const pdfBuffer = await pdfService.generateInvoicePdf({
        invoiceId: input.invoiceId,
        companyName: company.name,
        companyCuit: company.cuit,
        companyAddress: company.address || undefined,
        companyCity: company.city || undefined,
        companyProvince: company.province || undefined,
        companyPhone: company.phone || undefined,
        companyEmail: company.email || undefined,
      })

      // Resolve recipient email
      let recipientEmail = input.recipientEmail
      if (invoice.customer_id) {
        const customer = await db.query.customers.findFirst({
          where: eq(customers.id, invoice.customer_id),
        })
        if (customer?.email) {
          recipientEmail = customer.email
        }
      }

      const html = invoiceEmailHtml({
        invoiceNumber: String(invoice.invoice_number),
        invoiceType: invoice.invoice_type || '',
        companyName: company.name,
        cae: invoice.cae,
        message: input.message,
      })

      return await this.send({
        to: recipientEmail,
        subject: `Factura ${invoice.invoice_type}${invoice.invoice_number} - ${company.name}`,
        html,
        attachments: [
          {
            filename: `factura-${invoice.invoice_number}.pdf`,
            content: pdfBuffer,
            contentType: 'application/pdf',
          },
        ],
      })
    } catch (error) {
      if (error instanceof ApiError) throw error
      throw new ApiError(500, `Email sending failed: ${(error as any).message}`)
    }
  }
}

export const emailService = new EmailService()
