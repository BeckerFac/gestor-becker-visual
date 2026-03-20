// SecretarIA — Main orchestrator service
// Handles incoming WhatsApp messages, phone linking, config, and usage tracking

import { db } from '../../config/db';
import { sql } from 'drizzle-orm';
import { ApiError } from '../../middlewares/errorHandler';
import logger from '../../config/logger';
import { whatsappClient, IncomingMessage } from './secretaria.whatsapp';
import { classifyIntent, generateResponse } from './secretaria.agents';
import {
  queryClients,
  queryProducts,
  queryInvoices,
  queryBalances,
  queryOrders,
  queryGeneral,
  morningBrief,
  sendDocument,
} from './secretaria.tools';
import { secretariaMemory } from './secretaria.memory';
import { SECRETARIA_CONFIG, SECRETARIA_PROMPTS } from './secretaria.config';
import { deepgramSTT } from './secretaria.stt';
import {
  WhatsAppWebhookPayload,
  SecretariaIntent,
  SecretariaContext,
  ConversationMessage,
  ToolResult,
  SecretariaConfig,
  LinkedPhone,
  UsageTracking,
} from './secretaria.types';
import { isIntentAllowedForRole, checkDailyLimit, checkMonthlyLimit } from './secretaria.access';
import { secretariaCredits } from './secretaria.credits';
import { billingService } from '../billing/billing.service';
import { getPlanAiFeatures, AiFeatures } from '../billing/plans.config';
import { secretariaSafety } from './secretaria.safety';
import { handleFallback } from './secretaria.fallback';

// ── Per-phone concurrency lock ──

const phoneProcessingLocks = new Map<string, Promise<void>>();

// ── Webhook deduplication (replay attack protection) ──

const processedMessageIds = new Map<string, number>();
const DEDUP_TTL_MS = 10 * 60 * 1000; // 10 minutes
const DEDUP_MAX_SIZE = 5000;

function isMessageAlreadyProcessed(messageId: string): boolean {
  const now = Date.now();

  // Periodic cleanup
  if (processedMessageIds.size > DEDUP_MAX_SIZE) {
    for (const [id, ts] of processedMessageIds) {
      if (now - ts > DEDUP_TTL_MS) {
        processedMessageIds.delete(id);
      }
    }
  }

  if (processedMessageIds.has(messageId)) {
    return true;
  }

  processedMessageIds.set(messageId, now);
  return false;
}

function withPhoneLock(phoneNumber: string, fn: () => Promise<void>): void {
  const previous = phoneProcessingLocks.get(phoneNumber) ?? Promise.resolve();
  const next = previous.then(fn).catch(err => {
    logger.error({ err, phoneNumber }, 'SecretarIA: error processing message');
  });
  phoneProcessingLocks.set(phoneNumber, next);

  // Cleanup entry once the chain settles
  next.finally(() => {
    if (phoneProcessingLocks.get(phoneNumber) === next) {
      phoneProcessingLocks.delete(phoneNumber);
    }
  });
}

// ── Helpers ──

async function executeTool(
  intent: SecretariaIntent,
  entities: Record<string, string>,
  companyId: string,
  phoneNumber?: string,
): Promise<ToolResult> {
  switch (intent) {
    case 'query_clients':
      return queryClients(companyId, entities);
    case 'query_products':
      return queryProducts(companyId, entities);
    case 'query_invoices':
      return queryInvoices(companyId, entities);
    case 'query_balances':
      return queryBalances(companyId, entities);
    case 'query_orders':
      return queryOrders(companyId, entities);
    case 'morning_brief':
      return morningBrief(companyId);
    case 'query_general':
      return queryGeneral(companyId, entities);
    case 'send_document':
      return sendDocument(companyId, entities, phoneNumber);
    case 'greeting':
      return { toolName: 'greeting', data: null, formatted: SECRETARIA_PROMPTS.greeting.replace('{{displayName}}', 'usuario') };
    case 'help':
      return { toolName: 'help', data: null, formatted: SECRETARIA_PROMPTS.help };
    case 'unknown':
    default:
      return {
        toolName: 'unknown',
        data: null,
        formatted: 'No entendi tu consulta. Escribi "ayuda" para ver lo que puedo hacer.',
      };
  }
}

function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

// ── Service ──

class SecretariaService {
  // --------------------------------------------------------------------------
  // handleIncomingMessage — main webhook entry point
  // --------------------------------------------------------------------------

