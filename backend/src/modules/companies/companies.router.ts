import { Router } from 'express'
import { companiesController } from './companies.controller'
import { authorize } from '../../middlewares/authorize'

const router = Router()

router.get('/me', authorize('settings', 'view'), (req, res, next) => companiesController.getMyCompany(req, res, next))
router.put('/me', authorize('settings', 'edit'), (req, res, next) => companiesController.updateMyCompany(req, res, next))
router.post('/me/certificates', authorize('settings', 'edit'), (req, res, next) => companiesController.uploadCertificates(req, res, next))
router.delete('/me/certificates', authorize('settings', 'edit'), (req, res, next) => companiesController.removeCertificates(req, res, next))

export { router as companiesRouter }
