import { Request, Response } from 'express';
import { invoicesService } from './invoices.service';
import { AuthRequest } from '../../middlewares/auth';
import { ApiError } from '../../middlewares/errorHandler';

export class InvoicesController {
  async createInvoice(req: AuthRequest, res: Response) {
    try {
      if (!req.user?.company_id || !req.user.id) throw new ApiError(401, 'Unauthorized');
      const invoice = await invoicesService.createInvoice(req.user.company_id, req.user.id, req.body);
      res.status(201).json(invoice);
    } catch (error) {
      if (error instanceof ApiError) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      res.status(500).json({ error: 'Failed to create invoice' });
    }
  }

  async getInvoices(req: AuthRequest, res: Response) {
    try {
      if (!req.user?.company_id) throw new ApiError(401, 'Unauthorized');
      const { skip = '0', limit = '50' } = req.query;
      const data = await invoicesService.getInvoices(req.user.company_id, {
        skip: parseInt(skip as string, 10),
        limit: parseInt(limit as string, 10),
      });
      res.json(data);
    } catch (error) {
      if (error instanceof ApiError) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      res.status(500).json({ error: 'Failed to get invoices' });
    }
  }

  async getInvoice(req: AuthRequest, res: Response) {
    try {
      if (!req.user?.company_id || !req.params.id) throw new ApiError(400, 'Missing invoice ID');
      const invoice = await invoicesService.getInvoice(req.user.company_id, req.params.id);
      res.json(invoice);
    } catch (error) {
      if (error instanceof ApiError) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      res.status(500).json({ error: 'Failed to get invoice' });
    }
  }

  async authorizeInvoice(req: AuthRequest, res: Response) {
    try {
      if (!req.user?.company_id || !req.params.id) throw new ApiError(400, 'Missing invoice ID');
      const invoice = await invoicesService.authorizeInvoice(req.user.company_id, req.params.id);
      res.json(invoice);
    } catch (error) {
      if (error instanceof ApiError) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      res.status(500).json({ error: 'Failed to authorize invoice' });
    }
  }
}

export const invoicesController = new InvoicesController();