  async handleIncomingMessage(payload: WhatsAppWebhookPayload): Promise<void> {
    const parsed = whatsappClient.parseIncomingMessage(payload);

    if (!parsed) {
      return; // Status update or unsupported message type
    }

    // Replay attack protection: deduplicate by WhatsApp message ID
    if (isMessageAlreadyProcessed(parsed.messageId)) {
      logger.debug({ messageId: parsed.messageId }, 'SecretarIA: duplicate message ignored');
      return;
    }

    // Serialize processing per phone number
    withPhoneLock(parsed.from, () => this.processMessage(parsed));
  }

  private async processMessage(message: IncomingMessage): Promise<void> {
    const phoneNumber = message.from;

    // Step 1: Look up phone -> company_id + user_id (SECURITY: server-side lookup)
    const link = await secretariaMemory.lookupPhone(phoneNumber);

    if (!link) {
      await whatsappClient.sendTextMessage(
        phoneNumber,
        'No tengo tu numero vinculado a ninguna empresa. ' +
        'Para conectarte, ingresa a GESTIA > SecretarIA y genera un codigo de vinculacion.',
      );
      return;
    }

    const { companyId, userId, displayName } = link;

    // Step 2: Check if SecretarIA is enabled for this company
    const config = await this.getConfig(companyId);
    if (!config.enabled) {
      await whatsappClient.sendTextMessage(
        phoneNumber,
        'SecretarIA esta desactivada para tu empresa. Pedi al administrador que la active desde GESTIA.',
      );
      return;
    }

    // Step 2.5: Check plan AI features and limits
    const aiFeatures = await this.getAiFeatures(companyId);

    if (!aiFeatures.enabled || !aiFeatures.whatsappEnabled) {
      await whatsappClient.sendTextMessage(
        phoneNumber,
        'WhatsApp IA no esta disponible en tu plan actual. Actualiza a Premium para acceder a SecretarIA por WhatsApp.',
      );
      return;
    }

    // Check daily limit
    const dailyCount = await secretariaMemory.getDailyMessageCount(companyId);
    const dailyCheck = checkDailyLimit(aiFeatures, dailyCount);
    if (!dailyCheck.allowed) {
      await whatsappClient.sendTextMessage(phoneNumber, dailyCheck.reason!);
      return;
    }

    // Check monthly limit
    const monthlyCount = await secretariaMemory.getMonthlyMessageCount(companyId);
    const availableCredits = await secretariaCredits.getAvailableCredits(companyId);
    const monthlyCheck = checkMonthlyLimit(aiFeatures, monthlyCount, availableCredits);
    if (!monthlyCheck.allowed) {
      // Fallback: use rule-based responses without LLM
      const fallbackResult = await handleFallback(companyId, message.text || '');
      await whatsappClient.sendTextMessage(phoneNumber, fallbackResult.formatted);
      return;
    }

    // If over monthly plan limit but has credits, deduct a credit
    const overMonthlyPlanLimit = isFinite(aiFeatures.chatMessagesPerMonth) &&
      monthlyCount >= aiFeatures.chatMessagesPerMonth;
    if (overMonthlyPlanLimit && availableCredits > 0) {
      await secretariaCredits.consumeCredit(companyId);
    }

    // Step 3: Mark as read
    await whatsappClient.markAsRead(message.messageId);

    // Step 4: Extract text content (supports text + audio messages)
    let textContent = message.text || '';

    if (message.type === 'audio' && message.mediaId) {
      const sttResult = await deepgramSTT.transcribeFromWhatsApp(
        message.mediaId,
        (id) => whatsappClient.downloadMedia(id),
      );

      // Validate transcription quality
      const validation = deepgramSTT.validateAndFormat(sttResult);

      if (validation && !validation.warning) {
        // Hard error (empty, too long, etc.) — respond and stop
        await whatsappClient.sendTextMessage(phoneNumber, validation.text);
        return;
      }

      if (validation?.warning) {
        // Low confidence or non-Spanish — send warning, then continue processing
        await whatsappClient.sendTextMessage(phoneNumber, validation.warning);
      }

      textContent = sttResult.text;

      // Track STT usage
      await secretariaMemory.trackUsage(companyId, {
        stt_minutes: sttResult.duration_seconds / 60,
        estimated_cost_usd: deepgramSTT.estimateCostUsd(sttResult.duration_seconds),
      });

      logger.info(
        { companyId, phoneNumber, duration: sttResult.duration_seconds, confidence: sttResult.confidence },
        'SecretarIA: audio transcribed',
      );
    }

    if (!textContent.trim()) {
      await whatsappClient.sendTextMessage(
        phoneNumber,
        'Por ahora solo puedo procesar mensajes de texto y audio. Enviame tu consulta escrita o por audio.',
      );
      return;
    }

    // Step 5: Save incoming message
    await this.saveConversationMessage(companyId, phoneNumber, 'user', textContent);

    // Step 5.1: Safety — check for human escalation request
    if (secretariaSafety.isEscalationRequest(textContent)) {
      await secretariaSafety.escalateToHuman(companyId, userId, 'user_requested', textContent, 'whatsapp', phoneNumber);
      const escMsg = 'Entiendo, voy a derivar tu consulta a un humano. Te van a contactar pronto.';
      await whatsappClient.sendTextMessage(phoneNumber, escMsg);
      await this.saveConversationMessage(companyId, phoneNumber, 'assistant', escMsg);
      return;
    }

    // Step 5.2: Safety — check for pending action confirmation/cancellation
    const pendingAction = await secretariaSafety.getPendingAction(companyId, phoneNumber);
    if (pendingAction) {
      if (secretariaSafety.isConfirmation(textContent)) {
        await secretariaSafety.confirmPendingAction(pendingAction.id);
        const confirmMsg = `Listo! La operacion "${pendingAction.actionType}" fue confirmada y ejecutada.`;
        await whatsappClient.sendTextMessage(phoneNumber, confirmMsg);
        await this.saveConversationMessage(companyId, phoneNumber, 'assistant', confirmMsg);
        return;
      }
      if (secretariaSafety.isCancellation(textContent)) {
        await secretariaSafety.cancelPendingAction(pendingAction.id);
        const cancelMsg = 'Operacion cancelada. Si necesitas otra cosa, escribime.';
        await whatsappClient.sendTextMessage(phoneNumber, cancelMsg);
        await this.saveConversationMessage(companyId, phoneNumber, 'assistant', cancelMsg);
        return;
      }
      // Not a confirmation/cancellation — expire old action and continue
      await secretariaSafety.cancelPendingAction(pendingAction.id);
    }

    // Step 5.3: Safety — track corrections for escalation triggers
    const channelKey = `${companyId}:${phoneNumber}`;
    if (secretariaSafety.isCorrection(textContent)) {
      secretariaSafety.trackCorrection(channelKey, true);
      const lastMsgs = await this.loadRecentMessages(companyId, phoneNumber, 2);
      const lastAiResponse = lastMsgs.find(m => m.role === 'assistant')?.content || '';
      await secretariaSafety.logAIError(companyId, userId, 'user_correction', {
        userMessage: textContent,
        aiResponse: lastAiResponse,
        correction: textContent,
      });
    } else {
      secretariaSafety.trackCorrection(channelKey, false);
    }

    // Step 6: Load context (last N messages + memory)
    const recentMessages = await this.loadRecentMessages(
      companyId,
      phoneNumber,
      SECRETARIA_CONFIG.context.recentMessagesCount,
    );
    const companyName = await this.getCompanyName(companyId);
    const memoryContext = await secretariaMemory.getMemoryContext(companyId, userId);
    const memory: Record<string, string> = memoryContext ? { context: memoryContext } : {};

    const context: SecretariaContext = {
      companyId,
      userId,
      phoneNumber,
      displayName,
      recentMessages,
      memory,
    };

    try {
      // Step 7: Classify intent
      const intentResult = await classifyIntent(textContent, context);

      // Step 7.1: Safety — track low confidence for escalation triggers
      secretariaSafety.trackLowConfidence(channelKey, intentResult.confidence);

      // Step 7.2: Safety — pre-execution check
      const safetyCheck = await secretariaSafety.checkSafety({
        companyId,
        userId,
        intent: intentResult.intent,
        entities: intentResult.entities,
      });

      if (!safetyCheck.safe) {
        if (safetyCheck.escalateToHuman) {
          await secretariaSafety.escalateToHuman(
            companyId, userId, safetyCheck.reason || 'safety_check', textContent, 'whatsapp', phoneNumber,
          );
          const escMsg = safetyCheck.reason || 'Voy a derivar tu consulta a un humano. Te van a contactar pronto.';
          await whatsappClient.sendTextMessage(phoneNumber, escMsg);
          await this.saveConversationMessage(companyId, phoneNumber, 'assistant', escMsg);
          return;
        }

        if (safetyCheck.requiresConfirmation) {
          await secretariaSafety.createPendingAction({
            companyId,
            userId,
            channel: 'whatsapp',
            channelId: phoneNumber,
            actionType: intentResult.intent,
            actionData: { entities: intentResult.entities, originalText: textContent },
          });
          const confirmMsg = `${safetyCheck.reason}\n\nConfirmas? (si/no)`;
          await whatsappClient.sendTextMessage(phoneNumber, confirmMsg);
          await this.saveConversationMessage(companyId, phoneNumber, 'assistant', confirmMsg);
          return;
        }

        const blockMsg = safetyCheck.reason || 'No puedo procesar esa consulta por razones de seguridad.';
        await whatsappClient.sendTextMessage(phoneNumber, blockMsg);
        await this.saveConversationMessage(companyId, phoneNumber, 'assistant', blockMsg);
        return;
      }

      // Step 7.5: Role-based intent filtering (look up user role from DB)
      const userRole = await this.getUserRole(userId);
      if (!isIntentAllowedForRole(userRole, intentResult.intent)) {
        const blockedMsg = 'No tenes permiso para acceder a esa informacion. Contacta a tu administrador.';
        await whatsappClient.sendTextMessage(phoneNumber, blockedMsg);
        await this.saveConversationMessage(companyId, phoneNumber, 'assistant', blockedMsg);
        return;
      }

      // Step 8: Execute tool based on intent
      const toolResult = await executeTool(intentResult.intent, intentResult.entities, companyId, phoneNumber);

      // Step 9: Generate natural language response
      let responseText = await generateResponse(toolResult, context, companyName);

      // Step 9.1: Safety — post-execution response validation
      const responseValidation = await secretariaSafety.validateResponse(responseText, companyId);
      if (!responseValidation.safe && responseValidation.sanitizedResponse) {
        responseText = responseValidation.sanitizedResponse;
      }

      // Step 9.2: Safety — validate tool result consistency (hallucination detection)
      const consistency = secretariaSafety.validateToolResultConsistency(toolResult, responseText);
      if (!consistency.consistent && consistency.warning) {
        responseText += `\n\n_${consistency.warning}_`;
      }

      // Step 10: Send response via WhatsApp
      await whatsappClient.sendTextMessage(phoneNumber, responseText);

      // Step 11: Save outgoing message
      await this.saveConversationMessage(companyId, phoneNumber, 'assistant', responseText);

      // Step 12: Update usage tracking
      await secretariaMemory.trackUsage(companyId, {
        messages_received: 1,
        messages_sent: 1,
      });

      // Step 13: Detect and save memory updates if new info detected
      await secretariaMemory.detectAndSaveMemory(companyId, userId, textContent, responseText);
    } catch (error: any) {
      logger.error({ err: error, companyId, phoneNumber }, 'SecretarIA: error in message pipeline');

      // Safety — log AI errors for learning
      await secretariaSafety.logAIError(companyId, userId, 'pipeline_error', {
        userMessage: textContent,
        correction: error?.message || 'Unknown error',
      }).catch(() => {});

      await whatsappClient.sendTextMessage(
        phoneNumber,
        'Perdon, tuve un problema procesando tu consulta. Intenta de nuevo en unos segundos.',
      );
    }
  }

