import { Response } from 'express';
import { AuthRequest } from '../../middlewares/auth';
import { remitosService } from './remitos.service';
import { validateBase64Upload } from '../../lib/upload-validation';

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

  async getRemito(req: AuthRequest, res: Response) {
    const data = await remitosService.getRemito(req.user!.company_id, req.params.id);
    res.json(data);
  }

  async createRemito(req: AuthRequest, res: Response) {
    const data = await remitosService.createRemito(req.user!.company_id, req.user!.id, req.body);
    res.status(201).json(data);
  }

  async updateRemito(req: AuthRequest, res: Response) {
    const data = await remitosService.updateRemito(req.user!.company_id, req.params.id, req.body);
    res.json(data);
  }

  async updateStatus(req: AuthRequest, res: Response) {
    const data = await remitosService.updateRemitoStatus(req.user!.company_id, req.params.id, req.body.status);
    res.json(data);
  }

  async deleteRemito(req: AuthRequest, res: Response) {
    const data = await remitosService.deleteRemito(req.user!.company_id, req.params.id, req.user!.id);
    res.json(data);
  }

  // ═══ Availability endpoints ═══

  async getAvailableOrderItems(req: AuthRequest, res: Response) {
    const enterpriseId = req.query.enterprise_id as string;
    if (!enterpriseId) return res.status(400).json({ message: 'enterprise_id required' });
    const data = await remitosService.getAvailableOrderItemsForRemitoByEnterprise(req.user!.company_id, enterpriseId);
    res.json(data);
  }

  async getAvailableOrderItemsByOrder(req: AuthRequest, res: Response) {
    const data = await remitosService.getAvailableOrderItemsForRemito(req.user!.company_id, req.params.orderId);
    res.json(data);
  }

  async getInvoiceItemsForRemito(req: AuthRequest, res: Response) {
    const data = await remitosService.getInvoiceItemsForRemito(req.user!.company_id, req.params.invoiceId);
    res.json(data);
  }

  async anularRemito(req: AuthRequest, res: Response) {
    const data = await remitosService.anularRemito(req.user!.company_id, req.params.id, req.user!.id);
    res.json(data);
  }

  async getContextData(req: AuthRequest, res: Response) {
    const data = await remitosService.getRemitoContextData(req.user!.company_id, req.params.id);
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

    // HIGH-5: centralized validation (magic bytes + size). Service
    // re-validates with a stricter 2MB cap as defense-in-depth.
    validateBase64Upload(base64, {
      maxSize: 5 * 1024 * 1024,
      allowedMimes: ['application/pdf'],
    });

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
