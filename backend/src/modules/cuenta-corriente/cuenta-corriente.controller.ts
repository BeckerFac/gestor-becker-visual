import { Response } from 'express';
import { AuthRequest } from '../../middlewares/auth';
import { cuentaCorrienteService } from './cuenta-corriente.service';
import { pdfService } from '../pdf/pdf.service';
import { ApiError } from '../../middlewares/errorHandler';

export class CuentaCorrienteController {
  async getResumen(req: AuthRequest, res: Response) {
    const data = await cuentaCorrienteService.getResumen(
      req.user!.company_id,
      req.query.business_unit_id as string
    );
    res.json(data);
  }

  async getDetalle(req: AuthRequest, res: Response) {
    const data = await cuentaCorrienteService.getDetalle(
      req.user!.company_id,
      req.params.enterpriseId,
      req.query.business_unit_id as string
    );
    res.json(data);
  }

  async getPdf(req: AuthRequest, res: Response) {
    try {
      const { enterpriseId } = req.params;
      const dateFrom = req.query.date_from as string;
      const dateTo = req.query.date_to as string;

      if (!dateFrom || !dateTo) {
        res.status(400).json({ error: 'date_from and date_to son requeridos' });
        return;
      }

      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      if (!dateRegex.test(dateFrom) || !dateRegex.test(dateTo)) {
        res.status(400).json({ error: 'Formato de fecha invalido. Usar YYYY-MM-DD' });
        return;
      }

      const data = await cuentaCorrienteService.getPdfData(
        req.user!.company_id,
        enterpriseId,
        dateFrom,
        dateTo
      );

      const pdf = await pdfService.generateCuentaCorrientePdf(data);

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="cuenta_corriente_${(data.enterprise?.name || 'empresa').replace(/[^a-zA-Z0-9]/g, '_')}.pdf"`);
      res.send(pdf);
    } catch (error: any) {
      console.error('Cuenta corriente PDF error:', error?.message, error?.stack);
      res.status(500).json({ error: 'Error al generar PDF: ' + (error?.message || 'Error desconocido').slice(0, 200) });
    }
  }

  async createAdjustment(req: AuthRequest, res: Response) {
    const { enterpriseId } = req.params;
    const { amount, reason, adjustment_type } = req.body;

    const data = await cuentaCorrienteService.createAdjustment(
      req.user!.company_id,
      enterpriseId,
      { amount, reason, adjustment_type, created_by: req.user!.id }
    );
    res.status(201).json(data);
  }

  async getAdjustments(req: AuthRequest, res: Response) {
    const { enterpriseId } = req.params;
    const data = await cuentaCorrienteService.getAdjustments(req.user!.company_id, enterpriseId);
    res.json(data);
  }

  async deleteAdjustment(req: AuthRequest, res: Response) {
    const { enterpriseId, adjustmentId } = req.params;
    const data = await cuentaCorrienteService.deleteAdjustment(req.user!.company_id, enterpriseId, adjustmentId);
    res.json(data);
  }
}

export const cuentaCorrienteController = new CuentaCorrienteController();
