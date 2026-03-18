import { Response } from 'express';
import { AuthRequest } from '../../middlewares/auth';
import { ApiError } from '../../middlewares/errorHandler';
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

  async updatePurchase(req: AuthRequest, res: Response) {
    try {
      const result = await purchasesService.updatePurchase(req.user!.company_id, req.params.id, req.user!.id, req.body);
      res.json(result);
    } catch (error: any) {
      if (error instanceof ApiError) return res.status(error.statusCode).json({ error: error.message });
      res.status(500).json({ error: 'Failed to update purchase' });
    }
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
