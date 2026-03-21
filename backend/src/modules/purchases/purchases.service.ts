import { db } from '../../config/db';
import { sql } from 'drizzle-orm';
import { ApiError } from '../../middlewares/errorHandler';
import { v4 as uuid } from 'uuid';
import { inventoryService } from '../inventory/inventory.service';

export class PurchasesService {
  private tablesEnsured = false;

  async ensureTables() {
    if (this.tablesEnsured) return;
    try {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS purchases (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
          enterprise_id UUID REFERENCES enterprises(id),
          purchase_number INTEGER NOT NULL,
          date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          invoice_type VARCHAR(5),
          invoice_number VARCHAR(50),
          invoice_cae VARCHAR(30),
          subtotal DECIMAL(12,2),
          vat_amount DECIMAL(12,2),
          total_amount DECIMAL(12,2) NOT NULL,
          payment_method VARCHAR(50),
          payment_status VARCHAR(50) DEFAULT 'pendiente',
          bank_id UUID REFERENCES banks(id),
          notes TEXT,
          status VARCHAR(50) DEFAULT 'activa',
          created_by UUID REFERENCES users(id),
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
      `);
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS purchase_items (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          purchase_id UUID NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
          product_name VARCHAR(255) NOT NULL,
          description TEXT,
          quantity DECIMAL(12,2) DEFAULT 1,
          unit_price DECIMAL(12,2) NOT NULL,
          subtotal DECIMAL(12,2),
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
      `);
      await db.execute(sql`ALTER TABLE purchase_items ADD COLUMN IF NOT EXISTS product_id UUID REFERENCES products(id) ON DELETE SET NULL`);
      await db.execute(sql`ALTER TABLE purchases ADD COLUMN IF NOT EXISTS stock_added BOOLEAN DEFAULT false`);
      this.tablesEnsured = true;
    } catch (error) {
      console.error('Ensure purchases tables error:', error);
    }
  }

  async getPurchases(companyId: string, filters: { enterprise_id?: string } = {}) {
    await this.ensureTables();
    try {
      let whereClause = sql`p.company_id = ${companyId}`;
      if (filters.enterprise_id) {
        whereClause = sql`${whereClause} AND p.enterprise_id = ${filters.enterprise_id}`;
      }

      const result = await db.execute(sql`
        SELECT p.*,
          e.name as enterprise_name,
          e.cuit as enterprise_cuit,
          b.bank_name,
          COALESCE((SELECT json_agg(json_build_object('id',t.id,'name',t.name,'color',t.color))
            FROM entity_tags et JOIN tags t ON et.tag_id=t.id
            WHERE et.entity_id=e.id AND et.entity_type='enterprise'),'[]'::json) as enterprise_tags,
          COALESCE((SELECT COUNT(*) FROM purchase_items pi WHERE pi.purchase_id = p.id), 0) as item_count
        FROM purchases p
        LEFT JOIN enterprises e ON p.enterprise_id = e.id
        LEFT JOIN banks b ON p.bank_id = b.id
        WHERE ${whereClause}
        ORDER BY p.date DESC
      `);
      return (result as any).rows || result || [];
    } catch (error) {
      throw new ApiError(500, 'Failed to get purchases');
    }
  }

  async getPurchase(companyId: string, purchaseId: string) {
    await this.ensureTables();
    try {
      const result = await db.execute(sql`
        SELECT p.*,
          e.name as enterprise_name, e.cuit as enterprise_cuit,
          b.bank_name,
          COALESCE((SELECT json_agg(json_build_object('id',t.id,'name',t.name,'color',t.color))
            FROM entity_tags et JOIN tags t ON et.tag_id=t.id
            WHERE et.entity_id=e.id AND et.entity_type='enterprise'),'[]'::json) as enterprise_tags
        FROM purchases p
        LEFT JOIN enterprises e ON p.enterprise_id = e.id
        LEFT JOIN banks b ON p.bank_id = b.id
        WHERE p.id = ${purchaseId} AND p.company_id = ${companyId}
      `);
      const rows = (result as any).rows || result || [];
      if (rows.length === 0) throw new ApiError(404, 'Purchase not found');

      const itemsResult = await db.execute(sql`
        SELECT * FROM purchase_items WHERE purchase_id = ${purchaseId} ORDER BY created_at ASC
      `);
      const items = (itemsResult as any).rows || itemsResult || [];

      return { ...rows[0], items };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Failed to get purchase');
    }
  }

