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
        ORDER BY plr.priority DESC, plr.min_quantity DESC
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
        ORDER BY plr.priority DESC, plr.min_quantity DESC
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
          ${data.min_quantity || 1},
          ${data.priority || 0}
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
          min_quantity = ${data.min_quantity || 1},
          priority = ${data.priority || 0},
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
        ORDER BY plr.priority DESC, plr.min_quantity DESC
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
      // 2. Category match
      // 3. Global rule (no product_id and no category_id)
      const productRules = rules.filter((r: any) => r.product_id === productId);
      const categoryRules = product.category_id
        ? rules.filter((r: any) => !r.product_id && r.category_id === product.category_id)
        : [];
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

      if (operation.type === 'increase_percent' && operation.percent) {
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
}

export const priceListsService = new PriceListsService();
