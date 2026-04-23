import { Response } from 'express';
import { AuthRequest } from '../../middlewares/auth';
import { cobrosService } from './cobros.service';
import { pdfService } from '../pdf/pdf.service';
import { ApiError } from '../../middlewares/errorHandler';

export class CobrosController {
  async getCobros(req: AuthRequest, res: Response) {
    try {
      const data = await cobrosService.getCobros(req.user!.company_id, {
        enterprise_id: req.query.enterprise_id as string,
        business_unit_id: req.query.business_unit_id as string,
        fiscal_type: req.query.fiscal_type as 'fiscal' | 'no_fiscal' | 'all' | undefined,
        userCanAccessLuna: !!(req.user as any)?.can_access_luna,
      });
      res.json(data);
    } catch (error) {
      console.error('getCobros controller error:', error);
      const status = (error as any).statusCode || 500;
      const message = (error as any).message || 'Error al obtener cobros';
      res.status(status).json({ error: message });
    }
  }

  async createCobro(req: AuthRequest, res: Response) {
    try {
      const data = await cobrosService.createCobro(req.user!.company_id, req.user!.id, req.body, {
        userCanAccessLuna: !!(req.user as any)?.can_access_luna,
      });
      res.status(201).json(data);
    } catch (error) {
      console.error('createCobro controller error:', error);
      const status = (error as any).statusCode || 500;
      const message = (error as any).message || 'Error al crear cobro';
      res.status(status).json({ error: message });
    }
  }

  async deleteCobro(req: AuthRequest, res: Response) {
    // PR7-T5: pasar userId + reason para audit trail del soft delete
    const reason = typeof req.body?.reason === 'string' ? req.body.reason : undefined;
    const data = await cobrosService.deleteCobro(req.user!.company_id, req.params.id, req.user!.id, reason);
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
    try {
      // Sol/Luna gate: propagate the 404 that cobrosService.getCobroById emits
      // for Luna-as-Sol row lookups. The receipt PDF would otherwise render the
      // complete receipt of a Luna cobro for a Sol-only user.
      const userCanAccessLuna = !!(req.user as any)?.can_access_luna;
      try {
        await cobrosService.getCobroById(req.user!.company_id, req.params.id, { userCanAccessLuna });
      } catch (gateErr) {
        if (gateErr instanceof ApiError && gateErr.statusCode === 404) {
          return res.status(404).json({ error: 'Cobro no encontrado' });
        }
        throw gateErr;
      }
      const pdf = await pdfService.generateReceiptPdf(req.params.id, req.user!.company_id);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename=recibo-${req.params.id}.pdf`);
      res.send(pdf);
    } catch (error) {
      console.error('Error generating receipt PDF:', error);
      const status = (error as any).statusCode || 500;
      const message = (error as any).message || 'Error al generar PDF del recibo';
      res.status(status).json({ error: message });
    }
  }
}

export const cobrosController = new CobrosController();
