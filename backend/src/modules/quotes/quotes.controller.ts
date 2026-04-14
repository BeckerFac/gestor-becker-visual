import { Response } from 'express';
import { AuthRequest } from '../../middlewares/auth';
import { quotesService } from './quotes.service';
import { ApiError } from '../../middlewares/errorHandler';
import { validateBase64Upload } from '../../lib/upload-validation';

export class QuotesController {
  async getQuotes(req: AuthRequest, res: Response) {
    const data = await quotesService.getQuotes(req.user!.company_id, {
      enterprise_id: req.query.enterprise_id as string,
      status: req.query.status as string,
      search: req.query.search as string,
      date_from: req.query.date_from as string,
      date_to: req.query.date_to as string,
      skip: Math.max(0, parseInt(req.query.skip as string) || 0),
      limit: Math.min(parseInt(req.query.limit as string) || 50, 100),
    });
    res.json(data);
  }

  async getQuote(req: AuthRequest, res: Response) {
    const data = await quotesService.getQuote(req.user!.company_id, req.params.id);
    res.json(data);
  }

  async createQuote(req: AuthRequest, res: Response) {
    const data = await quotesService.createQuote(req.user!.company_id, req.user!.id, req.body);
    res.status(201).json(data);
  }

  async updateQuote(req: AuthRequest, res: Response) {
    const data = await quotesService.updateQuote(req.user!.company_id, req.params.id, req.body);
    res.json(data);
  }

  async updateStatus(req: AuthRequest, res: Response) {
    const data = await quotesService.updateQuoteStatus(req.user!.company_id, req.params.id, req.body.status);
    res.json(data);
  }

  async downloadPdf(req: AuthRequest, res: Response) {
    const template = (req.query.template as string) || 'clasico';
    const bannerUrl = (req.query.banner_url as string) || undefined;
    const pdf = await quotesService.generateQuotePdf(req.user!.company_id, req.params.id, template, bannerUrl);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=cotizacion-${req.params.id.substring(0, 8)}.pdf`);
    res.send(pdf);
  }

  // --- Banner management ---

  async uploadBanner(req: AuthRequest, res: Response) {
    const { base64 } = req.body;
    if (!base64) throw new ApiError(400, 'base64 field is required');

    // HIGH-5: validate magic bytes (never trust client-supplied mime_type).
    // Limit to 2MB because the banner is stored inline in the companies row.
    validateBase64Upload(base64, {
      maxSize: 2 * 1024 * 1024,
      allowedMimes: ['image/png', 'image/jpeg'],
    });

    const data = await quotesService.uploadBanner(req.user!.company_id, base64);
    res.json(data);
  }

  async getBanner(req: AuthRequest, res: Response) {
    const banner = await quotesService.getBanner(req.user!.company_id);
    res.json({ banner });
  }

  async deleteBanner(req: AuthRequest, res: Response) {
    const data = await quotesService.deleteBanner(req.user!.company_id);
    res.json(data);
  }
}

export const quotesController = new QuotesController();
