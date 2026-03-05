import { db } from '../../config/db';
import { sql } from 'drizzle-orm';
import { ApiError } from '../../middlewares/errorHandler';
import { v4 as uuid } from 'uuid';

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
          b.bank_name
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
            INSERT INTO purchase_items (id, purchase_id, product_name, description, quantity, unit_price, subtotal)
            VALUES (${itemId}, ${purchaseId}, ${item.product_name}, ${item.description || null}, ${item.quantity || 1}, ${item.unit_price || 0}, ${subtotal})
          `);
        }
      }

      return await this.getPurchase(companyId, purchaseId);
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
