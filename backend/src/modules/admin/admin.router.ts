import { Router } from 'express';
import { adminController } from './admin.controller';
import { superadminMiddleware } from '../../middlewares/superadmin';

export const adminRouter = Router();

// All routes require superadmin
adminRouter.use(superadminMiddleware);

// Companies management
adminRouter.get('/companies', (req, res) => adminController.getAllCompanies(req as any, res));
adminRouter.get('/companies/:id', (req, res) => adminController.getCompanyDetail(req as any, res));
adminRouter.post('/companies', (req, res) => adminController.createCompany(req as any, res));
adminRouter.post('/companies/:id/block', (req, res) => adminController.blockCompany(req as any, res));
adminRouter.post('/companies/:id/unblock', (req, res) => adminController.unblockCompany(req as any, res));
adminRouter.put('/companies/:id/plan', (req, res) => adminController.updateCompanyPlan(req as any, res));
adminRouter.post('/companies/:id/impersonate', (req, res) => adminController.impersonateCompany(req as any, res));

// Backups
adminRouter.get('/companies/:id/backups', (req, res) => adminController.listBackups(req as any, res));
adminRouter.get('/companies/:id/backup', (req, res) => adminController.downloadBackup(req as any, res));
adminRouter.post('/companies/:id/restore', (req, res) => adminController.restoreBackup(req as any, res));

// Audit trail
adminRouter.get('/companies/:id/audit', (req, res) => adminController.getAuditTrail(req as any, res));

// Block reason categories
adminRouter.get('/block-reasons', (req, res) => adminController.getBlockReasonCategories(req as any, res));

// Legacy endpoints (backwards compatibility)
adminRouter.post('/companies/:id/disable', (req, res) => adminController.disableCompany(req as any, res));
adminRouter.post('/companies/:id/enable', (req, res) => adminController.enableCompany(req as any, res));

// System
adminRouter.get('/stats', (req, res) => adminController.getSystemStats(req as any, res));
adminRouter.get('/health', (req, res) => adminController.getSystemHealth(req as any, res));

// Activity logs (cross-company)
adminRouter.get('/logs', (req, res) => adminController.getGlobalLogs(req as any, res));
adminRouter.get('/logs/stats', (req, res) => adminController.getLogStats(req as any, res));

// Security monitoring dashboard
adminRouter.get('/security', (req, res) => adminController.getSecurityDashboard(req as any, res));
