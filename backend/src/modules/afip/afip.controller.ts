import { Request, Response } from 'express'
import { afipService, AuthorizeInvoiceInput } from './afip.service'
import { AuthRequest } from '../../middlewares/auth'
import { ApiError } from '../../middlewares/errorHandler'
import { db } from '../../config/db'
import { invoices as invoicesTable, customers } from '../../db/schema'
import { eq, and } from 'drizzle-orm'

export class AfipController {
  async authorizeInvoice(req: AuthRequest, res: Response) {
    try {
      const { invoiceId } = req.body

      if (!invoiceId || !req.user?.company_id) {
        throw new ApiError(400, 'Se requiere invoiceId')
      }

      const companyId = req.user.company_id

      // Get invoice
      const invoice = await db.query.invoices.findFirst({
        where: and(eq(invoicesTable.id, invoiceId), eq(invoicesTable.company_id, companyId)),
      })

      if (!invoice) throw new ApiError(404, 'Factura no encontrada')
      if (invoice.status === 'authorized') {
        return res.json({ message: 'Factura ya autorizada', cae: invoice.cae })
      }

      // Get customer CUIT if exists
      let customerCuit = ''
      if (invoice.customer_id) {
        const customer = await db.query.customers.findFirst({
          where: eq(customers.id, invoice.customer_id),
        })
        if (customer) customerCuit = customer.cuit || ''
      }

      const authInput: AuthorizeInvoiceInput = {
        invoiceId,
        invoiceNumber: invoice.invoice_number,
        invoiceType: (invoice.invoice_type || 'B') as 'A' | 'B' | 'C',
        customerCuit,
        subtotal: parseFloat(invoice.subtotal.toString()),
        vat: parseFloat(invoice.vat_amount.toString()),
        total: parseFloat(invoice.total_amount.toString()),
        invoiceDate: invoice.invoice_date ? new Date(invoice.invoice_date) : new Date(),
        puntoVenta: req.body.punto_venta || 1,
      }

      const authorization = await afipService.authorizeInvoice(companyId, authInput)
      await afipService.saveAuthorizedInvoice(invoiceId, authorization)

      return res.json({
        message: 'Factura autorizada exitosamente',
        authorization,
      })
    } catch (error) {
      if (error instanceof ApiError) {
        return res.status(error.statusCode).json({ error: error.message })
      }
      console.error('AFIP authorize error:', error)
      return res.status(500).json({ error: 'Error al autorizar factura' })
    }
  }

  async verifyCuit(req: AuthRequest, res: Response) {
    try {
      const { cuit } = req.body
      if (!cuit) throw new ApiError(400, 'CUIT requerido')

      const result = await afipService.verifyCuit(req.user!.company_id, cuit)
      return res.json(result)
    } catch (error) {
      if (error instanceof ApiError) {
        return res.status(error.statusCode).json({ error: error.message })
      }
      return res.status(500).json({ error: 'Error al verificar CUIT' })
    }
  }

  async getAuthorizedInvoices(req: AuthRequest, res: Response) {
    try {
      if (!req.user?.company_id) throw new ApiError(401, 'No autenticado')

      const authorized = await db.query.invoices.findMany({
        where: and(
          eq(invoicesTable.company_id, req.user.company_id),
          eq(invoicesTable.status, 'authorized')
        ),
      })

      return res.json({ items: authorized, total: authorized.length })
    } catch (error) {
      if (error instanceof ApiError) {
        return res.status(error.statusCode).json({ error: error.message })
      }
      return res.status(500).json({ error: 'Error al obtener facturas autorizadas' })
    }
  }

  async testConnection(req: AuthRequest, res: Response) {
    try {
      if (!req.user?.company_id) throw new ApiError(401, 'No autenticado')
      const result = await afipService.testConnection(req.user.company_id)
      return res.json(result)
    } catch (error) {
      if (error instanceof ApiError) {
        return res.status(error.statusCode).json({ error: error.message })
      }
      return res.status(500).json({ error: 'Error al probar conexión' })
    }
  }

  async consultarComprobante(req: AuthRequest, res: Response) {
    try {
      if (!req.user?.company_id) throw new ApiError(401, 'No autenticado')
      const puntoVenta = parseInt(req.query.punto_venta as string) || 3
      const invoiceType = (req.query.invoice_type as string) || 'C'
      const cbteNro = parseInt(req.query.cbte_nro as string)

      if (!cbteNro) throw new ApiError(400, 'cbte_nro requerido')

      const result = await afipService.consultarComprobante(
        req.user.company_id, puntoVenta, invoiceType, cbteNro
      )
      return res.json({ exists: true, comprobante: result })
    } catch (error) {
      if (error instanceof ApiError) {
        return res.status(error.statusCode).json({ exists: false, error: error.message })
      }
      return res.status(500).json({ exists: false, error: 'Error al consultar comprobante' })
    }
  }

  async getLastVoucher(req: AuthRequest, res: Response) {
    try {
      if (!req.user?.company_id) throw new ApiError(401, 'No autenticado')
      const puntoVenta = parseInt(req.query.punto_venta as string) || 1
      const invoiceType = (req.query.invoice_type as string) || 'B'

      const lastNumber = await afipService.getLastVoucherNumber(
        req.user.company_id, puntoVenta, invoiceType
      )
      return res.json({ lastVoucher: lastNumber, puntoVenta, invoiceType })
    } catch (error) {
      if (error instanceof ApiError) {
        return res.status(error.statusCode).json({ error: error.message })
      }
      return res.status(500).json({ error: 'Error al obtener último comprobante' })
    }
  }
}

export const afipController = new AfipController()
