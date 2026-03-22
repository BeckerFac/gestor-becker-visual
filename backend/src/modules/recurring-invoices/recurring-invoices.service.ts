import { db } from '../../config/db';
import { sql } from 'drizzle-orm';
import { ApiError } from '../../middlewares/errorHandler';
import { v4 as uuid } from 'uuid';

export class RecurringInvoicesService {
  private migrationsRun = false;

  async ensureMigrations() {
    if (this.migrationsRun) return;
    try {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS recurring_invoices (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
          enterprise_id UUID REFERENCES enterprises(id),
          customer_id UUID REFERENCES customers(id),
          invoice_type VARCHAR(5) NOT NULL,
          frequency VARCHAR(20) NOT NULL DEFAULT 'monthly',
          amount DECIMAL(12,2) NOT NULL,
          description TEXT,
          next_invoice_date DATE NOT NULL,
          end_date DATE,
          active BOOLEAN DEFAULT true,
          auto_authorize BOOLEAN DEFAULT false,
          items JSONB,
          created_by UUID REFERENCES users(id),
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
      `);
      this.migrationsRun = true;
    } catch (error) {
      console.error('Recurring invoices migrations error:', error);
    }
  }

  async list(companyId: string) {
    await this.ensureMigrations();
    try {
      const result = await db.execute(sql`
        SELECT ri.*,
          e.name as enterprise_name,
          c.name as customer_name
        FROM recurring_invoices ri
        LEFT JOIN enterprises e ON ri.enterprise_id = e.id
        LEFT JOIN customers c ON ri.customer_id = c.id
        WHERE ri.company_id = ${companyId}
        ORDER BY ri.active DESC, ri.next_invoice_date ASC
      `);
      return (result as any).rows || result || [];
    } catch (error) {
      console.error('List recurring invoices error:', error);
      throw new ApiError(500, 'Error al obtener facturas recurrentes');
    }
  }

  async create(companyId: string, userId: string, data: any) {
    await this.ensureMigrations();
    try {
      const {
        enterprise_id,
        customer_id,
        invoice_type,
        frequency,
        amount,
        description,
        next_invoice_date,
        end_date,
        auto_authorize,
        items,
      } = data;

      if (!invoice_type) throw new ApiError(400, 'Tipo de factura requerido');
      if (!amount || parseFloat(amount) <= 0) throw new ApiError(400, 'Monto debe ser mayor a 0');
      if (!next_invoice_date) throw new ApiError(400, 'Fecha de proxima factura requerida');
      if (!frequency) throw new ApiError(400, 'Frecuencia requerida');

      const validFrequencies = ['weekly', 'biweekly', 'monthly', 'quarterly', 'yearly'];
      if (!validFrequencies.includes(frequency)) {
        throw new ApiError(400, `Frecuencia invalida. Opciones: ${validFrequencies.join(', ')}`);
      }

      const id = uuid();
      await db.execute(sql`
        INSERT INTO recurring_invoices (id, company_id, enterprise_id, customer_id, invoice_type, frequency, amount, description, next_invoice_date, end_date, auto_authorize, items, created_by, created_at, updated_at)
        VALUES (${id}, ${companyId}, ${enterprise_id || null}, ${customer_id || null}, ${invoice_type}, ${frequency}, ${parseFloat(amount).toFixed(2)}, ${description || null}, ${next_invoice_date}, ${end_date || null}, ${auto_authorize || false}, ${items ? JSON.stringify(items) : null}::jsonb, ${userId}, NOW(), NOW())
      `);

      return { id, message: 'Factura recurrente creada' };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      console.error('Create recurring invoice error:', error);
      throw new ApiError(500, 'Error al crear factura recurrente');
    }
  }

  async update(companyId: string, id: string, data: any) {
    await this.ensureMigrations();
    try {
      // Verify ownership
      const check = await db.execute(sql`
        SELECT id FROM recurring_invoices WHERE id = ${id} AND company_id = ${companyId}
      `);
      const rows = (check as any).rows || check || [];
      if (rows.length === 0) throw new ApiError(404, 'Factura recurrente no encontrada');

      const {
        enterprise_id,
        customer_id,
        invoice_type,
        frequency,
        amount,
        description,
        next_invoice_date,
        end_date,
        auto_authorize,
        items,
        active,
      } = data;

      await db.execute(sql`
        UPDATE recurring_invoices SET
          enterprise_id = COALESCE(${enterprise_id ?? null}, enterprise_id),
          customer_id = COALESCE(${customer_id ?? null}, customer_id),
          invoice_type = COALESCE(${invoice_type ?? null}, invoice_type),
          frequency = COALESCE(${frequency ?? null}, frequency),
          amount = COALESCE(${amount ? parseFloat(amount).toFixed(2) : null}, amount),
          description = COALESCE(${description ?? null}, description),
          next_invoice_date = COALESCE(${next_invoice_date ?? null}, next_invoice_date),
          end_date = ${end_date ?? null},
          auto_authorize = COALESCE(${auto_authorize ?? null}, auto_authorize),
          items = COALESCE(${items ? JSON.stringify(items) : null}::jsonb, items),
          active = COALESCE(${active ?? null}, active),
          updated_at = NOW()
        WHERE id = ${id} AND company_id = ${companyId}
      `);

      return { id, message: 'Factura recurrente actualizada' };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      console.error('Update recurring invoice error:', error);
      throw new ApiError(500, 'Error al actualizar factura recurrente');
    }
  }

  async deactivate(companyId: string, id: string) {
    await this.ensureMigrations();
    try {
      const check = await db.execute(sql`
        SELECT id FROM recurring_invoices WHERE id = ${id} AND company_id = ${companyId}
      `);
      const rows = (check as any).rows || check || [];
      if (rows.length === 0) throw new ApiError(404, 'Factura recurrente no encontrada');

      await db.execute(sql`
        UPDATE recurring_invoices SET active = false, updated_at = NOW()
        WHERE id = ${id} AND company_id = ${companyId}
      `);

      return { id, message: 'Factura recurrente desactivada' };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      console.error('Deactivate recurring invoice error:', error);
      throw new ApiError(500, 'Error al desactivar factura recurrente');
    }
  }

  async delete(companyId: string, id: string) {
    await this.ensureMigrations();
    try {
      const check = await db.execute(sql`
        SELECT id FROM recurring_invoices WHERE id = ${id} AND company_id = ${companyId}
      `);
      const rows = (check as any).rows || check || [];
      if (rows.length === 0) throw new ApiError(404, 'Factura recurrente no encontrada');

      await db.execute(sql`
        DELETE FROM recurring_invoices WHERE id = ${id} AND company_id = ${companyId}
      `);

      return { deleted: true };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      console.error('Delete recurring invoice error:', error);
      throw new ApiError(500, 'Error al eliminar factura recurrente');
    }
  }
}

export const recurringInvoicesService = new RecurringInvoicesService();
