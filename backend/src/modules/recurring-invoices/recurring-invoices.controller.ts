import { Response } from 'express';
import { AuthRequest } from '../../middlewares/auth';
import { recurringInvoicesService } from './recurring-invoices.service';
import { ApiError } from '../../middlewares/errorHandler';

export class RecurringInvoicesController {
  async list(req: AuthRequest, res: Response) {
    try {
      const data = await recurringInvoicesService.list(req.user!.company_id);
      res.json(data);
    } catch (error) {
      if (error instanceof ApiError) return res.status(error.statusCode).json({ error: error.message });
      res.status(500).json({ error: 'Failed to list recurring invoices' });
    }
  }

  async create(req: AuthRequest, res: Response) {
    try {
      const data = await recurringInvoicesService.create(req.user!.company_id, req.user!.id, req.body);
      res.status(201).json(data);
    } catch (error) {
      if (error instanceof ApiError) return res.status(error.statusCode).json({ error: error.message });
      res.status(500).json({ error: 'Failed to create recurring invoice' });
    }
  }

  async update(req: AuthRequest, res: Response) {
    try {
      const data = await recurringInvoicesService.update(req.user!.company_id, req.params.id, req.body);
      res.json(data);
    } catch (error) {
      if (error instanceof ApiError) return res.status(error.statusCode).json({ error: error.message });
      res.status(500).json({ error: 'Failed to update recurring invoice' });
    }
  }

  async deactivate(req: AuthRequest, res: Response) {
    try {
      const data = await recurringInvoicesService.deactivate(req.user!.company_id, req.params.id);
      res.json(data);
    } catch (error) {
      if (error instanceof ApiError) return res.status(error.statusCode).json({ error: error.message });
      res.status(500).json({ error: 'Failed to deactivate recurring invoice' });
    }
  }

  async delete(req: AuthRequest, res: Response) {
    try {
      const data = await recurringInvoicesService.delete(req.user!.company_id, req.params.id);
      res.json(data);
    } catch (error) {
      if (error instanceof ApiError) return res.status(error.statusCode).json({ error: error.message });
      res.status(500).json({ error: 'Failed to delete recurring invoice' });
    }
  }
}

export const recurringInvoicesController = new RecurringInvoicesController();
