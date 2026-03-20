import { Response } from 'express';
import { priceCriteriaService } from './price-criteria.service';
import { AuthRequest } from '../../middlewares/auth';

export class PriceCriteriaController {
  async getCriteria(req: AuthRequest, res: Response) {
    try {
      if (!req.user?.company_id) return res.status(401).json({ error: 'Unauthorized' });
      const criteria = await priceCriteriaService.getCriteria(req.user.company_id);
      res.json(criteria);
    } catch (error: any) {
      res.status(500).json({ error: error.message || 'Failed to get price criteria' });
    }
  }

  async createCriteria(req: AuthRequest, res: Response) {
    try {
      if (!req.user?.company_id) return res.status(401).json({ error: 'Unauthorized' });
      const { name } = req.body;
      if (!name) return res.status(400).json({ error: 'Name is required' });
      const criteria = await priceCriteriaService.createCriteria(req.user.company_id, name);
      res.status(201).json(criteria);
    } catch (error: any) {
      if (error.message?.includes('duplicate') || error.code === '23505') {
        return res.status(409).json({ error: 'Ya existe un criterio con ese nombre' });
      }
      res.status(500).json({ error: error.message || 'Failed to create criteria' });
    }
  }

  async deleteCriteria(req: AuthRequest, res: Response) {
    try {
      if (!req.user?.company_id) return res.status(401).json({ error: 'Unauthorized' });
      const { id } = req.params;
      const result = await priceCriteriaService.deleteCriteria(req.user.company_id, id);
      res.json(result);
    } catch (error: any) {
      if (error.message === 'Criteria not found') {
        return res.status(404).json({ error: 'Criteria not found' });
      }
      res.status(500).json({ error: error.message || 'Failed to delete criteria' });
    }
  }

  async getProductPrices(req: AuthRequest, res: Response) {
    try {
      if (!req.user?.company_id) return res.status(401).json({ error: 'Unauthorized' });
      const { id } = req.params;
      const prices = await priceCriteriaService.getProductPrices(req.user.company_id, id);
      res.json(prices);
    } catch (error: any) {
      res.status(500).json({ error: error.message || 'Failed to get product prices' });
    }
  }

  async setProductPrices(req: AuthRequest, res: Response) {
    try {
      if (!req.user?.company_id) return res.status(401).json({ error: 'Unauthorized' });
      const { id } = req.params;
      const { prices } = req.body;
      if (!prices || typeof prices !== 'object') {
        return res.status(400).json({ error: 'Prices object is required' });
      }
      const result = await priceCriteriaService.setProductPrices(req.user.company_id, id, prices);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message || 'Failed to set product prices' });
    }
  }
}

export const priceCriteriaController = new PriceCriteriaController();
