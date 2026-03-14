import { Response } from 'express';
import { AuthRequest } from '../../middlewares/auth';
import { ApiError } from '../../middlewares/errorHandler';
import { priceListsService } from './price-lists.service';

export class PriceListsController {
  async getPriceLists(req: AuthRequest, res: Response) {
    try {
      if (!req.user?.company_id) throw new ApiError(401, 'Unauthorized');
      const data = await priceListsService.getPriceLists(req.user.company_id);
      res.json(data);
    } catch (error) {
      if (error instanceof ApiError) return res.status(error.statusCode).json({ error: error.message });
      res.status(500).json({ error: 'Failed to get price lists' });
    }
  }

  async getPriceList(req: AuthRequest, res: Response) {
    try {
      if (!req.user?.company_id) throw new ApiError(401, 'Unauthorized');
      const data = await priceListsService.getPriceList(req.user.company_id, req.params.id);
      res.json(data);
    } catch (error) {
      if (error instanceof ApiError) return res.status(error.statusCode).json({ error: error.message });
      res.status(500).json({ error: 'Failed to get price list' });
    }
  }

  async createPriceList(req: AuthRequest, res: Response) {
    try {
      if (!req.user?.company_id) throw new ApiError(401, 'Unauthorized');
      if (!req.body.name) throw new ApiError(400, 'Name is required');
      const data = await priceListsService.createPriceList(req.user.company_id, req.body);
      res.status(201).json(data);
    } catch (error) {
      if (error instanceof ApiError) return res.status(error.statusCode).json({ error: error.message });
      res.status(500).json({ error: 'Failed to create price list' });
    }
  }

  async updatePriceList(req: AuthRequest, res: Response) {
    try {
      if (!req.user?.company_id) throw new ApiError(401, 'Unauthorized');
      const data = await priceListsService.updatePriceList(req.user.company_id, req.params.id, req.body);
      res.json(data);
    } catch (error) {
      if (error instanceof ApiError) return res.status(error.statusCode).json({ error: error.message });
      res.status(500).json({ error: 'Failed to update price list' });
    }
  }

  async deletePriceList(req: AuthRequest, res: Response) {
    try {
      if (!req.user?.company_id) throw new ApiError(401, 'Unauthorized');
      const data = await priceListsService.deletePriceList(req.user.company_id, req.params.id);
      res.json(data);
    } catch (error) {
      if (error instanceof ApiError) return res.status(error.statusCode).json({ error: error.message });
      res.status(500).json({ error: 'Failed to delete price list' });
    }
  }

  async setPriceListItems(req: AuthRequest, res: Response) {
    try {
      if (!req.user?.company_id) throw new ApiError(401, 'Unauthorized');
      if (!Array.isArray(req.body.items)) throw new ApiError(400, 'Items array is required');
      const data = await priceListsService.setPriceListItems(req.user.company_id, req.params.id, req.body.items);
      res.json(data);
    } catch (error) {
      if (error instanceof ApiError) return res.status(error.statusCode).json({ error: error.message });
      res.status(500).json({ error: 'Failed to set price list items' });
    }
  }

  async getEnterprisePriceForProduct(req: AuthRequest, res: Response) {
    try {
      if (!req.user?.company_id) throw new ApiError(401, 'Unauthorized');
      const data = await priceListsService.getProductPriceForEnterprise(
        req.user.company_id,
        req.params.productId,
        req.params.enterpriseId
      );
      res.json(data);
    } catch (error) {
      if (error instanceof ApiError) return res.status(error.statusCode).json({ error: error.message });
      res.status(500).json({ error: 'Failed to get enterprise price' });
    }
  }

  async linkEnterpriseToPriceList(req: AuthRequest, res: Response) {
    try {
      if (!req.user?.company_id) throw new ApiError(401, 'Unauthorized');
      const data = await priceListsService.linkEnterpriseToList(
        req.user.company_id,
        req.params.enterpriseId,
        req.body.price_list_id || null
      );
      res.json(data);
    } catch (error) {
      if (error instanceof ApiError) return res.status(error.statusCode).json({ error: error.message });
      res.status(500).json({ error: 'Failed to link enterprise to price list' });
    }
  }
}

export const priceListsController = new PriceListsController();
