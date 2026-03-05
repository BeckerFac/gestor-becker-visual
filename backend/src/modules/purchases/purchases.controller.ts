import { Response } from 'express';
import { AuthRequest } from '../../middlewares/auth';
import { purchasesService } from './purchases.service';

export class PurchasesController {
  async getPurchases(req: AuthRequest, res: Response) {
    const data = await purchasesService.getPurchases(req.user!.company_id, {
      enterprise_id: req.query.enterprise_id as string,
    });
    res.json(data);
  }

  async getPurchase(req: AuthRequest, res: Response) {
    const data = await purchasesService.getPurchase(req.user!.company_id, req.params.id);
    res.json(data);
  }

  async createPurchase(req: AuthRequest, res: Response) {
    const data = await purchasesService.createPurchase(req.user!.company_id, req.user!.id, req.body);
    res.status(201).json(data);
  }

  async updatePaymentStatus(req: AuthRequest, res: Response) {
    const data = await purchasesService.updatePaymentStatus(req.user!.company_id, req.params.id, req.body.payment_status);
    res.json(data);
  }

  async deletePurchase(req: AuthRequest, res: Response) {
    const data = await purchasesService.deletePurchase(req.user!.company_id, req.params.id);
    res.json(data);
  }
}

export const purchasesController = new PurchasesController();
