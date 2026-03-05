import { db } from '../../config/db';
import { sql } from 'drizzle-orm';
import { ApiError } from '../../middlewares/errorHandler';
import { v4 as uuid } from 'uuid';

export class CobrosService {
  private tablesEnsured = false;

  async ensureTables() {
    if (this.tablesEnsured) return;
    try {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS cobros (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
          enterprise_id UUID REFERENCES enterprises(id),
          order_id UUID REFERENCES orders(id),
          invoice_id UUID REFERENCES invoices(id),
          amount DECIMAL(12,2) NOT NULL,
          payment_method VARCHAR(50) NOT NULL,
          bank_id UUID REFERENCES banks(id),
          reference VARCHAR(255),
          payment_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          notes TEXT,
          created_by UUID REFERENCES users(id),
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
      `);
      this.tablesEnsured = true;
    } catch (error) {
      console.error('Ensure cobros tables error:', error);
    }
  }

  async getCobros(companyId: string, filters: { enterprise_id?: string } = {}) {
    await this.ensureTables();
    try {
      let whereClause = sql`c.company_id = ${companyId}`;
      if (filters.enterprise_id) {
        whereClause = sql`${whereClause} AND c.enterprise_id = ${filters.enterprise_id}`;
      }

      const result = await db.execute(sql`
        SELECT c.*,
          e.name as enterprise_name,
          o.order_number, o.title as order_title,
          b.bank_name
        FROM cobros c
        LEFT JOIN enterprises e ON c.enterprise_id = e.id
        LEFT JOIN orders o ON c.order_id = o.id
        LEFT JOIN banks b ON c.bank_id = b.id
        WHERE ${whereClause}
        ORDER BY c.payment_date DESC
      `);
      return (result as any).rows || result || [];
    } catch (error) {
      throw new ApiError(500, 'Failed to get cobros');
    }
  }

  async createCobro(companyId: string, userId: string, data: any) {
    await this.ensureTables();

    const methodsRequiringBank = ['transferencia', 'cheque'];
    if (methodsRequiringBank.includes(data.payment_method) && !data.bank_id) {
      throw new ApiError(400, 'Se requiere seleccionar un banco para transferencia o cheque');
    }

    try {
      const cobroId = uuid();
      await db.execute(sql`
        INSERT INTO cobros (id, company_id, enterprise_id, order_id, invoice_id, amount, payment_method, bank_id, reference, payment_date, notes, created_by)
        VALUES (${cobroId}, ${companyId}, ${data.enterprise_id || null}, ${data.order_id || null}, ${data.invoice_id || null}, ${data.amount}, ${data.payment_method}, ${data.bank_id || null}, ${data.reference || null}, ${data.payment_date || new Date().toISOString()}, ${data.notes || null}, ${userId})
      `);

      const result = await db.execute(sql`
        SELECT c.*, e.name as enterprise_name, o.order_number, b.bank_name
        FROM cobros c
        LEFT JOIN enterprises e ON c.enterprise_id = e.id
        LEFT JOIN orders o ON c.order_id = o.id
        LEFT JOIN banks b ON c.bank_id = b.id
        WHERE c.id = ${cobroId}
      `);
      const rows = (result as any).rows || result || [];
      return rows[0];
    } catch (error) {
      console.error('Create cobro error:', error);
      throw new ApiError(500, 'Failed to create cobro');
    }
  }

  async deleteCobro(companyId: string, cobroId: string) {
    await this.ensureTables();
    try {
      const check = await db.execute(sql`SELECT id FROM cobros WHERE id = ${cobroId} AND company_id = ${companyId}`);
      const rows = (check as any).rows || check || [];
      if (rows.length === 0) throw new ApiError(404, 'Cobro not found');

      await db.execute(sql`DELETE FROM cobros WHERE id = ${cobroId} AND company_id = ${companyId}`);
      return { success: true };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Failed to delete cobro');
    }
  }

  async getSummary(companyId: string) {
    await this.ensureTables();
    try {
      const result = await db.execute(sql`
        SELECT COALESCE(SUM(CAST(amount AS decimal)), 0) as total_cobrado, COUNT(*) as count
        FROM cobros WHERE company_id = ${companyId}
      `);
      const rows = (result as any).rows || result || [];
      return {
        total_cobrado: parseFloat(rows[0]?.total_cobrado || '0'),
        count: parseInt(rows[0]?.count || '0'),
      };
    } catch (error) {
      throw new ApiError(500, 'Failed to get cobros summary');
    }
  }
}

export const cobrosService = new CobrosService();