  async createPurchase(companyId: string, userId: string, data: any) {
    await this.ensureTables();
    try {
      const purchaseId = uuid();

      const numResult = await db.execute(sql`
        SELECT COALESCE(MAX(purchase_number), 0) + 1 as next_number FROM purchases WHERE company_id = ${companyId}
      `);
      const numRows = (numResult as any).rows || numResult || [];
      const purchaseNumber = parseInt(numRows[0]?.next_number || '1');

      // Calculate totals from items if not provided
      let subtotal = parseFloat(data.subtotal) || 0;
      let totalAmount = parseFloat(data.total_amount) || 0;
      let vatAmount = parseFloat(data.vat_amount) || 0;
      if (data.items && Array.isArray(data.items) && data.items.length > 0 && !totalAmount) {
        subtotal = data.items.reduce((sum: number, item: any) => sum + (parseFloat(item.quantity) || 1) * (parseFloat(item.unit_price) || 0), 0);
        vatAmount = subtotal * 0.21;
        totalAmount = subtotal + vatAmount;
      }

      await db.execute(sql`
        INSERT INTO purchases (id, company_id, enterprise_id, purchase_number, date, invoice_type, invoice_number, invoice_cae, subtotal, vat_amount, total_amount, payment_method, payment_status, bank_id, notes, created_by)
        VALUES (${purchaseId}, ${companyId}, ${data.enterprise_id || null}, ${purchaseNumber}, ${data.date || new Date().toISOString()}, ${data.invoice_type || null}, ${data.invoice_number || null}, ${data.invoice_cae || null}, ${subtotal.toString()}, ${vatAmount.toString()}, ${totalAmount.toString()}, ${data.payment_method || null}, ${data.payment_status || 'pendiente'}, ${data.bank_id || null}, ${data.notes || null}, ${userId})
      `);

      if (data.items && Array.isArray(data.items)) {
        for (const item of data.items) {
          const itemId = uuid();
          const subtotal = (parseFloat(item.quantity) || 1) * (parseFloat(item.unit_price) || 0);
          await db.execute(sql`
            INSERT INTO purchase_items (id, purchase_id, product_id, product_name, description, quantity, unit_price, subtotal)
            VALUES (${itemId}, ${purchaseId}, ${item.product_id || null}, ${item.product_name}, ${item.description || null}, ${item.quantity || 1}, ${item.unit_price || 0}, ${subtotal})
          `);
        }
      }

      const result = await this.getPurchase(companyId, purchaseId);

      // Auto-add stock if requested
      if (data.add_to_inventory) {
        const stockItems = (data.items || [])
          .filter((item: any) => item.product_id && item.product_id !== 'custom' && item.add_to_stock !== false)
          .map((item: any) => ({
            product_id: item.product_id,
            quantity: parseFloat(item.quantity) || 0,
          }))
          .filter((item: any) => item.quantity > 0);

        if (stockItems.length > 0) {
          try {
            const purchaseLabel = `Compra #${String(purchaseNumber).padStart(4, '0')}`;
            await inventoryService.addStockFromPurchase(
              companyId,
              userId,
              purchaseId,
              stockItems,
              purchaseLabel
            );
            // Mark purchase as stock_added
            await db.execute(sql`UPDATE purchases SET stock_added = true WHERE id = ${purchaseId}`);
            (result as any).stock_updated = true;
            (result as any).stock_added = true;
          } catch (stockError) {
            console.error('Auto stock update on purchase create failed:', stockError);
            (result as any).stock_updated = false;
            (result as any).stock_error = 'No se pudo actualizar el stock automaticamente';
          }
        }
      }

      return result;
    } catch (error) {
      console.error('Create purchase error:', error);
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Failed to create purchase');
    }
  }

  async updatePaymentStatus(companyId: string, purchaseId: string, status: string) {
    await this.ensureTables();
    try {
      const check = await db.execute(sql`
        SELECT id FROM purchases WHERE id = ${purchaseId} AND company_id = ${companyId}
      `);
      const rows = (check as any).rows || check || [];
      if (rows.length === 0) throw new ApiError(404, 'Purchase not found');

      await db.execute(sql`
        UPDATE purchases SET payment_status = ${status}, updated_at = NOW() WHERE id = ${purchaseId}
      `);
      return { id: purchaseId, payment_status: status };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Failed to update purchase payment status');
    }
  }

