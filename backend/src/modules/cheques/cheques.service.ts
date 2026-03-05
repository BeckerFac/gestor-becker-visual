import { db } from '../../config/db';
import { sql } from 'drizzle-orm';
import { ApiError } from '../../middlewares/errorHandler';
import { v4 as uuid } from 'uuid';

export class ChequesService {
  async getCheques(companyId: string, filters: { status?: string } = {}) {
    try {
      let whereClause = sql`c.company_id = ${companyId}`;
      if (filters.status && filters.status !== 'todos') {
        whereClause = sql`${whereClause} AND c.status = ${filters.status}`;
      }

      const result = await db.execute(sql`
        SELECT c.*, cu.name as customer_name, o.order_number
        FROM cheques c
        LEFT JOIN customers cu ON c.customer_id = cu.id
        LEFT JOIN orders o ON c.order_id = o.id
        WHERE ${whereClause}
        ORDER BY c.due_date ASC
      `);
      return (result as any).rows || result || [];
    } catch (error) {
      console.error('Get cheques error:', error);
      throw new ApiError(500, 'Failed to get cheques');
    }
  }

  async createCheque(companyId: string, userId: string, data: any) {
    try {
      const chequeId = uuid();
      await db.execute(sql`
        INSERT INTO cheques (id, company_id, number, bank, drawer, amount, issue_date, due_date, status, customer_id, order_id, notes, created_by)
        VALUES (${chequeId}, ${companyId}, ${data.number}, ${data.bank}, ${data.drawer}, ${data.amount.toString()}, ${new Date(data.issue_date)}, ${new Date(data.due_date)}, 'a_cobrar', ${data.customer_id || null}, ${data.order_id || null}, ${data.notes || null}, ${userId})
      `);
      return { id: chequeId, status: 'a_cobrar' };
    } catch (error) {
      console.error('Create cheque error:', error);
      throw new ApiError(500, 'Failed to create cheque');
    }
  }

  async updateChequeStatus(companyId: string, chequeId: string, newStatus: string) {
    try {
      if (!['a_cobrar', 'cobrado'].includes(newStatus)) {
        throw new ApiError(400, 'Invalid status');
      }

      const result = await db.execute(sql`
        SELECT id FROM cheques WHERE id = ${chequeId} AND company_id = ${companyId}
      `);
      const rows = (result as any).rows || result || [];
      if (rows.length === 0) throw new ApiError(404, 'Cheque not found');

      const collectedDate = newStatus === 'cobrado' ? sql`NOW()` : sql`NULL`;
      await db.execute(sql`
        UPDATE cheques SET status = ${newStatus}, collected_date = ${collectedDate}
        WHERE id = ${chequeId}
      `);

      return { id: chequeId, status: newStatus };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Failed to update cheque status');
    }
  }

  async getSummary(companyId: string) {
    try {
      const result = await db.execute(sql`
        SELECT
          COALESCE(SUM(CASE WHEN status = 'a_cobrar' THEN CAST(amount AS decimal) ELSE 0 END), 0) as total_a_cobrar,
          COALESCE(SUM(CASE WHEN status = 'cobrado' THEN CAST(amount AS decimal) ELSE 0 END), 0) as total_cobrado,
          COUNT(*) FILTER (WHERE status = 'a_cobrar') as count_a_cobrar,
          COUNT(*) FILTER (WHERE status = 'cobrado') as count_cobrado
        FROM cheques
        WHERE company_id = ${companyId}
      `);
      const rows = (result as any).rows || result || [];
      const row = rows[0] || {};
      return {
        total_a_cobrar: parseFloat(row.total_a_cobrar || '0'),
        total_cobrado: parseFloat(row.total_cobrado || '0'),
        count_a_cobrar: parseInt(row.count_a_cobrar || '0'),
        count_cobrado: parseInt(row.count_cobrado || '0'),
      };
    } catch (error) {
      throw new ApiError(500, 'Failed to get cheques summary');
    }
  }
}

export const chequesService = new ChequesService();
