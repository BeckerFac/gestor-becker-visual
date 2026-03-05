import { Response } from 'express';
import { AuthRequest } from '../../middlewares/auth';
import { banksService } from './banks.service';

export class BanksController {
  async getBanks(req: AuthRequest, res: Response) {
    const data = await banksService.getBanks(req.user!.company_id);
    res.json(data);
  }

  async createBank(req: AuthRequest, res: Response) {
    const data = await banksService.createBank(req.user!.company_id, req.body);
    res.status(201).json(data);
  }

  async updateBank(req: AuthRequest, res: Response) {
    const data = await banksService.updateBank(req.user!.company_id, req.params.id, req.body);
    res.json(data);
  }

  async deleteBank(req: AuthRequest, res: Response) {
    const data = await banksService.deleteBank(req.user!.company_id, req.params.id);
    res.json(data);
  }

  async getBreakdown(req: AuthRequest, res: Response) {
    const data = await banksService.getBreakdown(req.user!.company_id);
    res.json(data);
  }
}

export const banksController = new BanksController();