  // --------------------------------------------------------------------------
  // handleWebChat — In-app chat entry point (no WhatsApp, uses JWT identity)
  // --------------------------------------------------------------------------

  async handleWebChat(
    companyId: string,
    userId: string,
    message: string,
    displayName: string,
    userRole?: string,
  ): Promise<{ response: string; intent: string; attachments?: { type: string; url: string; name: string }[] }> {
    const channelId = `web-${userId}`;

    // Step 1: Check if SecretarIA is enabled
    const config = await this.getConfig(companyId);
    if (!config.enabled) {
      return {
        response: 'SecretarIA esta desactivada. Activa SecretarIA desde Configuracion > SecretarIA.',
        intent: 'disabled',
      };
    }

    // Step 2: Get plan AI features and check limits
    const aiFeatures = await this.getAiFeatures(companyId);

    if (!aiFeatures.enabled) {
      return {
        response: 'AI no esta disponible en tu plan actual. Actualiza a Premium para acceder a SecretarIA.',
        intent: 'plan_blocked',
      };
    }

    // Step 2a: Check daily limit
    const dailyCount = await secretariaMemory.getDailyMessageCount(companyId);
    const dailyCheck = checkDailyLimit(aiFeatures, dailyCount);
    if (!dailyCheck.allowed) {
      return {
        response: dailyCheck.reason!,
        intent: 'daily_limit_exceeded',
      };
    }

    // Step 2b: Check monthly limit
    const monthlyCount = await secretariaMemory.getMonthlyMessageCount(companyId);
    const availableCredits = await secretariaCredits.getAvailableCredits(companyId);
    const monthlyCheck = checkMonthlyLimit(aiFeatures, monthlyCount, availableCredits);
    if (!monthlyCheck.allowed) {
      // Fallback: use rule-based responses without LLM
      const fallbackResult = await handleFallback(companyId, message);
      return {
        response: fallbackResult.formatted,
        intent: 'fallback',
      };
    }

    // Step 2c: If over monthly plan limit but has credits, deduct a credit
    const overMonthlyPlanLimit = isFinite(aiFeatures.chatMessagesPerMonth) &&
      monthlyCount >= aiFeatures.chatMessagesPerMonth;
    if (overMonthlyPlanLimit && availableCredits > 0) {
      await secretariaCredits.consumeCredit(companyId);
    }

    // Step 3: Truncate very long messages
    const truncatedMessage = message.slice(0, 2000);

    // Step 4: Save user message
    await this.saveConversationMessage(companyId, channelId, 'user', truncatedMessage);

    // Step 4.1: Safety — check for human escalation request
    if (secretariaSafety.isEscalationRequest(truncatedMessage)) {
      await secretariaSafety.escalateToHuman(companyId, userId, 'user_requested', truncatedMessage, 'web', channelId);
      const escResponse = 'Entiendo, voy a derivar tu consulta a un humano. Te van a contactar pronto.';
      await this.saveConversationMessage(companyId, channelId, 'assistant', escResponse);
      return { response: escResponse, intent: 'human_escalation' };
    }

    // Step 4.2: Safety — check for pending action confirmation/cancellation
    const pendingAction = await secretariaSafety.getPendingAction(companyId, channelId);
    if (pendingAction) {
      if (secretariaSafety.isConfirmation(truncatedMessage)) {
        await secretariaSafety.confirmPendingAction(pendingAction.id);
        const confirmResponse = `Listo! La operacion "${pendingAction.actionType}" fue confirmada y ejecutada.`;
        await this.saveConversationMessage(companyId, channelId, 'assistant', confirmResponse);
        return { response: confirmResponse, intent: 'action_confirmed' };
      }
      if (secretariaSafety.isCancellation(truncatedMessage)) {
        await secretariaSafety.cancelPendingAction(pendingAction.id);
        const cancelResponse = 'Operacion cancelada. Si necesitas otra cosa, escribime.';
        await this.saveConversationMessage(companyId, channelId, 'assistant', cancelResponse);
        return { response: cancelResponse, intent: 'action_cancelled' };
      }
      await secretariaSafety.cancelPendingAction(pendingAction.id);
    }

    // Step 4.3: Safety — track corrections
    const webChannelKey = `${companyId}:${channelId}`;
    if (secretariaSafety.isCorrection(truncatedMessage)) {
      secretariaSafety.trackCorrection(webChannelKey, true);
      const lastMsgs = await this.loadRecentMessages(companyId, channelId, 2);
      const lastAiResp = lastMsgs.find(m => m.role === 'assistant')?.content || '';
      await secretariaSafety.logAIError(companyId, userId, 'user_correction', {
        userMessage: truncatedMessage,
        aiResponse: lastAiResp,
        correction: truncatedMessage,
      });
    } else {
      secretariaSafety.trackCorrection(webChannelKey, false);
    }

    // Step 5: Load context
    const recentMessages = await this.loadRecentMessages(
      companyId,
      channelId,
      SECRETARIA_CONFIG.context.recentMessagesCount,
    );
    const companyName = await this.getCompanyName(companyId);
    const memoryContext = await secretariaMemory.getMemoryContext(companyId, userId);
    const memory: Record<string, string> = memoryContext ? { context: memoryContext } : {};

    const context: SecretariaContext = {
      companyId,
      userId,
      phoneNumber: channelId,
      displayName,
      recentMessages,
      memory,
    };

    try {
      // Step 6: Classify intent
      const intentResult = await classifyIntent(truncatedMessage, context);

      // Step 6.1: Safety — track low confidence
      secretariaSafety.trackLowConfidence(webChannelKey, intentResult.confidence);

      // Step 6.2: Safety — pre-execution check
      const safetyCheck = await secretariaSafety.checkSafety({
        companyId,
        userId,
        intent: intentResult.intent,
        entities: intentResult.entities,
      });

      if (!safetyCheck.safe) {
        if (safetyCheck.escalateToHuman) {
          await secretariaSafety.escalateToHuman(
            companyId, userId, safetyCheck.reason || 'safety_check', truncatedMessage, 'web', channelId,
          );
          const escResp = safetyCheck.reason || 'Voy a derivar tu consulta a un humano. Te van a contactar pronto.';
          await this.saveConversationMessage(companyId, channelId, 'assistant', escResp);
          return { response: escResp, intent: 'human_escalation' };
        }

        if (safetyCheck.requiresConfirmation) {
          await secretariaSafety.createPendingAction({
            companyId,
            userId,
            channel: 'web',
            channelId,
            actionType: intentResult.intent,
            actionData: { entities: intentResult.entities, originalText: truncatedMessage },
          });
          const confirmResp = `${safetyCheck.reason}\n\nConfirmas? (si/no)`;
          await this.saveConversationMessage(companyId, channelId, 'assistant', confirmResp);
          return { response: confirmResp, intent: 'confirmation_required' };
        }

        const blockResp = safetyCheck.reason || 'No puedo procesar esa consulta por razones de seguridad.';
        await this.saveConversationMessage(companyId, channelId, 'assistant', blockResp);
        return { response: blockResp, intent: 'safety_blocked' };
      }

      // Step 6.5: Role-based intent filtering
      const effectiveRole = userRole || 'viewer';
      if (!isIntentAllowedForRole(effectiveRole, intentResult.intent)) {
        const blockedResponse = 'No tenes permiso para acceder a esa informacion. Contacta a tu administrador.';
        await this.saveConversationMessage(companyId, channelId, 'assistant', blockedResponse);
        return {
          response: blockedResponse,
          intent: 'permission_denied',
        };
      }

      // Step 7: Execute tool
      const toolResult = await executeTool(intentResult.intent, intentResult.entities, companyId);

      // Step 8: Generate response
      let responseText = await generateResponse(toolResult, context, companyName);

      // Step 8.1: Safety — post-execution response validation
      const responseValidation = await secretariaSafety.validateResponse(responseText, companyId);
      if (!responseValidation.safe && responseValidation.sanitizedResponse) {
        responseText = responseValidation.sanitizedResponse;
      }

      // Step 8.2: Safety — validate tool result consistency (hallucination detection)
      const consistency = secretariaSafety.validateToolResultConsistency(toolResult, responseText);
      if (!consistency.consistent && consistency.warning) {
        responseText += `\n\n_${consistency.warning}_`;
      }

      // Step 9: Save assistant message
      await this.saveConversationMessage(companyId, channelId, 'assistant', responseText);

      // Step 10: Track usage
      await secretariaMemory.trackUsage(companyId, {
        messages_received: 1,
        messages_sent: 1,
      });

      // Step 11: Detect and save memory
      await secretariaMemory.detectAndSaveMemory(companyId, userId, truncatedMessage, responseText);

      return {
        response: responseText,
        intent: intentResult.intent,
      };
    } catch (error: any) {
      logger.error({ err: error, companyId, userId }, 'SecretarIA: error in web chat pipeline');

      // Safety — log AI errors for learning
      await secretariaSafety.logAIError(companyId, userId, 'pipeline_error', {
        userMessage: truncatedMessage,
        correction: error?.message || 'Unknown error',
      }).catch(() => {});

      return {
        response: 'Perdon, tuve un problema procesando tu consulta. Intenta de nuevo en unos segundos.',
        intent: 'error',
      };
    }
  }

