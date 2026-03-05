import { Request, Response } from 'express'
import { pdfService } from './pdf.service'
import { AuthRequest } from '../../middlewares/auth'
import { ApiError } from '../../middlewares/errorHandler'
import { db } from '../../config/db'
import { invoices as invoicesTable, companies, products } from '../../db/schema'
import { eq } from 'drizzle-orm'

export class PdfController {
  async generateInvoicePdf(req: AuthRequest, res: Response) {
    try {
      const { invoiceId } = req.params

      if (!invoiceId || !req.user?.company_id) {
        throw new ApiError(400, 'Invoice ID and company required')
      }

      // Get invoice to verify ownership
      const invoice = await db.query.invoices.findFirst({
        where: eq(invoicesTable.id, invoiceId),
      })

      if (!invoice || invoice.company_id !== req.user.company_id) {
        throw new ApiError(403, 'Unauthorized to access this invoice')
      }

      // Get company data
      const company = await db.query.companies.findFirst({
        where: eq(companies.id, req.user.company_id),
      })

      if (!company) {
        throw new ApiError(404, 'Company not found')
      }

      // Generate PDF
      const pdfBuffer = await pdfService.generateInvoicePdf({
        invoiceId,
        companyName: company.name,
        companyCuit: company.cuit,
        companyAddress: company.address || undefined,
        companyCity: company.city || undefined,
        companyProvince: company.province || undefined,
        companyPhone: company.phone || undefined,
        companyEmail: company.email || undefined,
      })

      // Send PDF
      res.contentType('application/pdf')
      res.setHeader('Content-Disposition', `attachment; filename="factura-${invoice.invoice_number}.pdf"`)
      res.send(pdfBuffer)
    } catch (error) {
      if (error instanceof ApiError) {
        return res.status(error.statusCode).json({ error: error.message })
      }
      return res.status(500).json({ error: 'PDF generation failed' })
    }
  }

  async generateCatalogPdf(req: AuthRequest, res: Response) {
    try {
      if (!req.user?.company_id) {
        throw new ApiError(401, 'Not authenticated')
      }

      // Get company
      const company = await db.query.companies.findFirst({
        where: eq(companies.id, req.user.company_id),
      })

      if (!company) {
        throw new ApiError(404, 'Company not found')
      }

      // Get all active products
      const allProducts = await db.query.products.findMany({
        where: eq(products.company_id, req.user.company_id),
      })

      // Filter by request body if provided
      const { productIds } = req.body
      const productsToInclude = productIds
        ? allProducts.filter((p) => productIds.includes(p.id))
        : allProducts

      // Generate PDF
      const pdfBuffer = await pdfService.generateCatalogPdf(productsToInclude, company.name)

      // Send PDF
      res.contentType('application/pdf')
      res.setHeader('Content-Disposition', `attachment; filename="catalogo-${company.name}.pdf"`)
      res.send(pdfBuffer)
    } catch (error) {
      if (error instanceof ApiError) {
        return res.status(error.statusCode).json({ error: error.message })
      }
      return res.status(500).json({ error: 'Catalog PDF generation failed' })
    }
  }
}

export const pdfController = new PdfController()
