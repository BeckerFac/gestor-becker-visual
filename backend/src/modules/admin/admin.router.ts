import { Router } from 'express';
import { adminController } from './admin.controller';
import { superadminMiddleware } from '../../middlewares/superadmin';

export const adminRouter = Router();

// All routes require superadmin
adminRouter.use(superadminMiddleware);

// Companies management
adminRouter.get('/companies', (req, res) => adminController.getAllCompanies(req as any, res));
adminRouter.get('/companies/:id', (req, res) => adminController.getCompanyDetail(req as any, res));
adminRouter.post('/companies/:id/disable', (req, res) => adminController.disableCompany(req as any, res));
adminRouter.post('/companies/:id/enable', (req, res) => adminController.enableCompany(req as any, res));
adminRouter.post('/companies/:id/impersonate', (req, res) => adminController.impersonateCompany(req as any, res));

// System
adminRouter.get('/stats', (req, res) => adminController.getSystemStats(req as any, res));
adminRouter.get('/health', (req, res) => adminController.getSystemHealth(req as any, res));
