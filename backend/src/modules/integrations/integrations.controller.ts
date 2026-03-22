import { Response } from 'express';
import { AuthRequest } from '../../middlewares/auth';
import { integrationsService } from './integrations.service';

export class IntegrationsController {
  async list(req: AuthRequest, res: Response) {
    const data = await integrationsService.listConnections(req.user!.company_id);
    res.json(data);
  }

  async get(req: AuthRequest, res: Response) {
    const data = await integrationsService.getConnection(req.user!.company_id, req.params.id);
    res.json(data);
  }

  async create(req: AuthRequest, res: Response) {
    const data = await integrationsService.createConnection(req.user!.company_id, req.body);
    res.status(201).json(data);
  }

  async update(req: AuthRequest, res: Response) {
    const data = await integrationsService.updateConnection(req.user!.company_id, req.params.id, req.body);
    res.json(data);
  }

  async delete(req: AuthRequest, res: Response) {
    const data = await integrationsService.deleteConnection(req.user!.company_id, req.params.id);
    res.json(data);
  }

  async syncLog(req: AuthRequest, res: Response) {
    const data = await integrationsService.getSyncLog(req.user!.company_id, req.params.id);
    res.json(data);
  }
}

export const integrationsController = new IntegrationsController();
