import { Router } from 'express';
import { crmController } from './crm.controller';
import { authorize } from '../../middlewares/authorize';

export const crmRouter = Router();

// Deals
crmRouter.get('/deals', authorize('enterprises', 'view'), (req, res) => crmController.getDeals(req as any, res));
crmRouter.get('/deals/by-stage', authorize('enterprises', 'view'), (req, res) => crmController.getDealsByStage(req as any, res));
crmRouter.post('/deals', authorize('enterprises', 'create'), (req, res) => crmController.createDeal(req as any, res));
crmRouter.put('/deals/:id', authorize('enterprises', 'edit'), (req, res) => crmController.updateDeal(req as any, res));
crmRouter.post('/deals/:id/move', authorize('enterprises', 'edit'), (req, res) => crmController.moveDealStage(req as any, res));
crmRouter.post('/deals/:id/close', authorize('enterprises', 'edit'), (req, res) => crmController.closeDeal(req as any, res));
crmRouter.delete('/deals/:id', authorize('enterprises', 'delete'), (req, res) => crmController.deleteDeal(req as any, res));

// Activities
crmRouter.get('/activities', authorize('enterprises', 'view'), (req, res) => crmController.getActivities(req as any, res));
crmRouter.post('/activities', authorize('enterprises', 'create'), (req, res) => crmController.createActivity(req as any, res));

// Summary
crmRouter.get('/summary', authorize('enterprises', 'view'), (req, res) => crmController.getPipelineSummary(req as any, res));
crmRouter.get('/health', authorize('enterprises', 'view'), (req, res) => crmController.getCustomerHealth(req as any, res));
