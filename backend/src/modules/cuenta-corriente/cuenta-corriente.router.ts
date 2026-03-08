import { Router } from 'express';
import { cuentaCorrienteController } from './cuenta-corriente.controller';
import { authorize } from '../../middlewares/authorize';

export const cuentaCorrienteRouter = Router();

cuentaCorrienteRouter.get('/', authorize('cuenta_corriente', 'view'), (req, res) => cuentaCorrienteController.getResumen(req as any, res));
cuentaCorrienteRouter.get('/:enterpriseId', authorize('cuenta_corriente', 'view'), (req, res) => cuentaCorrienteController.getDetalle(req as any, res));