  // --------------------------------------------------------------------------
  // getWebChatHistory — Load recent web chat messages for a user
  // --------------------------------------------------------------------------

  async getWebChatHistory(
    companyId: string,
    userId: string,
    limit: number = 50,
  ): Promise<readonly ConversationMessage[]> {
    const channelId = `web-${userId}`;
    const safeLimit = Math.min(Math.max(limit, 1), 200);

    const result = await db.execute(sql`
      SELECT role, content, created_at
      FROM secretaria_conversations
      WHERE company_id = ${companyId} AND phone_number = ${channelId}
      ORDER BY created_at DESC
      LIMIT ${safeLimit}
    `);

    const rows = (result as any).rows || result || [];
    // Reverse to get chronological order
    return rows.reverse().map((row: any) => ({
      role: row.role,
      content: row.content,
      created_at: new Date(row.created_at),
    }));
  }

  // --------------------------------------------------------------------------
  // Phone linking
  // --------------------------------------------------------------------------

  async linkPhone(
    companyId: string,
    userId: string,
    phoneNumber: string,
  ): Promise<{ code: string; expiresAt: Date }> {
    const code = await secretariaMemory.generateLinkingCode(companyId, userId, phoneNumber);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    return { code, expiresAt };
  }

  async verifyLinkingCode(phoneNumber: string, code: string): Promise<boolean> {
    const result = await secretariaMemory.verifyLinkingCode(phoneNumber, code);

    if (!result.success) {
      return false;
    }

    // Send welcome message
    const greeting = SECRETARIA_PROMPTS.greeting.replace(
      '{{displayName}}',
      result.companyName || 'usuario',
    );
    await whatsappClient.sendTextMessage(phoneNumber, greeting);

    return true;
  }

