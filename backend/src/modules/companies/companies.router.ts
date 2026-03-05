import { Router } from 'express'
import { companiesController } from './companies.controller'

const router = Router()

router.get('/me', (req, res, next) => companiesController.getMyCompany(req, res, next))
router.put('/me', (req, res, next) => companiesController.updateMyCompany(req, res, next))
router.post('/me/certificates', (req, res, next) => companiesController.uploadCertificates(req, res, next))
router.delete('/me/certificates', (req, res, next) => companiesController.removeCertificates(req, res, next))

export { router as companiesRouter }
