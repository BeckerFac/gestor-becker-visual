import { Response } from 'express';
import { AuthRequest } from '../../middlewares/auth';
import { receiptsService } from './receipts.service';

export class ReceiptsController {
  async getReceipts(req: AuthRequest, res: Response) {
    const data = await receiptsService.getReceipts(req.user!.company_id);
    res.json(data);
  }

  async createReceipt(req: AuthRequest, res: Response) {
    const data = await receiptsService.createReceipt(req.user!.company_id, req.user!.id, req.body);
    res.status(201).json(data);
  }

  async deleteReceipt(req: AuthRequest, res: Response) {
    const data = await receiptsService.deleteReceipt(req.user!.company_id, req.params.id);
    res.json(data);
  }
}

export const receiptsController = new ReceiptsController();
