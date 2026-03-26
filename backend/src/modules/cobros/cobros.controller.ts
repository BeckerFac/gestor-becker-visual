import { Response } from 'express';
import { AuthRequest } from '../../middlewares/auth';
import { cobrosService } from './cobros.service';
import { pdfService } from '../pdf/pdf.service';

export class CobrosController {
  async getCobros(req: AuthRequest, res: Response) {
    const data = await cobrosService.getCobros(req.user!.company_id, {
      enterprise_id: req.query.enterprise_id as string,
      business_unit_id: req.query.business_unit_id as string,
    });
    res.json(data);
  }

  async createCobro(req: AuthRequest, res: Response) {
    const data = await cobrosService.createCobro(req.user!.company_id, req.user!.id, req.body);
    res.status(201).json(data);
  }

  async deleteCobro(req: AuthRequest, res: Response) {
    const data = await cobrosService.deleteCobro(req.user!.company_id, req.params.id);
    res.json(data);
  }

  async getSummary(req: AuthRequest, res: Response) {
    const data = await cobrosService.getSummary(req.user!.company_id);
    res.json(data);
  }

  async getOrderPaymentDetails(req: AuthRequest, res: Response) {
    const data = await cobrosService.getOrderPaymentDetails(req.user!.company_id, req.params.orderId);
    res.json(data);
  }

  async getCobroReceipt(req: AuthRequest, res: Response) {
    const data = await cobrosService.getCobroReceipt(req.user!.company_id, req.params.id);
    res.json(data);
  }

  async getReceiptPdf(req: AuthRequest, res: Response) {
    const pdf = await pdfService.generateReceiptPdf(req.params.id, req.user!.company_id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename=recibo-${req.params.id}.pdf`);
    res.send(pdf);
  }
}

export const cobrosController = new CobrosController();
