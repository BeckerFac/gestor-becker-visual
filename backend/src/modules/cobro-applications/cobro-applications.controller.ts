import { Response } from 'express';
import { AuthRequest } from '../../middlewares/auth';
import { cobroApplicationsService } from './cobro-applications.service';

export class CobroApplicationsController {
  async linkCobroToInvoice(req: AuthRequest, res: Response) {
    const result = await cobroApplicationsService.linkCobroToInvoice(
      req.user!.company_id,
      req.user!.id,
      req.params.cobroId,
      req.body.invoice_id,
      parseFloat(req.body.amount_applied),
      req.body.notes
    );
    res.status(201).json(result);
  }

  async unlinkCobroFromInvoice(req: AuthRequest, res: Response) {
    const result = await cobroApplicationsService.unlinkCobroFromInvoice(
      req.user!.company_id,
      req.params.cobroId,
      req.body.invoice_id
    );
    res.json(result);
  }

  async getCobroApplications(req: AuthRequest, res: Response) {
    const data = await cobroApplicationsService.getCobroApplications(
      req.user!.company_id,
      req.params.cobroId
    );
    res.json(data);
  }

  async getInvoiceCobros(req: AuthRequest, res: Response) {
    const data = await cobroApplicationsService.getInvoiceCobros(
      req.user!.company_id,
      req.params.invoiceId
    );
    res.json(data);
  }

  async getInvoiceBalance(req: AuthRequest, res: Response) {
    const data = await cobroApplicationsService.getInvoiceBalanceDetail(
      req.user!.company_id,
      req.params.invoiceId
    );
    res.json(data);
  }

  async getCobroBalance(req: AuthRequest, res: Response) {
    const data = await cobroApplicationsService.getCobroBalanceDetail(
      req.user!.company_id,
      req.params.cobroId
    );
    res.json(data);
  }

  async getPendingCobros(req: AuthRequest, res: Response) {
    const data = await cobroApplicationsService.getPendingCobros(
      req.user!.company_id,
      {
        enterprise_id: req.query.enterprise_id as string,
        business_unit_id: req.query.business_unit_id as string,
      }
    );
    res.json(data);
  }

  async getAvailableInvoices(req: AuthRequest, res: Response) {
    const data = await cobroApplicationsService.getAvailableInvoicesForLinking(
      req.user!.company_id,
      {
        enterprise_id: req.query.enterprise_id as string,
        business_unit_id: req.query.business_unit_id as string,
      }
    );
    res.json(data);
  }
}

export const cobroApplicationsController = new CobroApplicationsController();