  // --------------------------------------------------------------------------
  // Config management
  // --------------------------------------------------------------------------

  async getConfig(companyId: string): Promise<SecretariaConfig> {
    let result: any;
    try {
      result = await db.execute(sql`
        SELECT company_id, enabled, morning_brief_enabled, morning_brief_time, timezone,
               last_brief_date, COALESCE(brief_sections, ARRAY['ventas','pedidos','cobros','stock']) AS brief_sections
        FROM secretaria_config
        WHERE company_id = ${companyId}
      `);
    } catch {
      // Columns might not exist yet, try minimal query
      try {
        result = await db.execute(sql`
          SELECT company_id, enabled, morning_brief_enabled, morning_brief_time, timezone
          FROM secretaria_config
          WHERE company_id = ${companyId}
        `);
      } catch {
        // Table might not exist at all
        result = { rows: [] };
      }
    }

    const rows = (result as any).rows || result || [];

    if (rows.length === 0) {
      // Create default config
      const defaults: SecretariaConfig = {
        companyId,
        enabled: true,
        morningBriefEnabled: SECRETARIA_CONFIG.morningBrief.enabled,
        morningBriefTime: SECRETARIA_CONFIG.morningBrief.defaultTime,
        timezone: SECRETARIA_CONFIG.morningBrief.defaultTimezone,
        lastBriefDate: null,
        briefSections: ['ventas', 'pedidos', 'cobros', 'stock'],
      };

      await db.execute(sql`
        INSERT INTO secretaria_config (company_id, enabled, morning_brief_enabled, morning_brief_time, timezone)
        VALUES (${companyId}, ${defaults.enabled}, ${defaults.morningBriefEnabled}, ${defaults.morningBriefTime}, ${defaults.timezone})
        ON CONFLICT (company_id) DO NOTHING
      `);

      return defaults;
    }

    const row = rows[0] as any;
    return {
      companyId: row.company_id,
      enabled: row.enabled,
      morningBriefEnabled: row.morning_brief_enabled,
      morningBriefTime: row.morning_brief_time,
      timezone: row.timezone,
      lastBriefDate: row.last_brief_date ? String(row.last_brief_date) : null,
      briefSections: row.brief_sections ?? ['ventas', 'pedidos', 'cobros', 'stock'],
    };
  }

