import { db } from '../../config/db';
import { pool } from '../../config/db';
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

      // Create price_list_rules table
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS price_list_rules (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          price_list_id UUID NOT NULL REFERENCES price_lists(id) ON DELETE CASCADE,
          product_id UUID REFERENCES products(id) ON DELETE CASCADE,
          category_id UUID REFERENCES categories(id) ON DELETE CASCADE,
          rule_type VARCHAR(20) NOT NULL DEFAULT 'percentage',
          value DECIMAL(12,2) NOT NULL,
          min_quantity INTEGER DEFAULT 1,
          priority INTEGER DEFAULT 0,
          active BOOLEAN DEFAULT true,
          created_at TIMESTAMP DEFAULT NOW(),
          updated_at TIMESTAMP DEFAULT NOW()
        )
      `).catch(() => {});

      // Create index for fast rule lookup
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS idx_plr_lookup ON price_list_rules(price_list_id, product_id, category_id, min_quantity)
      `).catch(() => {});

      // Price change history table
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS price_change_history (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          company_id UUID NOT NULL REFERENCES companies(id),
          product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
          field_changed VARCHAR(50) NOT NULL,
          old_value DECIMAL(12,2),
          new_value DECIMAL(12,2),
          change_source VARCHAR(50) NOT NULL,
          batch_id UUID,
          changed_by UUID REFERENCES users(id),
          created_at TIMESTAMP DEFAULT NOW()
        )
      `).catch(() => {});

      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS idx_pch_product ON price_change_history(product_id, created_at DESC)
      `).catch(() => {});

      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS idx_pch_batch ON price_change_history(batch_id) WHERE batch_id IS NOT NULL
      `).catch(() => {});

      // Bulk operations log table
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS bulk_price_operations (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          company_id UUID NOT NULL REFERENCES companies(id),
          operation_type VARCHAR(50) NOT NULL,
          parameters JSONB NOT NULL DEFAULT '{}',
          affected_products INTEGER NOT NULL DEFAULT 0,
          rollback_data JSONB,
          rolled_back BOOLEAN DEFAULT false,
          rolled_back_at TIMESTAMP,
          performed_by UUID REFERENCES users(id),
          performed_at TIMESTAMP DEFAULT NOW()
        )
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
          COALESCE((SELECT COUNT(*) FROM price_list_items pli WHERE pli.price_list_id = pl.id), 0) as item_count,
          COALESCE((SELECT COUNT(*) FROM price_list_rules plr WHERE plr.price_list_id = pl.id), 0) as rule_count,
          COALESCE((SELECT COUNT(*) FROM enterprises e WHERE e.price_list_id = pl.id), 0) as enterprise_count
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

      // Get old-style items
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

      // Get rules
      const rulesResult = await db.execute(sql`
        SELECT plr.*,
          p.name as product_name, p.sku as product_sku,
          c.name as category_name
        FROM price_list_rules plr
        LEFT JOIN products p ON p.id = plr.product_id
        LEFT JOIN categories c ON c.id = plr.category_id
        WHERE plr.price_list_id = ${priceListId}
        ORDER BY plr.priority DESC, plr.min_quantity DESC, plr.created_at ASC, plr.id ASC
      `);
      const rules = (rulesResult as any).rows || rulesResult || [];

      // Get assigned enterprises
      const enterprisesResult = await db.execute(sql`
        SELECT id, name FROM enterprises WHERE price_list_id = ${priceListId}
        ORDER BY name ASC
      `);
      const enterprises = (enterprisesResult as any).rows || enterprisesResult || [];

      return { ...rows[0], items, rules, enterprises };
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

  // =============================================
  // RULES MANAGEMENT
  // =============================================

  async getRules(companyId: string, priceListId: string) {
    await this.ensureMigrations();
    try {
      const check = await db.execute(sql`
        SELECT id FROM price_lists WHERE id = ${priceListId} AND company_id = ${companyId}
      `);
      const rows = (check as any).rows || check || [];
      if (rows.length === 0) throw new ApiError(404, 'Price list not found');

      const result = await db.execute(sql`
        SELECT plr.*,
          p.name as product_name, p.sku as product_sku,
          c.name as category_name
        FROM price_list_rules plr
        LEFT JOIN products p ON p.id = plr.product_id
        LEFT JOIN categories c ON c.id = plr.category_id
        WHERE plr.price_list_id = ${priceListId}
        ORDER BY plr.priority DESC, plr.min_quantity DESC, plr.created_at ASC, plr.id ASC
      `);
      return (result as any).rows || result || [];
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Failed to get rules');
    }
  }

  async addRule(companyId: string, priceListId: string, data: {
    product_id?: string | null;
    category_id?: string | null;
    rule_type: string;
    value: number;
    min_quantity?: number;
    priority?: number;
  }) {
    await this.ensureMigrations();
    try {
      const check = await db.execute(sql`
        SELECT id FROM price_lists WHERE id = ${priceListId} AND company_id = ${companyId}
      `);
      const rows = (check as any).rows || check || [];
      if (rows.length === 0) throw new ApiError(404, 'Price list not found');

      if (!['percentage', 'fixed', 'formula'].includes(data.rule_type)) {
        throw new ApiError(400, 'rule_type must be percentage, fixed, or formula');
      }

      const id = uuid();
      await db.execute(sql`
        INSERT INTO price_list_rules (id, price_list_id, product_id, category_id, rule_type, value, min_quantity, priority)
        VALUES (
          ${id},
          ${priceListId},
          ${data.product_id || null},
          ${data.category_id || null},
          ${data.rule_type},
          ${data.value.toString()},
          ${data.min_quantity !== undefined && data.min_quantity !== null ? data.min_quantity : 1},
          ${data.priority !== undefined && data.priority !== null ? data.priority : 0}
        )
      `);

      const result = await db.execute(sql`
        SELECT plr.*,
          p.name as product_name, p.sku as product_sku,
          c.name as category_name
        FROM price_list_rules plr
        LEFT JOIN products p ON p.id = plr.product_id
        LEFT JOIN categories c ON c.id = plr.category_id
        WHERE plr.id = ${id}
      `);
      return ((result as any).rows || result || [])[0];
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Failed to add rule');
    }
  }

  async updateRule(companyId: string, priceListId: string, ruleId: string, data: any) {
    await this.ensureMigrations();
    try {
      // Verify ownership chain
      const check = await db.execute(sql`
        SELECT plr.id FROM price_list_rules plr
        JOIN price_lists pl ON pl.id = plr.price_list_id
        WHERE plr.id = ${ruleId} AND plr.price_list_id = ${priceListId} AND pl.company_id = ${companyId}
      `);
      const rows = (check as any).rows || check || [];
      if (rows.length === 0) throw new ApiError(404, 'Rule not found');

      await db.execute(sql`
        UPDATE price_list_rules SET
          product_id = ${data.product_id || null},
          category_id = ${data.category_id || null},
          rule_type = ${data.rule_type || 'percentage'},
          value = ${(data.value !== undefined ? data.value : 0).toString()},
          min_quantity = ${data.min_quantity !== undefined && data.min_quantity !== null ? data.min_quantity : 1},
          priority = ${data.priority !== undefined && data.priority !== null ? data.priority : 0},
          active = ${data.active !== undefined ? data.active : true},
          updated_at = NOW()
        WHERE id = ${ruleId}
      `);

      return { success: true };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Failed to update rule');
    }
  }

  async deleteRule(companyId: string, priceListId: string, ruleId: string) {
    await this.ensureMigrations();
    try {
      const check = await db.execute(sql`
        SELECT plr.id FROM price_list_rules plr
        JOIN price_lists pl ON pl.id = plr.price_list_id
        WHERE plr.id = ${ruleId} AND plr.price_list_id = ${priceListId} AND pl.company_id = ${companyId}
      `);
      const rows = (check as any).rows || check || [];
      if (rows.length === 0) throw new ApiError(404, 'Rule not found');

      await db.execute(sql`DELETE FROM price_list_rules WHERE id = ${ruleId}`);
      return { success: true };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Failed to delete rule');
    }
  }

  // =============================================
  // PRICE RESOLUTION
  // =============================================

  async resolvePrice(companyId: string, priceListId: string, productId: string, quantity: number = 1) {
    await this.ensureMigrations();
    try {
      // Get base price for the product
      const productResult = await db.execute(sql`
        SELECT p.id, p.name, p.category_id, pp.cost, pp.margin_percent, pp.vat_rate, pp.final_price
        FROM products p
        LEFT JOIN product_pricing pp ON pp.product_id = p.id
        WHERE p.id = ${productId} AND p.company_id = ${companyId}
      `);
      const productRows = (productResult as any).rows || productResult || [];
      if (productRows.length === 0) throw new ApiError(404, 'Product not found');
      const product = productRows[0];
      const basePrice = parseFloat(product.final_price || '0');
      const cost = parseFloat(product.cost || '0');

      if (!priceListId) {
        return {
          resolved_price: basePrice,
          base_price: basePrice,
          discount_percent: 0,
          rule_applied: null,
          price_list_name: null,
        };
      }

      // Get the price list name
      const plResult = await db.execute(sql`
        SELECT name FROM price_lists WHERE id = ${priceListId} AND company_id = ${companyId} AND active = true
      `);
      const plRows = (plResult as any).rows || plResult || [];
      if (plRows.length === 0) {
        return {
          resolved_price: basePrice,
          base_price: basePrice,
          discount_percent: 0,
          rule_applied: null,
          price_list_name: null,
        };
      }
      const priceListName = plRows[0].name;

      // First check old-style price_list_items for backward compat
      const itemResult = await db.execute(sql`
        SELECT price, discount_percent FROM price_list_items
        WHERE price_list_id = ${priceListId} AND product_id = ${productId}
      `);
      const itemRows = (itemResult as any).rows || itemResult || [];
      if (itemRows.length > 0) {
        const itemPrice = parseFloat(itemRows[0].price || '0');
        const discountPct = basePrice > 0 ? ((basePrice - itemPrice) / basePrice * 100) : 0;
        return {
          resolved_price: itemPrice,
          base_price: basePrice,
          discount_percent: Math.round(discountPct * 100) / 100,
          rule_applied: 'Precio fijo (legacy)',
          price_list_name: priceListName,
        };
      }

      // Get all active rules for this price list
      const rulesResult = await db.execute(sql`
        SELECT plr.*, c.name as category_name
        FROM price_list_rules plr
        LEFT JOIN categories c ON c.id = plr.category_id
        WHERE plr.price_list_id = ${priceListId}
          AND plr.active = true
          AND plr.min_quantity <= ${quantity}
        ORDER BY plr.priority DESC, plr.min_quantity DESC, plr.created_at ASC, plr.id ASC
      `);
      const rules = (rulesResult as any).rows || rulesResult || [];

      if (rules.length === 0) {
        return {
          resolved_price: basePrice,
          base_price: basePrice,
          discount_percent: 0,
          rule_applied: null,
          price_list_name: priceListName,
        };
      }

      // Find best matching rule by specificity:
      // 1. Exact product match
      // 2. Category match (direct category, then parent categories up the tree)
      // 3. Global rule (no product_id and no category_id)
      const productRules = rules.filter((r: any) => r.product_id === productId);

      // Collect ancestor category IDs for subcategory rule inheritance
      const categoryIds: string[] = [];
      if (product.category_id) {
        categoryIds.push(product.category_id);
        try {
          let parentCatId: string | null = product.category_id;
          let depth = 0;
          while (parentCatId && depth < 5) {
            const parentResult = await db.execute(sql`
              SELECT parent_id FROM categories WHERE id = ${parentCatId}
            `);
            const parentRows = (parentResult as any).rows || parentResult || [];
            if (parentRows.length === 0 || !parentRows[0].parent_id) break;
            parentCatId = parentRows[0].parent_id as string;
            categoryIds.push(parentCatId);
            depth++;
          }
        } catch { /* ignore lookup errors */ }
      }

      // Match category rules: direct category first, then parent categories in order
      let categoryRules: any[] = [];
      for (const catId of categoryIds) {
        const rulesForCat = rules.filter((r: any) => !r.product_id && r.category_id === catId);
        if (rulesForCat.length > 0) {
          categoryRules = rulesForCat;
          break; // most specific category match wins
        }
      }

      const globalRules = rules.filter((r: any) => !r.product_id && !r.category_id);

      const matchingRules = productRules.length > 0 ? productRules
        : categoryRules.length > 0 ? categoryRules
        : globalRules;

      if (matchingRules.length === 0) {
        return {
          resolved_price: basePrice,
          base_price: basePrice,
          discount_percent: 0,
          rule_applied: null,
          price_list_name: priceListName,
        };
      }

      // Pick the rule with highest min_quantity that's <= ordered qty (already sorted by priority, min_qty)
      const bestRule = matchingRules[0];

      // Compute price based on rule type
      let resolvedPrice = basePrice;
      let ruleDescription = '';

      switch (bestRule.rule_type) {
        case 'fixed':
          resolvedPrice = parseFloat(bestRule.value || '0');
          ruleDescription = `Precio fijo: $${resolvedPrice.toFixed(2)}`;
          break;
        case 'percentage': {
          const pct = parseFloat(bestRule.value || '0');
          resolvedPrice = basePrice * (1 + pct / 100);
          ruleDescription = `${pct > 0 ? '+' : ''}${pct}%`;
          if (bestRule.product_id) ruleDescription += ' (producto)';
          else if (bestRule.category_id) ruleDescription += ` (cat: ${bestRule.category_name || 'N/A'})`;
          else ruleDescription += ' (global)';
          if (bestRule.min_quantity > 1) ruleDescription += ` [qty>=${bestRule.min_quantity}]`;
          break;
        }
        case 'formula': {
          const coefficient = parseFloat(bestRule.value || '1');
          resolvedPrice = cost * coefficient;
          // Add IVA
          const vatRate = parseFloat(product.vat_rate || '21');
          resolvedPrice = resolvedPrice * (1 + vatRate / 100);
          ruleDescription = `Costo x ${coefficient}`;
          break;
        }
      }

      // Round to 2 decimals
      resolvedPrice = Math.round(resolvedPrice * 100) / 100;

      const discountPercent = basePrice > 0 ? ((basePrice - resolvedPrice) / basePrice * 100) : 0;

      return {
        resolved_price: resolvedPrice,
        base_price: basePrice,
        discount_percent: Math.round(discountPercent * 100) / 100,
        rule_applied: ruleDescription,
        price_list_name: priceListName,
      };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      console.error('Resolve price error:', error);
      // Fallback: return base price
      return {
        resolved_price: 0,
        base_price: 0,
        discount_percent: 0,
        rule_applied: null,
        price_list_name: null,
      };
    }
  }

  // Resolve prices for ALL products in a price list (preview)
  async resolveAllPrices(companyId: string, priceListId: string, quantity: number = 1) {
    await this.ensureMigrations();
    try {
      // Get all products for this company
      const productsResult = await db.execute(sql`
        SELECT p.id, p.name, p.sku, p.category_id,
          pp.cost, pp.margin_percent, pp.vat_rate, pp.final_price
        FROM products p
        LEFT JOIN product_pricing pp ON pp.product_id = p.id
        WHERE p.company_id = ${companyId} AND p.active = true
        ORDER BY p.name ASC
        LIMIT 200
      `);
      const products = (productsResult as any).rows || productsResult || [];

      const resolved = [];
      for (const product of products) {
        const resolution = await this.resolvePrice(companyId, priceListId, product.id, quantity);
        resolved.push({
          product_id: product.id,
          product_name: product.name,
          product_sku: product.sku,
          base_price: resolution.base_price,
          resolved_price: resolution.resolved_price,
          discount_percent: resolution.discount_percent,
          rule_applied: resolution.rule_applied,
        });
      }

      return resolved;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Failed to resolve all prices');
    }
  }

  // =============================================
  // BULK OPERATIONS
  // =============================================

  async bulkUpdateRules(companyId: string, priceListId: string, operation: {
    type: 'increase_percent' | 'copy_from_list';
    percent?: number;
    source_list_id?: string;
    markup_percent?: number;
  }) {
    await this.ensureMigrations();
    try {
      const check = await db.execute(sql`
        SELECT id FROM price_lists WHERE id = ${priceListId} AND company_id = ${companyId}
      `);
      const rows = (check as any).rows || check || [];
      if (rows.length === 0) throw new ApiError(404, 'Price list not found');

      if (operation.type === 'increase_percent' && operation.percent !== undefined && operation.percent !== null) {
        // Update all fixed-price rules by the percentage
        const pct = operation.percent;
        const multiplier = 1 + pct / 100;
        await db.execute(sql`
          UPDATE price_list_rules SET
            value = ROUND(CAST(value AS decimal) * ${multiplier.toString()}, 2),
            updated_at = NOW()
          WHERE price_list_id = ${priceListId} AND rule_type = 'fixed' AND active = true
        `);

        // Also update legacy price_list_items
        await db.execute(sql`
          UPDATE price_list_items SET
            price = ROUND(CAST(price AS decimal) * ${multiplier.toString()}, 2)
          WHERE price_list_id = ${priceListId}
        `);

        const countResult = await db.execute(sql`
          SELECT
            (SELECT COUNT(*) FROM price_list_rules WHERE price_list_id = ${priceListId} AND rule_type = 'fixed') as rule_count,
            (SELECT COUNT(*) FROM price_list_items WHERE price_list_id = ${priceListId}) as item_count
        `);
        const counts = ((countResult as any).rows || countResult || [])[0] || {};
        const total = parseInt(counts.rule_count || '0') + parseInt(counts.item_count || '0');

        return { success: true, updated: total, operation: 'increase_percent', percent: pct };
      }

      if (operation.type === 'copy_from_list' && operation.source_list_id) {
        const sourceCheck = await db.execute(sql`
          SELECT id FROM price_lists WHERE id = ${operation.source_list_id} AND company_id = ${companyId}
        `);
        const sourceRows = (sourceCheck as any).rows || sourceCheck || [];
        if (sourceRows.length === 0) throw new ApiError(404, 'Source price list not found');

        // Delete existing rules in target
        await db.execute(sql`DELETE FROM price_list_rules WHERE price_list_id = ${priceListId}`);

        // Copy rules from source with optional markup adjustment
        const markupAdj = operation.markup_percent || 0;

        const sourceRules = await db.execute(sql`
          SELECT * FROM price_list_rules WHERE price_list_id = ${operation.source_list_id} AND active = true
        `);
        const srcRules = (sourceRules as any).rows || sourceRules || [];

        for (const rule of srcRules) {
          const newId = uuid();
          let newValue = parseFloat(rule.value || '0');
          if (rule.rule_type === 'fixed' && markupAdj !== 0) {
            newValue = newValue * (1 + markupAdj / 100);
          } else if (rule.rule_type === 'percentage' && markupAdj !== 0) {
            // Adjust percentage: e.g. original -15, markup +5 => -10
            newValue = newValue + markupAdj;
          }

          await db.execute(sql`
            INSERT INTO price_list_rules (id, price_list_id, product_id, category_id, rule_type, value, min_quantity, priority)
            VALUES (
              ${newId}, ${priceListId}, ${rule.product_id || null}, ${rule.category_id || null},
              ${rule.rule_type}, ${newValue.toFixed(2)}, ${rule.min_quantity || 1}, ${rule.priority || 0}
            )
          `);
        }

        return { success: true, copied: srcRules.length, operation: 'copy_from_list' };
      }

      throw new ApiError(400, 'Invalid bulk operation');
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Failed to bulk update rules');
    }
  }

  // =============================================
  // ENTERPRISE LINKING
  // =============================================

  async getProductPriceForEnterprise(companyId: string, productId: string, enterpriseId: string) {
    await this.ensureMigrations();
    try {
      // Get the enterprise's price list id
      const entResult = await db.execute(sql`
        SELECT price_list_id FROM enterprises WHERE id = ${enterpriseId} AND company_id = ${companyId}
      `);
      const entRows = (entResult as any).rows || entResult || [];
      if (entRows.length === 0) return null;

      const priceListId = entRows[0].price_list_id;
      if (!priceListId) return null;

      return await this.resolvePrice(companyId, priceListId, productId, 1);
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

  // =============================================
  // PRICE HISTORY
  // =============================================

  async logPriceChange(companyId: string, productId: string, fieldChanged: string, oldValue: number | null, newValue: number | null, changeSource: string, changedBy?: string, batchId?: string) {
    await this.ensureMigrations();
    try {
      const id = uuid();
      await db.execute(sql`
        INSERT INTO price_change_history (id, company_id, product_id, field_changed, old_value, new_value, change_source, batch_id, changed_by)
        VALUES (
          ${id},
          ${companyId},
          ${productId},
          ${fieldChanged},
          ${oldValue !== null && oldValue !== undefined ? oldValue.toString() : null},
          ${newValue !== null && newValue !== undefined ? newValue.toString() : null},
          ${changeSource},
          ${batchId || null},
          ${changedBy || null}
        )
      `);
      return id;
    } catch (error) {
      console.error('Log price change error:', error);
      // Non-critical: don't throw, just log
      return null;
    }
  }

  async getPriceHistory(companyId: string, productId: string, limit: number = 20, offset: number = 0) {
    await this.ensureMigrations();
    try {
      const safeLimit = Math.min(Math.max(1, limit), 100);
      const safeOffset = Math.max(0, offset);

      const result = await db.execute(sql`
        SELECT pch.*,
          u.name as changed_by_name
        FROM price_change_history pch
        LEFT JOIN users u ON u.id = pch.changed_by
        WHERE pch.company_id = ${companyId} AND pch.product_id = ${productId}
        ORDER BY pch.created_at DESC
        LIMIT ${safeLimit} OFFSET ${safeOffset}
      `);

      const countResult = await db.execute(sql`
        SELECT COUNT(*) as total FROM price_change_history
        WHERE company_id = ${companyId} AND product_id = ${productId}
      `);
      const total = parseInt(((countResult as any).rows?.[0]?.total ?? '0'), 10);

      return {
        items: (result as any).rows || result || [],
        total,
      };
    } catch (error) {
      console.error('Get price history error:', error);
      return { items: [], total: 0 };
    }
  }

  // =============================================
  // QUANTITY TIERS
  // =============================================

  async getQuantityTiers(companyId: string, priceListId: string, productId: string) {
    await this.ensureMigrations();
    try {
      // Get base price
      const productResult = await db.execute(sql`
        SELECT p.id, p.category_id, pp.cost, pp.vat_rate, pp.final_price
        FROM products p
        LEFT JOIN product_pricing pp ON pp.product_id = p.id
        WHERE p.id = ${productId} AND p.company_id = ${companyId}
      `);
      const productRows = (productResult as any).rows || productResult || [];
      if (productRows.length === 0) return [];
      const product = productRows[0];
      const basePrice = parseFloat(product.final_price || '0');
      const cost = parseFloat(product.cost || '0');

      // Get all active rules for this product in the list, sorted by min_quantity
      const rulesResult = await db.execute(sql`
        SELECT plr.*, c.name as category_name
        FROM price_list_rules plr
        LEFT JOIN categories c ON c.id = plr.category_id
        WHERE plr.price_list_id = ${priceListId}
          AND plr.active = true
        ORDER BY plr.min_quantity ASC, plr.priority DESC, plr.created_at ASC, plr.id ASC
      `);
      const allRules = (rulesResult as any).rows || rulesResult || [];

      if (allRules.length === 0) return [];

      // Find rules that match this product (by specificity order)
      const productRules = allRules.filter((r: any) => r.product_id === productId);

      // Collect ancestor category IDs for subcategory rule inheritance
      const tierCategoryIds: string[] = [];
      if (product.category_id) {
        tierCategoryIds.push(product.category_id);
        try {
          let parentCatId: string | null = product.category_id;
          let depth = 0;
          while (parentCatId && depth < 5) {
            const parentResult = await db.execute(sql`
              SELECT parent_id FROM categories WHERE id = ${parentCatId}
            `);
            const parentRows = (parentResult as any).rows || parentResult || [];
            if (parentRows.length === 0 || !parentRows[0].parent_id) break;
            parentCatId = parentRows[0].parent_id as string;
            tierCategoryIds.push(parentCatId);
            depth++;
          }
        } catch { /* ignore lookup errors */ }
      }

      let categoryRules: any[] = [];
      for (const catId of tierCategoryIds) {
        const rulesForCat = allRules.filter((r: any) => !r.product_id && r.category_id === catId);
        if (rulesForCat.length > 0) {
          categoryRules = rulesForCat;
          break;
        }
      }

      const globalRules = allRules.filter((r: any) => !r.product_id && !r.category_id);

      const matchingRules = productRules.length > 0 ? productRules
        : categoryRules.length > 0 ? categoryRules
        : globalRules;

      if (matchingRules.length === 0) return [];

      // Group by distinct min_quantity values
      const qtyMap = new Map<number, any>();
      for (const rule of matchingRules) {
        const minQty = parseInt(rule.min_quantity || '1', 10);
        // Keep highest priority / most specific for each qty threshold
        if (!qtyMap.has(minQty) || (rule.priority || 0) > (qtyMap.get(minQty)?.priority || 0)) {
          qtyMap.set(minQty, rule);
        }
      }

      // Compute price for each tier
      const tiers: { min_quantity: number; price: number; discount_percent: number }[] = [];
      for (const [minQty, rule] of Array.from(qtyMap.entries()).sort((a, b) => a[0] - b[0])) {
        let price = basePrice;
        switch (rule.rule_type) {
          case 'fixed':
            price = parseFloat(rule.value || '0');
            break;
          case 'percentage': {
            const pct = parseFloat(rule.value || '0');
            price = basePrice * (1 + pct / 100);
            break;
          }
          case 'formula': {
            const coefficient = parseFloat(rule.value || '1');
            price = cost * coefficient;
            const vatRate = parseFloat(product.vat_rate || '21');
            price = price * (1 + vatRate / 100);
            break;
          }
        }
        price = Math.round(price * 100) / 100;
        const discountPct = basePrice > 0 ? Math.round(((basePrice - price) / basePrice) * 10000) / 100 : 0;
        tiers.push({ min_quantity: minQty, price, discount_percent: discountPct });
      }

      return tiers;
    } catch (error) {
      console.error('Get quantity tiers error:', error);
      return [];
    }
  }

  // =============================================
  // BULK OPERATIONS WITH HISTORY + UNDO
  // =============================================

  async bulkUpdatePriceWithHistory(companyId: string, productIds: string[], percentIncrease: number, userId?: string) {
    await this.ensureMigrations();
    try {
      if (productIds.length === 0) throw new ApiError(400, 'No products selected');
      if (percentIncrease === 0) throw new ApiError(400, 'Percentage must be non-zero');

      const batchId = uuid();
      const multiplier = 1 + percentIncrease / 100;

      // Get current prices for rollback data
      const placeholders = productIds.map((_, i) => `$${i + 1}`).join(',');
      const rollbackResult = await pool.query(`
        SELECT pp.product_id, pp.cost, pp.margin_percent, pp.vat_rate, pp.final_price
        FROM product_pricing pp
        JOIN products p ON p.id = pp.product_id
        WHERE pp.product_id IN (${placeholders}) AND p.company_id = $${productIds.length + 1}
      `, [...productIds, companyId]);
      const rollbackData = rollbackResult.rows || [];

      // Log each product's price changes
      for (const row of rollbackData) {
        const oldCost = parseFloat(row.cost || '0');
        const oldFinal = parseFloat(row.final_price || '0');
        const newCost = Math.round(oldCost * multiplier * 100) / 100;
        const margin = parseFloat(row.margin_percent || '0');
        const vat = parseFloat(row.vat_rate || '0');
        const newFinal = Math.round(newCost * (1 + margin / 100) * (1 + vat / 100) * 100) / 100;

        await this.logPriceChange(companyId, row.product_id, 'cost', oldCost, newCost, 'bulk_update', userId, batchId);
        await this.logPriceChange(companyId, row.product_id, 'final_price', oldFinal, newFinal, 'bulk_update', userId, batchId);
      }

      // Apply the update
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

      // Log the bulk operation for undo
      const opId = uuid();
      await db.execute(sql`
        INSERT INTO bulk_price_operations (id, company_id, operation_type, parameters, affected_products, rollback_data, performed_by)
        VALUES (
          ${opId},
          ${companyId},
          ${'percentage_increase'},
          ${JSON.stringify({ percent: percentIncrease, product_ids: productIds })},
          ${rollbackData.length},
          ${JSON.stringify(rollbackData)},
          ${userId || null}
        )
      `);

      return { updated: rollbackData.length, batch_id: batchId, operation_id: opId };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      console.error('Bulk update with history error:', error);
      throw new ApiError(500, 'Failed to bulk update prices');
    }
  }

  async undoBulkOperation(companyId: string, operationId: string, userId?: string) {
    await this.ensureMigrations();
    try {
      // Get the operation
      const opResult = await db.execute(sql`
        SELECT * FROM bulk_price_operations
        WHERE id = ${operationId} AND company_id = ${companyId} AND rolled_back = false
      `);
      const opRows = (opResult as any).rows || opResult || [];
      if (opRows.length === 0) throw new ApiError(404, 'Operacion no encontrada o ya fue revertida');

      const op = opRows[0];
      const performedAt = new Date(op.performed_at).getTime();
      const fiveMinutesMs = 5 * 60 * 1000;
      if (Date.now() - performedAt > fiveMinutesMs) {
        throw new ApiError(400, 'La ventana de 5 minutos para deshacer ya expiro');
      }

      const rollbackData = typeof op.rollback_data === 'string' ? JSON.parse(op.rollback_data) : op.rollback_data;
      if (!Array.isArray(rollbackData) || rollbackData.length === 0) {
        throw new ApiError(400, 'No hay datos de rollback disponibles');
      }

      const undoBatchId = uuid();
      let restored = 0;

      for (const row of rollbackData) {
        // Check product still exists
        const existsResult = await db.execute(sql`
          SELECT pp.product_id FROM product_pricing pp
          JOIN products p ON p.id = pp.product_id
          WHERE pp.product_id = ${row.product_id} AND p.company_id = ${companyId}
        `);
        const existsRows = (existsResult as any).rows || existsResult || [];
        if (existsRows.length === 0) continue; // Skip deleted products

        // Get current values for history
        const currentResult = await db.execute(sql`
          SELECT cost, final_price FROM product_pricing WHERE product_id = ${row.product_id}
        `);
        const currentRows = (currentResult as any).rows || currentResult || [];
        if (currentRows.length > 0) {
          const curr = currentRows[0];
          await this.logPriceChange(companyId, row.product_id, 'cost', parseFloat(curr.cost || '0'), parseFloat(row.cost || '0'), 'undo_bulk', userId, undoBatchId);
          await this.logPriceChange(companyId, row.product_id, 'final_price', parseFloat(curr.final_price || '0'), parseFloat(row.final_price || '0'), 'undo_bulk', userId, undoBatchId);
        }

        // Restore old prices
        await db.execute(sql`
          UPDATE product_pricing SET
            cost = ${row.cost},
            margin_percent = ${row.margin_percent},
            vat_rate = ${row.vat_rate},
            final_price = ${row.final_price},
            updated_at = NOW()
          WHERE product_id = ${row.product_id}
        `);
        restored++;
      }

      // Mark operation as rolled back
      await db.execute(sql`
        UPDATE bulk_price_operations SET rolled_back = true, rolled_back_at = NOW()
        WHERE id = ${operationId}
      `);

      return { success: true, restored };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      console.error('Undo bulk operation error:', error);
      throw new ApiError(500, 'Error al deshacer operacion');
    }
  }

  async getRecentBulkOperations(companyId: string, limit: number = 10) {
    await this.ensureMigrations();
    try {
      const result = await db.execute(sql`
        SELECT bpo.*, u.name as performed_by_name
        FROM bulk_price_operations bpo
        LEFT JOIN users u ON u.id = bpo.performed_by
        WHERE bpo.company_id = ${companyId}
        ORDER BY bpo.performed_at DESC
        LIMIT ${Math.min(limit, 50)}
      `);
      return (result as any).rows || result || [];
    } catch (error) {
      console.error('Get recent bulk operations error:', error);
      return [];
    }
  }

  // =============================================
  // SUPPLIER IMPORT
  // =============================================

  async importSupplierPrices(companyId: string, items: { sku: string; new_cost: number }[], userId?: string) {
    await this.ensureMigrations();
    try {
      if (!Array.isArray(items) || items.length === 0) {
        throw new ApiError(400, 'No items provided');
      }

      // Validate no negative costs
      const negativeCosts = items.filter(i => i.new_cost < 0);
      if (negativeCosts.length > 0) {
        throw new ApiError(400, `Se encontraron ${negativeCosts.length} costos negativos. Los costos deben ser >= 0.`);
      }

      const batchId = uuid();
      const results: { sku: string; status: string; product_name?: string; old_cost?: number; new_cost?: number; new_final_price?: number }[] = [];
      const rollbackData: any[] = [];

      for (const item of items) {
        if (!item.sku || item.new_cost === undefined || item.new_cost === null) {
          results.push({ sku: item.sku || '(vacio)', status: 'error', product_name: 'SKU o costo invalido' });
          continue;
        }

        // Find product by SKU
        const productResult = await pool.query(
          `SELECT p.id, p.name, p.sku, pp.cost, pp.margin_percent, pp.vat_rate, pp.final_price
           FROM products p
           LEFT JOIN product_pricing pp ON pp.product_id = p.id
           WHERE p.company_id = $1 AND LOWER(p.sku) = LOWER($2)`,
          [companyId, item.sku.trim()]
        );

        if (!productResult.rows || productResult.rows.length === 0) {
          results.push({ sku: item.sku, status: 'not_found' });
          continue;
        }

        const product = productResult.rows[0];
        const oldCost = parseFloat(product.cost || '0');
        const margin = parseFloat(product.margin_percent || '30');
        const vat = parseFloat(product.vat_rate || '21');
        const oldFinal = parseFloat(product.final_price || '0');
        const newCost = Math.round(item.new_cost * 100) / 100;
        const newFinal = Math.round(newCost * (1 + margin / 100) * (1 + vat / 100) * 100) / 100;

        // Store rollback data
        rollbackData.push({
          product_id: product.id,
          cost: product.cost,
          margin_percent: product.margin_percent,
          vat_rate: product.vat_rate,
          final_price: product.final_price,
        });

        // Log changes
        await this.logPriceChange(companyId, product.id, 'cost', oldCost, newCost, 'supplier_import', userId, batchId);
        await this.logPriceChange(companyId, product.id, 'final_price', oldFinal, newFinal, 'supplier_import', userId, batchId);

        // Update pricing
        await db.execute(sql`
          UPDATE product_pricing SET
            cost = ${newCost.toFixed(2)},
            final_price = ${newFinal.toFixed(2)},
            updated_at = NOW()
          WHERE product_id = ${product.id}
        `);

        results.push({
          sku: product.sku,
          status: 'updated',
          product_name: product.name,
          old_cost: oldCost,
          new_cost: newCost,
          new_final_price: newFinal,
        });
      }

      // Log the bulk operation
      const updatedCount = results.filter(r => r.status === 'updated').length;
      if (updatedCount > 0) {
        const opId = uuid();
        await db.execute(sql`
          INSERT INTO bulk_price_operations (id, company_id, operation_type, parameters, affected_products, rollback_data, performed_by)
          VALUES (
            ${opId},
            ${companyId},
            ${'supplier_import'},
            ${JSON.stringify({ item_count: items.length })},
            ${updatedCount},
            ${JSON.stringify(rollbackData)},
            ${userId || null}
          )
        `);

        return {
          results,
          summary: {
            total: items.length,
            updated: updatedCount,
            not_found: results.filter(r => r.status === 'not_found').length,
            errors: results.filter(r => r.status === 'error').length,
          },
          operation_id: opId,
        };
      }

      return {
        results,
        summary: {
          total: items.length,
          updated: 0,
          not_found: results.filter(r => r.status === 'not_found').length,
          errors: results.filter(r => r.status === 'error').length,
        },
        operation_id: null,
      };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      console.error('Import supplier prices error:', error);
      throw new ApiError(500, 'Error al importar precios de proveedor');
    }
  }
}

export const priceListsService = new PriceListsService();
