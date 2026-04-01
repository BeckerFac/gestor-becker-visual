import { db } from '../../config/db';
import { sql } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';
import { crmService } from './crm.service';

interface HandleEventParams {
  companyId: string;
  event: string;
  enterpriseId?: string;
  customerId?: string;
  documentId: string;
  documentType: 'quote' | 'order' | 'invoice' | 'cobro';
  metadata?: { title?: string; amount?: number };
}

export class CrmSyncService {
  /**
   * Main entry point for all CRM auto-sync events.
   * Called from quotes, orders, invoices, cobros services.
   * NEVER throws -- errors are logged but don't block the caller.
   */
  async handleEvent(params: HandleEventParams): Promise<void> {
    try {
      await crmService.ensureTables();
      await crmService.ensureDefaultStages(params.companyId);

      const { companyId, event, documentId, documentType } = params;

      // 1. Find target stage with this trigger_event for this company
      const targetStageResult = await db.execute(sql`
        SELECT id, name, stage_order, is_loss_stage
        FROM crm_stages
        WHERE company_id = ${companyId} AND trigger_event = ${event}
        LIMIT 1
      `);
      const targetStage = ((targetStageResult as any).rows || [])[0];

      // 2. If no stage has this trigger, still link document but don't move
      // 3. Find active deal linked to this document (via crm_deal_documents)
      //    OR find active deal for this enterprise
      //    OR create new deal
      let deal = await this.findDealForDocument(companyId, documentId, documentType);

      if (!deal && params.enterpriseId) {
        deal = await this.findActiveDealForEnterprise(companyId, params.enterpriseId);
      }

      if (!deal && params.customerId && !params.enterpriseId) {
        deal = await this.findActiveDealForCustomer(companyId, params.customerId);
      }

      if (!deal && targetStage) {
        // Create new deal with enterprise name
        const title = await this.buildDealTitle(params);
        deal = await this.createDealForEvent(companyId, params, targetStage.id, title);
      }

      if (!deal) return;

      // 4. Link document to deal (ignore if already linked)
      await this.linkDocumentToDeal(deal.id, documentType, documentId);

      // If no target stage for this trigger, just link doc and recalculate
      if (!targetStage) {
        await this.recalculateActualValue(deal.id);
        await this.updateDealValue(deal.id, params.metadata?.amount);
        return;
      }

      // 5. Check if target stage is FORWARD from current stage (by order)
      const currentStageOrder = await this.getStageOrder(deal.stage_id);
      const targetStageOrder = targetStage.stage_order;

      // If loss event, handle separately
      if (targetStage.is_loss_stage) {
        await db.execute(sql`
          UPDATE crm_deals SET
            stage_id = ${targetStage.id},
            stage = ${targetStage.name.toLowerCase()},
            lost_reason = ${event},
            completed_at = NOW(),
            updated_at = NOW()
          WHERE id = ${deal.id}
        `);

        await this.recordStageHistory(deal.id, deal.stage_id, targetStage.id, null, true, event);
        return;
      }

      // Only move forward
      if (currentStageOrder !== null && targetStageOrder <= currentStageOrder) {
        // Still recalculate values even if not moving
        await this.recalculateActualValue(deal.id);
        await this.updateDealValue(deal.id, params.metadata?.amount);
        return;
      }

      // 6. Check manual_override_at - if set and < 24hrs ago, don't auto-move
      if (deal.manual_override_at) {
        const overrideTime = new Date(deal.manual_override_at).getTime();
        const twentyFourHoursAgo = Date.now() - (24 * 60 * 60 * 1000);
        if (overrideTime > twentyFourHoursAgo) return;
      }

      // Check if deal is completed or lost
      if (deal.completed_at) return;

      // 7. Move deal to target stage
      await db.execute(sql`
        UPDATE crm_deals SET
          stage_id = ${targetStage.id},
          stage = ${targetStage.name.toLowerCase()},
          updated_at = NOW()
        WHERE id = ${deal.id}
      `);

      await this.recordStageHistory(deal.id, deal.stage_id, targetStage.id, null, true, event);

      // 9. If event is payment_received: set completed_at
      if (event === 'payment_received') {
        await db.execute(sql`
          UPDATE crm_deals SET completed_at = NOW() WHERE id = ${deal.id}
        `);
      }

      // 10. Recalculate actual_value from linked invoices
      await this.recalculateActualValue(deal.id);
      await this.updateDealValue(deal.id, params.metadata?.amount);
    } catch (error) {
      console.error('CRM sync handleEvent error:', error);
      // Never throw -- CRM sync must not block the calling service
    }
  }

