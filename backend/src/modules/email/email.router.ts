import { Router } from 'express'
import { emailController } from './email.controller'

export const emailRouter = Router()

emailRouter.post('/send-invoice', (req, res) => emailController.sendInvoiceEmail(req, res))
emailRouter.post('/test', (req, res) => emailController.testEmail(req, res))
