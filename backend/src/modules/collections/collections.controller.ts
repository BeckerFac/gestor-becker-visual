import { Response } from 'express';
import { AuthRequest } from '../../middlewares/auth';
import { collectionsService } from './collections.service';

export class CollectionsController {
  async getPendingInvoices(req: AuthRequest, res: Response) {
    const data = await collectionsService.getPendingInvoices(req.user!.company_id);
    res.json(data);
  }

  async registerPayment(req: AuthRequest, res: Response) {
    const invoiceId = req.params.invoiceId;
    const data = await collectionsService.registerPayment(
      req.user!.company_id,
      req.user!.id,
      invoiceId,
      req.body
    );
    res.status(201).json(data);
  }

  async getPendingOrders(req: AuthRequest, res: Response) {
    const data = await collectionsService.getPendingOrders(req.user!.company_id);
    res.json(data);
  }

  async markOrderAsPaid(req: AuthRequest, res: Response) {
    const data = await collectionsService.markOrderAsPaid(req.user!.company_id, req.params.orderId, req.body);
    res.json(data);
  }

  async getSummary(req: AuthRequest, res: Response) {
    const data = await collectionsService.getSummary(req.user!.company_id);
    res.json(data);
  }
}

export const collectionsController = new CollectionsController();
