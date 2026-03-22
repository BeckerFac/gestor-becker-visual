import { Response } from 'express';
import { AuthRequest } from '../../middlewares/auth';
import { remindersService } from './reminders.service';

export class RemindersController {
  async getConfig(req: AuthRequest, res: Response) {
    const data = await remindersService.getConfig(req.user!.company_id);
    res.json(data);
  }

  async updateConfig(req: AuthRequest, res: Response) {
    const data = await remindersService.updateConfig(req.user!.company_id, req.body);
    res.json(data);
  }

  async listReminders(req: AuthRequest, res: Response) {
    const data = await remindersService.listReminders(req.user!.company_id);
    res.json(data);
  }

  async getOverdueInvoices(req: AuthRequest, res: Response) {
    const data = await remindersService.getOverdueInvoices(req.user!.company_id);
    res.json(data);
  }
}

export const remindersController = new RemindersController();
