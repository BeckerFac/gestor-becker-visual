import { Router } from 'express';
import { cuentaCorrienteController } from './cuenta-corriente.controller';
import { authorize } from '../../middlewares/authorize';

export const cuentaCorrienteRouter = Router();

cuentaCorrienteRouter.get('/', authorize('cuenta_corriente', 'view'), (req, res) => cuentaCorrienteController.getResumen(req as any, res));
cuentaCorrienteRouter.get('/:enterpriseId/pdf', authorize('cuenta_corriente', 'view'), (req, res, next) => cuentaCorrienteController.getPdf(req as any, res).catch(next));
cuentaCorrienteRouter.get('/:enterpriseId/adjustments', authorize('cuenta_corriente', 'view'), (req, res, next) => cuentaCorrienteController.getAdjustments(req as any, res).catch(next));
cuentaCorrienteRouter.post('/:enterpriseId/adjustment', authorize('cuenta_corriente', 'view'), (req, res, next) => cuentaCorrienteController.createAdjustment(req as any, res).catch(next));
cuentaCorrienteRouter.delete('/:enterpriseId/adjustment/:adjustmentId', authorize('cuenta_corriente', 'view'), (req, res, next) => cuentaCorrienteController.deleteAdjustment(req as any, res).catch(next));
cuentaCorrienteRouter.get('/:enterpriseId', authorize('cuenta_corriente', 'view'), (req, res) => cuentaCorrienteController.getDetalle(req as any, res));
