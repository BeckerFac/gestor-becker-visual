import { db } from '../../config/db';
import { sql } from 'drizzle-orm';
import { ApiError } from '../../middlewares/errorHandler';
import { v4 as uuid } from 'uuid';

export class ReceiptsService {
  private migrationsRun = false;

  async ensureMigrations() {
    if (this.migrationsRun) return;
    try {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS receipts (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
          receipt_number INTEGER NOT NULL,
          receipt_date TIMESTAMP WITH TIME ZONE NOT NULL,
          total_amount DECIMAL(12,2) NOT NULL,
          payment_method VARCHAR(50),
          notes TEXT,
          created_by UUID REFERENCES users(id),
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
      `);
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS receipt_items (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          receipt_id UUID NOT NULL REFERENCES receipts(id) ON DELETE CASCADE,
          invoice_id UUID NOT NULL REFERENCES invoices(id),
          amount DECIMAL(12,2) NOT NULL,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
      `);
      this.migrationsRun = true;
    } catch (error) {
      console.error('Receipts migrations error:', error);
    }
  }

  async getReceipts(companyId: string) {
    await this.ensureMigrations();
    try {
      const result = await db.execute(sql`
        SELECT r.*,
          COALESCE(
            (SELECT json_agg(json_build_object(
              'id', ri.id,
              'invoice_id', ri.invoice_id,
              'amount', ri.amount,
              'invoice_number', i.invoice_number,
              'invoice_type', i.invoice_type,
              'invoice_total', i.total_amount,
              'fiscal_type', i.fiscal_type,
              'enterprise_name', COALESCE(e.name, ''),
              'customer_name', COALESCE(c.name, 'Consumidor Final')
            ) ORDER BY ri.created_at)
            FROM receipt_items ri
            JOIN invoices i ON ri.invoice_id = i.id
            LEFT JOIN enterprises e ON i.enterprise_id = e.id
            LEFT JOIN customers c ON i.customer_id = c.id
            WHERE ri.receipt_id = r.id),
            '[]'::json
          ) as items
        FROM receipts r
        WHERE r.company_id = ${companyId}
        ORDER BY r.created_at DESC
      `);
      return (result as any).rows || result || [];
    } catch (error) {
      console.error('Get receipts error:', error);
      throw new ApiError(500, 'Failed to get receipts');
    }
  }

  async createReceipt(companyId: string, userId: string, data: any) {
    await this.ensureMigrations();
    try {
      const { receipt_date, payment_method, notes, items } = data;

      if (!items || !Array.isArray(items) || items.length === 0) {
        throw new ApiError(400, 'El recibo debe tener al menos un item');
      }

      // Validate all items have invoice_id and amount > 0
      for (const item of items) {
        if (!item.invoice_id) throw new ApiError(400, 'Cada item debe tener una factura asociada');
        if (!item.amount || parseFloat(item.amount) <= 0) throw new ApiError(400, 'Cada item debe tener un monto mayor a 0');
      }

      // Auto-generate receipt_number
      const maxResult = await db.execute(sql`
        SELECT COALESCE(MAX(receipt_number), 0) + 1 as next_number
        FROM receipts WHERE company_id = ${companyId}
      `);
      const rows = (maxResult as any).rows || maxResult || [];
      const receiptNumber = parseInt(rows[0]?.next_number || '1');

      // Calculate total from items
      const totalAmount = items.reduce((sum: number, item: any) => sum + parseFloat(item.amount), 0);

      const receiptId = uuid();

      await db.execute(sql`
        INSERT INTO receipts (id, company_id, receipt_number, receipt_date, total_amount, payment_method, notes, created_by, created_at)
        VALUES (${receiptId}, ${companyId}, ${receiptNumber}, ${receipt_date || new Date().toISOString()}, ${totalAmount.toFixed(2)}, ${payment_method || null}, ${notes || null}, ${userId}, NOW())
      `);

      // Create receipt items and corresponding cobros entries
      for (const item of items) {
        const itemId = uuid();
        await db.execute(sql`
          INSERT INTO receipt_items (id, receipt_id, invoice_id, amount, created_at)
          VALUES (${itemId}, ${receiptId}, ${item.invoice_id}, ${parseFloat(item.amount).toFixed(2)}, NOW())
        `);

        // Also create a cobro linked to the invoice
        const cobroId = uuid();
        // Get enterprise_id and order_id from invoice
        const invResult = await db.execute(sql`
          SELECT enterprise_id, order_id FROM invoices WHERE id = ${item.invoice_id}
        `);
        const invRows = (invResult as any).rows || invResult || [];
        const enterpriseId = invRows[0]?.enterprise_id || null;
        const orderId = invRows[0]?.order_id || null;

        await db.execute(sql`
          INSERT INTO cobros (id, company_id, enterprise_id, order_id, invoice_id, amount, payment_method, reference, payment_date, notes, created_by, created_at)
          VALUES (${cobroId}, ${companyId}, ${enterpriseId}, ${orderId}, ${item.invoice_id}, ${parseFloat(item.amount).toFixed(2)}, ${payment_method || 'efectivo'}, ${`Recibo #${receiptNumber}`}, ${receipt_date || new Date().toISOString()}, ${notes || null}, ${userId}, NOW())
        `);
      }

      return { id: receiptId, receipt_number: receiptNumber, total_amount: totalAmount };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      console.error('Create receipt error:', error);
      throw new ApiError(500, 'Failed to create receipt');
    }
  }

  async deleteReceipt(companyId: string, receiptId: string) {
    await this.ensureMigrations();
    try {
      // Verify receipt exists
      const check = await db.execute(sql`
        SELECT id, receipt_number FROM receipts WHERE id = ${receiptId} AND company_id = ${companyId}
      `);
      const checkRows = (check as any).rows || check || [];
      if (checkRows.length === 0) throw new ApiError(404, 'Recibo no encontrado');

      const receiptNumber = checkRows[0].receipt_number;

      // Delete associated cobros (those with reference matching the receipt)
      await db.execute(sql`
        DELETE FROM cobros WHERE company_id = ${companyId} AND reference = ${`Recibo #${receiptNumber}`}
          AND invoice_id IN (SELECT invoice_id FROM receipt_items WHERE receipt_id = ${receiptId})
      `);

      // Delete receipt items (cascade should handle it, but be explicit)
      await db.execute(sql`DELETE FROM receipt_items WHERE receipt_id = ${receiptId}`);

      // Delete receipt
      await db.execute(sql`DELETE FROM receipts WHERE id = ${receiptId} AND company_id = ${companyId}`);

      return { deleted: true };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      console.error('Delete receipt error:', error);
      throw new ApiError(500, 'Failed to delete receipt');
    }
  }
}

export const receiptsService = new ReceiptsService();
