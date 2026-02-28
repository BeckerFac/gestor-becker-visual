import { Request, Response } from 'express';
import { productsService } from './products.service';
import { AuthRequest } from '../../middlewares/auth';
import { ApiError } from '../../middlewares/errorHandler';

export class ProductsController {
  async createProduct(req: AuthRequest, res: Response) {
    try {
      if (!req.user?.company_id || !req.body.sku || !req.body.name) {
        throw new ApiError(400, 'Missing required fields');
      }

      const product = await productsService.createProduct(req.user.company_id, req.body);
      res.status(201).json(product);
    } catch (error) {
      if (error instanceof ApiError) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      res.status(500).json({ error: 'Failed to create product' });
    }
  }

  async getProducts(req: AuthRequest, res: Response) {
    try {
      if (!req.user?.company_id) throw new ApiError(401, 'Unauthorized');

      const { skip = '0', limit = '50' } = req.query;
      const products = await productsService.getProducts(req.user.company_id, {
        skip: parseInt(skip as string, 10),
        limit: parseInt(limit as string, 10),
      });

      res.json(products);
    } catch (error) {
      if (error instanceof ApiError) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      res.status(500).json({ error: 'Failed to get products' });
    }
  }

  async getProduct(req: AuthRequest, res: Response) {
    try {
      if (!req.user?.company_id || !req.params.id) throw new ApiError(400, 'Missing product ID');

      const product = await productsService.getProduct(req.user.company_id, req.params.id);
      res.json(product);
    } catch (error) {
      if (error instanceof ApiError) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      res.status(500).json({ error: 'Failed to get product' });
    }
  }

  async updateProduct(req: AuthRequest, res: Response) {
    try {
      if (!req.user?.company_id || !req.params.id) throw new ApiError(400, 'Missing product ID');

      const product = await productsService.updateProduct(req.user.company_id, req.params.id, req.body);
      res.json(product);
    } catch (error) {
      if (error instanceof ApiError) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      res.status(500).json({ error: 'Failed to update product' });
    }
  }

  async deleteProduct(req: AuthRequest, res: Response) {
    try {
      if (!req.user?.company_id || !req.params.id) throw new ApiError(400, 'Missing product ID');

      await productsService.deleteProduct(req.user.company_id, req.params.id);
      res.json({ success: true });
    } catch (error) {
      if (error instanceof ApiError) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      res.status(500).json({ error: 'Failed to delete product' });
    }
  }
}

export const productsController = new ProductsController();
