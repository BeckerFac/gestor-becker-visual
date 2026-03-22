import { Response } from 'express';
import { AuthRequest } from '../../middlewares/auth';
import { portalService } from './portal.service';
import { quotesService } from '../quotes/quotes.service';
import { ApiError } from '../../middlewares/errorHandler';

export class PortalController {
  // ==================== CONFIG ENDPOINTS (admin) ====================

  async getConfig(req: AuthRequest, res: Response) {
    try {
      const companyId = req.user!.company_id;
      const config = await portalService.getPortalConfig(companyId);
      res.json(config);
    } catch (error) {
      if (error instanceof ApiError) return res.status(error.statusCode).json({ error: error.message });
      res.status(500).json({ error: 'Failed to get portal config' });
    }
  }

  async updateConfig(req: AuthRequest, res: Response) {
    try {
      const companyId = req.user!.company_id;
      const config = await portalService.updatePortalConfig(companyId, req.body);
      res.json(config);
    } catch (error) {
      if (error instanceof ApiError) return res.status(error.statusCode).json({ error: error.message });
      res.status(500).json({ error: 'Failed to update portal config' });
    }
  }

  // ==================== PUBLIC CONFIG (customer auth) ====================

  async getPublicConfig(req: AuthRequest, res: Response) {
    try {
      const companyId = req.user!.company_id;
      const config = await portalService.getPublicPortalConfig(companyId);
      res.json(config);
    } catch (error) {
      if (error instanceof ApiError) return res.status(error.statusCode).json({ error: error.message });
      res.status(500).json({ error: 'Failed to get portal config' });
    }
  }

  // ==================== PREVIEW TOKEN (admin) ====================

  async generatePreviewToken(req: AuthRequest, res: Response) {
    try {
      const { authService } = await import('../auth/auth.service');
      const token = await authService.generatePortalPreviewToken(req.user!.company_id, req.user!.id);
      res.json({ token });
    } catch (error) {
      if (error instanceof ApiError) return res.status(error.statusCode).json({ error: error.message });
      res.status(500).json({ error: 'Error generando token de preview' });
    }
  }

  // ==================== PORTAL DATA ENDPOINTS ====================

  async getSummary(req: AuthRequest, res: Response) {
    try {
      const enterpriseId = (req.user as any)?.enterprise_id;
      const companyId = req.user!.company_id;
      if (!enterpriseId) throw new ApiError(403, 'Access denied');

      const summary = await portalService.getCustomerSummary(enterpriseId, companyId);
      res.json(summary);
    } catch (error) {
      if (error instanceof ApiError) return res.status(error.statusCode).json({ error: error.message });
      res.status(500).json({ error: 'Failed to get summary' });
    }
  }

  async getProfile(req: AuthRequest, res: Response) {
    try {
      const enterpriseId = (req.user as any)?.enterprise_id;
      if (!enterpriseId) throw new ApiError(403, 'Access denied');

      const profile = await portalService.getCustomerProfile(enterpriseId);
      res.json(profile);
    } catch (error) {
      if (error instanceof ApiError) return res.status(error.statusCode).json({ error: error.message });
      res.status(500).json({ error: 'Failed to get profile' });
    }
  }

  async getOrders(req: AuthRequest, res: Response) {
    try {
      const enterpriseId = (req.user as any)?.enterprise_id;
      const companyId = req.user!.company_id;
      if (!enterpriseId) throw new ApiError(403, 'Access denied');

      const orders = await portalService.getCustomerOrders(enterpriseId, companyId);
      res.json(orders);
    } catch (error) {
      if (error instanceof ApiError) return res.status(error.statusCode).json({ error: error.message });
      res.status(500).json({ error: 'Failed to get orders' });
    }
  }

  async getOrder(req: AuthRequest, res: Response) {
    try {
      const enterpriseId = (req.user as any)?.enterprise_id;
      const companyId = req.user!.company_id;
      if (!enterpriseId) throw new ApiError(403, 'Access denied');

      const order = await portalService.getCustomerOrder(enterpriseId, req.params.id, companyId);
      res.json(order);
    } catch (error) {
      if (error instanceof ApiError) return res.status(error.statusCode).json({ error: error.message });
      res.status(500).json({ error: 'Failed to get order' });
    }
  }

  async getInvoices(req: AuthRequest, res: Response) {
    try {
      const enterpriseId = (req.user as any)?.enterprise_id;
      const companyId = req.user!.company_id;
      if (!enterpriseId) throw new ApiError(403, 'Access denied');

      const invoices = await portalService.getCustomerInvoices(enterpriseId, companyId);
      res.json(invoices);
    } catch (error) {
      if (error instanceof ApiError) return res.status(error.statusCode).json({ error: error.message });
      res.status(500).json({ error: 'Failed to get invoices' });
    }
  }

  async getQuotes(req: AuthRequest, res: Response) {
    try {
      const enterpriseId = (req.user as any)?.enterprise_id;
      const companyId = req.user!.company_id;
      if (!enterpriseId) throw new ApiError(403, 'Access denied');

      const quotes = await portalService.getCustomerQuotes(enterpriseId, companyId);
      res.json(quotes);
    } catch (error) {
      if (error instanceof ApiError) return res.status(error.statusCode).json({ error: error.message });
      res.status(500).json({ error: 'Failed to get quotes' });
    }
  }

  async getQuotePdf(req: AuthRequest, res: Response) {
    try {
      const enterpriseId = (req.user as any)?.enterprise_id;
      const companyId = req.user!.company_id;
      if (!enterpriseId) throw new ApiError(403, 'Access denied');

      // Verify quote belongs to this enterprise before generating PDF
      const quote = await quotesService.getQuote(companyId, req.params.id);
      if ((quote as any).enterprise_id !== enterpriseId) {
        throw new ApiError(403, 'Access denied: quote does not belong to this enterprise');
      }

      const pdf = await quotesService.generateQuotePdf(companyId, req.params.id);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename=cotizacion-${req.params.id.slice(0, 8)}.pdf`);
      res.send(pdf);
    } catch (error) {
      if (error instanceof ApiError) return res.status(error.statusCode).json({ error: error.message });
      res.status(500).json({ error: 'Failed to generate PDF' });
    }
  }

  async updateQuoteStatus(req: AuthRequest, res: Response) {
    try {
      const enterpriseId = (req.user as any)?.enterprise_id;
      const companyId = req.user!.company_id;
      if (!enterpriseId) throw new ApiError(403, 'Access denied');

      const { status, reason } = req.body;
      if (!status || !['accepted', 'rejected'].includes(status)) {
        throw new ApiError(400, 'Invalid status. Must be accepted or rejected');
      }

      const result = await portalService.updateQuoteStatus(enterpriseId, companyId, req.params.id, status, reason);
      res.json(result);
    } catch (error) {
      if (error instanceof ApiError) return res.status(error.statusCode).json({ error: error.message });
      res.status(500).json({ error: 'Failed to update quote status' });
    }
  }

  async getRemitos(req: AuthRequest, res: Response) {
    try {
      const enterpriseId = (req.user as any)?.enterprise_id;
      const companyId = req.user!.company_id;
      if (!enterpriseId) throw new ApiError(403, 'Access denied');

      const remitos = await portalService.getCustomerRemitos(enterpriseId, companyId);
      res.json(remitos);
    } catch (error) {
      if (error instanceof ApiError) return res.status(error.statusCode).json({ error: error.message });
      res.status(500).json({ error: 'Failed to get remitos' });
    }
  }
}

export const portalController = new PortalController();
