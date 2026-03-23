import { Response } from 'express';
import { AuthRequest } from '../../middlewares/auth';
import { businessUnitsService } from './business-units.service';

export class BusinessUnitsController {
  async getAll(req: AuthRequest, res: Response) {
    const units = await businessUnitsService.getBusinessUnits(req.user!.company_id);
    res.json(units);
  }

  async getOne(req: AuthRequest, res: Response) {
    const unit = await businessUnitsService.getBusinessUnit(req.user!.company_id, req.params.id);
    res.json(unit);
  }

  async create(req: AuthRequest, res: Response) {
    const unit = await businessUnitsService.createBusinessUnit(
      req.user!.company_id,
      req.user!.id,
      req.body
    );
    res.status(201).json(unit);
  }

  async update(req: AuthRequest, res: Response) {
    const unit = await businessUnitsService.updateBusinessUnit(
      req.user!.company_id,
      req.params.id,
      req.body
    );
    res.json(unit);
  }

  async remove(req: AuthRequest, res: Response) {
    const result = await businessUnitsService.deleteBusinessUnit(req.user!.company_id, req.params.id);
    res.json(result);
  }

  async getDefault(req: AuthRequest, res: Response) {
    const unit = await businessUnitsService.getDefaultBusinessUnit(req.user!.company_id);
    res.json(unit);
  }
}

export const businessUnitsController = new BusinessUnitsController();
