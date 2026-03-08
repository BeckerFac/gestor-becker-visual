import { Router } from 'express'
import { emailController } from './email.controller'
import { authorize } from '../../middlewares/authorize'

export const emailRouter = Router()

emailRouter.post('/send-invoice', authorize('invoices', 'view'), (req, res) => emailController.sendInvoiceEmail(req, res))
emailRouter.post('/test', authorize('settings', 'edit'), (req, res) => emailController.testEmail(req, res))
