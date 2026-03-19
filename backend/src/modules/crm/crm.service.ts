import { db } from '../../config/db';
import { sql } from 'drizzle-orm';
import { ApiError } from '../../middlewares/errorHandler';
import { v4 as uuid } from 'uuid';

const VALID_STAGES = ['contacto', 'cotizacion', 'negociacion', 'pedido', 'entregado', 'cobrado', 'perdido'] as const;
type DealStage = typeof VALID_STAGES[number];

const ACTIVE_STAGES = ['contacto', 'cotizacion', 'negociacion', 'pedido', 'entregado', 'cobrado'] as const;

const VALID_PRIORITIES = ['baja', 'normal', 'alta', 'urgente'] as const;

const VALID_ACTIVITY_TYPES = [
  'note', 'call', 'email', 'whatsapp', 'meeting',
  'quote_created', 'order_created', 'invoice_sent',
  'payment_received', 'remito_sent', 'stage_change',
] as const;

export class CrmService {
  private tablesEnsured = false;

  async ensureTables() {
    if (this.tablesEnsured) return;
    try {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS crm_deals (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          company_id UUID NOT NULL REFERENCES companies(id),
          enterprise_id UUID REFERENCES enterprises(id),
          customer_id UUID REFERENCES customers(id),
          title VARCHAR(255) NOT NULL,
          value DECIMAL(12,2) DEFAULT 0,
          stage VARCHAR(50) NOT NULL DEFAULT 'contacto',
          priority VARCHAR(20) DEFAULT 'normal',
          expected_close_date DATE,
          lost_reason TEXT,
          notes TEXT,
          created_by UUID REFERENCES users(id),
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
      `);

      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS crm_activities (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          company_id UUID NOT NULL,
          deal_id UUID REFERENCES crm_deals(id) ON DELETE CASCADE,
          enterprise_id UUID REFERENCES enterprises(id),
          activity_type VARCHAR(50) NOT NULL,
          description TEXT,
          is_auto BOOLEAN DEFAULT false,
          created_by UUID REFERENCES users(id),
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
      `);

      // Indices for performance
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS idx_crm_deals_company_stage
        ON crm_deals(company_id, stage)
      `).catch(() => {});
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS idx_crm_deals_enterprise
        ON crm_deals(enterprise_id) WHERE enterprise_id IS NOT NULL
      `).catch(() => {});
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS idx_crm_activities_deal
        ON crm_activities(deal_id) WHERE deal_id IS NOT NULL
      `).catch(() => {});
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS idx_crm_activities_enterprise
        ON crm_activities(enterprise_id) WHERE enterprise_id IS NOT NULL
      `).catch(() => {});

