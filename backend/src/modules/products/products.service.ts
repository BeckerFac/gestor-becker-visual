import { db } from '../../config/db';
import { products, categories, brands, product_pricing } from '../../db/schema';
import { eq, and, ilike, sql } from 'drizzle-orm';
import { ApiError } from '../../middlewares/errorHandler';
import { v4 as uuid } from 'uuid';

export class ProductsService {
  async createProduct(companyId: string, data: any) {
    try {
      const existingSku = await db.query.products.findFirst({
        where: and(eq(products.company_id, companyId), eq(products.sku, data.sku)),
      });
      if (existingSku) throw new ApiError(409, 'SKU already exists');

      return await db.transaction(async (tx) => {
        const product = await tx.insert(products).values({
          id: uuid(),
          company_id: companyId,
          sku: data.sku,
          name: data.name,
          description: data.description || null,
          barcode: data.barcode || null,
          category_id: data.category_id || null,
          brand_id: data.brand_id || null,
        }).returning();

        if (data.cost !== undefined && data.margin_percent !== undefined) {
          const cost = Number(data.cost);
          const margin = Number(data.margin_percent);
          const vat_rate = Number(data.vat_rate || 21);
          const final_price = cost * (1 + margin / 100) * (1 + vat_rate / 100);

          // Validate values fit in decimal(12,2)
          if (final_price > 9999999999.99) {
            throw new ApiError(400, 'El precio final excede el maximo permitido');
          }

          await tx.insert(product_pricing).values({
            id: uuid(),
            product_id: product[0].id,
            cost: cost.toFixed(2),
            margin_percent: margin.toFixed(2),
            vat_rate: vat_rate.toFixed(2),
            final_price: final_price.toFixed(2),
          });
        }

        return product[0];
      });
    } catch (error) {
      if (error instanceof ApiError) throw error;
      console.error('Create product error:', error);
      throw new ApiError(500, 'Failed to create product');
    }
  }

  async getProducts(companyId: string, { skip = 0, limit = 50, search = '' } = {}) {
    try {
      const result = await db.execute(sql`
        SELECT p.*,
          CASE WHEN pp.id IS NOT NULL THEN
            json_build_object(
              'cost', pp.cost,
              'margin_percent', pp.margin_percent,
              'vat_rate', pp.vat_rate,
              'final_price', pp.final_price
            )
          ELSE NULL END as pricing
        FROM products p
        LEFT JOIN product_pricing pp ON pp.product_id = p.id
        WHERE p.company_id = ${companyId}
        ORDER BY p.name ASC
        LIMIT ${limit} OFFSET ${skip}
      `);

      const items = (result as any).rows || result || [];

      return {
        items,
        total: items.length,
        skip,
        limit,
      };
    } catch (error) {
      console.error('Get products error:', error);
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
          sku: data.sku || product.sku,
          name: data.name || product.name,
          description: data.description !== undefined ? data.description : product.description,
          barcode: data.barcode !== undefined ? data.barcode : product.barcode,
          category_id: data.category_id || product.category_id,
          updated_at: new Date(),
        })
        .where(and(eq(products.company_id, companyId), eq(products.id, productId)))
        .returning();

      // Update or create pricing
      if (data.cost !== undefined) {
        const vat_rate = data.vat_rate || 21;
        const margin = data.margin_percent || 30;
        const final_price = Number(data.cost) * (1 + Number(margin) / 100) * (1 + Number(vat_rate) / 100);

        const existingPricing = await db.select().from(product_pricing)
          .where(eq(product_pricing.product_id, productId));

        if (existingPricing.length > 0) {
          await db.update(product_pricing)
            .set({
              cost: data.cost.toString(),
              margin_percent: margin.toString(),
              vat_rate: vat_rate.toString(),
              final_price: final_price.toString(),
              updated_at: new Date(),
            })
            .where(eq(product_pricing.product_id, productId));
        } else {
          await db.insert(product_pricing).values({
            id: uuid(),
            product_id: productId,
            cost: data.cost.toString(),
            margin_percent: margin.toString(),
            vat_rate: vat_rate.toString(),
            final_price: final_price.toString(),
          });
        }
      }

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
