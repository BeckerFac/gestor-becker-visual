import { Response } from 'express';
import { AuthRequest } from '../../middlewares/auth';
import { cuentaCorrienteService } from './cuenta-corriente.service';
import { pdfService } from '../pdf/pdf.service';
import { ApiError } from '../../middlewares/errorHandler';

export class CuentaCorrienteController {
  async getResumen(req: AuthRequest, res: Response) {
    const data = await cuentaCorrienteService.getResumen(req.user!.company_id);
    res.json(data);
  }

  async getDetalle(req: AuthRequest, res: Response) {
    const data = await cuentaCorrienteService.getDetalle(req.user!.company_id, req.params.enterpriseId);
    res.json(data);
  }

  async getPdf(req: AuthRequest, res: Response) {
    const { enterpriseId } = req.params;
    const dateFrom = req.query.date_from as string;
    const dateTo = req.query.date_to as string;

    if (!dateFrom || !dateTo) {
      throw new ApiError(400, 'date_from and date_to query parameters are required');
    }

    // Validate date format (YYYY-MM-DD)
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(dateFrom) || !dateRegex.test(dateTo)) {
      throw new ApiError(400, 'Invalid date format. Use YYYY-MM-DD');
    }

    const data = await cuentaCorrienteService.getPdfData(
      req.user!.company_id,
      enterpriseId,
      dateFrom,
      dateTo
    );

    const pdf = await pdfService.generateCuentaCorrientePdf(data);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="cuenta_corriente_${data.enterprise.name.replace(/[^a-zA-Z0-9]/g, '_')}.pdf"`);
    res.send(pdf);
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
