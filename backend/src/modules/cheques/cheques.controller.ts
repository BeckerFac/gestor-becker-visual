import { Response } from 'express';
import { AuthRequest } from '../../middlewares/auth';
import { chequesService } from './cheques.service';

export class ChequesController {
  async getCheques(req: AuthRequest, res: Response) {
    const data = await chequesService.getCheques(req.user!.company_id, {
      status: req.query.status as string,
    });
    res.json(data);
  }

  async createCheque(req: AuthRequest, res: Response) {
    const data = await chequesService.createCheque(req.user!.company_id, req.user!.id, req.body);
    res.status(201).json(data);
  }

  async updateStatus(req: AuthRequest, res: Response) {
    const data = await chequesService.updateChequeStatus(req.user!.company_id, req.params.id, req.body.status);
    res.json(data);
  }

  async getSummary(req: AuthRequest, res: Response) {
    const data = await chequesService.getSummary(req.user!.company_id);
    res.json(data);
  }
}

export const chequesController = new ChequesController();