  /**
   * Build a meaningful deal title from enterprise name.
   */
  private async buildDealTitle(params: HandleEventParams): Promise<string> {
    if (params.metadata?.title) return params.metadata.title;

    // Try to get enterprise name
    if (params.enterpriseId) {
      try {
        const result = await db.execute(sql`SELECT name FROM enterprises WHERE id = ${params.enterpriseId}`);
        const name = ((result as any).rows || [])[0]?.name;
        if (name) return name;
      } catch { /* fallback */ }
    }

    // Try customer name
    if (params.customerId) {
      try {
        const result = await db.execute(sql`SELECT name FROM customers WHERE id = ${params.customerId}`);
        const name = ((result as any).rows || [])[0]?.name;
        if (name) return name;
      } catch { /* fallback */ }
    }

    return `Oportunidad - ${params.documentType}`;
  }

  /**
   * Update deal value from metadata if higher.
   */
  private async updateDealValue(dealId: string, amount?: number): Promise<void> {
    if (!amount || amount <= 0) return;
    try {
      await db.execute(sql`
        UPDATE crm_deals SET
          estimated_value = GREATEST(COALESCE(estimated_value, 0), ${amount}),
          value = GREATEST(COALESCE(value, 0), ${amount})
        WHERE id = ${dealId}
      `);
    } catch { /* non-critical */ }
  }

  /**
   * Find a deal that is already linked to a specific document.
   */
  private async findDealForDocument(
    companyId: string,
    documentId: string,
    documentType: string,
  ): Promise<any | null> {
    const result = await db.execute(sql`
      SELECT d.*
      FROM crm_deals d
      JOIN crm_deal_documents dd ON dd.deal_id = d.id
      WHERE d.company_id = ${companyId}
        AND dd.document_type = ${documentType}
        AND dd.document_id = ${documentId}
      LIMIT 1
    `);
    const rows = (result as any).rows || result || [];
    return rows[0] || null;
  }

  /**
   * Find a deal linked to a related document.
   * E.g., when creating an order from a quote, find the deal linked to that quote.
   */
  async findDealByRelatedDocument(
    companyId: string,
    relatedDocId: string,
    relatedDocType: string,
  ): Promise<any | null> {
    const result = await db.execute(sql`
      SELECT d.*
      FROM crm_deals d
      JOIN crm_deal_documents dd ON dd.deal_id = d.id
      WHERE d.company_id = ${companyId}
        AND dd.document_type = ${relatedDocType}
        AND dd.document_id = ${relatedDocId}
        AND d.completed_at IS NULL
      LIMIT 1
    `);
    const rows = (result as any).rows || result || [];
    return rows[0] || null;
  }

  /**
   * Find the most recent active deal for an enterprise.
   * No longer filters by document type — one deal per enterprise is the pattern.
   */
  private async findActiveDealForEnterprise(
    companyId: string,
    enterpriseId: string,
  ): Promise<any | null> {
    const result = await db.execute(sql`
      SELECT d.*
      FROM crm_deals d
      LEFT JOIN crm_stages s ON d.stage_id = s.id
      WHERE d.company_id = ${companyId}
        AND d.enterprise_id = ${enterpriseId}
        AND d.completed_at IS NULL
        AND (s.is_loss_stage = false OR s.is_loss_stage IS NULL)
      ORDER BY d.updated_at DESC
      LIMIT 1
    `);
    const rows = (result as any).rows || result || [];
    return rows[0] || null;
  }

