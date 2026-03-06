import { Response } from 'express';
import { AuthRequest } from '../../middlewares/auth';
import { remitosService } from './remitos.service';

export class RemitosController {
  async getRemitos(req: AuthRequest, res: Response) {
    const data = await remitosService.getRemitos(req.user!.company_id, {
      enterprise_id: req.query.enterprise_id as string,
      status: req.query.status as string,
      tipo: req.query.tipo as string,
      search: req.query.search as string,
      date_from: req.query.date_from as string,
      date_to: req.query.date_to as string,
      skip: parseInt(req.query.skip as string) || 0,
      limit: parseInt(req.query.limit as string) || 100,
    });
    res.json(data);
  }

  async createRemito(req: AuthRequest, res: Response) {
    const data = await remitosService.createRemito(req.user!.company_id, req.user!.id, req.body);
    res.status(201).json(data);
  }

  async updateStatus(req: AuthRequest, res: Response) {
    const data = await remitosService.updateRemitoStatus(req.user!.company_id, req.params.id, req.body.status);
    res.json(data);
  }

  async deleteRemito(req: AuthRequest, res: Response) {
    const data = await remitosService.deleteRemito(req.user!.company_id, req.params.id);
    res.json(data);
  }

  async downloadPdf(req: AuthRequest, res: Response) {
    const pdf = await remitosService.generateRemitoPdf(req.user!.company_id, req.params.id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=remito-${req.params.id.substring(0, 8)}.pdf`);
    res.send(pdf);
  }

  async uploadSignedPdf(req: AuthRequest, res: Response) {
    const { base64 } = req.body;
    if (!base64) return res.status(400).json({ message: 'base64 field is required' });
    const data = await remitosService.uploadSignedPdf(req.user!.company_id, req.params.id, base64);
    res.json(data);
  }

  async getSignedPdf(req: AuthRequest, res: Response) {
    const data = await remitosService.getSignedPdf(req.user!.company_id, req.params.id);
    if (!data) return res.status(404).json({ message: 'No signed PDF found' });
    res.json({ base64: data });
  }
}

export const remitosController = new RemitosController();
