import { Response } from 'express';
import { AuthRequest } from '../../middlewares/auth';
import { remindersService } from './reminders.service';
import { ApiError } from '../../middlewares/errorHandler';

export class RemindersController {
  async getConfig(req: AuthRequest, res: Response) {
    try {
      const data = await remindersService.getConfig(req.user!.company_id);
      res.json(data);
    } catch (error) {
      if (error instanceof ApiError) return res.status(error.statusCode).json({ error: error.message });
      res.status(500).json({ error: 'Failed to get reminder config' });
    }
  }

  async updateConfig(req: AuthRequest, res: Response) {
    try {
      const data = await remindersService.updateConfig(req.user!.company_id, req.body);
      res.json(data);
    } catch (error) {
      if (error instanceof ApiError) return res.status(error.statusCode).json({ error: error.message });
      res.status(500).json({ error: 'Failed to update reminder config' });
    }
  }

  async listReminders(req: AuthRequest, res: Response) {
    try {
      const data = await remindersService.listReminders(req.user!.company_id);
      res.json(data);
    } catch (error) {
      if (error instanceof ApiError) return res.status(error.statusCode).json({ error: error.message });
      res.status(500).json({ error: 'Failed to list reminders' });
    }
  }

  async getOverdueInvoices(req: AuthRequest, res: Response) {
    try {
      const data = await remindersService.getOverdueInvoices(req.user!.company_id);
      res.json(data);
    } catch (error) {
      if (error instanceof ApiError) return res.status(error.statusCode).json({ error: error.message });
      res.status(500).json({ error: 'Failed to get overdue invoices' });
    }
  }
}

export const remindersController = new RemindersController();
