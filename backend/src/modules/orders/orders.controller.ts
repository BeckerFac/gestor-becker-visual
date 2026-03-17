import { Response } from 'express';
import { AuthRequest } from '../../middlewares/auth';
import { ordersService } from './orders.service';

export class OrdersController {
  async getOrders(req: AuthRequest, res: Response) {
    const data = await ordersService.getOrders(req.user!.company_id, {
      status: req.query.status as string,
      product_type: req.query.product_type as string,
      customer_id: req.query.customer_id as string,
      enterprise_id: req.query.enterprise_id as string,
      has_invoice: req.query.has_invoice as string,
      search: req.query.search as string,
      skip: parseInt(req.query.skip as string) || 0,
      limit: parseInt(req.query.limit as string) || 50,
    });
    res.json(data);
  }

  async getOrder(req: AuthRequest, res: Response) {
    const data = await ordersService.getOrder(req.user!.company_id, req.params.id);
    res.json(data);
  }

  async createOrder(req: AuthRequest, res: Response) {
    const data = await ordersService.createOrder(req.user!.company_id, req.user!.id, req.body);
    res.status(201).json(data);
  }

  async updateOrder(req: AuthRequest, res: Response) {
    const data = await ordersService.updateOrder(req.user!.company_id, req.params.id, req.body);
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
    const data = await ordersService.deleteOrder(req.user!.company_id, req.params.id);
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

  async checkBOMAvailability(req: AuthRequest, res: Response) {
    const data = await ordersService.checkBOMAvailability(req.user!.company_id, req.params.id);
    res.json(data);
  }
}

export const ordersController = new OrdersController();