  async updatePurchase(companyId: string, purchaseId: string, userId: string, data: any) {
    await this.ensureTables();
    try {
      // Verify ownership
      const check = await db.execute(sql`SELECT id, purchase_number FROM purchases WHERE id = ${purchaseId} AND company_id = ${companyId}`);
      const rows = (check as any).rows || check || [];
      if (rows.length === 0) throw new ApiError(404, 'Purchase not found');

      // Fetch old items BEFORE replacing (needed for stock delta calculation)
      let oldItems: any[] = [];
      if (data.add_to_inventory && data.items && Array.isArray(data.items)) {
        const oldItemsResult = await db.execute(sql`
          SELECT product_id, quantity FROM purchase_items WHERE purchase_id = ${purchaseId}
        `);
        oldItems = (oldItemsResult as any).rows || oldItemsResult || [];
      }

      // Recalculate totals from items if provided
      let subtotal = parseFloat(data.subtotal) || 0;
      let vatAmount = parseFloat(data.vat_amount) || 0;
      let totalAmount = parseFloat(data.total_amount) || 0;
      if (data.items && Array.isArray(data.items) && data.items.length > 0) {
        subtotal = data.items.reduce((sum: number, item: any) => sum + (parseFloat(item.quantity) || 1) * (parseFloat(item.unit_price) || 0), 0);
        vatAmount = subtotal * 0.21;
        totalAmount = subtotal + vatAmount;
      }

      // Update purchase
      await db.execute(sql`
        UPDATE purchases SET
          enterprise_id = ${data.enterprise_id || null},
          date = ${data.date || new Date().toISOString()},
          invoice_type = ${data.invoice_type || null},
          invoice_number = ${data.invoice_number || null},
          invoice_cae = ${data.invoice_cae || null},
          subtotal = ${subtotal.toString()},
          vat_amount = ${vatAmount.toString()},
          total_amount = ${totalAmount.toString()},
          payment_method = ${data.payment_method || null},
          bank_id = ${data.bank_id || null},
          notes = ${data.notes || null},
          updated_at = NOW()
        WHERE id = ${purchaseId} AND company_id = ${companyId}
      `);

      // Replace items if provided
      if (data.items && Array.isArray(data.items)) {
        await db.execute(sql`DELETE FROM purchase_items WHERE purchase_id = ${purchaseId}`);
        for (const item of data.items) {
          const itemId = uuid();
          const itemSubtotal = (parseFloat(item.quantity) || 1) * (parseFloat(item.unit_price) || 0);
          await db.execute(sql`
            INSERT INTO purchase_items (id, purchase_id, product_id, product_name, description, quantity, unit_price, subtotal)
            VALUES (${itemId}, ${purchaseId}, ${item.product_id || null}, ${item.product_name}, ${item.description || null}, ${item.quantity || 1}, ${item.unit_price || 0}, ${itemSubtotal})
          `);
        }
      }

      const result = await this.getPurchase(companyId, purchaseId);

      // Adjust stock if requested during edit
      if (data.add_to_inventory && data.items && Array.isArray(data.items)) {
        try {
          await this.adjustStockForPurchaseEdit(companyId, userId, purchaseId, rows[0].purchase_number, oldItems, data.items);
          await db.execute(sql`UPDATE purchases SET stock_added = true WHERE id = ${purchaseId}`);
          (result as any).stock_updated = true;
          (result as any).stock_added = true;
        } catch (stockError) {
          console.error('Stock adjustment on purchase edit failed:', stockError);
          (result as any).stock_updated = false;
          (result as any).stock_error = 'No se pudo ajustar el stock automaticamente';
        }
      }

      return result;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Failed to update purchase');
    }
  }

  private async adjustStockForPurchaseEdit(
    companyId: string,
    userId: string,
    purchaseId: string,
    purchaseNumber: number,
    oldItems: any[],
    newItems: any[]
  ) {
    // Build quantity maps: product_id -> total quantity
    const oldQtyMap = new Map<string, number>();
    for (const item of oldItems) {
      if (!item.product_id) continue;
      const current = oldQtyMap.get(item.product_id) || 0;
      oldQtyMap.set(item.product_id, current + (parseFloat(item.quantity) || 0));
    }

    const newQtyMap = new Map<string, number>();
    for (const item of newItems) {
      if (!item.product_id || item.product_id === 'custom' || item.add_to_stock === false) continue;
      const current = newQtyMap.get(item.product_id) || 0;
      newQtyMap.set(item.product_id, current + (parseFloat(item.quantity) || 0));
    }

    // Calculate deltas
    const allProductIds = new Set([...oldQtyMap.keys(), ...newQtyMap.keys()]);
    const deltas: { product_id: string; quantity_change: number }[] = [];

    for (const productId of allProductIds) {
      const oldQty = oldQtyMap.get(productId) || 0;
      const newQty = newQtyMap.get(productId) || 0;
      const delta = newQty - oldQty;
      if (delta !== 0) {
        deltas.push({ product_id: productId, quantity_change: delta });
      }
    }

    // Apply deltas using inventory service
    const purchaseLabel = `Compra #${String(purchaseNumber).padStart(4, '0')}`;
    for (const delta of deltas) {
      try {
        await inventoryService.adjustStock(companyId, userId, {
          product_id: delta.product_id,
          quantity_change: delta.quantity_change,
          reason: `Ajuste por edicion de ${purchaseLabel}`,
        });
      } catch (err) {
        console.error(`Stock adjust failed for product ${delta.product_id}:`, err);
      }
    }
  }

  async deletePurchase(companyId: string, purchaseId: string) {
    await this.ensureTables();
    try {
      const check = await db.execute(sql`
        SELECT id FROM purchases WHERE id = ${purchaseId} AND company_id = ${companyId}
      `);
      const rows = (check as any).rows || check || [];
      if (rows.length === 0) throw new ApiError(404, 'Purchase not found');

      await db.execute(sql`DELETE FROM purchases WHERE id = ${purchaseId} AND company_id = ${companyId}`);
      return { success: true };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Failed to delete purchase');
    }
  }
}

export const purchasesService = new PurchasesService();
