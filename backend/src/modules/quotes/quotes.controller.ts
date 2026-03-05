import { Response } from 'express';
import { AuthRequest } from '../../middlewares/auth';
import { quotesService } from './quotes.service';

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

  async updateStatus(req: AuthRequest, res: Response) {
    const data = await quotesService.updateQuoteStatus(req.user!.company_id, req.params.id, req.body.status);
    res.json(data);
  }

  async downloadPdf(req: AuthRequest, res: Response) {
    const pdf = await quotesService.generateQuotePdf(req.user!.company_id, req.params.id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=cotizacion-${req.params.id.substring(0, 8)}.pdf`);
    res.send(pdf);
  }
}

export const quotesController = new QuotesController();
