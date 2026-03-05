import { Router } from 'express';
import { quotesController } from './quotes.controller';

export const quotesRouter = Router();

quotesRouter.get('/', (req, res) => quotesController.getQuotes(req as any, res));
quotesRouter.post('/', (req, res) => quotesController.createQuote(req as any, res));
quotesRouter.get('/:id', (req, res) => quotesController.getQuote(req as any, res));
quotesRouter.put('/:id/status', (req, res) => quotesController.updateStatus(req as any, res));
quotesRouter.get('/:id/pdf', (req, res) => quotesController.downloadPdf(req as any, res));
