import { db } from '../../config/db';
import { sql } from 'drizzle-orm';
import { ApiError } from '../../middlewares/errorHandler';
import { v4 as uuid } from 'uuid';

export class PriceListsService {
  private migrationsRun = false;

  async ensureMigrations() {
    if (this.migrationsRun) return;
    try {
      // Add price_list_id column to enterprises table
      await db.execute(sql`
        ALTER TABLE enterprises ADD COLUMN IF NOT EXISTS price_list_id UUID REFERENCES price_lists(id) ON DELETE SET NULL
      `).catch(() => {});
      this.migrationsRun = true;
    } catch (error) {
      console.error('Price lists migration error:', error);
    }
  }

  async getPriceLists(companyId: string) {
    await this.ensureMigrations();
    try {
      const result = await db.execute(sql`
        SELECT pl.*,
          COALESCE((SELECT COUNT(*) FROM price_list_items pli WHERE pli.price_list_id = pl.id), 0) as item_count
        FROM price_lists pl
        WHERE pl.company_id = ${companyId}
        ORDER BY pl.name ASC
      `);
      return (result as any).rows || result || [];
    } catch (error) {
      console.error('Get price lists error:', error);
      throw new ApiError(500, 'Failed to get price lists');
    }
  }

  async getPriceList(companyId: string, priceListId: string) {
    await this.ensureMigrations();
    try {
      const result = await db.execute(sql`
        SELECT * FROM price_lists WHERE id = ${priceListId} AND company_id = ${companyId}
      `);
      const rows = (result as any).rows || result || [];
      if (rows.length === 0) throw new ApiError(404, 'Price list not found');

      const itemsResult = await db.execute(sql`
        SELECT pli.*, p.name as product_name, p.sku as product_sku,
          pp.final_price as current_price, pp.cost as current_cost
        FROM price_list_items pli
        JOIN products p ON p.id = pli.product_id
        LEFT JOIN product_pricing pp ON pp.product_id = p.id
        WHERE pli.price_list_id = ${priceListId}
        ORDER BY p.name ASC
      `);
      const items = (itemsResult as any).rows || itemsResult || [];

      return { ...rows[0], items };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      console.error('Get price list error:', error);
      throw new ApiError(500, 'Failed to get price list');
    }
  }

  async createPriceList(companyId: string, data: any) {
    await this.ensureMigrations();
    try {
      const id = uuid();
      await db.execute(sql`
        INSERT INTO price_lists (id, company_id, name, type, valid_from, valid_to, active)
        VALUES (
          ${id},
          ${companyId},
          ${data.name},
          ${data.type || 'default'},
          ${data.valid_from || null},
          ${data.valid_to || null},
          ${data.active !== undefined ? data.active : true}
        )
      `);

      const result = await db.execute(sql`SELECT * FROM price_lists WHERE id = ${id}`);
      const rows = (result as any).rows || result || [];
      return rows[0];
    } catch (error) {
      if (error instanceof ApiError) throw error;
      console.error('Create price list error:', error);
      throw new ApiError(500, 'Failed to create price list');
    }
  }

  async updatePriceList(companyId: string, priceListId: string, data: any) {
    await this.ensureMigrations();
    try {
      const check = await db.execute(sql`
        SELECT id FROM price_lists WHERE id = ${priceListId} AND company_id = ${companyId}
      `);
      const rows = (check as any).rows || check || [];
      if (rows.length === 0) throw new ApiError(404, 'Price list not found');

      await db.execute(sql`
        UPDATE price_lists SET
          name = ${data.name},
          type = ${data.type || 'default'},
          valid_from = ${data.valid_from || null},
          valid_to = ${data.valid_to || null},
          active = ${data.active !== undefined ? data.active : true},
          updated_at = NOW()
        WHERE id = ${priceListId} AND company_id = ${companyId}
      `);

      const result = await db.execute(sql`SELECT * FROM price_lists WHERE id = ${priceListId}`);
      const updated = (result as any).rows || result || [];
      return updated[0];
    } catch (error) {
      if (error instanceof ApiError) throw error;
      console.error('Update price list error:', error);
      throw new ApiError(500, 'Failed to update price list');
    }
  }

