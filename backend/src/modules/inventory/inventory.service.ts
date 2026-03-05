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
               json_build_object('id', p.id, 'name', p.name, 'sku', p.sku) as product,
               json_build_object('id', w.id, 'name', w.name) as warehouse
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
        SELECT s.id, s.quantity, s.min_level,
               json_build_object('id', p.id, 'name', p.name, 'sku', p.sku) as product,
               json_build_object('id', w.id, 'name', w.name) as warehouse
        FROM stock s
        JOIN products p ON s.product_id = p.id
        JOIN warehouses w ON s.warehouse_id = w.id
        WHERE p.company_id = ${companyId}
          AND CAST(s.quantity AS decimal) <= CAST(s.min_level AS decimal)
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
}

export const inventoryService = new InventoryService();
