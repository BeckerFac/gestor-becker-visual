import { Router } from 'express';
import { cobroApplicationsController } from './cobro-applications.controller';
import { authorize } from '../../middlewares/authorize';

export const cobroApplicationsRouter = Router();

// Cobro → Invoice linking
cobroApplicationsRouter.post('/cobros/:cobroId/link', authorize('cobros', 'create'), (req, res) =>
  cobroApplicationsController.linkCobroToInvoice(req as any, res));

cobroApplicationsRouter.delete('/cobros/:cobroId/unlink', authorize('cobros', 'delete'), (req, res) =>
  cobroApplicationsController.unlinkCobroFromInvoice(req as any, res));

cobroApplicationsRouter.get('/cobros/:cobroId/applications', authorize('cobros', 'view'), (req, res) =>
  cobroApplicationsController.getCobroApplications(req as any, res));

cobroApplicationsRouter.get('/cobros/:cobroId/balance', authorize('cobros', 'view'), (req, res) =>
  cobroApplicationsController.getCobroBalance(req as any, res));

// Invoice → Cobro views
cobroApplicationsRouter.get('/invoices/:invoiceId/cobros', authorize('invoices', 'view'), (req, res) =>
  cobroApplicationsController.getInvoiceCobros(req as any, res));

cobroApplicationsRouter.get('/invoices/:invoiceId/balance', authorize('invoices', 'view'), (req, res) =>
  cobroApplicationsController.getInvoiceBalance(req as any, res));

// Credit (saldo a favor) endpoints
cobroApplicationsRouter.get('/credito-disponible', authorize('cobros', 'view'), (req, res) =>
  cobroApplicationsController.getCreditoDisponible(req as any, res));

cobroApplicationsRouter.post('/apply-credit', authorize('cobros', 'create'), (req, res) =>
  cobroApplicationsController.applyCredit(req as any, res));

// Discovery endpoints
cobroApplicationsRouter.get('/pending-cobros', authorize('cobros', 'view'), (req, res) =>
  cobroApplicationsController.getPendingCobros(req as any, res));

cobroApplicationsRouter.get('/available-invoices', authorize('invoices', 'view'), (req, res) =>
  cobroApplicationsController.getAvailableInvoices(req as any, res));
