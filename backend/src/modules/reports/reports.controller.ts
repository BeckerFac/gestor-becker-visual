import { Response } from 'express';
import { AuthRequest } from '../../middlewares/auth';
import { reportsService } from './reports.service';

export class ReportsController {
  async getDashboard(req: AuthRequest, res: Response) {
    const data = await reportsService.getDashboard(req.user!.company_id);
    res.json(data);
  }

  async getSalesReport(req: AuthRequest, res: Response) {
    const days = parseInt(req.query.days as string) || 7;
    const data = await reportsService.getSalesReport(req.user!.company_id, days);
    res.json(data);
  }

  async getTopProducts(req: AuthRequest, res: Response) {
    const limit = parseInt(req.query.limit as string) || 5;
    const data = await reportsService.getTopProducts(req.user!.company_id, limit);
    res.json(data);
  }
  async globalSearch(req: AuthRequest, res: Response) {
    const query = (req.query.q as string) || '';
    const data = await reportsService.globalSearch(req.user!.company_id, query);
    res.json(data);
  }
}

export const reportsController = new ReportsController();