  /**
   * Find an active deal for a customer (when no enterprise is available).
   */
  private async findActiveDealForCustomer(
    companyId: string,
    customerId: string,
  ): Promise<any | null> {
    const result = await db.execute(sql`
      SELECT d.*
      FROM crm_deals d
      LEFT JOIN crm_stages s ON d.stage_id = s.id
      WHERE d.company_id = ${companyId}
        AND d.customer_id = ${customerId}
        AND d.enterprise_id IS NULL
        AND d.completed_at IS NULL
        AND (s.is_loss_stage = false OR s.is_loss_stage IS NULL)
      ORDER BY d.updated_at DESC
      LIMIT 1
    `);
    const rows = (result as any).rows || result || [];
    return rows[0] || null;
  }

  /**
   * Create a new deal from an event.
   */
  private async createDealForEvent(
    companyId: string,
    params: HandleEventParams,
    stageId: string,
    title: string,
  ): Promise<any | null> {
    const dealId = uuid();

    // Get stage name for backward compat
    const stageResult = await db.execute(sql`SELECT name FROM crm_stages WHERE id = ${stageId}`);
    const stageName = ((stageResult as any).rows || [])[0]?.name || 'contacto';

    await db.execute(sql`
      INSERT INTO crm_deals (id, company_id, enterprise_id, customer_id, title, value, stage, stage_id, estimated_value, priority, created_by)
      VALUES (
        ${dealId},
        ${companyId},
        ${params.enterpriseId || null},
        ${params.customerId || null},
        ${title},
        ${params.metadata?.amount || 0},
        ${stageName.toLowerCase()},
        ${stageId},
        ${params.metadata?.amount || 0},
        'normal',
        ${null}
      )
    `);

    // Record initial stage history
    await this.recordStageHistory(dealId, null, stageId, null, true, params.event);

    const result = await db.execute(sql`SELECT * FROM crm_deals WHERE id = ${dealId}`);
    return ((result as any).rows || result || [])[0] || null;
  }

  /**
   * Link a document to a deal. Idempotent (ignores if already linked).
   */
  async linkDocumentToDeal(dealId: string, documentType: string, documentId: string): Promise<void> {
    try {
      await db.execute(sql`
        INSERT INTO crm_deal_documents (id, deal_id, document_type, document_id)
        VALUES (${uuid()}, ${dealId}, ${documentType}, ${documentId})
        ON CONFLICT (deal_id, document_type, document_id) DO NOTHING
      `);
    } catch (error) {
      // Silently ignore duplicate key errors
      console.warn('linkDocumentToDeal warning:', error);
    }
  }

  /**
   * Get the stage_order for a given stage_id.
   */
  private async getStageOrder(stageId: string | null): Promise<number | null> {
    if (!stageId) return null;
    const result = await db.execute(sql`
      SELECT stage_order FROM crm_stages WHERE id = ${stageId}
    `);
    const rows = (result as any).rows || result || [];
    return rows[0]?.stage_order ?? null;
  }

  /**
   * Record a stage transition in history.
   */
  private async recordStageHistory(
    dealId: string,
    fromStageId: string | null,
    toStageId: string,
    movedBy: string | null,
    isAuto: boolean,
    triggerEvent: string | null,
  ): Promise<void> {
    await db.execute(sql`
      INSERT INTO crm_deal_stage_history (id, deal_id, from_stage_id, to_stage_id, moved_by, is_auto, trigger_event)
      VALUES (${uuid()}, ${dealId}, ${fromStageId}, ${toStageId}, ${movedBy}, ${isAuto}, ${triggerEvent})
    `);
  }

  /**
   * Recalculate deal's actual_value from linked invoices.
   */
  private async recalculateActualValue(dealId: string): Promise<void> {
    try {
      const result = await db.execute(sql`
        SELECT COALESCE(SUM(CAST(i.total_amount AS decimal)), 0) as total
        FROM crm_deal_documents dd
        JOIN invoices i ON dd.document_id = i.id
        WHERE dd.deal_id = ${dealId}
          AND dd.document_type = 'invoice'
          AND i.status = 'authorized'
      `);
      const total = parseFloat(((result as any).rows || [])[0]?.total || '0');

      if (total > 0) {
        await db.execute(sql`
          UPDATE crm_deals SET actual_value = ${total} WHERE id = ${dealId}
        `);
      }
    } catch (error) {
      console.warn('recalculateActualValue warning:', error);
    }
  }

