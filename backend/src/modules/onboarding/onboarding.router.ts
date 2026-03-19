import { Router } from 'express';
import { onboardingController } from './onboarding.controller';

const router = Router();

router.get('/status', (req, res, next) => onboardingController.getStatus(req as any, res, next));
router.put('/step/:step', (req, res, next) => onboardingController.completeStep(req as any, res, next));
router.post('/complete', (req, res, next) => onboardingController.complete(req as any, res, next));
router.post('/reset', (req, res, next) => onboardingController.reset(req as any, res, next));
router.put('/modules', (req, res, next) => onboardingController.updateModules(req as any, res, next));
router.post('/cuit-lookup', (req, res, next) => onboardingController.lookupCUIT(req as any, res, next));

export { router as onboardingRouter };
