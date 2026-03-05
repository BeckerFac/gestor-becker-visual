import { Router } from 'express';
import { cuentaCorrienteController } from './cuenta-corriente.controller';

export const cuentaCorrienteRouter = Router();

cuentaCorrienteRouter.get('/', (req, res) => cuentaCorrienteController.getResumen(req as any, res));
cuentaCorrienteRouter.get('/:enterpriseId', (req, res) => cuentaCorrienteController.getDetalle(req as any, res));
