import { db } from '../../config/db';
import { sql } from 'drizzle-orm';
import { ApiError } from '../../middlewares/errorHandler';
import { v4 as uuid } from 'uuid';

// Legacy stages kept for backward compat mapping
const LEGACY_STAGE_MAP: Record<string, string> = {
  contacto: 'Contacto',
  cotizacion: 'Cotizacion',
  negociacion: 'Cotizacion', // merged into Cotizacion
  pedido: 'Pedido',
  entregado: 'Entregado',
  facturado: 'Facturado',
  cobrado: 'Cobrado',
  perdido: 'Perdido',
};

const VALID_PRIORITIES = ['baja', 'normal', 'alta', 'urgente'] as const;

const VALID_ACTIVITY_TYPES = [
  'note', 'call', 'email', 'whatsapp', 'meeting',
  'quote_created', 'order_created', 'invoice_sent',
  'payment_received', 'remito_sent', 'stage_change',
] as const;

const DEFAULT_STAGES = [
  { name: 'Contacto', color: '#6B7280', stage_order: 1, trigger_event: null, is_loss_stage: false },
  { name: 'Cotizacion', color: '#3B82F6', stage_order: 2, trigger_event: 'quote_created', is_loss_stage: false },
  { name: 'Pedido', color: '#8B5CF6', stage_order: 3, trigger_event: 'order_created', is_loss_stage: false },
  { name: 'Entregado', color: '#F59E0B', stage_order: 4, trigger_event: 'order_delivered', is_loss_stage: false },
  { name: 'Facturado', color: '#06B6D4', stage_order: 5, trigger_event: 'invoice_authorized', is_loss_stage: false },
  { name: 'Cobrado', color: '#22C55E', stage_order: 6, trigger_event: 'payment_received', is_loss_stage: false },
  { name: 'Perdido', color: '#EF4444', stage_order: 7, trigger_event: 'deal_lost', is_loss_stage: true },
];

export class CrmService {
  private tablesEnsured = false;

