import { Response } from 'express';
import { AuthRequest } from '../../middlewares/auth';
import { integrationsService } from './integrations.service';
import { ApiError } from '../../middlewares/errorHandler';

export class IntegrationsController {
  async list(req: AuthRequest, res: Response) {
    try {
      const data = await integrationsService.listConnections(req.user!.company_id);
      res.json(data);
    } catch (error) {
      if (error instanceof ApiError) return res.status(error.statusCode).json({ error: error.message });
      res.status(500).json({ error: 'Failed to list integrations' });
    }
  }

  async get(req: AuthRequest, res: Response) {
    try {
      const data = await integrationsService.getConnection(req.user!.company_id, req.params.id);
      res.json(data);
    } catch (error) {
      if (error instanceof ApiError) return res.status(error.statusCode).json({ error: error.message });
      res.status(500).json({ error: 'Failed to get integration' });
    }
  }

  async create(req: AuthRequest, res: Response) {
    try {
      const data = await integrationsService.createConnection(req.user!.company_id, req.body);
      res.status(201).json(data);
    } catch (error) {
      if (error instanceof ApiError) return res.status(error.statusCode).json({ error: error.message });
      res.status(500).json({ error: 'Failed to create integration' });
    }
  }

  async update(req: AuthRequest, res: Response) {
    try {
      const data = await integrationsService.updateConnection(req.user!.company_id, req.params.id, req.body);
      res.json(data);
    } catch (error) {
      if (error instanceof ApiError) return res.status(error.statusCode).json({ error: error.message });
      res.status(500).json({ error: 'Failed to update integration' });
    }
  }

  async delete(req: AuthRequest, res: Response) {
    try {
      const data = await integrationsService.deleteConnection(req.user!.company_id, req.params.id);
      res.json(data);
    } catch (error) {
      if (error instanceof ApiError) return res.status(error.statusCode).json({ error: error.message });
      res.status(500).json({ error: 'Failed to delete integration' });
    }
  }

  async syncLog(req: AuthRequest, res: Response) {
    try {
      const data = await integrationsService.getSyncLog(req.user!.company_id, req.params.id);
      res.json(data);
    } catch (error) {
      if (error instanceof ApiError) return res.status(error.statusCode).json({ error: error.message });
      res.status(500).json({ error: 'Failed to get sync log' });
    }
  }
}

export const integrationsController = new IntegrationsController();
