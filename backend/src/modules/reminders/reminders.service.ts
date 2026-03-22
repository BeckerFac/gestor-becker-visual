import { db } from '../../config/db';
import { sql } from 'drizzle-orm';
import { ApiError } from '../../middlewares/errorHandler';
import { v4 as uuid } from 'uuid';

export class RemindersService {
  private migrationsRun = false;

  async ensureMigrations() {
    if (this.migrationsRun) return;
    try {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS reminder_config (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
          enabled BOOLEAN DEFAULT false,
          day_7_template TEXT DEFAULT 'Estimado cliente, le recordamos que su factura #{invoice_number} vence en 7 dias.',
          day_15_template TEXT DEFAULT 'Estimado cliente, su factura #{invoice_number} tiene 15 dias de vencida.',
          day_30_template TEXT DEFAULT 'Estimado cliente, su factura #{invoice_number} tiene 30 dias de vencida. Por favor regularice su situacion.',
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          UNIQUE(company_id)
        )
      `);
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS payment_reminders (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
          invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
          reminder_type VARCHAR(20) NOT NULL,
          sent_at TIMESTAMP WITH TIME ZONE,
          channel VARCHAR(20) NOT NULL DEFAULT 'email',
          status VARCHAR(20) NOT NULL DEFAULT 'pending',
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
      `);
      this.migrationsRun = true;
    } catch (error) {
      console.error('Reminders migrations error:', error);
    }
  }

  async getConfig(companyId: string) {
    await this.ensureMigrations();
    try {
      const result = await db.execute(sql`
        SELECT * FROM reminder_config WHERE company_id = ${companyId}
      `);
      const rows = (result as any).rows || result || [];
      if (rows.length === 0) {
        // Return default config (not yet saved)
        return {
          enabled: false,
          day_7_template: 'Estimado cliente, le recordamos que su factura #{invoice_number} vence en 7 dias.',
          day_15_template: 'Estimado cliente, su factura #{invoice_number} tiene 15 dias de vencida.',
          day_30_template: 'Estimado cliente, su factura #{invoice_number} tiene 30 dias de vencida. Por favor regularice su situacion.',
        };
      }
      return rows[0];
    } catch (error) {
      console.error('Get reminder config error:', error);
      throw new ApiError(500, 'Error al obtener configuracion de recordatorios');
    }
  }

  async updateConfig(companyId: string, data: any) {
    await this.ensureMigrations();
    try {
      const { enabled, day_7_template, day_15_template, day_30_template } = data;

      await db.execute(sql`
        INSERT INTO reminder_config (id, company_id, enabled, day_7_template, day_15_template, day_30_template, created_at, updated_at)
        VALUES (${uuid()}, ${companyId}, ${enabled ?? false}, ${day_7_template ?? null}, ${day_15_template ?? null}, ${day_30_template ?? null}, NOW(), NOW())
        ON CONFLICT (company_id) DO UPDATE SET
          enabled = COALESCE(${enabled ?? null}, reminder_config.enabled),
          day_7_template = COALESCE(${day_7_template ?? null}, reminder_config.day_7_template),
          day_15_template = COALESCE(${day_15_template ?? null}, reminder_config.day_15_template),
          day_30_template = COALESCE(${day_30_template ?? null}, reminder_config.day_30_template),
          updated_at = NOW()
      `);

      return { message: 'Configuracion de recordatorios actualizada' };
    } catch (error) {
      console.error('Update reminder config error:', error);
      throw new ApiError(500, 'Error al actualizar configuracion de recordatorios');
    }
  }

  async listReminders(companyId: string) {
    await this.ensureMigrations();
    try {
      const result = await db.execute(sql`
        SELECT pr.*, i.invoice_number, i.total_amount, i.invoice_date,
          c.name as customer_name
        FROM payment_reminders pr
        JOIN invoices i ON pr.invoice_id = i.id
        LEFT JOIN customers c ON i.customer_id = c.id
        WHERE pr.company_id = ${companyId}
        ORDER BY pr.created_at DESC
        LIMIT 100
      `);
      return (result as any).rows || result || [];
    } catch (error) {
      console.error('List reminders error:', error);
      throw new ApiError(500, 'Error al obtener recordatorios');
    }
  }

  async getOverdueInvoices(companyId: string) {
    await this.ensureMigrations();
    try {
      const result = await db.execute(sql`
        SELECT i.id, i.invoice_number, i.invoice_date, i.total_amount, i.status,
          i.payment_status, c.name as customer_name, c.email as customer_email,
          EXTRACT(DAY FROM NOW() - i.invoice_date::timestamp) as days_overdue
        FROM invoices i
        LEFT JOIN customers c ON i.customer_id = c.id
        WHERE i.company_id = ${companyId}
          AND i.status = 'authorized'
          AND (i.payment_status IS NULL OR i.payment_status = 'pendiente' OR i.payment_status = 'parcial')
          AND i.invoice_date < NOW() - INTERVAL '7 days'
        ORDER BY i.invoice_date ASC
      `);
      return (result as any).rows || result || [];
    } catch (error) {
      console.error('Get overdue invoices error:', error);
      throw new ApiError(500, 'Error al obtener facturas vencidas');
    }
  }
}

export const remindersService = new RemindersService();
