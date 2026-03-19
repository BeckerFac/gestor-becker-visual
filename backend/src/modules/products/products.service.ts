import { db } from '../../config/db';
import { pool } from '../../config/db';
import { products, categories, brands, product_pricing } from '../../db/schema';
import { eq, and, ilike, sql } from 'drizzle-orm';
import { ApiError } from '../../middlewares/errorHandler';
import { v4 as uuid } from 'uuid';

export class ProductsService {
  private migrationsRun = false;

  async ensureMigrations() {
    if (this.migrationsRun) return;
    try {
      await db.execute(sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS controls_stock BOOLEAN DEFAULT false`);
      await db.execute(sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS low_stock_threshold DECIMAL(12,2) DEFAULT 0`);
      this.migrationsRun = true;
    } catch (error) {
      console.error('Products migrations error:', error);
    }
  }

  async createProduct(companyId: string, data: any) {
    await this.ensureMigrations();
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

        // Save product_type, controls_stock, low_stock_threshold via raw SQL (not in drizzle schema)
        if (data.product_type) {
          await pool.query('UPDATE products SET product_type = $1 WHERE id = $2', [data.product_type, product[0].id]);
        }
        if (data.controls_stock !== undefined) {
          await pool.query('UPDATE products SET controls_stock = $1 WHERE id = $2', [!!data.controls_stock, product[0].id]);
        }
        if (data.low_stock_threshold !== undefined) {
          await pool.query('UPDATE products SET low_stock_threshold = $1 WHERE id = $2', [Number(data.low_stock_threshold) || 0, product[0].id]);
        }

        return product[0];
      });
    } catch (error: any) {
      if (error instanceof ApiError) throw error;
      console.error('Create product error:', error);
      const msg = error?.message || 'Error desconocido';
      if (msg.includes('numeric field overflow') || msg.includes('out of range')) {
        throw new ApiError(400, 'El valor del precio excede el limite permitido (max 9,999,999,999.99)');
      }
      if (msg.includes('unique') || msg.includes('duplicate')) {
        throw new ApiError(409, 'Ya existe un producto con ese SKU');
      }
      throw new ApiError(500, `Error al crear producto: ${msg}`);
    }
  }

  async getProducts(companyId: string, { skip = 0, limit = 50, search = '', stock_status = 'all', category_id = '', product_type = '', active = '' } = {}) {
    await this.ensureMigrations();
    try {
      // Build WHERE conditions with parameterized queries to prevent SQL injection
      const conditions: string[] = ['p.company_id = $1'];
      const params: any[] = [companyId];
      let paramIdx = 2;

      if (search) {
        const searchPattern = `%${search}%`;
        conditions.push(`(p.name ILIKE $${paramIdx} OR p.sku ILIKE $${paramIdx} OR p.barcode ILIKE $${paramIdx})`);
        params.push(searchPattern);
        paramIdx++;
      }
      if (category_id) {
        conditions.push(`p.category_id = $${paramIdx}`);
        params.push(category_id);
        paramIdx++;
      }
      if (product_type) {
        conditions.push(`p.product_type = $${paramIdx}`);
        params.push(product_type);
        paramIdx++;
      }
      if (active === 'true') {
        conditions.push(`p.active = true`);
      } else if (active === 'false') {
        conditions.push(`p.active = false`);
      }

      // Stock status filter applied after JOIN
      let stockHaving = '';
      if (stock_status === 'in_stock') {
        stockHaving = `AND COALESCE(CAST(s.quantity AS decimal), 0) > 0`;
      } else if (stock_status === 'low') {
        stockHaving = `AND COALESCE(CAST(s.quantity AS decimal), 0) > 0 AND COALESCE(CAST(s.quantity AS decimal), 0) <= COALESCE(NULLIF(CAST(p.low_stock_threshold AS decimal), 0), NULLIF(CAST(s.min_level AS decimal), 0), 0)`;
      } else if (stock_status === 'out') {
        stockHaving = `AND p.controls_stock = true AND COALESCE(CAST(s.quantity AS decimal), 0) <= 0`;
      }

      const whereClause = conditions.join(' AND ');

      // Ensure limit and skip are valid integers
      const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.min(limit, 200) : 50;
      const safeSkip = Number.isFinite(skip) && skip >= 0 ? skip : 0;

      // Count total for pagination
      const countResult = await pool.query(`
        SELECT COUNT(*) as total
        FROM products p
        LEFT JOIN stock s ON s.product_id = p.id
        WHERE ${whereClause} ${stockHaving}
      `, params);
      const total = parseInt(countResult.rows?.[0]?.total || '0', 10);

      // Check if any product in company has controls_stock = true
      const hasStockResult = await pool.query(`
        SELECT EXISTS(SELECT 1 FROM products WHERE company_id = $1 AND controls_stock = true) as has_stock
      `, [companyId]);
      const has_stock_products = hasStockResult.rows?.[0]?.has_stock || false;

      // Main query with stock data - limit/offset appended as separate params
      const mainParams = [...params, safeLimit, safeSkip];
      const result = await pool.query(`
        SELECT p.*,
          CASE WHEN pp.id IS NOT NULL THEN
            json_build_object(
              'cost', pp.cost,
              'margin_percent', pp.margin_percent,
              'vat_rate', pp.vat_rate,
              'final_price', pp.final_price
            )
          ELSE NULL END as pricing,
          COALESCE(CAST(s.quantity AS decimal), 0) as stock_quantity,
          COALESCE(CAST(s.min_level AS decimal), 0) as stock_min_level
        FROM products p
        LEFT JOIN product_pricing pp ON pp.product_id = p.id
        LEFT JOIN stock s ON s.product_id = p.id
        WHERE ${whereClause} ${stockHaving}
        ORDER BY p.name ASC
        LIMIT $${paramIdx} OFFSET $${paramIdx + 1}
      `, mainParams);

      const items = result.rows || [];

      return {
        items,
        total,
        skip: safeSkip,
        limit: safeLimit,
        has_stock_products,
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

      // Save product_type, controls_stock, low_stock_threshold via raw SQL (not in drizzle schema)
      if (data.product_type !== undefined) {
        await pool.query('UPDATE products SET product_type = $1 WHERE id = $2', [data.product_type, productId]);
      }
      if (data.controls_stock !== undefined) {
        await pool.query('UPDATE products SET controls_stock = $1 WHERE id = $2', [!!data.controls_stock, productId]);
      }
      if (data.low_stock_threshold !== undefined) {
        await pool.query('UPDATE products SET low_stock_threshold = $1 WHERE id = $2', [Number(data.low_stock_threshold) || 0, productId]);
      }

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

  private productTypesMigrated = false;

  async ensureProductTypesMigration() {
    if (this.productTypesMigrated) return;
    try {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS product_types (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
          name VARCHAR(100) NOT NULL,
          description TEXT,
          sort_order INTEGER DEFAULT 0,
          created_at TIMESTAMP DEFAULT NOW(),
          UNIQUE(company_id, name)
        )
      `);
      this.productTypesMigrated = true;
    } catch (error) {
      console.error('Product types migration error:', error);
    }
  }

  async getProductTypes(companyId: string) {
    await this.ensureProductTypesMigration();
    try {
      // Return from product_types table, merged with distinct types from products
      const [typesRes, distinctRes] = await Promise.all([
        db.execute(sql`
          SELECT id, name, description, sort_order FROM product_types
          WHERE company_id = ${companyId}
          ORDER BY sort_order ASC, name ASC
        `),
        db.execute(sql`
          SELECT DISTINCT product_type FROM products
          WHERE company_id = ${companyId} AND product_type IS NOT NULL AND product_type != ''
          ORDER BY product_type ASC
        `),
      ]);

      const typeRows = (typesRes as any).rows || typesRes || [];
      const distinctRows = (distinctRes as any).rows || distinctRes || [];
      const typeNames = new Set(typeRows.map((r: any) => r.name.toLowerCase()));

      // If product_types table is empty, seed from distinct product types in products table
      if (typeRows.length === 0 && distinctRows.length > 0) {
        for (let i = 0; i < distinctRows.length; i++) {
          const typeName = distinctRows[i].product_type;
          try {
            await db.execute(sql`
              INSERT INTO product_types (id, company_id, name, sort_order)
              VALUES (gen_random_uuid(), ${companyId}, ${typeName}, ${i})
              ON CONFLICT (company_id, name) DO NOTHING
            `);
          } catch { /* ignore duplicates */ }
        }
        // Re-fetch after seeding
        const seededRes = await db.execute(sql`
          SELECT id, name, description, sort_order FROM product_types
          WHERE company_id = ${companyId}
          ORDER BY sort_order ASC, name ASC
        `);
        return (seededRes as any).rows || seededRes || [];
      }

      // Merge: add any distinct types from products that aren't in the table yet
      const newTypes: string[] = [];
      for (const row of distinctRows) {
        if (!typeNames.has(row.product_type.toLowerCase())) {
          newTypes.push(row.product_type);
        }
      }
      if (newTypes.length > 0) {
        const maxOrder = typeRows.length > 0 ? Math.max(...typeRows.map((r: any) => r.sort_order || 0)) : 0;
        for (let i = 0; i < newTypes.length; i++) {
          try {
            await db.execute(sql`
              INSERT INTO product_types (id, company_id, name, sort_order)
              VALUES (gen_random_uuid(), ${companyId}, ${newTypes[i]}, ${maxOrder + i + 1})
              ON CONFLICT (company_id, name) DO NOTHING
            `);
          } catch { /* ignore */ }
        }
        const refreshed = await db.execute(sql`
          SELECT id, name, description, sort_order FROM product_types
          WHERE company_id = ${companyId}
          ORDER BY sort_order ASC, name ASC
        `);
        return (refreshed as any).rows || refreshed || [];
      }

      return typeRows;
    } catch (error) {
      console.error('Get product types error:', error);
      return [];
    }
  }

  async createProductType(companyId: string, data: { name: string; description?: string }) {
    await this.ensureProductTypesMigration();
    try {
      if (!data.name?.trim()) throw new ApiError(400, 'El nombre del tipo es requerido');
      const maxOrderRes = await db.execute(sql`
        SELECT COALESCE(MAX(sort_order), -1) as max_order FROM product_types WHERE company_id = ${companyId}
      `);
      const maxOrder = ((maxOrderRes as any).rows?.[0]?.max_order ?? -1) + 1;
      const id = uuid();
      await db.execute(sql`
        INSERT INTO product_types (id, company_id, name, description, sort_order)
        VALUES (${id}, ${companyId}, ${data.name.trim()}, ${data.description || null}, ${maxOrder})
      `);
      return { id, name: data.name.trim(), description: data.description || null, sort_order: maxOrder };
    } catch (error: any) {
      if (error instanceof ApiError) throw error;
      if (error?.message?.includes('unique') || error?.message?.includes('duplicate') || error?.code === '23505') {
        throw new ApiError(409, 'Ya existe un tipo con ese nombre');
      }
      throw new ApiError(500, 'Error al crear tipo de producto');
    }
  }

  async updateProductType(companyId: string, typeId: string, data: { name?: string; description?: string; sort_order?: number }) {
    await this.ensureProductTypesMigration();
    try {
      // Get current type to know old name for product migration
      const currentRes = await db.execute(sql`
        SELECT name FROM product_types WHERE id = ${typeId} AND company_id = ${companyId}
      `);
      const currentRows = (currentRes as any).rows || currentRes || [];
      if (currentRows.length === 0) throw new ApiError(404, 'Tipo no encontrado');
      const oldName = currentRows[0].name;

      const sets: string[] = [];
      if (data.name !== undefined) sets.push(`name = '${data.name.trim().replace(/'/g, "''")}'`);
      if (data.description !== undefined) sets.push(`description = ${data.description ? `'${data.description.replace(/'/g, "''")}'` : 'NULL'}`);
      if (data.sort_order !== undefined) sets.push(`sort_order = ${data.sort_order}`);

      if (sets.length > 0) {
        await pool.query(
          `UPDATE product_types SET ${sets.join(', ')} WHERE id = $1 AND company_id = $2`,
          [typeId, companyId]
        );
      }

      // If name changed, update all products with the old type name
      if (data.name && data.name.trim() !== oldName) {
        await pool.query(
          'UPDATE products SET product_type = $1 WHERE company_id = $2 AND product_type = $3',
          [data.name.trim(), companyId, oldName]
        );
      }

      return { success: true };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Error al actualizar tipo de producto');
    }
  }

  async deleteProductType(companyId: string, typeId: string) {
    await this.ensureProductTypesMigration();
    try {
      // Check if any products use this type
      const typeRes = await db.execute(sql`
        SELECT name FROM product_types WHERE id = ${typeId} AND company_id = ${companyId}
      `);
      const typeRows = (typeRes as any).rows || typeRes || [];
      if (typeRows.length === 0) throw new ApiError(404, 'Tipo no encontrado');

      const typeName = typeRows[0].name;
      const usageRes = await db.execute(sql`
        SELECT COUNT(*) as count FROM products WHERE company_id = ${companyId} AND product_type = ${typeName}
      `);
      const count = parseInt(((usageRes as any).rows?.[0]?.count ?? '0'), 10);
      if (count > 0) {
        throw new ApiError(409, `No se puede eliminar: ${count} producto(s) usan este tipo`);
      }

      await db.execute(sql`DELETE FROM product_types WHERE id = ${typeId} AND company_id = ${companyId}`);
      return { success: true };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Error al eliminar tipo de producto');
    }
  }

  async reorderProductTypes(companyId: string, orderedIds: string[]) {
    await this.ensureProductTypesMigration();
    try {
      for (let i = 0; i < orderedIds.length; i++) {
        await pool.query(
          'UPDATE product_types SET sort_order = $1 WHERE id = $2 AND company_id = $3',
          [i, orderedIds[i], companyId]
        );
      }
      return { success: true };
    } catch (error) {
      throw new ApiError(500, 'Error al reordenar tipos');
    }
  }

  async getCategories(companyId: string) {
    try {
      const result = await db.execute(sql`
        SELECT c.*, (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id) as product_count
        FROM categories c
        WHERE c.company_id = ${companyId} AND c.active = true
        ORDER BY c.parent_id NULLS FIRST, c.name ASC
      `);
      return (result as any).rows || result || [];
    } catch {
      return [];
    }
  }

  async createCategory(companyId: string, data: { name: string; description?: string; parent_id?: string }) {
    try {
      const id = uuid();
      await db.insert(categories).values({
        id,
        company_id: companyId,
        name: data.name,
        description: data.description || null,
        parent_id: data.parent_id || null,
      });
      return { id, name: data.name };
    } catch (error) {
      throw new ApiError(500, 'Failed to create category');
    }
  }

  async deleteCategory(companyId: string, categoryId: string) {
    try {
      // Unlink products
      await db.update(products).set({ category_id: null }).where(eq(products.category_id, categoryId));
      // Delete children
      await db.execute(sql`UPDATE categories SET parent_id = NULL WHERE parent_id = ${categoryId}`);
      await db.execute(sql`DELETE FROM categories WHERE id = ${categoryId} AND company_id = ${companyId}`);
      return { success: true };
    } catch (error) {
      throw new ApiError(500, 'Failed to delete category');
    }
  }

  async bulkPricePreview(companyId: string, productIds: string[], percentIncrease: number) {
    try {
      if (productIds.length === 0) throw new ApiError(400, 'No products selected');
      if (percentIncrease === 0) throw new ApiError(400, 'Percentage must be non-zero');

      const multiplier = 1 + percentIncrease / 100;
      const placeholders = productIds.map((_, i) => `$${i + 1}`).join(',');
      const result = await pool.query(`
        SELECT pp.product_id, p.sku, p.name,
          pp.cost as old_cost, pp.margin_percent, pp.vat_rate, pp.final_price as old_final_price,
          ROUND(CAST(pp.cost AS decimal) * ${multiplier}, 2) as new_cost,
          ROUND(
            ROUND(CAST(pp.cost AS decimal) * ${multiplier}, 2) *
            (1 + CAST(pp.margin_percent AS decimal) / 100) *
            (1 + CAST(pp.vat_rate AS decimal) / 100),
          2) as new_final_price
        FROM product_pricing pp
        JOIN products p ON p.id = pp.product_id
        WHERE pp.product_id IN (${placeholders}) AND p.company_id = $${productIds.length + 1}
        ORDER BY p.name ASC
      `, [...productIds, companyId]);

      return { items: result.rows || [], percent: percentIncrease };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Failed to preview bulk price update');
    }
  }

  async bulkUpdatePrice(companyId: string, productIds: string[], percentIncrease: number) {
    try {
      if (productIds.length === 0) throw new ApiError(400, 'No products selected');
      if (percentIncrease === 0) throw new ApiError(400, 'Percentage must be non-zero');

      const multiplier = 1 + percentIncrease / 100;
      // FIXED formula: update cost, then recalculate final_price preserving margin% and vat%
      for (const pid of productIds) {
        await db.execute(sql`
          UPDATE product_pricing SET
            cost = ROUND(CAST(cost AS decimal) * ${multiplier.toString()}, 2),
            final_price = ROUND(
              ROUND(CAST(cost AS decimal) * ${multiplier.toString()}, 2) *
              (1 + CAST(margin_percent AS decimal) / 100) *
              (1 + CAST(vat_rate AS decimal) / 100),
            2),
            updated_at = NOW()
          WHERE product_id = ${pid}
        `);
      }
      return { updated: productIds.length };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Failed to bulk update prices');
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
