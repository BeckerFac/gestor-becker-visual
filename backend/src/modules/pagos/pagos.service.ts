import { db } from '../../config/db';
import { sql } from 'drizzle-orm';
import { ApiError } from '../../middlewares/errorHandler';
import { v4 as uuid } from 'uuid';

export class PagosService {
  private tablesEnsured = false;

  async ensureTables() {
    if (this.tablesEnsured) return;
    try {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS pagos (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
          enterprise_id UUID REFERENCES enterprises(id),
          purchase_id UUID REFERENCES purchases(id),
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
      console.error('Ensure pagos tables error:', error);
    }
  }

  async getPagos(companyId: string, filters: { enterprise_id?: string } = {}) {
    await this.ensureTables();
    try {
      let whereClause = sql`p.company_id = ${companyId}`;
      if (filters.enterprise_id) {
        whereClause = sql`${whereClause} AND p.enterprise_id = ${filters.enterprise_id}`;
      }

      const result = await db.execute(sql`
        SELECT p.*,
          e.name as enterprise_name,
          pu.purchase_number,
          b.bank_name,
          COALESCE((SELECT json_agg(json_build_object('id',t.id,'name',t.name,'color',t.color))
            FROM entity_tags et JOIN tags t ON et.tag_id=t.id
            WHERE et.entity_id=e.id AND et.entity_type='enterprise'),'[]'::json) as enterprise_tags
        FROM pagos p
        LEFT JOIN enterprises e ON p.enterprise_id = e.id
        LEFT JOIN purchases pu ON p.purchase_id = pu.id
        LEFT JOIN banks b ON p.bank_id = b.id
        WHERE ${whereClause}
        ORDER BY p.payment_date DESC
      `);
      return (result as any).rows || result || [];
    } catch (error) {
      throw new ApiError(500, 'Failed to get pagos');
    }
  }

  async createPago(companyId: string, userId: string, data: any) {
    await this.ensureTables();

    const methodsRequiringBank = ['transferencia', 'cheque'];
    if (methodsRequiringBank.includes(data.payment_method) && !data.bank_id) {
      throw new ApiError(400, 'Se requiere seleccionar un banco para transferencia o cheque');
    }

    try {
      const pagoId = uuid();
      await db.execute(sql`
        INSERT INTO pagos (id, company_id, enterprise_id, purchase_id, amount, payment_method, bank_id, reference, payment_date, notes, created_by)
        VALUES (${pagoId}, ${companyId}, ${data.enterprise_id || null}, ${data.purchase_id || null}, ${data.amount}, ${data.payment_method}, ${data.bank_id || null}, ${data.reference || null}, ${data.payment_date || new Date().toISOString()}, ${data.notes || null}, ${userId})
      `);

      const result = await db.execute(sql`
        SELECT p.*, e.name as enterprise_name, pu.purchase_number, b.bank_name,
          COALESCE((SELECT json_agg(json_build_object('id',t.id,'name',t.name,'color',t.color))
            FROM entity_tags et JOIN tags t ON et.tag_id=t.id
            WHERE et.entity_id=e.id AND et.entity_type='enterprise'),'[]'::json) as enterprise_tags
        FROM pagos p
        LEFT JOIN enterprises e ON p.enterprise_id = e.id
        LEFT JOIN purchases pu ON p.purchase_id = pu.id
        LEFT JOIN banks b ON p.bank_id = b.id
        WHERE p.id = ${pagoId}
      `);
      const rows = (result as any).rows || result || [];
      return rows[0];
    } catch (error) {
      console.error('Create pago error:', error);
      throw new ApiError(500, 'Failed to create pago');
    }
  }

  async deletePago(companyId: string, pagoId: string) {
    await this.ensureTables();
    try {
      const check = await db.execute(sql`SELECT id FROM pagos WHERE id = ${pagoId} AND company_id = ${companyId}`);
      const rows = (check as any).rows || check || [];
      if (rows.length === 0) throw new ApiError(404, 'Pago not found');

      await db.execute(sql`DELETE FROM pagos WHERE id = ${pagoId} AND company_id = ${companyId}`);
      return { success: true };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Failed to delete pago');
    }
  }

  async getSummary(companyId: string) {
    await this.ensureTables();
    try {
      const result = await db.execute(sql`
        SELECT COALESCE(SUM(CAST(amount AS decimal)), 0) as total_pagado, COUNT(*) as count
        FROM pagos WHERE company_id = ${companyId}
      `);
      const rows = (result as any).rows || result || [];
      return {
        total_pagado: parseFloat(rows[0]?.total_pagado || '0'),
        count: parseInt(rows[0]?.count || '0'),
      };
    } catch (error) {
      throw new ApiError(500, 'Failed to get pagos summary');
    }
  }
}

export const pagosService = new PagosService();