  async deletePriceList(companyId: string, priceListId: string) {
    await this.ensureMigrations();
    try {
      const check = await db.execute(sql`
        SELECT id FROM price_lists WHERE id = ${priceListId} AND company_id = ${companyId}
      `);
      const rows = (check as any).rows || check || [];
      if (rows.length === 0) throw new ApiError(404, 'Price list not found');

      // Unlink enterprises that reference this list
      await db.execute(sql`
        UPDATE enterprises SET price_list_id = NULL WHERE price_list_id = ${priceListId}
      `).catch(() => {});

      await db.execute(sql`
        DELETE FROM price_lists WHERE id = ${priceListId} AND company_id = ${companyId}
      `);

      return { success: true };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      console.error('Delete price list error:', error);
      throw new ApiError(500, 'Failed to delete price list');
    }
  }

  async setPriceListItems(companyId: string, priceListId: string, items: { product_id: string; price: number; discount_percent?: number }[]) {
    await this.ensureMigrations();
    try {
      // Verify ownership
      const check = await db.execute(sql`
        SELECT id FROM price_lists WHERE id = ${priceListId} AND company_id = ${companyId}
      `);
      const rows = (check as any).rows || check || [];
      if (rows.length === 0) throw new ApiError(404, 'Price list not found');

      // Delete existing items
      await db.execute(sql`DELETE FROM price_list_items WHERE price_list_id = ${priceListId}`);

      // Insert new items
      for (const item of items) {
        const itemId = uuid();
        await db.execute(sql`
          INSERT INTO price_list_items (id, price_list_id, product_id, price, discount_percent)
          VALUES (
            ${itemId},
            ${priceListId},
            ${item.product_id},
            ${item.price.toFixed(2)},
            ${(item.discount_percent || 0).toFixed(2)}
          )
        `);
      }

      // Return updated items
      const result = await db.execute(sql`
        SELECT pli.*, p.name as product_name, p.sku as product_sku,
          pp.final_price as current_price, pp.cost as current_cost
        FROM price_list_items pli
        JOIN products p ON p.id = pli.product_id
        LEFT JOIN product_pricing pp ON pp.product_id = p.id
        WHERE pli.price_list_id = ${priceListId}
        ORDER BY p.name ASC
      `);
      return (result as any).rows || result || [];
    } catch (error) {
      if (error instanceof ApiError) throw error;
      console.error('Set price list items error:', error);
      throw new ApiError(500, 'Failed to set price list items');
    }
  }

  async getProductPriceForEnterprise(companyId: string, productId: string, enterpriseId: string) {
    await this.ensureMigrations();
    try {
      // Find the enterprise's linked price list, then find the product in it
      const result = await db.execute(sql`
        SELECT pli.price, pli.discount_percent, pl.name as price_list_name
        FROM enterprises e
        JOIN price_lists pl ON pl.id = e.price_list_id AND pl.active = true
        JOIN price_list_items pli ON pli.price_list_id = pl.id AND pli.product_id = ${productId}
        WHERE e.id = ${enterpriseId} AND e.company_id = ${companyId}
        LIMIT 1
      `);
      const rows = (result as any).rows || result || [];
      if (rows.length === 0) return null;
      return rows[0];
    } catch (error) {
      console.error('Get product price for enterprise error:', error);
      return null;
    }
  }

  async linkEnterpriseToList(companyId: string, enterpriseId: string, priceListId: string | null) {
    await this.ensureMigrations();
    try {
      // Verify enterprise belongs to company
      const entCheck = await db.execute(sql`
        SELECT id FROM enterprises WHERE id = ${enterpriseId} AND company_id = ${companyId}
      `);
      const entRows = (entCheck as any).rows || entCheck || [];
      if (entRows.length === 0) throw new ApiError(404, 'Enterprise not found');

      // Verify price list belongs to company (if not null)
      if (priceListId) {
        const plCheck = await db.execute(sql`
          SELECT id FROM price_lists WHERE id = ${priceListId} AND company_id = ${companyId}
        `);
        const plRows = (plCheck as any).rows || plCheck || [];
        if (plRows.length === 0) throw new ApiError(404, 'Price list not found');
      }

      await db.execute(sql`
        UPDATE enterprises SET price_list_id = ${priceListId}, updated_at = NOW()
        WHERE id = ${enterpriseId} AND company_id = ${companyId}
      `);

      return { success: true };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      console.error('Link enterprise to list error:', error);
      throw new ApiError(500, 'Failed to link enterprise to price list');
    }
  }
}

export const priceListsService = new PriceListsService();
