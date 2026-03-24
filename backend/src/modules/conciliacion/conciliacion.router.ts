import { Router } from 'express';
import { conciliacionController } from './conciliacion.controller';
import { authorize } from '../../middlewares/authorize';

export const conciliacionRouter = Router();

conciliacionRouter.post('/upload', authorize('cobros', 'create'), (req, res) => conciliacionController.upload(req as any, res));
conciliacionRouter.get('/statements', authorize('cobros', 'view'), (req, res) => conciliacionController.getStatements(req as any, res));
conciliacionRouter.get('/statements/:id', authorize('cobros', 'view'), (req, res) => conciliacionController.getStatement(req as any, res));
conciliacionRouter.post('/statements/:id/auto-match', authorize('cobros', 'create'), (req, res) => conciliacionController.autoMatch(req as any, res));
conciliacionRouter.post('/match', authorize('cobros', 'create'), (req, res) => conciliacionController.manualMatch(req as any, res));
conciliacionRouter.delete('/match/:lineId', authorize('cobros', 'delete'), (req, res) => conciliacionController.unmatch(req as any, res));
