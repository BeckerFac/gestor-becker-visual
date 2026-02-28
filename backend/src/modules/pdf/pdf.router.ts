import { Router } from 'express'
import { pdfController } from './pdf.controller'

export const pdfRouter = Router()

pdfRouter.get('/invoice/:invoiceId', (req, res) => pdfController.generateInvoicePdf(req, res))
pdfRouter.post('/catalog', (req, res) => pdfController.generateCatalogPdf(req, res))