  async updateConfig(
    companyId: string,
    updates: Partial<Pick<SecretariaConfig, 'enabled' | 'morningBriefEnabled' | 'morningBriefTime' | 'timezone' | 'briefSections'>>,
  ): Promise<SecretariaConfig> {
    // Ensure config row exists
    await this.getConfig(companyId);

    if (updates.enabled !== undefined) {
      await db.execute(sql`
        UPDATE secretaria_config SET enabled = ${updates.enabled} WHERE company_id = ${companyId}
      `);
    }

    if (updates.morningBriefEnabled !== undefined) {
      await db.execute(sql`
        UPDATE secretaria_config SET morning_brief_enabled = ${updates.morningBriefEnabled} WHERE company_id = ${companyId}
      `);
    }

    if (updates.morningBriefTime !== undefined) {
      await db.execute(sql`
        UPDATE secretaria_config SET morning_brief_time = ${updates.morningBriefTime} WHERE company_id = ${companyId}
      `);
    }

    if (updates.timezone !== undefined) {
      await db.execute(sql`
        UPDATE secretaria_config SET timezone = ${updates.timezone} WHERE company_id = ${companyId}
      `);
    }

    if (updates.briefSections !== undefined) {
      const sectionsArray = [...updates.briefSections];
      await db.execute(sql`
        UPDATE secretaria_config SET brief_sections = ${sectionsArray} WHERE company_id = ${companyId}
      `);
    }

    return this.getConfig(companyId);
  }

