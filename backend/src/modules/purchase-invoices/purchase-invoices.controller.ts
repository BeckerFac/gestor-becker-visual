import { Response } from 'express';
import { AuthRequest } from '../../middlewares/auth';
import { purchaseInvoicesService } from './purchase-invoices.service';

export class PurchaseInvoicesController {
  async getAll(req: AuthRequest, res: Response) {
    const data = await purchaseInvoicesService.getPurchaseInvoices(req.user!.company_id, {
      enterprise_id: req.query.enterprise_id as string,
      business_unit_id: req.query.business_unit_id as string,
      purchase_id: req.query.purchase_id as string,
      payment_status: req.query.payment_status as string,
      status: req.query.status as string,
    });
    res.json(data);
  }

  async getOne(req: AuthRequest, res: Response) {
    const data = await purchaseInvoicesService.getPurchaseInvoice(req.user!.company_id, req.params.id);
    res.json(data);
  }

  async create(req: AuthRequest, res: Response) {
    const data = await purchaseInvoicesService.createPurchaseInvoice(
      req.user!.company_id,
      req.user!.id,
      req.body
    );
    res.status(201).json(data);
  }

  async update(req: AuthRequest, res: Response) {
    const data = await purchaseInvoicesService.updatePurchaseInvoice(
      req.user!.company_id,
      req.params.id,
      req.body
    );
    res.json(data);
  }

  async remove(req: AuthRequest, res: Response) {
    const data = await purchaseInvoicesService.deletePurchaseInvoice(req.user!.company_id, req.params.id);
    res.json(data);
  }

  async getPaymentBalance(req: AuthRequest, res: Response) {
    const data = await purchaseInvoicesService.getPaymentBalance(req.user!.company_id, req.params.id);
    res.json(data);
  }

  async getByPurchase(req: AuthRequest, res: Response) {
    const data = await purchaseInvoicesService.getPurchaseInvoicesByPurchase(
      req.user!.company_id,
      req.params.purchaseId
    );
    res.json(data);
  }
  async getAvailablePurchaseItems(req: AuthRequest, res: Response) {
    const data = await purchaseInvoicesService.getAvailablePurchaseItemsForInvoicing(
      req.user!.company_id,
      { enterprise_id: req.query.enterprise_id as string }
    );
    res.json(data);
  }

  async getItems(req: AuthRequest, res: Response) {
    const data = await purchaseInvoicesService.getPurchaseInvoiceItems(
      req.user!.company_id,
      req.params.id
    );
    res.json(data);
  }
}

export const purchaseInvoicesController = new PurchaseInvoicesController();
