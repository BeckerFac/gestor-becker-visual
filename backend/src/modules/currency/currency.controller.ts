import { Request, Response } from 'express';
import { currencyService } from './currency.service';

class CurrencyController {
  async getRate(req: Request, res: Response) {
    try {
      const currency = (req.query.currency as string || 'USD').toUpperCase();
      const date = req.query.date as string | undefined;
      const rate = await currencyService.getExchangeRate(currency, date);
      res.json({ currency, rate, date: date || new Date().toISOString().split('T')[0] });
    } catch (error: any) {
      res.status(500).json({ error: error.message || 'Error al obtener cotizacion' });
    }
  }

  async getRates(_req: Request, res: Response) {
    try {
      const rates = await currencyService.getAllRates();
      res.json({
        rates,
        currencies: currencyService.getAvailableCurrencies(),
        date: new Date().toISOString().split('T')[0],
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message || 'Error al obtener cotizaciones' });
    }
  }
}

export const currencyController = new CurrencyController();
