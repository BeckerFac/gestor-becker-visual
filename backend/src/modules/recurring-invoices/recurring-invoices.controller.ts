import { Response } from 'express';
import { AuthRequest } from '../../middlewares/auth';
import { recurringInvoicesService } from './recurring-invoices.service';

export class RecurringInvoicesController {
  async list(req: AuthRequest, res: Response) {
    const data = await recurringInvoicesService.list(req.user!.company_id);
    res.json(data);
  }

  async create(req: AuthRequest, res: Response) {
    const data = await recurringInvoicesService.create(req.user!.company_id, req.user!.id, req.body);
    res.status(201).json(data);
  }

  async update(req: AuthRequest, res: Response) {
    const data = await recurringInvoicesService.update(req.user!.company_id, req.params.id, req.body);
    res.json(data);
  }

  async deactivate(req: AuthRequest, res: Response) {
    const data = await recurringInvoicesService.deactivate(req.user!.company_id, req.params.id);
    res.json(data);
  }

  async delete(req: AuthRequest, res: Response) {
    const data = await recurringInvoicesService.delete(req.user!.company_id, req.params.id);
    res.json(data);
  }
}

export const recurringInvoicesController = new RecurringInvoicesController();
