import { Response } from 'express';
import { AuthRequest } from '../../middlewares/auth';
import { pagoApplicationsService } from './pago-applications.service';

export class PagoApplicationsController {
  async linkPagoToPurchaseInvoice(req: AuthRequest, res: Response) {
    const result = await pagoApplicationsService.linkPagoToPurchaseInvoice(
      req.user!.company_id,
      req.user!.id,
      req.params.pagoId,
      req.body.purchase_invoice_id,
      parseFloat(req.body.amount_applied),
      req.body.notes
    );
    res.status(201).json(result);
  }

  async unlinkPagoFromPurchaseInvoice(req: AuthRequest, res: Response) {
    const result = await pagoApplicationsService.unlinkPagoFromPurchaseInvoice(
      req.user!.company_id,
      req.params.pagoId,
      req.body.purchase_invoice_id
    );
    res.json(result);
  }

  async getPagoApplications(req: AuthRequest, res: Response) {
    const data = await pagoApplicationsService.getPagoApplications(req.user!.company_id, req.params.pagoId);
    res.json(data);
  }

  async getPurchaseInvoicePagos(req: AuthRequest, res: Response) {
    const data = await pagoApplicationsService.getPurchaseInvoicePagos(req.user!.company_id, req.params.purchaseInvoiceId);
    res.json(data);
  }

  async getPendingPagos(req: AuthRequest, res: Response) {
    const data = await pagoApplicationsService.getPendingPagos(req.user!.company_id, {
      enterprise_id: req.query.enterprise_id as string,
      business_unit_id: req.query.business_unit_id as string,
    });
    res.json(data);
  }

  async getAvailablePurchaseInvoices(req: AuthRequest, res: Response) {
    const data = await pagoApplicationsService.getAvailablePurchaseInvoicesForLinking(req.user!.company_id, {
      enterprise_id: req.query.enterprise_id as string,
      business_unit_id: req.query.business_unit_id as string,
    });
    res.json(data);
  }
}

export const pagoApplicationsController = new PagoApplicationsController();
