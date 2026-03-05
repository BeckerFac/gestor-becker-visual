import { Response } from 'express';
import { AuthRequest } from '../../middlewares/auth';
import { cuentaCorrienteService } from './cuenta-corriente.service';

export class CuentaCorrienteController {
  async getResumen(req: AuthRequest, res: Response) {
    const data = await cuentaCorrienteService.getResumen(req.user!.company_id);
    res.json(data);
  }

  async getDetalle(req: AuthRequest, res: Response) {
    const data = await cuentaCorrienteService.getDetalle(req.user!.company_id, req.params.enterpriseId);
    res.json(data);
  }
}

export const cuentaCorrienteController = new CuentaCorrienteController();
