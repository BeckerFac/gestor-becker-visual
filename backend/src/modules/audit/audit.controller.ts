import { Response } from 'express';
import { AuthRequest } from '../../middlewares/auth';
import { auditService } from './audit.service';
import { ApiError } from '../../middlewares/errorHandler';

export class AuditController {
  async getAuditLog(req: AuthRequest, res: Response) {
    try {
      const { user_id, action, entity_type, date_from, date_to, limit, offset } = req.query;

      const [entries, total] = await Promise.all([
        auditService.getAuditLog(req.user!.company_id, {
          userId: user_id as string,
          action: action as string,
          entityType: entity_type as string,
          dateFrom: date_from as string,
          dateTo: date_to as string,
          limit: limit ? parseInt(String(limit), 10) : 50,
          offset: offset ? parseInt(String(offset), 10) : 0,
        }),
        auditService.getAuditLogCount(req.user!.company_id, {
          userId: user_id as string,
          action: action as string,
          entityType: entity_type as string,
          dateFrom: date_from as string,
          dateTo: date_to as string,
        }),
      ]);

      res.json({ entries, total });
    } catch (error) {
      if (error instanceof ApiError) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      res.status(500).json({ error: 'Error al obtener registro de auditoria' });
    }
  }
}

export const auditController = new AuditController();
