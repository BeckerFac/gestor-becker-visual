import { Response } from 'express';
import { AuthRequest } from '../../middlewares/auth';
import { banksService } from './banks.service';
import { ApiError } from '../../middlewares/errorHandler';

export class BanksController {
  async getBanks(req: AuthRequest, res: Response) {
    const data = await banksService.getBanks(req.user!.company_id);
    res.json(data);
  }

  async createBank(req: AuthRequest, res: Response) {
    const data = await banksService.createBank(req.user!.company_id, req.body);
    res.status(201).json(data);
  }

  async updateBank(req: AuthRequest, res: Response) {
    const data = await banksService.updateBank(req.user!.company_id, req.params.id, req.body);
    res.json(data);
  }

  async deleteBank(req: AuthRequest, res: Response) {
    const data = await banksService.deleteBank(req.user!.company_id, req.params.id);
    res.json(data);
  }

  async getBreakdown(req: AuthRequest, res: Response) {
    const data = await banksService.getBreakdown(req.user!.company_id);
    res.json(data);
  }

  async getBankBalances(req: AuthRequest, res: Response) {
    try {
      const result = await banksService.getBankBalances(req.user!.company_id);
      res.json(result);
    } catch (error: any) {
      if (error instanceof ApiError) return res.status(error.statusCode).json({ error: error.message });
      res.status(500).json({ error: 'Failed to get bank balances' });
    }
  }

  async getBankMovements(req: AuthRequest, res: Response) {
    try {
      const result = await banksService.getBankMovements(
        req.user!.company_id,
        req.params.id,
        { date_from: req.query.date_from as string, date_to: req.query.date_to as string }
      );
      res.json(result);
    } catch (error: any) {
      if (error instanceof ApiError) return res.status(error.statusCode).json({ error: error.message });
      res.status(500).json({ error: 'Failed to get bank movements' });
    }
  }
  async getTransactionsByBankAndMethod(req: AuthRequest, res: Response) {
    try {
      const { bankId, method } = req.params;
      if (!bankId || !method) {
        return res.status(400).json({ error: 'bankId and method are required' });
      }
      const result = await banksService.getTransactionsByBankAndMethod(
        req.user!.company_id,
        bankId,
        method
      );
      res.json(result);
    } catch (error: any) {
      if (error instanceof ApiError) return res.status(error.statusCode).json({ error: error.message });
      res.status(500).json({ error: 'Failed to get bank method transactions' });
    }
  }
}

export const banksController = new BanksController();
