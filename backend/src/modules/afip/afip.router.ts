import { Router } from 'express'
import { afipController } from './afip.controller'
import { authorize } from '../../middlewares/authorize'

export const afipRouter = Router()

afipRouter.post('/authorize', authorize('invoices', 'edit'), (req, res) => afipController.authorizeInvoice(req, res))
afipRouter.post('/verify-cuit', authorize('settings', 'view'), (req, res) => afipController.verifyCuit(req, res))
afipRouter.get('/authorized', authorize('invoices', 'view'), (req, res) => afipController.getAuthorizedInvoices(req, res))
afipRouter.get('/test-connection', authorize('settings', 'view'), (req, res) => afipController.testConnection(req, res))
afipRouter.get('/last-voucher', authorize('invoices', 'view'), (req, res) => afipController.getLastVoucher(req, res))
afipRouter.get('/consultar', authorize('invoices', 'view'), (req, res) => afipController.consultarComprobante(req, res))
