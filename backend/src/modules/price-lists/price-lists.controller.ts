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

  // Rules
  async getRules(req: AuthRequest, res: Response) {
    try {
      if (!req.user?.company_id) throw new ApiError(401, 'Unauthorized');
      const data = await priceListsService.getRules(req.user.company_id, req.params.id);
      res.json(data);
    } catch (error) {
      if (error instanceof ApiError) return res.status(error.statusCode).json({ error: error.message });
      res.status(500).json({ error: 'Failed to get rules' });
    }
  }

  async addRule(req: AuthRequest, res: Response) {
    try {
      if (!req.user?.company_id) throw new ApiError(401, 'Unauthorized');
      if (!req.body.rule_type) throw new ApiError(400, 'rule_type is required');
      if (req.body.value === undefined) throw new ApiError(400, 'value is required');
      const data = await priceListsService.addRule(req.user.company_id, req.params.id, req.body);
      res.status(201).json(data);
    } catch (error) {
      if (error instanceof ApiError) return res.status(error.statusCode).json({ error: error.message });
      res.status(500).json({ error: 'Failed to add rule' });
    }
  }

  async updateRule(req: AuthRequest, res: Response) {
    try {
      if (!req.user?.company_id) throw new ApiError(401, 'Unauthorized');
      const data = await priceListsService.updateRule(req.user.company_id, req.params.id, req.params.ruleId, req.body);
      res.json(data);
    } catch (error) {
      if (error instanceof ApiError) return res.status(error.statusCode).json({ error: error.message });
      res.status(500).json({ error: 'Failed to update rule' });
    }
  }

  async deleteRule(req: AuthRequest, res: Response) {
    try {
      if (!req.user?.company_id) throw new ApiError(401, 'Unauthorized');
      const data = await priceListsService.deleteRule(req.user.company_id, req.params.id, req.params.ruleId);
      res.json(data);
    } catch (error) {
      if (error instanceof ApiError) return res.status(error.statusCode).json({ error: error.message });
      res.status(500).json({ error: 'Failed to delete rule' });
    }
  }

  // Price Resolution
  async resolvePrice(req: AuthRequest, res: Response) {
    try {
      if (!req.user?.company_id) throw new ApiError(401, 'Unauthorized');
      const { enterprise_id, product_id, quantity, price_list_id } = req.query;
      if (!product_id) throw new ApiError(400, 'product_id is required');

      let listId = price_list_id as string || null;

      // If enterprise_id provided, look up their price list
      if (enterprise_id && !listId) {
        const entPrice = await priceListsService.getProductPriceForEnterprise(
          req.user.company_id,
          product_id as string,
          enterprise_id as string
        );
        if (entPrice) {
          res.json(entPrice);
          return;
        }
      }

      const data = await priceListsService.resolvePrice(
        req.user.company_id,
        listId || '',
        product_id as string,
        parseInt(quantity as string) || 1
      );
      res.json(data);
    } catch (error) {
      if (error instanceof ApiError) return res.status(error.statusCode).json({ error: error.message });
      res.status(500).json({ error: 'Failed to resolve price' });
    }
  }

  // Resolve all prices
  async resolveAllPrices(req: AuthRequest, res: Response) {
    try {
      if (!req.user?.company_id) throw new ApiError(401, 'Unauthorized');
      const { quantity } = req.query;
      const data = await priceListsService.resolveAllPrices(
        req.user.company_id,
        req.params.id,
        parseInt(quantity as string) || 1
      );
      res.json(data);
    } catch (error) {
      if (error instanceof ApiError) return res.status(error.statusCode).json({ error: error.message });
      res.status(500).json({ error: 'Failed to resolve all prices' });
    }
  }

  // Bulk operations
  async bulkUpdateRules(req: AuthRequest, res: Response) {
    try {
      if (!req.user?.company_id) throw new ApiError(401, 'Unauthorized');
      const data = await priceListsService.bulkUpdateRules(req.user.company_id, req.params.id, req.body);
      res.json(data);
    } catch (error) {
      if (error instanceof ApiError) return res.status(error.statusCode).json({ error: error.message });
      res.status(500).json({ error: 'Failed to bulk update rules' });
    }
  }

  // Enterprise linking
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
