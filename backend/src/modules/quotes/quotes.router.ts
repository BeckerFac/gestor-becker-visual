import { Router } from 'express';
import { quotesController } from './quotes.controller';
import { authorize } from '../../middlewares/authorize';

export const quotesRouter = Router();

quotesRouter.get('/', authorize('quotes', 'view'), (req, res) => quotesController.getQuotes(req as any, res));
quotesRouter.post('/', authorize('quotes', 'create'), (req, res) => quotesController.createQuote(req as any, res));
quotesRouter.get('/:id', authorize('quotes', 'view'), (req, res) => quotesController.getQuote(req as any, res));
quotesRouter.put('/:id/status', authorize('quotes', 'edit'), (req, res) => quotesController.updateStatus(req as any, res));
quotesRouter.get('/:id/pdf', authorize('quotes', 'view'), (req, res) => quotesController.downloadPdf(req as any, res));
