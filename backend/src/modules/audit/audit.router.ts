import { Router } from 'express';
import { auditController } from './audit.controller';
import { authorize } from '../../middlewares/authorize';

export const auditRouter = Router();

auditRouter.get('/', authorize('audit_log', 'view'), (req, res) => auditController.getAuditLog(req, res));
