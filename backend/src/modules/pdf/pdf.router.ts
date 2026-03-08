import { Router } from 'express'
import { pdfController } from './pdf.controller'
import { authorize } from '../../middlewares/authorize'

export const pdfRouter = Router()

pdfRouter.get('/invoice/:invoiceId', authorize('invoices', 'view'), (req, res) => pdfController.generateInvoicePdf(req, res))
pdfRouter.post('/catalog', authorize('products', 'view'), (req, res) => pdfController.generateCatalogPdf(req, res))