      this.tablesEnsured = true;
    } catch (error) {
      console.error('Ensure CRM tables error:', error);
    }
  }

  // ========== DEALS ==========

  async getDeals(companyId: string, filters?: {
    stage?: string;
    enterprise_id?: string;
    priority?: string;
    search?: string;
  }) {
    await this.ensureTables();
    try {
      let query = sql`
        SELECT d.*,
          e.name as enterprise_name,
          e.cuit as enterprise_cuit,
          c.name as customer_name,
          EXTRACT(DAY FROM NOW() - d.updated_at)::int as days_in_stage
        FROM crm_deals d
        LEFT JOIN enterprises e ON d.enterprise_id = e.id
        LEFT JOIN customers c ON d.customer_id = c.id
        WHERE d.company_id = ${companyId}
      `;

      if (filters?.stage) {
        query = sql`${query} AND d.stage = ${filters.stage}`;
      }
      if (filters?.enterprise_id) {
        query = sql`${query} AND d.enterprise_id = ${filters.enterprise_id}`;
      }
      if (filters?.priority) {
        query = sql`${query} AND d.priority = ${filters.priority}`;
      }
      if (filters?.search) {
        const searchTerm = `%${filters.search}%`;
        query = sql`${query} AND (d.title ILIKE ${searchTerm} OR e.name ILIKE ${searchTerm})`;
      }

      query = sql`${query} ORDER BY d.updated_at DESC`;

      const result = await db.execute(query);
      return (result as any).rows || result || [];
    } catch (error) {
      console.error('getDeals error:', error);
      throw new ApiError(500, 'Failed to get deals');
    }
  }

  async getDealsByStage(companyId: string) {
    await this.ensureTables();
    try {
      const result = await db.execute(sql`
        SELECT d.*,
          e.name as enterprise_name,
          e.cuit as enterprise_cuit,
          c.name as customer_name,
          EXTRACT(DAY FROM NOW() - d.updated_at)::int as days_in_stage
        FROM crm_deals d
        LEFT JOIN enterprises e ON d.enterprise_id = e.id
        LEFT JOIN customers c ON d.customer_id = c.id
        WHERE d.company_id = ${companyId}
          AND d.stage != 'perdido'
        ORDER BY d.value DESC NULLS LAST, d.updated_at ASC
      `);
      const rows = (result as any).rows || result || [];

      const grouped: Record<string, any[]> = {};
      for (const stage of ACTIVE_STAGES) {
        grouped[stage] = [];
      }
      for (const row of rows) {
        const stage = row.stage as string;
        if (grouped[stage]) {
          grouped[stage].push(row);
        }
      }
      return grouped;
    } catch (error) {
      console.error('getDealsByStage error:', error);
      throw new ApiError(500, 'Failed to get deals by stage');
    }
  }

  async createDeal(companyId: string, userId: string, data: {
    enterprise_id?: string;
    customer_id?: string;
    title: string;
    value?: number;
    stage?: string;
    priority?: string;
    expected_close_date?: string;
    notes?: string;
  }) {
    await this.ensureTables();
    try {
      if (!data.title?.trim()) {
        throw new ApiError(400, 'El titulo del deal es obligatorio');
      }

      const stage = data.stage || 'contacto';
      if (!VALID_STAGES.includes(stage as DealStage)) {
        throw new ApiError(400, `Etapa invalida: ${stage}`);
      }

      const priority = data.priority || 'normal';
      if (!VALID_PRIORITIES.includes(priority as any)) {
        throw new ApiError(400, `Prioridad invalida: ${priority}`);
      }

      const dealId = uuid();
      await db.execute(sql`
        INSERT INTO crm_deals (id, company_id, enterprise_id, customer_id, title, value, stage, priority, expected_close_date, notes, created_by)
        VALUES (
          ${dealId},
          ${companyId},
          ${data.enterprise_id || null},
          ${data.customer_id || null},
          ${data.title.trim()},
          ${data.value || 0},
          ${stage},
          ${priority},
          ${data.expected_close_date || null},
          ${data.notes || null},
          ${userId}
        )
      `);

      // Auto-create activity
      await this.createActivity(companyId, {
        deal_id: dealId,
        enterprise_id: data.enterprise_id,
        activity_type: 'note',
        description: `Deal "${data.title.trim()}" creado en etapa ${stage}`,
        is_auto: true,
        created_by: userId,
      });

      const result = await db.execute(sql`
        SELECT d.*,
          e.name as enterprise_name,
          c.name as customer_name
        FROM crm_deals d
        LEFT JOIN enterprises e ON d.enterprise_id = e.id
        LEFT JOIN customers c ON d.customer_id = c.id
        WHERE d.id = ${dealId}
      `);
      return ((result as any).rows || result || [])[0];
    } catch (error) {
      if (error instanceof ApiError) throw error;
      console.error('createDeal error:', error);
      throw new ApiError(500, 'Failed to create deal');
    }
  }

  async updateDeal(companyId: string, dealId: string, data: {
    title?: string;
    value?: number;
    priority?: string;
    expected_close_date?: string | null;
    notes?: string | null;
    enterprise_id?: string | null;
    customer_id?: string | null;
  }) {
    await this.ensureTables();
    try {
      const check = await db.execute(sql`
        SELECT id, stage FROM crm_deals WHERE id = ${dealId} AND company_id = ${companyId}
      `);
      const rows = (check as any).rows || check || [];
      if (rows.length === 0) throw new ApiError(404, 'Deal not found');

      if (data.priority && !VALID_PRIORITIES.includes(data.priority as any)) {
        throw new ApiError(400, `Prioridad invalida: ${data.priority}`);
      }

      await db.execute(sql`
        UPDATE crm_deals SET
          title = COALESCE(${data.title || null}, title),
          value = COALESCE(${data.value !== undefined ? data.value : null}, value),
          priority = COALESCE(${data.priority || null}, priority),
          expected_close_date = ${data.expected_close_date !== undefined ? (data.expected_close_date || null) : null},
          notes = ${data.notes !== undefined ? (data.notes || null) : null},
          enterprise_id = ${data.enterprise_id !== undefined ? (data.enterprise_id || null) : null},
          customer_id = ${data.customer_id !== undefined ? (data.customer_id || null) : null},
          updated_at = NOW()
        WHERE id = ${dealId} AND company_id = ${companyId}
      `);

      const result = await db.execute(sql`
        SELECT d.*,
          e.name as enterprise_name,
          c.name as customer_name,
          EXTRACT(DAY FROM NOW() - d.updated_at)::int as days_in_stage
        FROM crm_deals d
        LEFT JOIN enterprises e ON d.enterprise_id = e.id
        LEFT JOIN customers c ON d.customer_id = c.id
        WHERE d.id = ${dealId}
      `);
      return ((result as any).rows || result || [])[0];
    } catch (error) {
      if (error instanceof ApiError) throw error;
      console.error('updateDeal error:', error);
      throw new ApiError(500, 'Failed to update deal');
    }
  }

  async moveDealStage(companyId: string, dealId: string, newStage: string, userId: string) {
    await this.ensureTables();
    try {
      if (!VALID_STAGES.includes(newStage as DealStage)) {
        throw new ApiError(400, `Etapa invalida: ${newStage}`);
      }

      const check = await db.execute(sql`
        SELECT id, stage, title, enterprise_id FROM crm_deals WHERE id = ${dealId} AND company_id = ${companyId}
      `);
      const rows = (check as any).rows || check || [];
      if (rows.length === 0) throw new ApiError(404, 'Deal not found');

      const oldStage = rows[0].stage;
      if (oldStage === newStage) return rows[0];

      await db.execute(sql`
        UPDATE crm_deals SET stage = ${newStage}, updated_at = NOW()
        WHERE id = ${dealId} AND company_id = ${companyId}
      `);

      // Log stage change activity
      await this.createActivity(companyId, {
        deal_id: dealId,
        enterprise_id: rows[0].enterprise_id,
        activity_type: 'stage_change',
        description: `Movido de "${oldStage}" a "${newStage}"`,
        is_auto: false,
        created_by: userId,
      });

      const result = await db.execute(sql`
        SELECT d.*,
          e.name as enterprise_name,
          c.name as customer_name,
          EXTRACT(DAY FROM NOW() - d.updated_at)::int as days_in_stage
        FROM crm_deals d
        LEFT JOIN enterprises e ON d.enterprise_id = e.id
        LEFT JOIN customers c ON d.customer_id = c.id
        WHERE d.id = ${dealId}
      `);
      return ((result as any).rows || result || [])[0];
    } catch (error) {
      if (error instanceof ApiError) throw error;
      console.error('moveDealStage error:', error);
      throw new ApiError(500, 'Failed to move deal stage');
    }
  }

  async closeDeal(companyId: string, dealId: string, won: boolean, reason: string | undefined, userId: string) {
    await this.ensureTables();
    try {
      const check = await db.execute(sql`
        SELECT id, stage, title, enterprise_id FROM crm_deals WHERE id = ${dealId} AND company_id = ${companyId}
      `);
      const rows = (check as any).rows || check || [];
      if (rows.length === 0) throw new ApiError(404, 'Deal not found');

      if (won) {
        await db.execute(sql`
          UPDATE crm_deals SET stage = 'cobrado', updated_at = NOW()
          WHERE id = ${dealId} AND company_id = ${companyId}
        `);
        await this.createActivity(companyId, {
          deal_id: dealId,
          enterprise_id: rows[0].enterprise_id,
          activity_type: 'stage_change',
          description: `Deal marcado como GANADO`,
          is_auto: false,
          created_by: userId,
        });
      } else {
        await db.execute(sql`
          UPDATE crm_deals SET stage = 'perdido', lost_reason = ${reason || null}, updated_at = NOW()
          WHERE id = ${dealId} AND company_id = ${companyId}
        `);
        await this.createActivity(companyId, {
          deal_id: dealId,
          enterprise_id: rows[0].enterprise_id,
          activity_type: 'stage_change',
          description: `Deal marcado como PERDIDO${reason ? ': ' + reason : ''}`,
          is_auto: false,
          created_by: userId,
        });
      }

      const result = await db.execute(sql`
        SELECT d.*,
          e.name as enterprise_name,
          c.name as customer_name
        FROM crm_deals d
        LEFT JOIN enterprises e ON d.enterprise_id = e.id
        LEFT JOIN customers c ON d.customer_id = c.id
        WHERE d.id = ${dealId}
      `);
      return ((result as any).rows || result || [])[0];
    } catch (error) {
      if (error instanceof ApiError) throw error;
      console.error('closeDeal error:', error);
      throw new ApiError(500, 'Failed to close deal');
    }
  }

  async deleteDeal(companyId: string, dealId: string) {
    await this.ensureTables();
    try {
      const check = await db.execute(sql`
        SELECT id FROM crm_deals WHERE id = ${dealId} AND company_id = ${companyId}
      `);
      const rows = (check as any).rows || check || [];
      if (rows.length === 0) throw new ApiError(404, 'Deal not found');

      await db.execute(sql`DELETE FROM crm_deals WHERE id = ${dealId} AND company_id = ${companyId}`);
      return { success: true };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Failed to delete deal');
    }
  }

  // ========== ACTIVITIES ==========

  async getActivities(companyId: string, filters?: {
    deal_id?: string;
    enterprise_id?: string;
    limit?: number;
  }) {
    await this.ensureTables();
    try {
      const limit = filters?.limit || 50;

      let query = sql`
        SELECT a.*,
          u.name as created_by_name,
          d.title as deal_title
        FROM crm_activities a
        LEFT JOIN users u ON a.created_by = u.id
        LEFT JOIN crm_deals d ON a.deal_id = d.id
        WHERE a.company_id = ${companyId}
      `;

      if (filters?.deal_id) {
        query = sql`${query} AND a.deal_id = ${filters.deal_id}`;
      }
      if (filters?.enterprise_id) {
        query = sql`${query} AND a.enterprise_id = ${filters.enterprise_id}`;
      }

      query = sql`${query} ORDER BY a.created_at DESC LIMIT ${limit}`;

      const result = await db.execute(query);
      return (result as any).rows || result || [];
    } catch (error) {
      console.error('getActivities error:', error);
      throw new ApiError(500, 'Failed to get activities');
    }
  }

  async createActivity(companyId: string, data: {
    deal_id?: string;
    enterprise_id?: string;
    activity_type: string;
    description?: string;
    is_auto?: boolean;
    created_by?: string;
  }) {
    await this.ensureTables();
    try {
      if (!VALID_ACTIVITY_TYPES.includes(data.activity_type as any)) {
        throw new ApiError(400, `Tipo de actividad invalido: ${data.activity_type}`);
      }

      const activityId = uuid();
      await db.execute(sql`
        INSERT INTO crm_activities (id, company_id, deal_id, enterprise_id, activity_type, description, is_auto, created_by)
        VALUES (
          ${activityId},
          ${companyId},
          ${data.deal_id || null},
          ${data.enterprise_id || null},
          ${data.activity_type},
          ${data.description || null},
          ${data.is_auto || false},
          ${data.created_by || null}
        )
      `);

      const result = await db.execute(sql`
        SELECT a.*, u.name as created_by_name
        FROM crm_activities a
        LEFT JOIN users u ON a.created_by = u.id
        WHERE a.id = ${activityId}
      `);
      return ((result as any).rows || result || [])[0];
    } catch (error) {
      if (error instanceof ApiError) throw error;
      console.error('createActivity error:', error);
      throw new ApiError(500, 'Failed to create activity');
    }
  }

  // ========== PIPELINE SUMMARY ==========

  async getPipelineSummary(companyId: string) {
    await this.ensureTables();
    try {
      const result = await db.execute(sql`
        SELECT
          stage,
          COUNT(*)::int as count,
          COALESCE(SUM(value), 0)::decimal as total_value
        FROM crm_deals
        WHERE company_id = ${companyId}
        GROUP BY stage
        ORDER BY
          CASE stage
            WHEN 'contacto' THEN 1
            WHEN 'cotizacion' THEN 2
            WHEN 'negociacion' THEN 3
            WHEN 'pedido' THEN 4
            WHEN 'entregado' THEN 5
            WHEN 'cobrado' THEN 6
            WHEN 'perdido' THEN 7
          END
      `);
      const rows = (result as any).rows || result || [];

      // Ensure all stages are present
      const summary: Record<string, { count: number; total_value: number }> = {};
      for (const stage of VALID_STAGES) {
        summary[stage] = { count: 0, total_value: 0 };
      }
      for (const row of rows) {
        summary[row.stage] = {
          count: Number(row.count),
          total_value: Number(row.total_value),
        };
      }

      // Totals
      const activeDeals = Object.entries(summary)
        .filter(([stage]) => stage !== 'perdido')
        .reduce((acc, [, v]) => acc + v.count, 0);
      const activePipelineValue = Object.entries(summary)
        .filter(([stage]) => stage !== 'perdido' && stage !== 'cobrado')
        .reduce((acc, [, v]) => acc + v.total_value, 0);

      return {
        stages: summary,
        totals: {
          active_deals: activeDeals,
          pipeline_value: activePipelineValue,
          won_value: summary.cobrado.total_value,
          lost_count: summary.perdido.count,
        },
      };
    } catch (error) {
      console.error('getPipelineSummary error:', error);
      throw new ApiError(500, 'Failed to get pipeline summary');
    }
  }

  // ========== CUSTOMER HEALTH ==========

  async getCustomerHealth(companyId: string) {
    await this.ensureTables();
    try {
      // Get enterprises with last order date, total invoiced, payment behavior
      const result = await db.execute(sql`
        SELECT
          e.id,
          e.name,
          e.cuit,
          -- Last order date from any customer linked to enterprise
          (
            SELECT MAX(o.created_at)
            FROM orders o
            JOIN customers c ON o.customer_id = c.id
            WHERE c.enterprise_id = e.id AND o.company_id = ${companyId}
          ) as last_order_date,
          -- Total revenue
          COALESCE((
            SELECT SUM(i.total)
            FROM invoices i
            JOIN customers c ON i.customer_id = c.id
            WHERE c.enterprise_id = e.id AND i.company_id = ${companyId} AND i.status != 'cancelled'
          ), 0)::decimal as total_revenue,
          -- Active deals count
          COALESCE((
            SELECT COUNT(*)
            FROM crm_deals d
            WHERE d.enterprise_id = e.id AND d.company_id = ${companyId} AND d.stage NOT IN ('cobrado', 'perdido')
          ), 0)::int as active_deals,
          -- Total deal value
          COALESCE((
            SELECT SUM(d.value)
            FROM crm_deals d
            WHERE d.enterprise_id = e.id AND d.company_id = ${companyId} AND d.stage NOT IN ('cobrado', 'perdido')
          ), 0)::decimal as pipeline_value
        FROM enterprises e
        WHERE e.company_id = ${companyId}
        ORDER BY e.name ASC
      `);
      const rows = (result as any).rows || result || [];

      return rows.map((row: any) => {
        const lastOrder = row.last_order_date ? new Date(row.last_order_date) : null;
        const daysSinceLastOrder = lastOrder
          ? Math.floor((Date.now() - lastOrder.getTime()) / (1000 * 60 * 60 * 24))
          : null;

        let health: 'green' | 'yellow' | 'red' = 'green';
        if (daysSinceLastOrder === null || daysSinceLastOrder > 30) health = 'red';
        else if (daysSinceLastOrder > 15) health = 'yellow';

        return {
          ...row,
          days_since_last_order: daysSinceLastOrder,
          health,
          total_revenue: Number(row.total_revenue),
          pipeline_value: Number(row.pipeline_value),
          active_deals: Number(row.active_deals),
        };
      });
    } catch (error) {
      console.error('getCustomerHealth error:', error);
      throw new ApiError(500, 'Failed to get customer health');
    }
  }
}

export const crmService = new CrmService();
