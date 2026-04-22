import { Response } from 'express';
import { AuthRequest } from '../../middlewares/auth';
import { ordersService } from './orders.service';
import { pdfService } from '../pdf/pdf.service';

export class OrdersController {
  async getOrders(req: AuthRequest, res: Response) {
    const rawFiscal = req.query.fiscal_type as string | undefined;
    const fiscal_type = rawFiscal === 'fiscal' || rawFiscal === 'no_fiscal' || rawFiscal === 'all'
      ? rawFiscal
      : undefined;
    const data = await ordersService.getOrders(req.user!.company_id, {
      status: req.query.status as string,
      product_type: req.query.product_type as string,
      customer_id: req.query.customer_id as string,
      enterprise_id: req.query.enterprise_id as string,
      business_unit_id: req.query.business_unit_id as string,
      has_invoice: req.query.has_invoice as string,
      fiscal_type,
      search: req.query.search as string,
      skip: parseInt(req.query.skip as string) || 0,
      limit: parseInt(req.query.limit as string) || 50,
      userCanAccessLuna: !!req.user?.can_access_luna,
    });
    res.json(data);
  }

  async getOrder(req: AuthRequest, res: Response) {
    const data = await ordersService.getOrder(req.user!.company_id, req.params.id, {
      userCanAccessLuna: !!req.user?.can_access_luna,
    });
    res.json(data);
  }

  async createOrder(req: AuthRequest, res: Response) {
    const data = await ordersService.createOrder(req.user!.company_id, req.user!.id, req.body, {
      userCanAccessLuna: !!req.user?.can_access_luna,
    });
    res.status(201).json(data);
  }

  async updateOrder(req: AuthRequest, res: Response) {
    const data = await ordersService.updateOrder(req.user!.company_id, req.params.id, req.body, req.user!.id);
    res.json(data);
  }

  async updateStatus(req: AuthRequest, res: Response) {
    const data = await ordersService.updateOrderStatus(
      req.user!.company_id, req.user!.id, req.params.id, req.body
    );
    res.json(data);
  }

  async linkInvoice(req: AuthRequest, res: Response) {
    const data = await ordersService.linkInvoice(
      req.user!.company_id, req.params.id, req.body.invoice_id
    );
    res.json(data);
  }

  async deleteOrder(req: AuthRequest, res: Response) {
    // mode: 'hard' (default, backward-compat) | 'soft' (preserva historia para auditoria fiscal).
    // El query string tiene prioridad sobre el body para que un DELETE simple pueda usar ?mode=soft.
    const rawMode = (req.query.mode ?? req.body?.mode) as string | undefined;
    const mode: 'hard' | 'soft' = rawMode === 'soft' ? 'soft' : 'hard';
    const reason = (req.body?.reason as string | undefined) || undefined;
    const data = await ordersService.deleteOrder(
      req.user!.company_id,
      req.params.id,
      req.user!.id,
      { mode, reason }
    );
    res.json(data);
  }

  async getOrdersWithoutInvoice(req: AuthRequest, res: Response) {
    const data = await ordersService.getOrdersWithoutInvoice(req.user!.company_id);
    res.json(data);
  }

  async getInvoicingStatus(req: AuthRequest, res: Response) {
    const data = await ordersService.getInvoicingStatus(req.user!.company_id, req.params.id);
    res.json(data);
  }

  async getUninvoicedItems(req: AuthRequest, res: Response) {
    const data = await ordersService.getUninvoicedItems(req.user!.company_id, req.params.id);
    res.json(data);
  }

  async getOrderContextData(req: AuthRequest, res: Response) {
    const data = await ordersService.getOrderContextData(req.user!.company_id, req.params.id);
    res.json(data);
  }

  async getOrderInvoicingDetail(req: AuthRequest, res: Response) {
    const data = await ordersService.getOrderInvoicingDetail(req.user!.company_id, req.params.id);
    if (!data) return res.status(404).json({ error: 'Pedido no encontrado' });
    res.json(data);
  }

  async checkBOMAvailability(req: AuthRequest, res: Response) {
    const data = await ordersService.checkBOMAvailability(req.user!.company_id, req.params.id);
    res.json(data);
  }

  async getOrderPdf(req: AuthRequest, res: Response) {
    try {
      const businessUnitId = (req.query.business_unit_id as string) || undefined;
      const pdf = await pdfService.generateOrderPdf(
        req.params.id,
        req.user!.company_id,
        businessUnitId
      );
      const orderNum = String(req.params.id).slice(0, 8);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="pedido-${orderNum}.pdf"`);
      res.send(pdf);
    } catch (error) {
      console.error('Error generating order PDF:', error);
      const status = (error as any).statusCode || 500;
      const message = (error as any).message || 'Error al generar PDF del pedido';
      res.status(status).json({ error: message });
    }
  }
}

export const ordersController = new OrdersController();
