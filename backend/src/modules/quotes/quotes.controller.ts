import { Response } from 'express';
import { AuthRequest } from '../../middlewares/auth';
import { quotesService } from './quotes.service';
import { ApiError } from '../../middlewares/errorHandler';

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
    const { base64, mime_type } = req.body;
    if (!base64) throw new ApiError(400, 'base64 field is required');

    // Validate mime type
    const allowedTypes = ['image/png', 'image/jpeg', 'image/jpg'];
    if (mime_type && !allowedTypes.includes(mime_type)) {
      throw new ApiError(400, 'Solo se permiten imagenes PNG o JPEG');
    }

    // Validate size (base64 is ~33% larger than binary, so 2MB binary = ~2.7MB base64)
    const sizeBytes = Buffer.from(base64, 'base64').length;
    if (sizeBytes > 2 * 1024 * 1024) {
      throw new ApiError(400, 'La imagen no puede superar 2MB');
    }

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
