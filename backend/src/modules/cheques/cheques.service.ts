import { db } from '../../config/db';
import { sql } from 'drizzle-orm';
import { ApiError } from '../../middlewares/errorHandler';
import { v4 as uuid } from 'uuid';

const VALID_TRANSITIONS: Record<string, string[]> = {
  a_cobrar: ['endosado', 'depositado', 'cobrado', 'rechazado'],
  endosado: ['cobrado', 'rechazado', 'a_cobrar'],
  depositado: ['cobrado', 'rechazado', 'a_cobrar'],
  rechazado: ['a_cobrar'],
  cobrado: ['a_cobrar'],
};

export class ChequesService {
  async getCheques(companyId: string, filters: { status?: string; search?: string; due_from?: string; due_to?: string } = {}) {
    try {
      let whereClause = sql`c.company_id = ${companyId}`;
      if (filters.status && filters.status !== 'todos') {
        whereClause = sql`${whereClause} AND c.status = ${filters.status}`;
      }
      if (filters.search) {
        const searchTerm = `%${filters.search}%`;
        whereClause = sql`${whereClause} AND (c.number ILIKE ${searchTerm} OR c.bank ILIKE ${searchTerm} OR c.drawer ILIKE ${searchTerm} OR cu.name ILIKE ${searchTerm})`;
      }
      if (filters.due_from) {
        whereClause = sql`${whereClause} AND c.due_date >= ${filters.due_from}`;
      }
      if (filters.due_to) {
        whereClause = sql`${whereClause} AND c.due_date <= ${filters.due_to}`;
      }

      const result = await db.execute(sql`
        SELECT c.*, c.customer_id, cu.name as customer_name, o.order_number
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

  async updateChequeStatus(companyId: string, chequeId: string, newStatus: string, userId?: string, notes?: string) {
    try {
      const validStatuses = ['a_cobrar', 'endosado', 'depositado', 'cobrado', 'rechazado'];
      if (!validStatuses.includes(newStatus)) {
        throw new ApiError(400, 'Estado invalido');
      }

      const result = await db.execute(sql`
        SELECT id, status FROM cheques WHERE id = ${chequeId} AND company_id = ${companyId}
      `);
      const rows = (result as any).rows || result || [];
      if (rows.length === 0) throw new ApiError(404, 'Cheque not found');

      const currentStatus = rows[0].status;
      const allowedTransitions = VALID_TRANSITIONS[currentStatus] || [];
      if (!allowedTransitions.includes(newStatus)) {
        throw new ApiError(400, `No se puede cambiar de "${currentStatus}" a "${newStatus}"`);
      }

      // Record history
      await db.execute(sql`
        INSERT INTO cheque_status_history (cheque_id, old_status, new_status, notes, changed_by)
        VALUES (${chequeId}, ${currentStatus}, ${newStatus}, ${notes || null}, ${userId || null})
      `);

      // Update collected_date based on status
      if (newStatus === 'cobrado') {
        await db.execute(sql`
          UPDATE cheques SET status = ${newStatus}, collected_date = NOW()
          WHERE id = ${chequeId}
        `);
      } else if (newStatus === 'a_cobrar') {
        await db.execute(sql`
          UPDATE cheques SET status = ${newStatus}, collected_date = NULL
          WHERE id = ${chequeId}
        `);
      } else {
        await db.execute(sql`
          UPDATE cheques SET status = ${newStatus}
          WHERE id = ${chequeId}
        `);
      }

      return { id: chequeId, status: newStatus };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Failed to update cheque status');
    }
  }

  async updateCheque(companyId: string, chequeId: string, data: any) {
    try {
      const result = await db.execute(sql`
        SELECT id, status FROM cheques WHERE id = ${chequeId} AND company_id = ${companyId}
      `);
      const rows = (result as any).rows || result || [];
      if (rows.length === 0) throw new ApiError(404, 'Cheque not found');
      if (rows[0].status !== 'a_cobrar') {
        throw new ApiError(400, 'Solo se pueden editar cheques pendientes');
      }

      await db.execute(sql`
        UPDATE cheques SET
          number = ${data.number},
          bank = ${data.bank},
          drawer = ${data.drawer},
          amount = ${data.amount.toString()},
          issue_date = ${new Date(data.issue_date)},
          due_date = ${new Date(data.due_date)},
          customer_id = ${data.customer_id || null},
          notes = ${data.notes || null}
        WHERE id = ${chequeId} AND company_id = ${companyId}
      `);

      return { id: chequeId, updated: true };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      console.error('Update cheque error:', error);
      throw new ApiError(500, 'Failed to update cheque');
    }
  }

  async deleteCheque(companyId: string, chequeId: string) {
    try {
      const result = await db.execute(sql`
        SELECT id, status FROM cheques WHERE id = ${chequeId} AND company_id = ${companyId}
      `);
      const rows = (result as any).rows || result || [];
      if (rows.length === 0) throw new ApiError(404, 'Cheque not found');
      if (rows[0].status !== 'a_cobrar') {
        throw new ApiError(400, 'Solo se pueden eliminar cheques pendientes');
      }

      await db.execute(sql`
        DELETE FROM cheques WHERE id = ${chequeId} AND company_id = ${companyId}
      `);

      return { id: chequeId, deleted: true };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      console.error('Delete cheque error:', error);
      throw new ApiError(500, 'Failed to delete cheque');
    }
  }

  async getStatusHistory(companyId: string, chequeId: string) {
    try {
      // Verify cheque belongs to company
      const chequeResult = await db.execute(sql`
        SELECT id FROM cheques WHERE id = ${chequeId} AND company_id = ${companyId}
      `);
      const chequeRows = (chequeResult as any).rows || chequeResult || [];
      if (chequeRows.length === 0) throw new ApiError(404, 'Cheque not found');

      const result = await db.execute(sql`
        SELECT h.*, u.name as changed_by_name
        FROM cheque_status_history h
        LEFT JOIN users u ON h.changed_by = u.id
        WHERE h.cheque_id = ${chequeId}
        ORDER BY h.created_at DESC
      `);
      return (result as any).rows || result || [];
    } catch (error) {
      if (error instanceof ApiError) throw error;
      console.error('Get status history error:', error);
      throw new ApiError(500, 'Failed to get cheque status history');
    }
  }

  async getSummary(companyId: string) {
    try {
      const result = await db.execute(sql`
        SELECT
          COALESCE(SUM(CASE WHEN status = 'a_cobrar' THEN CAST(amount AS decimal) ELSE 0 END), 0) as total_a_cobrar,
          COALESCE(SUM(CASE WHEN status = 'cobrado' THEN CAST(amount AS decimal) ELSE 0 END), 0) as total_cobrado,
          COALESCE(SUM(CASE WHEN status = 'endosado' THEN CAST(amount AS decimal) ELSE 0 END), 0) as total_endosado,
          COALESCE(SUM(CASE WHEN status = 'depositado' THEN CAST(amount AS decimal) ELSE 0 END), 0) as total_depositado,
          COALESCE(SUM(CASE WHEN status = 'rechazado' THEN CAST(amount AS decimal) ELSE 0 END), 0) as total_rechazado,
          COUNT(*) FILTER (WHERE status = 'a_cobrar') as count_a_cobrar,
          COUNT(*) FILTER (WHERE status = 'cobrado') as count_cobrado,
          COUNT(*) FILTER (WHERE status = 'endosado') as count_endosado,
          COUNT(*) FILTER (WHERE status = 'depositado') as count_depositado,
          COUNT(*) FILTER (WHERE status = 'rechazado') as count_rechazado,
          COUNT(*) FILTER (WHERE status = 'a_cobrar' AND due_date::date < NOW()::date) as vencidos_count,
          COALESCE(SUM(CASE WHEN status = 'a_cobrar' AND due_date::date < NOW()::date THEN CAST(amount AS decimal) ELSE 0 END), 0) as vencidos_amount,
          COUNT(*) FILTER (WHERE status = 'a_cobrar' AND due_date::date BETWEEN NOW()::date AND (NOW()::date + 7)) as vencen_semana_count,
          COALESCE(SUM(CASE WHEN status = 'a_cobrar' AND due_date::date BETWEEN NOW()::date AND (NOW()::date + 7) THEN CAST(amount AS decimal) ELSE 0 END), 0) as vencen_semana_amount
        FROM cheques
        WHERE company_id = ${companyId}
      `);
      const rows = (result as any).rows || result || [];
      const row = rows[0] || {};
      return {
        total_a_cobrar: parseFloat(row.total_a_cobrar || '0'),
        total_cobrado: parseFloat(row.total_cobrado || '0'),
        total_endosado: parseFloat(row.total_endosado || '0'),
        total_depositado: parseFloat(row.total_depositado || '0'),
        total_rechazado: parseFloat(row.total_rechazado || '0'),
        count_a_cobrar: parseInt(row.count_a_cobrar || '0'),
        count_cobrado: parseInt(row.count_cobrado || '0'),
        count_endosado: parseInt(row.count_endosado || '0'),
        count_depositado: parseInt(row.count_depositado || '0'),
        count_rechazado: parseInt(row.count_rechazado || '0'),
        vencidos_count: parseInt(row.vencidos_count || '0'),
        vencidos_amount: parseFloat(row.vencidos_amount || '0'),
        vencen_semana_count: parseInt(row.vencen_semana_count || '0'),
        vencen_semana_amount: parseFloat(row.vencen_semana_amount || '0'),
      };
    } catch (error) {
      throw new ApiError(500, 'Failed to get cheques summary');
    }
  }
}

export const chequesService = new ChequesService();
