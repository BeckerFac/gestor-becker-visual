import { db } from '../../config/db';
import { stock, stock_movements, products, warehouses } from '../../db/schema';
import { eq, and, sql, lte } from 'drizzle-orm';
import { ApiError } from '../../middlewares/errorHandler';
import { v4 as uuid } from 'uuid';

export class InventoryService {
  async getStock(companyId: string) {
    try {
      const result = await db.execute(sql`
        SELECT s.id, s.quantity, s.min_level, s.max_level,
               p.low_stock_threshold,
               json_build_object('id', p.id, 'name', p.name, 'sku', p.sku) as product,
               json_build_object('id', w.id, 'name', w.name) as warehouse,
               COALESCE((SELECT json_agg(json_build_object('name', pp.name, 'sku', pp.sku))
                 FROM product_components pc JOIN products pp ON pc.product_id = pp.id
                 WHERE pc.component_product_id = p.id), '[]'::json) as used_in_products
        FROM stock s
        JOIN products p ON s.product_id = p.id
        JOIN warehouses w ON s.warehouse_id = w.id
        WHERE p.company_id = ${companyId}
        ORDER BY p.name ASC
      `);

      const rows = (result as any).rows || result || [];
      return { items: rows, total: rows.length };
    } catch (error) {
      console.error('Get stock error:', error);
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Failed to get inventory');
    }
  }

  async createMovement(companyId: string, userId: string, data: any) {
    try {
      // Verify product belongs to company
      const product = await db.execute(sql`
        SELECT id FROM products WHERE id = ${data.product_id} AND company_id = ${companyId}
      `);
      const productRows = (product as any).rows || product || [];
      if (productRows.length === 0) {
        throw new ApiError(404, 'Product not found');
      }

      // Get or create default warehouse
      let warehouseResult = await db.execute(sql`
        SELECT id FROM warehouses WHERE company_id = ${companyId} LIMIT 1
      `);
      let warehouseRows = (warehouseResult as any).rows || warehouseResult || [];

      let warehouseId: string;
      if (warehouseRows.length === 0) {
        const newId = uuid();
        await db.insert(warehouses).values({
          id: newId,
          company_id: companyId,
          name: 'Principal',
        });
        warehouseId = newId;
      } else {
        warehouseId = warehouseRows[0].id;
      }

      // Create movement record
      const movementId = uuid();
      const quantity = parseFloat(data.quantity);
      const movementType = data.movement_type || 'adjustment';

      await db.insert(stock_movements).values({
        id: movementId,
        product_id: data.product_id,
        warehouse_id: warehouseId,
        movement_type: movementType,
        quantity: quantity.toString(),
        reference_type: data.reference_type || null,
        reference_id: data.reference_id || null,
        notes: data.notes || null,
        created_by: userId,
      });

      // Update stock: positive for purchases/returns, negative for sales/returns to supplier
      const isIncoming = ['purchase', 'adjustment', 'return_customer'].includes(movementType);
      const stockDelta = isIncoming ? quantity : -quantity;

      // Upsert stock record
      const existingStock = await db.execute(sql`
        SELECT id, quantity FROM stock
        WHERE product_id = ${data.product_id} AND warehouse_id = ${warehouseId}
      `);
      const stockRows = (existingStock as any).rows || existingStock || [];

      if (stockRows.length === 0) {
        await db.insert(stock).values({
          id: uuid(),
          product_id: data.product_id,
          warehouse_id: warehouseId,
          quantity: Math.max(0, stockDelta).toString(),
          min_level: '0',
          max_level: '0',
        });
      } else {
        const currentQty = parseFloat(stockRows[0].quantity || '0');
        const newQty = currentQty + stockDelta;
        await db.execute(sql`
          UPDATE stock SET quantity = ${Math.max(0, newQty).toString()}, updated_at = NOW()
          WHERE id = ${stockRows[0].id}
        `);
      }

      return { id: movementId, product_id: data.product_id, movement_type: movementType, quantity };
    } catch (error) {
      console.error('Create movement error:', error);
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Failed to create inventory movement');
    }
  }

