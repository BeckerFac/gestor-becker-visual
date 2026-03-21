import { Response } from 'express';
import { AuthRequest } from '../../middlewares/auth';
import { activityService } from './activity.service';

class ActivityController {
  async getLogs(req: AuthRequest, res: Response) {
    try {
      const companyId = req.user!.company_id;
      const filters = {
        userId: req.query.userId as string | undefined,
        module: req.query.module as string | undefined,
        action: req.query.action as string | undefined,
        dateFrom: req.query.dateFrom as string | undefined,
        dateTo: req.query.dateTo as string | undefined,
        search: req.query.search as string | undefined,
        page: parseInt(req.query.page as string) || 1,
        limit: parseInt(req.query.limit as string) || 50,
      };
      const data = await activityService.getLogs(companyId, filters);
      res.json(data);
    } catch (error: any) {
      res.status(500).json({ error: 'Error al obtener logs de actividad' });
    }
  }
}

export const activityController = new ActivityController();
