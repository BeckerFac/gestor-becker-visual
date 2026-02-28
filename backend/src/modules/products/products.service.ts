import { db } from '../../config/db';
import { products, categories, brands, product_pricing } from '../../db/schema';
import { eq, and, ilike } from 'drizzle-orm';
import { ApiError } from '../../middlewares/errorHandler';
import { v4 as uuid } from 'uuid';

export class ProductsService {
  async createProduct(companyId: string, data: any) {
    try {
      const existingSku = await db.query.products.findFirst({
        where: and(eq(products.company_id, companyId), eq(products.sku, data.sku)),
      });
      if (existingSku) throw new ApiError(409, 'SKU already exists');

      const product = await db.insert(products).values({
        id: uuid(),
        company_id: companyId,
        sku: data.sku,
        name: data.name,
        description: data.description,
        category_id: data.category_id,
        brand_id: data.brand_id,
      }).returning();

      if (data.cost !== undefined && data.margin_percent !== undefined) {
        const vat_rate = data.vat_rate || 21;
        const final_price = Number(data.cost) * (1 + Number(data.margin_percent) / 100) * (1 + Number(vat_rate) / 100);

        await db.insert(product_pricing).values({
          id: uuid(),
          product_id: product[0].id,
          cost: data.cost,
          margin_percent: data.margin_percent,
          vat_rate: vat_rate,
          final_price: final_price.toString(),
        });
      }

      return product[0];
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Failed to create product');
    }
  }

  async getProducts(companyId: string, { skip = 0, limit = 50, search = '' } = {}) {
    try {
      let query = db.query.products;
      const where = and(eq(products.company_id, companyId));

      const items = await db.select().from(products)
        .where(where)
        .limit(limit)
        .offset(skip);

      return {
        items,
        total: items.length,
        skip,
        limit,
      };
    } catch (error) {
      throw new ApiError(500, 'Failed to get products');
    }
  }

  async getProduct(companyId: string, productId: string) {
    try {
      const product = await db.query.products.findFirst({
        where: and(eq(products.company_id, companyId), eq(products.id, productId)),
      });
      if (!product) throw new ApiError(404, 'Product not found');
      return product;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Failed to get product');
    }
  }

  async updateProduct(companyId: string, productId: string, data: any) {
    try {
      const product = await this.getProduct(companyId, productId);

      const updated = await db.update(products)
        .set({
          name: data.name || product.name,
          description: data.description !== undefined ? data.description : product.description,
          category_id: data.category_id || product.category_id,
          updated_at: new Date(),
        })
        .where(and(eq(products.company_id, companyId), eq(products.id, productId)))
        .returning();

      return updated[0];
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Failed to update product');
    }
  }

  async deleteProduct(companyId: string, productId: string) {
    try {
      const product = await this.getProduct(companyId, productId);

      await db.delete(products)
        .where(and(eq(products.company_id, companyId), eq(products.id, productId)));

      return { success: true };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Failed to delete product');
    }
  }
}

export const productsService = new ProductsService();
