import { Router } from 'express';
import { remindersController } from './reminders.controller';
import { authorize } from '../../middlewares/authorize';

export const remindersRouter = Router();

remindersRouter.get('/config', authorize('settings', 'view'), (req, res) => remindersController.getConfig(req as any, res));
remindersRouter.put('/config', authorize('settings', 'edit'), (req, res) => remindersController.updateConfig(req as any, res));
remindersRouter.get('/', authorize('invoices', 'view'), (req, res) => remindersController.listReminders(req as any, res));
remindersRouter.get('/overdue', authorize('invoices', 'view'), (req, res) => remindersController.getOverdueInvoices(req as any, res));
