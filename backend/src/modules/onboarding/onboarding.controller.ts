import { Response, NextFunction } from 'express';
import { AuthRequest } from '../../middlewares/auth';
import { onboardingService } from './onboarding.service';
import { ApiError } from '../../middlewares/errorHandler';

export class OnboardingController {
  async getStatus(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const companyId = req.user!.company_id;
      const status = await onboardingService.getStatus(companyId);
      res.json(status);
    } catch (error) {
      next(error);
    }
  }

  async completeStep(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const companyId = req.user!.company_id;
      const step = parseInt(req.params.step, 10);

      if (isNaN(step) || step < 1 || step > 4) {
        throw new ApiError(400, 'Step must be between 1 and 4');
      }

      const result = await onboardingService.completeStep(companyId, step, req.body);
      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  async complete(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const companyId = req.user!.company_id;
      const result = await onboardingService.completeOnboarding(companyId);
      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  async reset(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const companyId = req.user!.company_id;
      const result = await onboardingService.resetOnboarding(companyId);
      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  async updateModules(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const companyId = req.user!.company_id;
      const { modules } = req.body;

      if (!Array.isArray(modules)) {
        throw new ApiError(400, 'modules must be an array');
      }

      const result = await onboardingService.updateModules(companyId, modules);
      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  async lookupCUIT(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const { cuit } = req.body;

      if (!cuit) {
        throw new ApiError(400, 'CUIT is required');
      }

      const result = await onboardingService.lookupCUIT(cuit);
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
}

export const onboardingController = new OnboardingController();
