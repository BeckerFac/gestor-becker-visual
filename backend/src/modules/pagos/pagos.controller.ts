import { Response } from 'express';
import { AuthRequest } from '../../middlewares/auth';
import { pagosService } from './pagos.service';

export class PagosController {
  async getPagos(req: AuthRequest, res: Response) {
    const data = await pagosService.getPagos(req.user!.company_id, {
      enterprise_id: req.query.enterprise_id as string,
    });
    res.json(data);
  }

  async createPago(req: AuthRequest, res: Response) {
    const data = await pagosService.createPago(req.user!.company_id, req.user!.id, req.body);
    res.status(201).json(data);
  }

  async deletePago(req: AuthRequest, res: Response) {
    const data = await pagosService.deletePago(req.user!.company_id, req.params.id);
    res.json(data);
  }

  async getSummary(req: AuthRequest, res: Response) {
    const data = await pagosService.getSummary(req.user!.company_id);
    res.json(data);
  }
}

export const pagosController = new PagosController();