  /**
   * Comprehensive bootstrap: creates/updates deals from ALL existing data.
   * Scans orders, quotes, invoices, cobros to determine correct stage.
   * Links all related documents to each deal.
   */
  async bootstrapFromExistingData(companyId: string): Promise<{ created: number; updated: number }> {
    try {
      await crmService.ensureTables();
      await crmService.ensureDefaultStages(companyId);

      // Get stages for mapping
      const stagesResult = await db.execute(sql`
        SELECT id, name, stage_order, trigger_event, is_loss_stage
        FROM crm_stages WHERE company_id = ${companyId}
        ORDER BY stage_order ASC
      `);
      const stages = (stagesResult as any).rows || [];
      const stageByTrigger = new Map<string, any>();
      const stageByName = new Map<string, any>();
      for (const s of stages) {
        if (s.trigger_event) stageByTrigger.set(s.trigger_event, s);
        stageByName.set(s.name.toLowerCase(), s);
      }

      // Get ALL enterprises that have ANY activity (orders, quotes, invoices, or cobros)
      const enterprisesResult = await db.execute(sql`
        SELECT DISTINCT eid as enterprise_id, e.name as enterprise_name FROM (
          SELECT enterprise_id as eid FROM orders WHERE company_id = ${companyId} AND enterprise_id IS NOT NULL
          UNION
          SELECT enterprise_id as eid FROM invoices WHERE company_id = ${companyId} AND enterprise_id IS NOT NULL
          UNION
          SELECT enterprise_id as eid FROM cobros WHERE company_id = ${companyId} AND enterprise_id IS NOT NULL
        ) sub
        LEFT JOIN enterprises e ON e.id = sub.eid
        WHERE sub.eid IS NOT NULL
      `);
      const enterprises = (enterprisesResult as any).rows || [];

      let created = 0;
      let updated = 0;

      for (const ent of enterprises) {
        if (!ent.enterprise_id) continue;

        // Check if active deal already exists for this enterprise
        const existingResult = await db.execute(sql`
          SELECT id, stage_id, stage FROM crm_deals
          WHERE company_id = ${companyId} AND enterprise_id = ${ent.enterprise_id}
          AND completed_at IS NULL
          LIMIT 1
        `);
        const existingDeal = ((existingResult as any).rows || [])[0];

        // Gather all document data for this enterprise
        const hasPayment = await db.execute(sql`
          SELECT 1 FROM cobros WHERE company_id = ${companyId} AND enterprise_id = ${ent.enterprise_id} LIMIT 1
        `).then(r => ((r as any).rows || []).length > 0).catch(() => false);

        const hasInvoice = await db.execute(sql`
          SELECT 1 FROM invoices WHERE company_id = ${companyId} AND enterprise_id = ${ent.enterprise_id} AND status = 'authorized' LIMIT 1
        `).then(r => ((r as any).rows || []).length > 0).catch(() => false);

        const orderStats = await db.execute(sql`
          SELECT COUNT(*)::int as cnt,
            COALESCE(SUM(CAST(total_amount AS decimal)), 0) as total_value,
            BOOL_OR(status = 'entregado') as has_delivered
          FROM orders WHERE company_id = ${companyId} AND enterprise_id = ${ent.enterprise_id}
        `).then(r => ((r as any).rows || [])[0] || { cnt: 0, total_value: 0, has_delivered: false }).catch(() => ({ cnt: 0, total_value: 0, has_delivered: false }));

        // Get invoice total for value
        const invoiceTotal = await db.execute(sql`
          SELECT COALESCE(SUM(CAST(total_amount AS decimal)), 0) as total
          FROM invoices WHERE company_id = ${companyId} AND enterprise_id = ${ent.enterprise_id} AND status = 'authorized'
        `).then(r => parseFloat(((r as any).rows || [])[0]?.total || '0')).catch(() => 0);

        const dealValue = Math.max(Number(orderStats.total_value) || 0, invoiceTotal);

        // Determine target stage (most advanced)
        let targetStage: any = null;
        if (hasPayment && stageByTrigger.get('payment_received')) {
          targetStage = stageByTrigger.get('payment_received');
        } else if (hasInvoice && stageByTrigger.get('invoice_authorized')) {
          targetStage = stageByTrigger.get('invoice_authorized');
        } else if (orderStats.has_delivered && stageByTrigger.get('order_delivered')) {
          targetStage = stageByTrigger.get('order_delivered');
        } else if (Number(orderStats.cnt) > 0 && stageByTrigger.get('order_created')) {
          targetStage = stageByTrigger.get('order_created');
        } else {
          targetStage = stageByName.get('contacto') || stages.find((s: any) => !s.is_loss_stage);
        }

        if (!targetStage) continue;

        const dealId = existingDeal?.id || uuid();

        if (existingDeal) {
          // Update existing deal to correct stage if it's more advanced
          const currentStageOrder = stages.find((s: any) => s.id === existingDeal.stage_id)?.stage_order || 0;
          if (targetStage.stage_order > currentStageOrder) {
            await db.execute(sql`
              UPDATE crm_deals SET
                stage_id = ${targetStage.id},
                stage = ${targetStage.name.toLowerCase()},
                value = GREATEST(COALESCE(value, 0), ${dealValue}),
                estimated_value = GREATEST(COALESCE(estimated_value, 0), ${dealValue}),
                actual_value = ${invoiceTotal},
                updated_at = NOW()
              WHERE id = ${existingDeal.id}
            `);
            updated++;
          } else {
            // Still update values
            await db.execute(sql`
              UPDATE crm_deals SET
                value = GREATEST(COALESCE(value, 0), ${dealValue}),
                estimated_value = GREATEST(COALESCE(estimated_value, 0), ${dealValue}),
                actual_value = ${invoiceTotal},
                updated_at = NOW()
              WHERE id = ${existingDeal.id}
            `);
          }
        } else {
          // Create new deal with enterprise name as title
          await db.execute(sql`
            INSERT INTO crm_deals (id, company_id, enterprise_id, title, value, stage, stage_id, priority, estimated_value, actual_value)
            VALUES (
              ${dealId}, ${companyId}, ${ent.enterprise_id},
              ${ent.enterprise_name || 'Oportunidad'},
              ${dealValue}, ${targetStage.name.toLowerCase()}, ${targetStage.id},
              'normal', ${dealValue}, ${invoiceTotal}
            )
          `);
          created++;
        }

        // Link ALL documents for this enterprise to the deal
        await this.linkAllDocumentsForEnterprise(dealId, companyId, ent.enterprise_id);
      }

      return { created, updated };
    } catch (error) {
      console.error('CRM bootstrap error:', error);
      return { created: 0, updated: 0 };
    }
  }

  /**
   * Link all orders, invoices, cobros for an enterprise to a deal.
   */
  private async linkAllDocumentsForEnterprise(dealId: string, companyId: string, enterpriseId: string): Promise<void> {
    // Link orders
    const orders = await db.execute(sql`SELECT id FROM orders WHERE company_id = ${companyId} AND enterprise_id = ${enterpriseId}`);
    for (const doc of ((orders as any).rows || [])) {
      await this.linkDocumentToDeal(dealId, 'order', doc.id);
    }

    // Link invoices
    const invoices = await db.execute(sql`SELECT id FROM invoices WHERE company_id = ${companyId} AND enterprise_id = ${enterpriseId}`);
    for (const doc of ((invoices as any).rows || [])) {
      await this.linkDocumentToDeal(dealId, 'invoice', doc.id);
    }

    // Link cobros
    const cobros = await db.execute(sql`SELECT id FROM cobros WHERE company_id = ${companyId} AND enterprise_id = ${enterpriseId}`);
    for (const doc of ((cobros as any).rows || [])) {
      await this.linkDocumentToDeal(dealId, 'cobro', doc.id);
    }
  }
}

export const crmSyncService = new CrmSyncService();
