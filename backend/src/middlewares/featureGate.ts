import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth';
import { billingService } from '../modules/billing/billing.service';
import { planHasFeature, getRequiredPlanForFeature, FEATURE_LABELS, FeatureKey } from '../modules/billing/plans.config';

// Middleware factory: blocks requests to features not available in the user's plan.
// Usage: router.use(requireFeature('crm'))
// or:    router.get('/route', requireFeature('advanced_reports'), controller.handler)
export const requireFeature = (feature: FeatureKey) => {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      if (!req.user?.company_id) {
        return res.status(401).json({ error: 'No autenticado' });
      }

      const subscription = await billingService.getSubscription(req.user.company_id);

      // Trial users get everything while trial is active
      if (subscription.is_trial && subscription.can_use) {
        return next();
      }

      // Check if the plan includes this feature
      if (!planHasFeature(subscription.plan, feature)) {
        const requiredPlan = getRequiredPlanForFeature(feature);
        const featureLabel = FEATURE_LABELS[feature] || feature;
        const planLabel = requiredPlan === 'premium' ? 'Premium' : 'Estandar';

        return res.status(403).json({
          error: `${featureLabel} requiere el plan ${planLabel}`,
          code: 'FEATURE_NOT_AVAILABLE',
          feature,
          feature_label: featureLabel,
          required_plan: requiredPlan,
        });
      }

      next();
    } catch (error) {
      // Graceful degradation: don't block if billing check fails
      console.error('Feature gate check error:', error);
      next();
    }
  };
};
