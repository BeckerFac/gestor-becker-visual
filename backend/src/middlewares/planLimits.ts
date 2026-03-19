import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth';
import { billingService, UsageAction } from '../modules/billing/billing.service';

// Middleware factory: checks plan limits before allowing resource creation
// Usage: router.post('/', planLimitCheck('invoice'), controller.create)
export const planLimitCheck = (action: UsageAction) => {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      if (!req.user?.company_id) {
        return res.status(401).json({ error: 'No autenticado' });
      }

      const result = await billingService.checkLimits(req.user.company_id, action);

      if (!result.allowed) {
        return res.status(403).json({
          error: result.message,
          code: 'PLAN_LIMIT_EXCEEDED',
          current: result.current,
          limit: result.limit,
        });
      }

      // Store action on request for post-processing usage tracking
      (req as any)._billingAction = action;

      next();
    } catch (error) {
      // Don't block requests if billing check fails (graceful degradation)
      console.error('Plan limit check error:', error);
      next();
    }
  };
};

// Middleware: tracks usage after successful resource creation
// Call this AFTER the controller has successfully created the resource
export const trackUsageAfterCreate = (action: UsageAction) => {
  return async (req: AuthRequest, _res: Response, next: NextFunction) => {
    try {
      if (req.user?.company_id) {
        await billingService.trackUsage(req.user.company_id, action);
      }
    } catch (error) {
      console.error('Usage tracking error:', error);
    }
    next();
  };
};
