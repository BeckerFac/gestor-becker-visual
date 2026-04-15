import { Response } from 'express';
import { AuthRequest } from '../../middlewares/auth';
import { pagosService } from './pagos.service';
import { pdfService } from '../pdf/pdf.service';

export class PagosController {
  async getPagos(req: AuthRequest, res: Response) {
    const data = await pagosService.getPagos(req.user!.company_id, {
      enterprise_id: req.query.enterprise_id as string,
      business_unit_id: req.query.business_unit_id as string,
    });
    res.json(data);
  }

  async createPago(req: AuthRequest, res: Response) {
    const data = await pagosService.createPago(req.user!.company_id, req.user!.id, req.body);
    res.status(201).json(data);
  }

  async deletePago(req: AuthRequest, res: Response) {
    const reason = (req.body && typeof req.body.reason === 'string') ? req.body.reason : 'Eliminado via DELETE endpoint';
    const data = await pagosService.deletePago(req.user!.company_id, req.params.id, req.user!.id, reason);
    res.json(data);
  }

  async anularPago(req: AuthRequest, res: Response) {
    const reason = req.body?.reason as string | undefined;
    const data = await pagosService.anularPago(req.user!.company_id, req.params.id, req.user!.id, reason || '');
    res.json(data);
  }

  async getPagoPdf(req: AuthRequest, res: Response) {
    const pdf = await pdfService.generatePaymentPdf(req.params.id, req.user!.company_id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="orden-pago-${req.params.id.slice(-8)}.pdf"`);
    res.send(pdf);
  }

  async getSummary(req: AuthRequest, res: Response) {
    const data = await pagosService.getSummary(req.user!.company_id);
    res.json(data);
  }
}

export const pagosController = new PagosController();