  async getLowStock(companyId: string) {
    try {
      const result = await db.execute(sql`
        SELECT s.id, s.quantity, s.min_level, p.low_stock_threshold,
               json_build_object('id', p.id, 'name', p.name, 'sku', p.sku) as product,
               json_build_object('id', w.id, 'name', w.name) as warehouse
        FROM stock s
        JOIN products p ON s.product_id = p.id
        JOIN warehouses w ON s.warehouse_id = w.id
        WHERE p.company_id = ${companyId}
          AND p.controls_stock = true
          AND CAST(s.quantity AS decimal) <= COALESCE(CAST(p.low_stock_threshold AS decimal), CAST(s.min_level AS decimal), 0)
          AND COALESCE(CAST(p.low_stock_threshold AS decimal), CAST(s.min_level AS decimal), 0) > 0
        ORDER BY CAST(s.quantity AS decimal) ASC
      `);

      const rows = (result as any).rows || result || [];
      return { items: rows, total: rows.length };
    } catch (error) {
      console.error('Low stock error:', error);
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Failed to get low stock items');
    }
  }
  async adjustStock(companyId: string, userId: string, data: { product_id: string; warehouse_id?: string; quantity_change: number; reason: string }) {
    try {
      // Verify product belongs to company
      const product = await db.execute(sql`
        SELECT id FROM products WHERE id = ${data.product_id} AND company_id = ${companyId}
      `);
      const productRows = (product as any).rows || product || [];
      if (productRows.length === 0) {
        throw new ApiError(404, 'Product not found');
      }

      // Get or create default warehouse
      let warehouseId = data.warehouse_id;
      if (!warehouseId) {
        const whResult = await db.execute(sql`
          SELECT id FROM warehouses WHERE company_id = ${companyId} LIMIT 1
        `);
        const whRows = (whResult as any).rows || whResult || [];
        if (whRows.length === 0) {
          const newId = uuid();
          await db.insert(warehouses).values({
            id: newId,
            company_id: companyId,
            name: 'Principal',
          });
          warehouseId = newId;
        } else {
          warehouseId = whRows[0].id;
        }
      }

      const quantityChange = parseFloat(String(data.quantity_change));

      // Create movement
      const movementId = uuid();
      await db.execute(sql`
        INSERT INTO stock_movements (id, product_id, warehouse_id, movement_type, quantity, notes, created_by)
        VALUES (${movementId}, ${data.product_id}, ${warehouseId}, 'adjustment', ${quantityChange.toString()}, ${(data.reason || '') + (quantityChange < 0 ? ' (salida)' : ' (ingreso)')}, ${userId})
      `);

      // Upsert stock
      const existingStock = await db.execute(sql`
        SELECT id, quantity FROM stock
        WHERE product_id = ${data.product_id} AND warehouse_id = ${warehouseId}
      `);
      const stockRows = (existingStock as any).rows || existingStock || [];

      let newQty: number;
      if (stockRows.length === 0) {
        newQty = Math.max(0, quantityChange);
        await db.execute(sql`
          INSERT INTO stock (id, product_id, warehouse_id, quantity, min_level, max_level)
          VALUES (${uuid()}, ${data.product_id}, ${warehouseId}, ${newQty.toString()}, '0', '0')
        `);
      } else {
        const currentQty = parseFloat(stockRows[0].quantity || '0');
        newQty = Math.max(0, currentQty + quantityChange);
        await db.execute(sql`
          UPDATE stock SET quantity = ${newQty.toString()}, updated_at = NOW()
          WHERE id = ${stockRows[0].id}
        `);
      }

      return { id: movementId, product_id: data.product_id, quantity_change: quantityChange, new_quantity: newQty };
    } catch (error) {
      console.error('Adjust stock error:', error);
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Failed to adjust stock');
    }
  }

