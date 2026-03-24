import { Router } from 'express';
import { currencyController } from './currency.controller';

export const currencyRouter = Router();

currencyRouter.get('/rate', (req, res) => currencyController.getRate(req, res));
currencyRouter.get('/rates', (req, res) => currencyController.getRates(req, res));
