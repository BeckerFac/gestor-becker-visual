import { Response } from 'express';
import { AuthRequest } from '../../middlewares/auth';
import { crmService } from './crm.service';

export class CrmController {
  // Stages
  async getStages(req: AuthRequest, res: Response) {
    const data = await crmService.getStages(req.user!.company_id);
    res.json(data);
  }

  async createStage(req: AuthRequest, res: Response) {
    const data = await crmService.createStage(req.user!.company_id, req.body);
    res.status(201).json(data);
  }

  async updateStage(req: AuthRequest, res: Response) {
    const data = await crmService.updateStage(req.user!.company_id, req.params.id, req.body);
    res.json(data);
  }

  async deleteStage(req: AuthRequest, res: Response) {
    const data = await crmService.deleteStage(req.user!.company_id, req.params.id);
    res.json(data);
  }

  async reorderStages(req: AuthRequest, res: Response) {
    const data = await crmService.reorderStages(req.user!.company_id, req.body.stages || req.body);
    res.json(data);
  }

  // Deals
  async getDeals(req: AuthRequest, res: Response) {
    const filters = {
      stage: req.query.stage as string | undefined,
      stage_id: req.query.stage_id as string | undefined,
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
    // Accept stage_id or legacy stage name
    const stageOrId = req.body.stage_id || req.body.stage;
    const data = await crmService.moveDealStage(req.user!.company_id, req.params.id, stageOrId, req.user!.id);
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

  // Deal stage history
  async getDealStageHistory(req: AuthRequest, res: Response) {
    const data = await crmService.getDealStageHistory(req.user!.company_id, req.params.id);
    res.json(data);
  }

  // Deal documents
  async getDealDocuments(req: AuthRequest, res: Response) {
    const data = await crmService.getDealDocuments(req.user!.company_id, req.params.id);
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
