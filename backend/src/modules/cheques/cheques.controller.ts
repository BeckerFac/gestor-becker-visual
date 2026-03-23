import { Response } from 'express';
import { AuthRequest } from '../../middlewares/auth';
import { chequesService } from './cheques.service';

export class ChequesController {
  async getCheques(req: AuthRequest, res: Response) {
    const data = await chequesService.getCheques(req.user!.company_id, {
      status: req.query.status as string,
      search: req.query.search as string,
      due_from: req.query.due_from as string,
      due_to: req.query.due_to as string,
      business_unit_id: req.query.business_unit_id as string,
    });
    res.json(data);
  }

  async createCheque(req: AuthRequest, res: Response) {
    const data = await chequesService.createCheque(req.user!.company_id, req.user!.id, req.body);
    res.status(201).json(data);
  }

  async updateStatus(req: AuthRequest, res: Response) {
    const data = await chequesService.updateChequeStatus(
      req.user!.company_id,
      req.params.id,
      req.body.status,
      req.user!.id,
      req.body.notes
    );
    res.json(data);
  }

  async updateCheque(req: AuthRequest, res: Response) {
    const data = await chequesService.updateCheque(req.user!.company_id, req.params.id, req.body);
    res.json(data);
  }

  async deleteCheque(req: AuthRequest, res: Response) {
    const data = await chequesService.deleteCheque(req.user!.company_id, req.params.id);
    res.json(data);
  }

  async getStatusHistory(req: AuthRequest, res: Response) {
    const data = await chequesService.getStatusHistory(req.user!.company_id, req.params.id);
    res.json(data);
  }

  async getSummary(req: AuthRequest, res: Response) {
    const data = await chequesService.getSummary(req.user!.company_id);
    res.json(data);
  }
  async endorseCheque(req: AuthRequest, res: Response) {
    const data = await chequesService.endorseCheque(
      req.user!.company_id,
      req.user!.id,
      req.params.id,
      {
        enterprise_id: req.body.enterprise_id,
        amount: parseFloat(req.body.amount),
        purchase_invoice_id: req.body.purchase_invoice_id,
        notes: req.body.notes,
      }
    );
    res.status(201).json(data);
  }

  async getChequesForEndorsement(req: AuthRequest, res: Response) {
    const data = await chequesService.getChequesForEndorsement(
      req.user!.company_id,
      req.query.business_unit_id as string
    );
    res.json(data);
  }
}

export const chequesController = new ChequesController();
