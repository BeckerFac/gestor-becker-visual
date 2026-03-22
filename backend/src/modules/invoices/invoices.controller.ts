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
      const data = await invoicesService.getInvoices(req.user.company_id, {
        skip: Math.max(0, parseInt(req.query.skip as string) || 0),
        limit: Math.max(1, Math.min(parseInt(req.query.limit as string) || 50, 200)),
        enterprise_id: req.query.enterprise_id as string,
        status: req.query.status as string,
        invoice_type: req.query.invoice_type as string,
        search: req.query.search as string,
        date_from: req.query.date_from as string,
        date_to: req.query.date_to as string,
        fiscal_type: req.query.fiscal_type as string,
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

  async linkOrder(req: AuthRequest, res: Response) {
    try {
      if (!req.user?.company_id) throw new ApiError(401, 'Unauthorized');
      const data = await invoicesService.linkOrder(req.user.company_id, req.params.id, req.body.order_id);
      res.json(data);
    } catch (error) {
      if (error instanceof ApiError) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      res.status(500).json({ error: 'Failed to link order' });
    }
  }

  async unlinkOrder(req: AuthRequest, res: Response) {
    try {
      if (!req.user?.company_id) throw new ApiError(401, 'Unauthorized');
      const data = await invoicesService.unlinkOrder(req.user.company_id, req.params.id);
      res.json(data);
    } catch (error) {
      if (error instanceof ApiError) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      res.status(500).json({ error: 'Failed to unlink order' });
    }
  }

  async updateDraftInvoice(req: AuthRequest, res: Response) {
    try {
      if (!req.user?.company_id || !req.params.id) throw new ApiError(400, 'Missing invoice ID');
      const invoice = await invoicesService.updateDraftInvoice(req.user.company_id, req.params.id, req.body);
      res.json(invoice);
    } catch (error) {
      if (error instanceof ApiError) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      res.status(500).json({ error: 'Failed to update invoice' });
    }
  }

  async deleteDraftInvoice(req: AuthRequest, res: Response) {
    try {
      if (!req.user?.company_id || !req.params.id) throw new ApiError(400, 'Missing invoice ID');
      const result = await invoicesService.deleteDraftInvoice(req.user.company_id, req.params.id);
      res.json(result);
    } catch (error) {
      if (error instanceof ApiError) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      res.status(500).json({ error: 'Failed to delete invoice' });
    }
  }

  async importInvoice(req: AuthRequest, res: Response) {
    try {
      if (!req.user?.company_id || !req.user.id) throw new ApiError(401, 'Unauthorized');
      const invoice = await invoicesService.importInvoice(req.user.company_id, req.user.id, req.body);
      res.status(201).json(invoice);
    } catch (error) {
      if (error instanceof ApiError) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      res.status(500).json({ error: 'Failed to import invoice' });
    }
  }

  async generatePaymentLink(req: AuthRequest, res: Response) {
    try {
      if (!req.user?.company_id || !req.params.id) throw new ApiError(400, 'Missing invoice ID');
      // TODO: Integrate with MercadoPago SDK to create real payment link
      res.json({ message: 'Configurar MERCADOPAGO_ACCESS_TOKEN para habilitar links de pago' });
    } catch (error) {
      if (error instanceof ApiError) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      res.status(500).json({ error: 'Failed to generate payment link' });
    }
  }

  async authorizeInvoice(req: AuthRequest, res: Response) {
    try {
      if (!req.user?.company_id || !req.params.id) throw new ApiError(400, 'Missing invoice ID');
      const rawPv = parseInt(req.body.punto_venta);
      const puntoVenta = Number.isFinite(rawPv) && rawPv >= 1 && rawPv <= 99999 ? rawPv : 3;
      const rawCondIva = parseInt(req.body.condicion_iva_receptor_id);
      const condicionIvaReceptorId = Number.isFinite(rawCondIva) ? rawCondIva : undefined;
      const invoice = await invoicesService.authorizeInvoice(req.user.company_id, req.params.id, puntoVenta, condicionIvaReceptorId);
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
