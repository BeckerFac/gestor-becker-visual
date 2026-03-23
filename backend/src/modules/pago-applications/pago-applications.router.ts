import { Router } from 'express';
import { pagoApplicationsController } from './pago-applications.controller';
import { authorize } from '../../middlewares/authorize';

export const pagoApplicationsRouter = Router();

// Pago → Purchase Invoice linking
pagoApplicationsRouter.post('/pagos/:pagoId/link', authorize('pagos', 'create'), (req, res) =>
  pagoApplicationsController.linkPagoToPurchaseInvoice(req as any, res));

pagoApplicationsRouter.delete('/pagos/:pagoId/unlink', authorize('pagos', 'delete'), (req, res) =>
  pagoApplicationsController.unlinkPagoFromPurchaseInvoice(req as any, res));

pagoApplicationsRouter.get('/pagos/:pagoId/applications', authorize('pagos', 'view'), (req, res) =>
  pagoApplicationsController.getPagoApplications(req as any, res));

// Purchase Invoice → Pago views
pagoApplicationsRouter.get('/purchase-invoices/:purchaseInvoiceId/pagos', authorize('purchases', 'view'), (req, res) =>
  pagoApplicationsController.getPurchaseInvoicePagos(req as any, res));

// Discovery endpoints
pagoApplicationsRouter.get('/pending-pagos', authorize('pagos', 'view'), (req, res) =>
  pagoApplicationsController.getPendingPagos(req as any, res));

pagoApplicationsRouter.get('/available-purchase-invoices', authorize('purchases', 'view'), (req, res) =>
  pagoApplicationsController.getAvailablePurchaseInvoices(req as any, res));
