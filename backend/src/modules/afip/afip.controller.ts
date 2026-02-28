import { Request, Response } from 'express'
import { afipService, AuthorizeInvoiceInput } from './afip.service'
import { AuthRequest } from '../../middlewares/auth'
import { ApiError } from '../../middlewares/errorHandler'
import { db } from '../../config/db'
import { invoices as invoicesTable } from '../../db/schema'
import { eq, and } from 'drizzle-orm'

export class AfipController {
  async authorizeInvoice(req: AuthRequest, res: Response) {
    try {
      const { invoiceId } = req.params

      if (!invoiceId || !req.user?.id) {
        throw new ApiError(400, 'Invoice ID and user required')
      }

      // Get invoice from database
      const invoice = await db.query.invoices.findFirst({
        where: eq(invoicesTable.id, invoiceId),
      })

      if (!invoice) {
        throw new ApiError(404, 'Invoice not found')
      }

      if (invoice.company_id !== req.user.company_id) {
        throw new ApiError(403, 'Unauthorized to access this invoice')
      }

      if (invoice.status === 'authorized') {
        return res.json({
          message: 'Invoice already authorized',
          cae: invoice.cae,
        })
      }

      // Prepare authorization request
      const authInput: AuthorizeInvoiceInput = {
        invoiceId,
        invoiceNumber: invoice.invoice_number,
        invoiceType: (invoice.invoice_type || 'B') as 'A' | 'B' | 'C',
        customerId: invoice.customer_id || '',
        subtotal: parseFloat(invoice.subtotal.toString()),
        vat: parseFloat(invoice.vat_amount.toString()),
        total: parseFloat(invoice.total_amount.toString()),
      }

      // Authorize with AFIP
      const authorization = await afipService.authorizeInvoice(authInput)

      // Save authorization to database
      await afipService.saveAuthorizedInvoice(invoiceId, authorization)

      return res.json({
        message: 'Invoice authorized successfully',
        authorization,
      })
    } catch (error) {
      if (error instanceof ApiError) {
        return res.status(error.statusCode).json({ error: error.message })
      }
      return res.status(500).json({ error: 'Authorization failed' })
    }
  }

  async verifyCuit(req: Request, res: Response) {
    try {
      const { cuit } = req.body

      if (!cuit) {
        throw new ApiError(400, 'CUIT required')
      }

      const result = await afipService.verifyCuit(cuit)

      return res.json({
        cuit,
        valid: result.valid,
        name: result.name,
      })
    } catch (error) {
      if (error instanceof ApiError) {
        return res.status(error.statusCode).json({ error: error.message })
      }
      return res.status(500).json({ error: 'Verification failed' })
    }
  }

  async getAuthorizedInvoices(req: AuthRequest, res: Response) {
    try {
      if (!req.user?.company_id) {
        throw new ApiError(401, 'Not authenticated')
      }

      // Get all authorized invoices for company
      const authorized = await db.query.invoices.findMany({
        where: and(
          eq(invoicesTable.company_id, req.user.company_id),
          eq(invoicesTable.status, 'authorized')
        ),
      })

      return res.json({
        items: authorized,
        total: authorized.length,
      })
    } catch (error) {
      if (error instanceof ApiError) {
        return res.status(error.statusCode).json({ error: error.message })
      }
      return res.status(500).json({ error: 'Failed to get authorized invoices' })
    }
  }
}

export const afipController = new AfipController()