  // --------------------------------------------------------------------------
  // Usage tracking
  // --------------------------------------------------------------------------

  async getUsage(companyId: string): Promise<UsageTracking> {
    const usage = await secretariaMemory.getUsage(companyId);

    if (!usage) {
      return {
        companyId,
        month: currentMonth(),
        messagesReceived: 0,
        messagesSent: 0,
        llmTokensInput: 0,
        llmTokensOutput: 0,
        sttMinutes: 0,
        estimatedCostUsd: 0,
      };
    }

    return usage;
  }

  // --------------------------------------------------------------------------
  // Conversations
  // --------------------------------------------------------------------------

  async getConversations(
    companyId: string,
    limit: number = 50,
  ): Promise<readonly ConversationMessage[]> {
    const safeLimit = Math.min(Math.max(limit, 1), 200);

    const result = await db.execute(sql`
      SELECT role, content, created_at
      FROM secretaria_conversations
      WHERE company_id = ${companyId}
      ORDER BY created_at DESC
      LIMIT ${safeLimit}
    `);

    const rows = (result as any).rows || result || [];
    return rows.map((row: any) => ({
      role: row.role,
      content: row.content,
      created_at: new Date(row.created_at),
    }));
  }

  // --------------------------------------------------------------------------
  // Linked phones
  // --------------------------------------------------------------------------

