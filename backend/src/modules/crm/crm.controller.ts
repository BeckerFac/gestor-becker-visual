import { Response } from 'express';
import { AuthRequest } from '../../middlewares/auth';
import { crmService } from './crm.service';

export class CrmController {
  // Deals
  async getDeals(req: AuthRequest, res: Response) {
    const filters = {
      stage: req.query.stage as string | undefined,
      enterprise_id: req.query.enterprise_id as string | undefined,
      priority: req.query.priority as string | undefined,
      search: req.query.search as string | undefined,
    };
    const data = await crmService.getDeals(req.user!.company_id, filters);
    res.json(data);
  }

  async getDealsByStage(req: AuthRequest, res: Response) {
    const data = await crmService.getDealsByStage(req.user!.company_id);
    res.json(data);
  }

  async createDeal(req: AuthRequest, res: Response) {
    const data = await crmService.createDeal(req.user!.company_id, req.user!.id, req.body);
    res.status(201).json(data);
  }

  async updateDeal(req: AuthRequest, res: Response) {
    const data = await crmService.updateDeal(req.user!.company_id, req.params.id, req.body);
    res.json(data);
  }

  async moveDealStage(req: AuthRequest, res: Response) {
    const { stage } = req.body;
    const data = await crmService.moveDealStage(req.user!.company_id, req.params.id, stage, req.user!.id);
    res.json(data);
  }

  async closeDeal(req: AuthRequest, res: Response) {
    const { won, reason } = req.body;
    const data = await crmService.closeDeal(req.user!.company_id, req.params.id, won, reason, req.user!.id);
    res.json(data);
  }

  async deleteDeal(req: AuthRequest, res: Response) {
    const data = await crmService.deleteDeal(req.user!.company_id, req.params.id);
    res.json(data);
  }

  // Activities
  async getActivities(req: AuthRequest, res: Response) {
    const filters = {
      deal_id: req.query.deal_id as string | undefined,
      enterprise_id: req.query.enterprise_id as string | undefined,
      limit: req.query.limit ? parseInt(req.query.limit as string) : undefined,
    };
    const data = await crmService.getActivities(req.user!.company_id, filters);
    res.json(data);
  }

  async createActivity(req: AuthRequest, res: Response) {
    const activityData = {
      ...req.body,
      created_by: req.user!.id,
    };
    const data = await crmService.createActivity(req.user!.company_id, activityData);
    res.status(201).json(data);
  }

  // Summary
  async getPipelineSummary(req: AuthRequest, res: Response) {
    const data = await crmService.getPipelineSummary(req.user!.company_id);
    res.json(data);
  }

  async getCustomerHealth(req: AuthRequest, res: Response) {
    const data = await crmService.getCustomerHealth(req.user!.company_id);
    res.json(data);
  }
}

export const crmController = new CrmController();
