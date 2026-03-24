import { Response } from 'express';
import { AuthRequest } from '../../middlewares/auth';
import { retencionesService } from './retenciones.service';

export class RetencionesController {
  async getRetentions(req: AuthRequest, res: Response) {
    const data = await retencionesService.getRetentions(req.user!.company_id, {
      type: req.query.type as string,
      enterprise_id: req.query.enterprise_id as string,
      period: req.query.period as string,
      date_from: req.query.date_from as string,
      date_to: req.query.date_to as string,
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

  async calculateForPago(req: AuthRequest, res: Response) {
    const { enterprise_id, amount } = req.query;
    if (!enterprise_id || !amount) {
      return res.status(400).json({ error: 'enterprise_id y amount son requeridos' });
    }
    const data = await retencionesService.calculateRetentionsForPago(
      req.user!.company_id,
      enterprise_id as string,
      parseFloat(amount as string),
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
    const data = await retencionesService.deleteRetention(
      req.user!.company_id,
      req.params.id,
    );
    res.json(data);
  }
}

export const retencionesController = new RetencionesController();