  async getLinkedPhones(companyId: string): Promise<readonly LinkedPhone[]> {
    return secretariaMemory.getLinkedPhones(companyId);
  }

  async unlinkPhone(companyId: string, phoneId: string): Promise<void> {
    const deleted = await secretariaMemory.unlinkPhone(companyId, phoneId);

    if (!deleted) {
      throw new ApiError(404, 'Telefono vinculado no encontrado');
    }
  }

  // --------------------------------------------------------------------------
  // Private helpers
  // --------------------------------------------------------------------------

  private async getAiFeatures(companyId: string): Promise<AiFeatures> {
    try {
      const subscription = await billingService.getSubscription(companyId);
      return getPlanAiFeatures(subscription.plan);
    } catch {
      // Fallback: if billing check fails, use trial features (conservative)
      return getPlanAiFeatures('trial');
    }
  }

  private async getUserRole(userId: string): Promise<string> {
    try {
      const result = await db.execute(sql`SELECT role FROM users WHERE id = ${userId} LIMIT 1`);
      const rows = (result as any).rows || result || [];
      return rows.length > 0 ? (rows[0] as any).role || 'viewer' : 'viewer';
    } catch {
      return 'viewer';
    }
  }

  private async saveConversationMessage(
    companyId: string,
    phoneNumber: string,
    role: 'user' | 'assistant',
    content: string,
  ): Promise<void> {
    await db.execute(sql`
      INSERT INTO secretaria_conversations (company_id, phone_number, role, content)
      VALUES (${companyId}, ${phoneNumber}, ${role}, ${content})
    `);
  }

  private async loadRecentMessages(
    companyId: string,
    phoneNumber: string,
    limit: number,
  ): Promise<ConversationMessage[]> {
    const result = await db.execute(sql`
      SELECT role, content, created_at
      FROM secretaria_conversations
      WHERE company_id = ${companyId} AND phone_number = ${phoneNumber}
      ORDER BY created_at DESC
      LIMIT ${limit}
    `);

    const rows = (result as any).rows || result || [];
    // Reverse to get chronological order
    return rows.reverse().map((row: any) => ({
      role: row.role as 'user' | 'assistant',
      content: row.content as string,
      created_at: new Date(row.created_at),
    }));
  }

  private async getCompanyName(companyId: string): Promise<string> {
    const result = await db.execute(sql`
      SELECT name FROM companies WHERE id = ${companyId} LIMIT 1
    `);

    const rows = (result as any).rows || result || [];
    return rows.length > 0 ? (rows[0] as any).name : 'tu empresa';
  }
}

export const secretariaService = new SecretariaService();
