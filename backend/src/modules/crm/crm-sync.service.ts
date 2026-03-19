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

      // 2. If no stage has this trigger, return (trigger disabled by user)
      if (!targetStage) return;

      // 3. Find active deal linked to this document (via crm_deal_documents)
      //    OR find active deal for this enterprise (if no direct link)
      //    OR create new deal
      let deal = await this.findDealForDocument(companyId, documentId, documentType);

      if (!deal && params.enterpriseId) {
        deal = await this.findActiveDealForEnterprise(companyId, params.enterpriseId, documentType);
      }

      if (!deal && params.customerId && !params.enterpriseId) {
        deal = await this.findActiveDealForCustomer(companyId, params.customerId, documentType);
      }

      if (!deal) {
        // Create new deal
        const title = params.metadata?.title || `Deal - ${documentType}`;
        deal = await this.createDealForEvent(companyId, params, targetStage.id, title);
      }

      if (!deal) return;

      // 4. Link document to deal (ignore if already linked)
      await this.linkDocumentToDeal(deal.id, documentType, documentId);

      // 5. Check if target stage is FORWARD from current stage (by order)
      const currentStageOrder = await this.getStageOrder(deal.stage_id);
      const targetStageOrder = targetStage.stage_order;

      // If loss event, handle separately
      if (targetStage.is_loss_stage) {
        // 8. Mark deal with lost_reason
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
      if (currentStageOrder !== null && targetStageOrder <= currentStageOrder) return;

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

      // Update estimated_value from metadata if provided
      if (params.metadata?.amount && params.metadata.amount > 0) {
        await db.execute(sql`
          UPDATE crm_deals SET
            estimated_value = GREATEST(estimated_value, ${params.metadata.amount}),
            value = GREATEST(value, ${params.metadata.amount})
          WHERE id = ${deal.id}
        `);
      }
    } catch (error) {
      console.error('CRM sync handleEvent error:', error);
      // Never throw -- CRM sync must not block the calling service
    }
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
      SELECT d.*, dd.document_type, dd.document_id
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
   * Find an active deal for an enterprise that doesn't already have a document of this type.
   */
  private async findActiveDealForEnterprise(
    companyId: string,
    enterpriseId: string,
    documentType: string,
  ): Promise<any | null> {
    // Find active deals for this enterprise that don't have a document of this type
    const result = await db.execute(sql`
      SELECT d.*
      FROM crm_deals d
      LEFT JOIN crm_stages s ON d.stage_id = s.id
      WHERE d.company_id = ${companyId}
        AND d.enterprise_id = ${enterpriseId}
        AND d.completed_at IS NULL
        AND (s.is_loss_stage = false OR s.is_loss_stage IS NULL)
        AND NOT EXISTS (
          SELECT 1 FROM crm_deal_documents dd
          WHERE dd.deal_id = d.id AND dd.document_type = ${documentType}
        )
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
    documentType: string,
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
        AND NOT EXISTS (
          SELECT 1 FROM crm_deal_documents dd
          WHERE dd.deal_id = d.id AND dd.document_type = ${documentType}
        )
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
}

export const crmSyncService = new CrmSyncService();
