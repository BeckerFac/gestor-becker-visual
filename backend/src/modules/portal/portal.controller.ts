import { Response } from 'express';
import { AuthRequest } from '../../middlewares/auth';
import { portalService } from './portal.service';
import { quotesService } from '../quotes/quotes.service';
import { ApiError } from '../../middlewares/errorHandler';

export class PortalController {
  async getSummary(req: AuthRequest, res: Response) {
    try {
      const customerId = (req.user as any)?.customer_id;
      const companyId = req.user!.company_id;
      if (!customerId) throw new ApiError(403, 'Access denied');

      const summary = await portalService.getCustomerSummary(customerId, companyId);
      res.json(summary);
    } catch (error) {
      if (error instanceof ApiError) return res.status(error.statusCode).json({ error: error.message });
      res.status(500).json({ error: 'Failed to get summary' });
    }
  }

  async getProfile(req: AuthRequest, res: Response) {
    try {
      const customerId = (req.user as any)?.customer_id;
      if (!customerId) throw new ApiError(403, 'Access denied');

      const profile = await portalService.getCustomerProfile(customerId);
      res.json(profile);
    } catch (error) {
      if (error instanceof ApiError) return res.status(error.statusCode).json({ error: error.message });
      res.status(500).json({ error: 'Failed to get profile' });
    }
  }

  async getOrders(req: AuthRequest, res: Response) {
    try {
      const customerId = (req.user as any)?.customer_id;
      const companyId = req.user!.company_id;
      if (!customerId) throw new ApiError(403, 'Access denied');

      const orders = await portalService.getCustomerOrders(customerId, companyId);
      res.json(orders);
    } catch (error) {
      if (error instanceof ApiError) return res.status(error.statusCode).json({ error: error.message });
      res.status(500).json({ error: 'Failed to get orders' });
    }
  }

  async getOrder(req: AuthRequest, res: Response) {
    try {
      const customerId = (req.user as any)?.customer_id;
      if (!customerId) throw new ApiError(403, 'Access denied');

      const order = await portalService.getCustomerOrder(customerId, req.params.id);
      res.json(order);
    } catch (error) {
      if (error instanceof ApiError) return res.status(error.statusCode).json({ error: error.message });
      res.status(500).json({ error: 'Failed to get order' });
    }
  }

  async getInvoices(req: AuthRequest, res: Response) {
    try {
      const customerId = (req.user as any)?.customer_id;
      const companyId = req.user!.company_id;
      if (!customerId) throw new ApiError(403, 'Access denied');

      const invoices = await portalService.getCustomerInvoices(customerId, companyId);
      res.json(invoices);
    } catch (error) {
      if (error instanceof ApiError) return res.status(error.statusCode).json({ error: error.message });
      res.status(500).json({ error: 'Failed to get invoices' });
    }
  }

  async getQuotes(req: AuthRequest, res: Response) {
    try {
      const customerId = (req.user as any)?.customer_id;
      const companyId = req.user!.company_id;
      if (!customerId) throw new ApiError(403, 'Access denied');

      const quotes = await portalService.getCustomerQuotes(customerId, companyId);
      res.json(quotes);
    } catch (error) {
      if (error instanceof ApiError) return res.status(error.statusCode).json({ error: error.message });
      res.status(500).json({ error: 'Failed to get quotes' });
    }
  }

  async getQuotePdf(req: AuthRequest, res: Response) {
    try {
      const companyId = req.user!.company_id;
      const pdf = await quotesService.generateQuotePdf(companyId, req.params.id);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename=cotizacion-${req.params.id.slice(0, 8)}.pdf`);
      res.send(pdf);
    } catch (error) {
      if (error instanceof ApiError) return res.status(error.statusCode).json({ error: error.message });
      res.status(500).json({ error: 'Failed to generate PDF' });
    }
  }
}

export const portalController = new PortalController();
