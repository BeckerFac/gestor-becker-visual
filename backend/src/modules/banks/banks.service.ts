import { db } from '../../config/db';
import { sql } from 'drizzle-orm';
import { ApiError } from '../../middlewares/errorHandler';
import { v4 as uuid } from 'uuid';

export class BanksService {
  private tablesEnsured = false;

  async ensureTables() {
    if (this.tablesEnsured) return;
    try {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS banks (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
          bank_name VARCHAR(255) NOT NULL,
          account_holder VARCHAR(255),
          account_number VARCHAR(100),
          account_type VARCHAR(50) DEFAULT 'cuenta corriente',
          cbu VARCHAR(30),
          alias VARCHAR(100),
          branch VARCHAR(255),
          notes TEXT,
          status VARCHAR(50) DEFAULT 'active',
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
      `);
      this.tablesEnsured = true;
    } catch (error) {
      console.error('Ensure banks tables error:', error);
    }
  }

  async getBanks(companyId: string) {
    await this.ensureTables();
    try {
      const result = await db.execute(sql`
        SELECT * FROM banks WHERE company_id = ${companyId} ORDER BY bank_name ASC
      `);
      return (result as any).rows || result || [];
    } catch (error) {
      throw new ApiError(500, 'Failed to get banks');
    }
  }

  async createBank(companyId: string, data: any) {
    await this.ensureTables();
    try {
      const bankId = uuid();
      await db.execute(sql`
        INSERT INTO banks (id, company_id, bank_name, account_holder, account_number, account_type, cbu, alias, branch, notes)
        VALUES (${bankId}, ${companyId}, ${data.bank_name}, ${data.account_holder || null}, ${data.account_number || null}, ${data.account_type || 'cuenta corriente'}, ${data.cbu || null}, ${data.alias || null}, ${data.branch || null}, ${data.notes || null})
      `);
      const result = await db.execute(sql`SELECT * FROM banks WHERE id = ${bankId}`);
      const rows = (result as any).rows || result || [];
      return rows[0];
    } catch (error) {
      console.error('Create bank error:', error);
      throw new ApiError(500, 'Failed to create bank');
    }
  }

  async updateBank(companyId: string, bankId: string, data: any) {
    await this.ensureTables();
    try {
      const check = await db.execute(sql`
        SELECT id FROM banks WHERE id = ${bankId} AND company_id = ${companyId}
      `);
      const rows = (check as any).rows || check || [];
      if (rows.length === 0) throw new ApiError(404, 'Bank not found');

      await db.execute(sql`
        UPDATE banks SET
          bank_name = ${data.bank_name},
          account_holder = ${data.account_holder || null},
          account_number = ${data.account_number || null},
          account_type = ${data.account_type || 'cuenta corriente'},
          cbu = ${data.cbu || null},
          alias = ${data.alias || null},
          branch = ${data.branch || null},
          notes = ${data.notes || null},
          updated_at = NOW()
        WHERE id = ${bankId} AND company_id = ${companyId}
      `);

      const result = await db.execute(sql`SELECT * FROM banks WHERE id = ${bankId}`);
      const updated = (result as any).rows || result || [];
      return updated[0];
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Failed to update bank');
    }
  }

  async deleteBank(companyId: string, bankId: string) {
    await this.ensureTables();
    try {
      const check = await db.execute(sql`
        SELECT id FROM banks WHERE id = ${bankId} AND company_id = ${companyId}
      `);
      const rows = (check as any).rows || check || [];
      if (rows.length === 0) throw new ApiError(404, 'Bank not found');

      await db.execute(sql`DELETE FROM banks WHERE id = ${bankId} AND company_id = ${companyId}`);
      return { success: true };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Failed to delete bank');
    }
  }

  async getBreakdown(companyId: string) {
    await this.ensureTables();
    try {
      // Income by payment method (orders paid + cobros)
      const ordersIncome = await db.execute(sql`
        SELECT
          COALESCE(o.payment_method, 'sin_especificar') as payment_method,
          o.bank_id,
          b.bank_name,
          COUNT(*) as count,
          COALESCE(SUM(CAST(o.total_amount AS decimal)), 0) as total
        FROM orders o
        LEFT JOIN banks b ON o.bank_id = b.id
        WHERE o.company_id = ${companyId} AND o.payment_status = 'pagado'
        GROUP BY o.payment_method, o.bank_id, b.bank_name
      `);

      const cobrosIncome = await db.execute(sql`
        SELECT
          COALESCE(c.payment_method, 'sin_especificar') as payment_method,
          c.bank_id,
          b.bank_name,
          COUNT(*) as count,
          COALESCE(SUM(CAST(c.amount AS decimal)), 0) as total
        FROM cobros c
        LEFT JOIN banks b ON c.bank_id = b.id
        WHERE c.company_id = ${companyId}
        GROUP BY c.payment_method, c.bank_id, b.bank_name
      `);

      // Expenses by payment method (purchases paid + pagos)
      const purchasesExpense = await db.execute(sql`
        SELECT
          COALESCE(p.payment_method, 'sin_especificar') as payment_method,
          p.bank_id,
          b.bank_name,
          COUNT(*) as count,
          COALESCE(SUM(CAST(p.total_amount AS decimal)), 0) as total
        FROM purchases p
        LEFT JOIN banks b ON p.bank_id = b.id
        WHERE p.company_id = ${companyId} AND p.payment_status = 'pagado'
        GROUP BY p.payment_method, p.bank_id, b.bank_name
      `);

      const pagosExpense = await db.execute(sql`
        SELECT
          COALESCE(pg.payment_method, 'sin_especificar') as payment_method,
          pg.bank_id,
          b.bank_name,
          COUNT(*) as count,
          COALESCE(SUM(CAST(pg.amount AS decimal)), 0) as total
        FROM pagos pg
        LEFT JOIN banks b ON pg.bank_id = b.id
        WHERE pg.company_id = ${companyId}
        GROUP BY pg.payment_method, pg.bank_id, b.bank_name
      `);

      // Recent movements (last 20)
      const recentMovements = await db.execute(sql`
        (
          SELECT 'cobro' as type, c.payment_method, c.bank_id, b.bank_name, CAST(c.amount AS decimal) as amount, c.payment_date as date, c.reference as detail, e.name as enterprise_name
          FROM cobros c LEFT JOIN banks b ON c.bank_id = b.id LEFT JOIN enterprises e ON c.enterprise_id = e.id
          WHERE c.company_id = ${companyId}
        )
        UNION ALL
        (
          SELECT 'pago' as type, pg.payment_method, pg.bank_id, b.bank_name, CAST(pg.amount AS decimal) as amount, pg.payment_date as date, pg.reference as detail, e.name as enterprise_name
          FROM pagos pg LEFT JOIN banks b ON pg.bank_id = b.id LEFT JOIN enterprises e ON pg.enterprise_id = e.id
          WHERE pg.company_id = ${companyId}
        )
        UNION ALL
        (
          SELECT 'venta' as type, o.payment_method, o.bank_id, b.bank_name, CAST(o.total_amount AS decimal) as amount, o.created_at as date, o.title as detail, ent.name as enterprise_name
          FROM orders o LEFT JOIN banks b ON o.bank_id = b.id LEFT JOIN enterprises ent ON o.enterprise_id = ent.id
          WHERE o.company_id = ${companyId} AND o.payment_status = 'pagado'
        )
        UNION ALL
        (
          SELECT 'compra' as type, p.payment_method, p.bank_id, b.bank_name, CAST(p.total_amount AS decimal) as amount, p.date as date, CAST(p.purchase_number AS TEXT) as detail, e.name as enterprise_name
          FROM purchases p LEFT JOIN banks b ON p.bank_id = b.id LEFT JOIN enterprises e ON p.enterprise_id = e.id
          WHERE p.company_id = ${companyId} AND p.payment_status = 'pagado'
        )
        ORDER BY date DESC LIMIT 20
      `);

      const ordersRows = (ordersIncome as any).rows || ordersIncome || [];
      const cobrosRows = (cobrosIncome as any).rows || cobrosIncome || [];
      const purchasesRows = (purchasesExpense as any).rows || purchasesExpense || [];
      const pagosRows = (pagosExpense as any).rows || pagosExpense || [];
      const movementsRows = (recentMovements as any).rows || recentMovements || [];

      // Aggregate into method groups
      const methods: Record<string, { income: number; income_count: number; expense: number; expense_count: number; bank_details: Record<string, { bank_name: string; income: number; expense: number }> }> = {};

      const ensureMethod = (m: string) => {
        if (!methods[m]) methods[m] = { income: 0, income_count: 0, expense: 0, expense_count: 0, bank_details: {} };
      };
      const ensureBank = (m: string, bankId: string | null, bankName: string | null) => {
        if (!bankId) return;
        if (!methods[m].bank_details[bankId]) methods[m].bank_details[bankId] = { bank_name: bankName || 'Sin nombre', income: 0, expense: 0 };
      };

      for (const r of ordersRows) {
        const m = r.payment_method || 'sin_especificar';
        ensureMethod(m);
        methods[m].income += parseFloat(r.total || '0');
        methods[m].income_count += parseInt(r.count || '0');
        if (r.bank_id) { ensureBank(m, r.bank_id, r.bank_name); methods[m].bank_details[r.bank_id].income += parseFloat(r.total || '0'); }
      }
      for (const r of cobrosRows) {
        const m = r.payment_method || 'sin_especificar';
        ensureMethod(m);
        methods[m].income += parseFloat(r.total || '0');
        methods[m].income_count += parseInt(r.count || '0');
        if (r.bank_id) { ensureBank(m, r.bank_id, r.bank_name); methods[m].bank_details[r.bank_id].income += parseFloat(r.total || '0'); }
      }
      for (const r of purchasesRows) {
        const m = r.payment_method || 'sin_especificar';
        ensureMethod(m);
        methods[m].expense += parseFloat(r.total || '0');
        methods[m].expense_count += parseInt(r.count || '0');
        if (r.bank_id) { ensureBank(m, r.bank_id, r.bank_name); methods[m].bank_details[r.bank_id].expense += parseFloat(r.total || '0'); }
      }
      for (const r of pagosRows) {
        const m = r.payment_method || 'sin_especificar';
        ensureMethod(m);
        methods[m].expense += parseFloat(r.total || '0');
        methods[m].expense_count += parseInt(r.count || '0');
        if (r.bank_id) { ensureBank(m, r.bank_id, r.bank_name); methods[m].bank_details[r.bank_id].expense += parseFloat(r.total || '0'); }
      }

      return { methods, recent_movements: movementsRows };
    } catch (error) {
      console.error('Bank breakdown error:', error);
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Failed to get bank breakdown');
    }
  }
}

export const banksService = new BanksService();