  async ensureTables() {
    if (this.tablesEnsured) return;
    try {
      // Original tables
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

      // Phase 1: New tables
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS crm_stages (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
          name VARCHAR(100) NOT NULL,
          color VARCHAR(20) NOT NULL DEFAULT '#3B82F6',
          stage_order INTEGER NOT NULL,
          trigger_event VARCHAR(50),
          is_loss_stage BOOLEAN DEFAULT false,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
      `);

      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS crm_deal_documents (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          deal_id UUID NOT NULL REFERENCES crm_deals(id) ON DELETE CASCADE,
          document_type VARCHAR(20) NOT NULL,
          document_id UUID NOT NULL,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          UNIQUE(deal_id, document_type, document_id)
        )
      `);

      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS crm_deal_stage_history (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          deal_id UUID NOT NULL REFERENCES crm_deals(id) ON DELETE CASCADE,
          from_stage_id UUID REFERENCES crm_stages(id),
          to_stage_id UUID NOT NULL REFERENCES crm_stages(id),
          moved_by UUID REFERENCES users(id),
          is_auto BOOLEAN DEFAULT false,
          trigger_event VARCHAR(50),
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
      `);

      // Add new columns to crm_deals
      await db.execute(sql`ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS stage_id UUID REFERENCES crm_stages(id)`).catch(() => {});
      await db.execute(sql`ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS estimated_value DECIMAL(12,2) DEFAULT 0`).catch(() => {});
      await db.execute(sql`ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS actual_value DECIMAL(12,2) DEFAULT 0`).catch(() => {});
      await db.execute(sql`ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS manual_override_at TIMESTAMP WITH TIME ZONE`).catch(() => {});
      await db.execute(sql`ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP WITH TIME ZONE`).catch(() => {});

      // Indices
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_crm_deals_company_stage ON crm_deals(company_id, stage)`).catch(() => {});
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_crm_deals_company_stage_id ON crm_deals(company_id, stage_id)`).catch(() => {});
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_crm_deals_enterprise ON crm_deals(enterprise_id) WHERE enterprise_id IS NOT NULL`).catch(() => {});
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_crm_activities_deal ON crm_activities(deal_id) WHERE deal_id IS NOT NULL`).catch(() => {});
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_crm_activities_enterprise ON crm_activities(enterprise_id) WHERE enterprise_id IS NOT NULL`).catch(() => {});
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_crm_stages_company ON crm_stages(company_id, stage_order)`).catch(() => {});
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_crm_deal_documents_deal ON crm_deal_documents(deal_id)`).catch(() => {});
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_crm_deal_documents_doc ON crm_deal_documents(document_type, document_id)`).catch(() => {});
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_crm_deal_history_deal ON crm_deal_stage_history(deal_id)`).catch(() => {});

      this.tablesEnsured = true;
    } catch (error) {
      console.error('Ensure CRM tables error:', error);
    }
  }

  // ========== STAGES ==========

  async ensureDefaultStages(companyId: string): Promise<void> {
    const existing = await db.execute(sql`
      SELECT COUNT(*)::int as cnt FROM crm_stages WHERE company_id = ${companyId}
    `);
    const count = ((existing as any).rows || existing || [])[0]?.cnt || 0;
    if (Number(count) > 0) return;

    for (const stage of DEFAULT_STAGES) {
      await db.execute(sql`
        INSERT INTO crm_stages (id, company_id, name, color, stage_order, trigger_event, is_loss_stage)
        VALUES (${uuid()}, ${companyId}, ${stage.name}, ${stage.color}, ${stage.stage_order}, ${stage.trigger_event}, ${stage.is_loss_stage})
      `);
    }
  }

  async migrateDealsToStageId(companyId: string): Promise<void> {
    // Check if there are deals with stage varchar but no stage_id
    const unmigrated = await db.execute(sql`
      SELECT COUNT(*)::int as cnt FROM crm_deals
      WHERE company_id = ${companyId} AND stage IS NOT NULL AND stage_id IS NULL
    `);
    const count = ((unmigrated as any).rows || unmigrated || [])[0]?.cnt || 0;
    if (Number(count) === 0) return;

    // Get stages for this company
    const stagesResult = await db.execute(sql`
      SELECT id, name FROM crm_stages WHERE company_id = ${companyId}
    `);
    const stages = (stagesResult as any).rows || stagesResult || [];
    const stageMap = new Map<string, string>();
    for (const s of stages) {
      stageMap.set(s.name.toLowerCase(), s.id);
    }

    // Map legacy varchar stages to stage_ids
    for (const [legacyKey, stageName] of Object.entries(LEGACY_STAGE_MAP)) {
      const stageId = stageMap.get(stageName.toLowerCase());
      if (stageId) {
        await db.execute(sql`
          UPDATE crm_deals SET stage_id = ${stageId}
          WHERE company_id = ${companyId} AND stage = ${legacyKey} AND stage_id IS NULL
        `);
      }
    }
  }

  async getStages(companyId: string) {
    await this.ensureTables();
    await this.ensureDefaultStages(companyId);
    try {
      const result = await db.execute(sql`
        SELECT s.*,
          COALESCE((SELECT COUNT(*)::int FROM crm_deals d WHERE d.stage_id = s.id), 0) as deal_count
        FROM crm_stages s
        WHERE s.company_id = ${companyId}
        ORDER BY s.stage_order ASC
      `);
      return (result as any).rows || result || [];
    } catch (error) {
      console.error('getStages error:', error);
      throw new ApiError(500, 'Failed to get stages');
    }
  }

  async createStage(companyId: string, data: {
    name: string;
    color?: string;
    stage_order?: number;
    trigger_event?: string | null;
    is_loss_stage?: boolean;
  }) {
    await this.ensureTables();
    await this.ensureDefaultStages(companyId);
    try {
      if (!data.name?.trim()) {
        throw new ApiError(400, 'El nombre de la etapa es obligatorio');
      }

      // Determine order: if not provided, add at the end (before loss stages)
      let order = data.stage_order;
      if (order === undefined) {
        const maxResult = await db.execute(sql`
          SELECT MAX(stage_order) as max_order FROM crm_stages
          WHERE company_id = ${companyId} AND is_loss_stage = false
        `);
        const maxOrder = ((maxResult as any).rows || maxResult || [])[0]?.max_order || 0;
        order = Number(maxOrder) + 1;

        // Shift loss stages up
        await db.execute(sql`
          UPDATE crm_stages SET stage_order = stage_order + 1
          WHERE company_id = ${companyId} AND stage_order >= ${order}
        `);
      }

      const stageId = uuid();
      await db.execute(sql`
        INSERT INTO crm_stages (id, company_id, name, color, stage_order, trigger_event, is_loss_stage)
        VALUES (${stageId}, ${companyId}, ${data.name.trim()}, ${data.color || '#3B82F6'}, ${order}, ${data.trigger_event || null}, ${data.is_loss_stage || false})
      `);

      const result = await db.execute(sql`SELECT * FROM crm_stages WHERE id = ${stageId}`);
      return ((result as any).rows || result || [])[0];
    } catch (error) {
      if (error instanceof ApiError) throw error;
      console.error('createStage error:', error);
      throw new ApiError(500, 'Failed to create stage');
    }
  }

  async updateStage(companyId: string, stageId: string, data: {
    name?: string;
    color?: string;
    trigger_event?: string | null;
  }) {
    await this.ensureTables();
    try {
      const check = await db.execute(sql`
        SELECT id FROM crm_stages WHERE id = ${stageId} AND company_id = ${companyId}
      `);
      if (((check as any).rows || check || []).length === 0) {
        throw new ApiError(404, 'Stage not found');
      }

      await db.execute(sql`
        UPDATE crm_stages SET
          name = COALESCE(${data.name || null}, name),
          color = COALESCE(${data.color || null}, color),
          trigger_event = ${data.trigger_event !== undefined ? (data.trigger_event || null) : null}
        WHERE id = ${stageId} AND company_id = ${companyId}
      `);

      const result = await db.execute(sql`SELECT * FROM crm_stages WHERE id = ${stageId}`);
      return ((result as any).rows || result || [])[0];
    } catch (error) {
      if (error instanceof ApiError) throw error;
      console.error('updateStage error:', error);
      throw new ApiError(500, 'Failed to update stage');
    }
  }

  async deleteStage(companyId: string, stageId: string) {
    await this.ensureTables();
    try {
      const check = await db.execute(sql`
        SELECT id, name, is_loss_stage FROM crm_stages WHERE id = ${stageId} AND company_id = ${companyId}
      `);
      const rows = (check as any).rows || check || [];
      if (rows.length === 0) throw new ApiError(404, 'Stage not found');

      // Check if deals exist in this stage
      const dealCheck = await db.execute(sql`
        SELECT COUNT(*)::int as cnt FROM crm_deals WHERE stage_id = ${stageId}
      `);
      const dealCount = ((dealCheck as any).rows || dealCheck || [])[0]?.cnt || 0;
      if (Number(dealCount) > 0) {
        throw new ApiError(400, `No se puede eliminar: hay ${dealCount} deals en esta etapa. Movelos primero.`);
      }

      await db.execute(sql`DELETE FROM crm_stages WHERE id = ${stageId} AND company_id = ${companyId}`);
      return { success: true };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      console.error('deleteStage error:', error);
      throw new ApiError(500, 'Failed to delete stage');
    }
  }

  async reorderStages(companyId: string, stages: Array<{ id: string; order: number }>) {
    await this.ensureTables();
    try {
      for (const stage of stages) {
        await db.execute(sql`
          UPDATE crm_stages SET stage_order = ${stage.order}
          WHERE id = ${stage.id} AND company_id = ${companyId}
        `);
      }
      return await this.getStages(companyId);
    } catch (error) {
      console.error('reorderStages error:', error);
      throw new ApiError(500, 'Failed to reorder stages');
    }
  }

  // ========== DEALS ==========

  async getDeals(companyId: string, filters?: {
    stage?: string;
    stage_id?: string;
    enterprise_id?: string;
    priority?: string;
    search?: string;
  }) {
    await this.ensureTables();
    await this.ensureDefaultStages(companyId);
    await this.migrateDealsToStageId(companyId);
    try {
      let query = sql`
        SELECT d.*,
          e.name as enterprise_name,
          e.cuit as enterprise_cuit,
          c.name as customer_name,
          s.name as stage_name,
          s.color as stage_color,
          s.stage_order,
          s.is_loss_stage,
          EXTRACT(DAY FROM NOW() - d.updated_at)::int as days_in_stage
        FROM crm_deals d
        LEFT JOIN enterprises e ON d.enterprise_id = e.id
        LEFT JOIN customers c ON d.customer_id = c.id
        LEFT JOIN crm_stages s ON d.stage_id = s.id
        WHERE d.company_id = ${companyId}
      `;

      if (filters?.stage_id) {
        query = sql`${query} AND d.stage_id = ${filters.stage_id}`;
      } else if (filters?.stage) {
        // Backward compat: filter by legacy varchar stage name
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
    await this.ensureDefaultStages(companyId);
    await this.migrateDealsToStageId(companyId);
    try {
      // Get stages for this company (ordered)
      const stagesResult = await db.execute(sql`
        SELECT * FROM crm_stages
        WHERE company_id = ${companyId}
        ORDER BY stage_order ASC
      `);
      const stages = (stagesResult as any).rows || stagesResult || [];

      // Get all active deals (not in loss stage)
      const dealsQuery = sql`
        SELECT d.*,
          e.name as enterprise_name,
          e.cuit as enterprise_cuit,
          c.name as customer_name,
          s.name as stage_name,
          s.color as stage_color,
          s.stage_order,
          EXTRACT(DAY FROM NOW() - d.updated_at)::int as days_in_stage
        FROM crm_deals d
        LEFT JOIN enterprises e ON d.enterprise_id = e.id
        LEFT JOIN customers c ON d.customer_id = c.id
        LEFT JOIN crm_stages s ON d.stage_id = s.id
        WHERE d.company_id = ${companyId}
          AND d.stage_id IS NOT NULL
          AND d.stage_id NOT IN (
            SELECT id FROM crm_stages WHERE company_id = ${companyId} AND is_loss_stage = true
          )
        ORDER BY d.value DESC NULLS LAST, d.updated_at ASC
      `;

      const dealsResult = await db.execute(dealsQuery);
      const deals = (dealsResult as any).rows || dealsResult || [];

      // Group by stage_id
      const grouped: Record<string, { stage: any; deals: any[] }> = {};
      for (const stage of stages) {
        if (!stage.is_loss_stage) {
          grouped[stage.id] = { stage, deals: [] };
        }
      }
      for (const deal of deals) {
        if (grouped[deal.stage_id]) {
          grouped[deal.stage_id].deals.push(deal);
        }
      }

      return {
        stages: stages.filter((s: any) => !s.is_loss_stage),
        columns: grouped,
      };
    } catch (error) {
      console.error('getDealsByStage error:', error);
      throw new ApiError(500, 'Failed to get deals by stage');
    }
  }

  async getFirstNonLossStageId(companyId: string): Promise<string | null> {
    const result = await db.execute(sql`
      SELECT id FROM crm_stages
      WHERE company_id = ${companyId} AND is_loss_stage = false
      ORDER BY stage_order ASC LIMIT 1
    `);
    const rows = (result as any).rows || result || [];
    return rows[0]?.id || null;
  }

  async createDeal(companyId: string, userId: string, data: {
    enterprise_id?: string;
    customer_id?: string;
    title: string;
    value?: number;
    stage?: string;
    stage_id?: string;
    priority?: string;
    expected_close_date?: string;
    notes?: string;
  }) {
    await this.ensureTables();
    await this.ensureDefaultStages(companyId);
    try {
      if (!data.title?.trim()) {
        throw new ApiError(400, 'El titulo del deal es obligatorio');
      }

      const priority = data.priority || 'normal';
      if (!VALID_PRIORITIES.includes(priority as any)) {
        throw new ApiError(400, `Prioridad invalida: ${priority}`);
      }

      // Resolve stage_id
      let stageId = data.stage_id;
      let stageName = data.stage || 'contacto';

      if (!stageId) {
        // Try to map legacy stage name to stage_id
        const mappedName = LEGACY_STAGE_MAP[stageName] || stageName;
        const stageResult = await db.execute(sql`
          SELECT id, name FROM crm_stages
          WHERE company_id = ${companyId} AND LOWER(name) = LOWER(${mappedName})
          LIMIT 1
        `);
        const stageRows = (stageResult as any).rows || stageResult || [];
        if (stageRows.length > 0) {
          stageId = stageRows[0].id;
          stageName = stageRows[0].name;
        } else {
          // Fallback: first non-loss stage
          stageId = (await this.getFirstNonLossStageId(companyId)) || undefined;
          stageName = 'Contacto';
        }
      }

      const dealId = uuid();
      await db.execute(sql`
        INSERT INTO crm_deals (id, company_id, enterprise_id, customer_id, title, value, stage, stage_id, priority, expected_close_date, notes, estimated_value, created_by)
        VALUES (
          ${dealId},
          ${companyId},
          ${data.enterprise_id || null},
          ${data.customer_id || null},
          ${data.title.trim()},
          ${data.value || 0},
          ${stageName.toLowerCase()},
          ${stageId},
          ${priority},
          ${data.expected_close_date || null},
          ${data.notes || null},
          ${data.value || 0},
          ${userId}
        )
      `);

      // Record stage history
      if (stageId) {
        await db.execute(sql`
          INSERT INTO crm_deal_stage_history (id, deal_id, to_stage_id, moved_by, is_auto, trigger_event)
          VALUES (${uuid()}, ${dealId}, ${stageId}, ${userId}, false, 'deal_created')
        `);
      }

      // Auto-create activity
      await this.createActivity(companyId, {
        deal_id: dealId,
        enterprise_id: data.enterprise_id,
        activity_type: 'note',
        description: `Deal "${data.title.trim()}" creado en etapa ${stageName}`,
        is_auto: true,
        created_by: userId,
      });

      const result = await db.execute(sql`
        SELECT d.*,
          e.name as enterprise_name,
          c.name as customer_name,
          s.name as stage_name,
          s.color as stage_color
        FROM crm_deals d
        LEFT JOIN enterprises e ON d.enterprise_id = e.id
        LEFT JOIN customers c ON d.customer_id = c.id
        LEFT JOIN crm_stages s ON d.stage_id = s.id
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
          s.name as stage_name,
          s.color as stage_color,
          EXTRACT(DAY FROM NOW() - d.updated_at)::int as days_in_stage
        FROM crm_deals d
        LEFT JOIN enterprises e ON d.enterprise_id = e.id
        LEFT JOIN customers c ON d.customer_id = c.id
        LEFT JOIN crm_stages s ON d.stage_id = s.id
        WHERE d.id = ${dealId}
      `);
      return ((result as any).rows || result || [])[0];
    } catch (error) {
      if (error instanceof ApiError) throw error;
      console.error('updateDeal error:', error);
      throw new ApiError(500, 'Failed to update deal');
    }
  }

  async moveDealStage(companyId: string, dealId: string, newStageOrId: string, userId: string) {
    await this.ensureTables();
    await this.ensureDefaultStages(companyId);
    try {
      const check = await db.execute(sql`
        SELECT d.id, d.stage, d.stage_id, d.title, d.enterprise_id,
          s.name as current_stage_name
        FROM crm_deals d
        LEFT JOIN crm_stages s ON d.stage_id = s.id
        WHERE d.id = ${dealId} AND d.company_id = ${companyId}
      `);
      const rows = (check as any).rows || check || [];
      if (rows.length === 0) throw new ApiError(404, 'Deal not found');

      const deal = rows[0];

      // Resolve target stage: accept stage_id (UUID) or legacy stage name
      let targetStageId: string;
      let targetStageName: string;

      // Check if it's a UUID (stage_id)
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(newStageOrId);
      if (isUuid) {
        const stageResult = await db.execute(sql`
          SELECT id, name FROM crm_stages WHERE id = ${newStageOrId} AND company_id = ${companyId}
        `);
        const stageRows = (stageResult as any).rows || stageResult || [];
        if (stageRows.length === 0) throw new ApiError(400, 'Etapa no encontrada');
        targetStageId = stageRows[0].id;
        targetStageName = stageRows[0].name;
      } else {
        // Legacy: map varchar stage name
        const mappedName = LEGACY_STAGE_MAP[newStageOrId] || newStageOrId;
        const stageResult = await db.execute(sql`
          SELECT id, name FROM crm_stages
          WHERE company_id = ${companyId} AND LOWER(name) = LOWER(${mappedName})
          LIMIT 1
        `);
        const stageRows = (stageResult as any).rows || stageResult || [];
        if (stageRows.length === 0) throw new ApiError(400, `Etapa invalida: ${newStageOrId}`);
        targetStageId = stageRows[0].id;
        targetStageName = stageRows[0].name;
      }

      if (deal.stage_id === targetStageId) return deal;

      // Update deal
      await db.execute(sql`
        UPDATE crm_deals SET
          stage_id = ${targetStageId},
          stage = ${targetStageName.toLowerCase()},
          manual_override_at = NOW(),
          updated_at = NOW()
        WHERE id = ${dealId} AND company_id = ${companyId}
      `);

      // Record history
      await db.execute(sql`
        INSERT INTO crm_deal_stage_history (id, deal_id, from_stage_id, to_stage_id, moved_by, is_auto, trigger_event)
        VALUES (${uuid()}, ${dealId}, ${deal.stage_id || null}, ${targetStageId}, ${userId}, false, 'manual')
      `);

      // Log stage change activity
      await this.createActivity(companyId, {
        deal_id: dealId,
        enterprise_id: deal.enterprise_id,
        activity_type: 'stage_change',
        description: `Movido de "${deal.current_stage_name || deal.stage}" a "${targetStageName}"`,
        is_auto: false,
        created_by: userId,
      });

      const result = await db.execute(sql`
        SELECT d.*,
          e.name as enterprise_name,
          c.name as customer_name,
          s.name as stage_name,
          s.color as stage_color,
          EXTRACT(DAY FROM NOW() - d.updated_at)::int as days_in_stage
        FROM crm_deals d
        LEFT JOIN enterprises e ON d.enterprise_id = e.id
        LEFT JOIN customers c ON d.customer_id = c.id
        LEFT JOIN crm_stages s ON d.stage_id = s.id
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
    await this.ensureDefaultStages(companyId);
    try {
      const check = await db.execute(sql`
        SELECT d.id, d.stage, d.stage_id, d.title, d.enterprise_id
        FROM crm_deals d
        WHERE d.id = ${dealId} AND d.company_id = ${companyId}
      `);
      const rows = (check as any).rows || check || [];
      if (rows.length === 0) throw new ApiError(404, 'Deal not found');

      const deal = rows[0];

      if (won) {
        // Find "Cobrado" stage
        const cobradoResult = await db.execute(sql`
          SELECT id FROM crm_stages
          WHERE company_id = ${companyId} AND LOWER(name) = 'cobrado'
          LIMIT 1
        `);
        const cobradoStageId = ((cobradoResult as any).rows || [])[0]?.id;

        await db.execute(sql`
          UPDATE crm_deals SET
            stage = 'cobrado',
            stage_id = ${cobradoStageId || null},
            completed_at = NOW(),
            updated_at = NOW()
          WHERE id = ${dealId} AND company_id = ${companyId}
        `);

        if (cobradoStageId) {
          await db.execute(sql`
            INSERT INTO crm_deal_stage_history (id, deal_id, from_stage_id, to_stage_id, moved_by, is_auto)
            VALUES (${uuid()}, ${dealId}, ${deal.stage_id || null}, ${cobradoStageId}, ${userId}, false)
          `);
        }

        await this.createActivity(companyId, {
          deal_id: dealId,
          enterprise_id: deal.enterprise_id,
          activity_type: 'stage_change',
          description: 'Deal marcado como GANADO',
          is_auto: false,
          created_by: userId,
        });
      } else {
        // Find "Perdido" stage
        const perdidoResult = await db.execute(sql`
          SELECT id FROM crm_stages
          WHERE company_id = ${companyId} AND is_loss_stage = true
          LIMIT 1
        `);
        const perdidoStageId = ((perdidoResult as any).rows || [])[0]?.id;

        await db.execute(sql`
          UPDATE crm_deals SET
            stage = 'perdido',
            stage_id = ${perdidoStageId || null},
            lost_reason = ${reason || null},
            completed_at = NOW(),
            updated_at = NOW()
          WHERE id = ${dealId} AND company_id = ${companyId}
        `);

        if (perdidoStageId) {
          await db.execute(sql`
            INSERT INTO crm_deal_stage_history (id, deal_id, from_stage_id, to_stage_id, moved_by, is_auto)
            VALUES (${uuid()}, ${dealId}, ${deal.stage_id || null}, ${perdidoStageId}, ${userId}, false)
          `);
        }

        await this.createActivity(companyId, {
          deal_id: dealId,
          enterprise_id: deal.enterprise_id,
          activity_type: 'stage_change',
          description: `Deal marcado como PERDIDO${reason ? ': ' + reason : ''}`,
          is_auto: false,
          created_by: userId,
        });
      }

      const result = await db.execute(sql`
        SELECT d.*,
          e.name as enterprise_name,
          c.name as customer_name,
          s.name as stage_name,
          s.color as stage_color
        FROM crm_deals d
        LEFT JOIN enterprises e ON d.enterprise_id = e.id
        LEFT JOIN customers c ON d.customer_id = c.id
        LEFT JOIN crm_stages s ON d.stage_id = s.id
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
    await this.ensureDefaultStages(companyId);
    await this.migrateDealsToStageId(companyId);
    try {
      // Get stages
      const stagesResult = await db.execute(sql`
        SELECT * FROM crm_stages WHERE company_id = ${companyId} ORDER BY stage_order ASC
      `);
      const stages = (stagesResult as any).rows || stagesResult || [];

      // Get counts per stage_id
      const countsResult = await db.execute(sql`
        SELECT
          stage_id,
          COUNT(*)::int as count,
          COALESCE(SUM(value), 0)::decimal as total_value
        FROM crm_deals
        WHERE company_id = ${companyId} AND stage_id IS NOT NULL
        GROUP BY stage_id
      `);
      const counts = (countsResult as any).rows || countsResult || [];
      const countMap = new Map<string, { count: number; total_value: number }>();
      for (const row of counts) {
        countMap.set(row.stage_id, { count: Number(row.count), total_value: Number(row.total_value) });
      }

      // Build summary
      const summary: Record<string, { stage: any; count: number; total_value: number }> = {};
      let activeDeals = 0;
      let activePipelineValue = 0;
      let wonValue = 0;
      let lostCount = 0;

      for (const stage of stages) {
        const data = countMap.get(stage.id) || { count: 0, total_value: 0 };
        summary[stage.id] = { stage, ...data };

        if (stage.is_loss_stage) {
          lostCount += data.count;
        } else {
          activeDeals += data.count;
          if (stage.name.toLowerCase() !== 'cobrado') {
            activePipelineValue += data.total_value;
          } else {
            wonValue += data.total_value;
          }
        }
      }

      return {
        stages: summary,
        totals: {
          active_deals: activeDeals,
          pipeline_value: activePipelineValue,
          won_value: wonValue,
          lost_count: lostCount,
        },
      };
    } catch (error) {
      console.error('getPipelineSummary error:', error);
      throw new ApiError(500, 'Failed to get pipeline summary');
    }
  }

  // ========== DEAL STAGE HISTORY ==========

  async getDealStageHistory(companyId: string, dealId: string) {
    await this.ensureTables();
    try {
      // Verify deal belongs to company
      const check = await db.execute(sql`
        SELECT id FROM crm_deals WHERE id = ${dealId} AND company_id = ${companyId}
      `);
      if (((check as any).rows || check || []).length === 0) {
        throw new ApiError(404, 'Deal not found');
      }

      const result = await db.execute(sql`
        SELECT h.*,
          fs.name as from_stage_name, fs.color as from_stage_color,
          ts.name as to_stage_name, ts.color as to_stage_color,
          u.name as moved_by_name
        FROM crm_deal_stage_history h
        LEFT JOIN crm_stages fs ON h.from_stage_id = fs.id
        LEFT JOIN crm_stages ts ON h.to_stage_id = ts.id
        LEFT JOIN users u ON h.moved_by = u.id
        WHERE h.deal_id = ${dealId}
        ORDER BY h.created_at DESC
      `);
      return (result as any).rows || result || [];
    } catch (error) {
      if (error instanceof ApiError) throw error;
      console.error('getDealStageHistory error:', error);
      throw new ApiError(500, 'Failed to get deal stage history');
    }
  }

  // ========== DEAL DOCUMENTS ==========

  async getDealDocuments(companyId: string, dealId: string) {
    await this.ensureTables();
    try {
      const check = await db.execute(sql`
        SELECT id FROM crm_deals WHERE id = ${dealId} AND company_id = ${companyId}
      `);
      if (((check as any).rows || check || []).length === 0) {
        throw new ApiError(404, 'Deal not found');
      }

      const result = await db.execute(sql`
        SELECT * FROM crm_deal_documents WHERE deal_id = ${dealId} ORDER BY created_at ASC
      `);
      return (result as any).rows || result || [];
    } catch (error) {
      if (error instanceof ApiError) throw error;
      console.error('getDealDocuments error:', error);
      throw new ApiError(500, 'Failed to get deal documents');
    }
  }

  // ========== CUSTOMER HEALTH ==========

  async getCustomerHealth(companyId: string) {
    await this.ensureTables();
    try {
      const result = await db.execute(sql`
        SELECT
          e.id,
          e.name,
          e.cuit,
          (
            SELECT MAX(o.created_at)
            FROM orders o
            JOIN customers c ON o.customer_id = c.id
            WHERE c.enterprise_id = e.id AND o.company_id = ${companyId}
          ) as last_order_date,
          COALESCE((
            SELECT SUM(i.total)
            FROM invoices i
            JOIN customers c ON i.customer_id = c.id
            WHERE c.enterprise_id = e.id AND i.company_id = ${companyId} AND i.status != 'cancelled'
          ), 0)::decimal as total_revenue,
          COALESCE((
            SELECT COUNT(*)
            FROM crm_deals d
            WHERE d.enterprise_id = e.id AND d.company_id = ${companyId} AND d.stage NOT IN ('cobrado', 'perdido')
          ), 0)::int as active_deals,
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
