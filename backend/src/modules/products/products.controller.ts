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

      const { skip = '0', limit = '50', search = '', stock_status = 'all', category_id = '', product_type = '', active = '' } = req.query;
      const products = await productsService.getProducts(req.user.company_id, {
        skip: parseInt(skip as string, 10),
        limit: parseInt(limit as string, 10),
        search: search as string,
        stock_status: stock_status as string,
        category_id: category_id as string,
        product_type: product_type as string,
        active: active as string,
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

  async getProductTypes(req: AuthRequest, res: Response) {
    try {
      if (!req.user?.company_id) throw new ApiError(401, 'Unauthorized');
      const types = await productsService.getProductTypes(req.user.company_id);
      res.json(types);
    } catch (error) {
      if (error instanceof ApiError) return res.status(error.statusCode).json({ error: error.message });
      res.status(500).json({ error: 'Failed to get product types' });
    }
  }

  async getCategories(req: AuthRequest, res: Response) {
    try {
      if (!req.user?.company_id) throw new ApiError(401, 'Unauthorized');
      const cats = await productsService.getCategories(req.user.company_id);
      res.json(cats);
    } catch (error) {
      if (error instanceof ApiError) return res.status(error.statusCode).json({ error: error.message });
      res.status(500).json({ error: 'Failed to get categories' });
    }
  }

  async createCategory(req: AuthRequest, res: Response) {
    try {
      if (!req.user?.company_id) throw new ApiError(401, 'Unauthorized');
      const cat = await productsService.createCategory(req.user.company_id, req.body);
      res.status(201).json(cat);
    } catch (error) {
      if (error instanceof ApiError) return res.status(error.statusCode).json({ error: error.message });
      res.status(500).json({ error: 'Failed to create category' });
    }
  }

  async updateCategory(req: AuthRequest, res: Response) {
    try {
      if (!req.user?.company_id) throw new ApiError(401, 'Unauthorized');
      const result = await productsService.updateCategory(req.user.company_id, req.params.id, req.body);
      res.json(result);
    } catch (error) {
      if (error instanceof ApiError) return res.status(error.statusCode).json({ error: error.message });
      res.status(500).json({ error: 'Failed to update category' });
    }
  }

  async reorderCategories(req: AuthRequest, res: Response) {
    try {
      if (!req.user?.company_id) throw new ApiError(401, 'Unauthorized');
      const { ordered_ids } = req.body;
      if (!Array.isArray(ordered_ids)) throw new ApiError(400, 'ordered_ids array required');
      const result = await productsService.reorderCategories(req.user.company_id, ordered_ids);
      res.json(result);
    } catch (error) {
      if (error instanceof ApiError) return res.status(error.statusCode).json({ error: error.message });
      res.status(500).json({ error: 'Failed to reorder categories' });
    }
  }

  async getCategoryDefaults(req: AuthRequest, res: Response) {
    try {
      if (!req.user?.company_id) throw new ApiError(401, 'Unauthorized');
      const defaults = await productsService.getCategoryDefaults(req.user.company_id, req.params.id);
      res.json(defaults);
    } catch (error) {
      if (error instanceof ApiError) return res.status(error.statusCode).json({ error: error.message });
      res.status(500).json({ error: 'Failed to get category defaults' });
    }
  }

  async deleteCategory(req: AuthRequest, res: Response) {
    try {
      if (!req.user?.company_id) throw new ApiError(401, 'Unauthorized');
      await productsService.deleteCategory(req.user.company_id, req.params.id);
      res.json({ success: true });
    } catch (error) {
      if (error instanceof ApiError) return res.status(error.statusCode).json({ error: error.message });
      res.status(500).json({ error: 'Failed to delete category' });
    }
  }

  async bulkUpdatePrice(req: AuthRequest, res: Response) {
    try {
      if (!req.user?.company_id) throw new ApiError(401, 'Unauthorized');
      const { product_ids, percent } = req.body;
      if (!Array.isArray(product_ids) || typeof percent !== 'number') {
        throw new ApiError(400, 'product_ids (array) and percent (number) required');
      }
      const result = await productsService.bulkUpdatePrice(req.user.company_id, product_ids, percent);
      res.json(result);
    } catch (error) {
      if (error instanceof ApiError) return res.status(error.statusCode).json({ error: error.message });
      res.status(500).json({ error: 'Failed to bulk update prices' });
    }
  }

  async bulkPricePreview(req: AuthRequest, res: Response) {
    try {
      if (!req.user?.company_id) throw new ApiError(401, 'Unauthorized');
      const { product_ids, percent } = req.body;
      if (!Array.isArray(product_ids) || typeof percent !== 'number') {
        throw new ApiError(400, 'product_ids (array) and percent (number) required');
      }
      const result = await productsService.bulkPricePreview(req.user.company_id, product_ids, percent);
      res.json(result);
    } catch (error) {
      if (error instanceof ApiError) return res.status(error.statusCode).json({ error: error.message });
      res.status(500).json({ error: 'Failed to preview bulk price update' });
    }
  }

  async createProductType(req: AuthRequest, res: Response) {
    try {
      if (!req.user?.company_id) throw new ApiError(401, 'Unauthorized');
      const result = await productsService.createProductType(req.user.company_id, req.body);
      res.status(201).json(result);
    } catch (error) {
      if (error instanceof ApiError) return res.status(error.statusCode).json({ error: error.message });
      res.status(500).json({ error: 'Failed to create product type' });
    }
  }

  async updateProductType(req: AuthRequest, res: Response) {
    try {
      if (!req.user?.company_id) throw new ApiError(401, 'Unauthorized');
      const result = await productsService.updateProductType(req.user.company_id, req.params.id, req.body);
      res.json(result);
    } catch (error) {
      if (error instanceof ApiError) return res.status(error.statusCode).json({ error: error.message });
      res.status(500).json({ error: 'Failed to update product type' });
    }
  }

  async deleteProductType(req: AuthRequest, res: Response) {
    try {
      if (!req.user?.company_id) throw new ApiError(401, 'Unauthorized');
      const result = await productsService.deleteProductType(req.user.company_id, req.params.id);
      res.json(result);
    } catch (error) {
      if (error instanceof ApiError) return res.status(error.statusCode).json({ error: error.message });
      res.status(500).json({ error: 'Failed to delete product type' });
    }
  }

  async reorderProductTypes(req: AuthRequest, res: Response) {
    try {
      if (!req.user?.company_id) throw new ApiError(401, 'Unauthorized');
      const { ordered_ids } = req.body;
      if (!Array.isArray(ordered_ids)) throw new ApiError(400, 'ordered_ids array required');
      const result = await productsService.reorderProductTypes(req.user.company_id, ordered_ids);
      res.json(result);
    } catch (error) {
      if (error instanceof ApiError) return res.status(error.statusCode).json({ error: error.message });
      res.status(500).json({ error: 'Failed to reorder product types' });
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
