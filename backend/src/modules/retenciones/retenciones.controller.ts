import { Response } from 'express';
import { AuthRequest } from '../../middlewares/auth';
import { retencionesService } from './retenciones.service';
import { ApiError } from '../../middlewares/errorHandler';

export class RetencionesController {
  async getRetentions(req: AuthRequest, res: Response) {
    const direction = req.query.direction as string | undefined;
    if (direction && direction !== 'sufrida' && direction !== 'practicada') {
      return res.status(400).json({ error: "direction debe ser 'sufrida' o 'practicada'" });
    }
    const data = await retencionesService.getRetentions(req.user!.company_id, {
      type: req.query.type as string,
      enterprise_id: req.query.enterprise_id as string,
      period: req.query.period as string,
      date_from: req.query.date_from as string,
      date_to: req.query.date_to as string,
      direction: direction as 'sufrida' | 'practicada' | undefined,
      jurisdiction: req.query.jurisdiction as string,
      pago_id: req.query.pago_id as string,
      cobro_id: req.query.cobro_id as string,
      purchase_invoice_id: req.query.purchase_invoice_id as string,
      invoice_id: req.query.invoice_id as string,
    });
    res.json(data);
  }

  async getSummary(req: AuthRequest, res: Response) {
    const data = await retencionesService.getRetentionSummary(
      req.user!.company_id,
      req.query.period as string,
    );
    res.json(data);
  }

  async createRetention(req: AuthRequest, res: Response) {
    const data = await retencionesService.createRetention(
      req.user!.company_id,
      req.user!.id,
      req.body,
    );
    res.status(201).json(data);
  }

  /**
   * H8: POST /api/retenciones/calculate
   * Preview a retention (rate, amount, source) BEFORE creating it.
   * Body: { type, base_amount, jurisdiction?, cuit?, date? }
   */
  async calculatePreview(req: AuthRequest, res: Response) {
    const { type, base_amount, jurisdiction, cuit, date } = req.body || {};
    if (!type || base_amount === undefined || base_amount === null) {
      return res.status(400).json({ error: 'type y base_amount son requeridos' });
    }
    const baseNum = parseFloat(base_amount);
    if (!Number.isFinite(baseNum) || baseNum <= 0) {
      return res.status(400).json({ error: 'base_amount debe ser un numero mayor a 0' });
    }
    const data = await retencionesService.calculateRetention({
      companyId: req.user!.company_id,
      type,
      base_amount: baseNum,
      jurisdiction: jurisdiction || null,
      cuit: cuit || null,
      date: date || null,
    });
    res.json(data);
  }

  async calculateForPago(req: AuthRequest, res: Response) {
    const { enterprise_id, amount, date } = req.query;
    if (!enterprise_id || !amount) {
      return res.status(400).json({ error: 'enterprise_id y amount son requeridos' });
    }
    const data = await retencionesService.calculateRetentionsForPago(
      req.user!.company_id,
      enterprise_id as string,
      parseFloat(amount as string),
      date as string | undefined,
    );
    res.json(data);
  }

  async importPadron(req: AuthRequest, res: Response) {
    const { source, csv_data } = req.body;
    if (!source || !csv_data) {
      return res.status(400).json({ error: 'source y csv_data son requeridos' });
    }
    const data = await retencionesService.importPadron(
      req.user!.company_id,
      source,
      csv_data,
    );
    res.json(data);
  }

  async deleteRetention(req: AuthRequest, res: Response) {
    const reason = (req.body?.reason || req.query?.reason) as string | undefined;
    const data = await retencionesService.deleteRetention(
      req.user!.company_id,
      req.params.id,
      req.user!.id,
      reason || '',
    );
    res.json(data);
  }

  /**
   * H8: Explicit rejection of PUT/PATCH. Retenciones are immutable.
   */
  async rejectUpdate(_req: AuthRequest, _res: Response) {
    throw new ApiError(
      405,
      'Las retenciones son inmutables una vez creadas. Para corregir, anule la retencion y cree una nueva.',
    );
  }
}

export const retencionesController = new RetencionesController();
