import { Router } from 'express'
import { afipController } from './afip.controller'

export const afipRouter = Router()

afipRouter.post('/authorize', (req, res) => afipController.authorizeInvoice(req, res))
afipRouter.post('/verify-cuit', (req, res) => afipController.verifyCuit(req, res))
afipRouter.get('/authorized', (req, res) => afipController.getAuthorizedInvoices(req, res))
