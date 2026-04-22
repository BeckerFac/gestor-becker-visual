import { Response } from 'express';
import { AuthRequest } from '../../middlewares/auth';
import { enterprisesService } from './enterprises.service';

export class EnterprisesController {
  async getEnterprises(req: AuthRequest, res: Response) {
    // Wave 2B-1 H22: optional ?role=client|supplier filter.
    const roleFilter = typeof req.query.role === 'string' ? req.query.role : undefined;
    const data = await enterprisesService.getEnterprises(req.user!.company_id, roleFilter);
    res.json(data);
  }

  async getEnterprise(req: AuthRequest, res: Response) {
    const data = await enterprisesService.getEnterprise(req.user!.company_id, req.params.id);
    res.json(data);
  }

  async createEnterprise(req: AuthRequest, res: Response) {
    const data = await enterprisesService.createEnterprise(req.user!.company_id, req.body);
    res.status(201).json(data);
  }

  async updateEnterprise(req: AuthRequest, res: Response) {
    const data = await enterprisesService.updateEnterprise(req.user!.company_id, req.params.id, req.body);
    res.json(data);
  }

  async deleteEnterprise(req: AuthRequest, res: Response) {
    const data = await enterprisesService.deleteEnterprise(req.user!.company_id, req.params.id);
    res.json(data);
  }
}

export const enterprisesController = new EnterprisesController();