  async getStockMovements(companyId: string, { skip = 0, limit = 50, product_id = '' } = {}) {
    try {
      const conditions = [`p.company_id = '${companyId.replace(/'/g, "''")}'`];
      if (product_id) {
        conditions.push(`sm.product_id = '${product_id.replace(/'/g, "''")}'`);
      }
      const whereClause = conditions.join(' AND ');

      const countResult = await db.execute(sql`
        SELECT COUNT(*) as total
        FROM stock_movements sm
        JOIN products p ON p.id = sm.product_id
        WHERE ${sql.raw(whereClause)}
      `);
      const total = parseInt(((countResult as any).rows?.[0]?.total ?? '0'), 10);

      const result = await db.execute(sql`
        SELECT sm.*,
          json_build_object('id', p.id, 'name', p.name, 'sku', p.sku) as product,
          json_build_object('id', w.id, 'name', w.name) as warehouse
        FROM stock_movements sm
        JOIN products p ON p.id = sm.product_id
        LEFT JOIN warehouses w ON w.id = sm.warehouse_id
        WHERE ${sql.raw(whereClause)}
        ORDER BY sm.created_at DESC
        LIMIT ${limit} OFFSET ${skip}
      `);

      const items = (result as any).rows || result || [];
      return { items, total, skip, limit };
    } catch (error) {
      console.error('Get stock movements error:', error);
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Failed to get stock movements');
    }
  }

  async addStockFromPurchase(companyId: string, userId: string, purchaseId: string, items: { product_id: string; quantity: number }[], customNote?: string) {
    try {
      // Get or create default warehouse
      let warehouseResult = await db.execute(sql`
        SELECT id FROM warehouses WHERE company_id = ${companyId} LIMIT 1
      `);
      let warehouseRows = (warehouseResult as any).rows || warehouseResult || [];

      let warehouseId: string;
      if (warehouseRows.length === 0) {
        const newId = uuid();
        await db.insert(warehouses).values({
          id: newId,
          company_id: companyId,
          name: 'Principal',
        });
        warehouseId = newId;
      } else {
        warehouseId = warehouseRows[0].id;
      }

      const results: any[] = [];

      for (const item of items) {
        // Check if product has controls_stock=true
        const productResult = await db.execute(sql`
          SELECT id, controls_stock FROM products WHERE id = ${item.product_id} AND company_id = ${companyId}
        `);
        const productRows = (productResult as any).rows || productResult || [];
        if (productRows.length === 0) continue;
        if (!productRows[0].controls_stock) continue;

        const quantity = parseFloat(String(item.quantity));

        // Create movement
        const movementId = uuid();
        await db.execute(sql`
          INSERT INTO stock_movements (id, product_id, warehouse_id, movement_type, quantity, reference_type, reference_id, notes, created_by)
          VALUES (${movementId}, ${item.product_id}, ${warehouseId}, 'purchase', ${quantity.toString()}, 'purchase', ${purchaseId}, ${customNote || 'Ingreso por compra'}, ${userId})
        `);

        // Upsert stock
        const existingStock = await db.execute(sql`
          SELECT id, quantity FROM stock
          WHERE product_id = ${item.product_id} AND warehouse_id = ${warehouseId}
        `);
        const stockRows = (existingStock as any).rows || existingStock || [];

        let newQty: number;
        if (stockRows.length === 0) {
          newQty = Math.max(0, quantity);
          await db.execute(sql`
            INSERT INTO stock (id, product_id, warehouse_id, quantity, min_level, max_level)
            VALUES (${uuid()}, ${item.product_id}, ${warehouseId}, ${newQty.toString()}, '0', '0')
          `);
        } else {
          const currentQty = parseFloat(stockRows[0].quantity || '0');
          newQty = currentQty + quantity;
          await db.execute(sql`
            UPDATE stock SET quantity = ${newQty.toString()}, updated_at = NOW()
            WHERE id = ${stockRows[0].id}
          `);
        }

        results.push({ product_id: item.product_id, quantity_added: quantity, new_quantity: newQty });
      }

      return { purchase_id: purchaseId, items_processed: results };
    } catch (error) {
      console.error('Add stock from purchase error:', error);
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Failed to add stock from purchase');
    }
  }
}

export const inventoryService = new InventoryService();
