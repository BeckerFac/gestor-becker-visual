// SecretarIA — Safety guardrails, confirmation flow, human escalation, error learning
// SECURITY: This module enforces hard rules BEFORE and AFTER every AI interaction.

import { pool } from '../../config/db';
import logger from '../../config/logger';

// ── Types ──

export interface SafetyCheckParams {
  readonly companyId: string;
  readonly userId: string;
  readonly intent: string;
  readonly entities: Record<string, string>;
  readonly toolResult?: any;
}

export interface SafetyCheckResult {
  readonly safe: boolean;
  readonly reason?: string;
  readonly requiresConfirmation?: boolean;
  readonly escalateToHuman?: boolean;
}

export interface ResponseValidationResult {
  readonly safe: boolean;
  readonly sanitizedResponse?: string;
}

export interface PendingAction {
  readonly id: string;
  readonly companyId: string;
  readonly userId: string | null;
  readonly channel: string;
  readonly channelId: string;
  readonly actionType: string;
  readonly actionData: Record<string, unknown>;
  readonly status: string;
  readonly createdAt: Date;
  readonly expiresAt: Date;
}

// ── Constants ──

const WRITE_INTENTS: ReadonlyArray<string> = [
  'create_invoice',
  'create_order',
  'adjust_stock',
  'update_product',
  'update_price',
  'register_payment',
  'send_reminder',
];

const MAX_AMOUNT_THRESHOLD = 10_000_000; // $10M — likely hallucination
const ESCALATION_AMOUNT_THRESHOLD = 1_000_000; // $1M — escalate to human

const SYSTEM_INTERNALS_PATTERNS: ReadonlyArray<RegExp> = [
  /api[_-]?key/i,
  /secret[_-]?key/i,
  /bearer\s+[a-zA-Z0-9._-]{20,}/i,
  /token[:\s]+[a-zA-Z0-9._-]{20,}/i,
  /password[:\s]+\S{6,}/i,
  /postgres:\/\//i,
  /mongodb:\/\//i,
  /redis:\/\//i,
  /OPENAI_API_KEY/i,
  /RESEND_API_KEY/i,
  /WHATSAPP_TOKEN/i,
  /DEEPGRAM/i,
  /sk-[a-zA-Z0-9]{20,}/i, // OpenAI key pattern
  /process\.env\./i,
  /system\s*prompt/i,
  /secretaria_config|secretaria_memory|secretaria_conversations/i,
];

const CREDENTIAL_SHARING_PATTERNS: ReadonlyArray<RegExp> = [
  /(?:dame|pasame|envia|manda)\s+(?:tu|la|el)\s+(?:contrasena|password|clave|pin|token)/i,
  /(?:comparti|compartir)\s+(?:tu|la)\s+(?:credencial|contrasena|clave)/i,
  /necesito\s+(?:tu|la)\s+(?:contrasena|password|clave)/i,
];

const ESCALATION_KEYWORDS: ReadonlyArray<RegExp> = [
  /(?:quiero|necesito)\s+(?:hablar|contactar)\s+(?:con\s+)?(?:una?\s+)?(?:persona|humano|agente|soporte)/i,
  /\bsoporte\b/i,
  /\bayuda\s+humana\b/i,
  /\boperador\b/i,
  /\bpasame\s+con\s+(?:alguien|una?\s+persona)\b/i,
];

const CORRECTION_PATTERNS: ReadonlyArray<RegExp> = [
  /\bno[,.]?\s+(?:eso\s+)?(?:esta|estuvo)\s+mal\b/i,
  /\bno[,.]?\s+es\s+/i,
  /\berror\b/i,
  /\bequivocad[oa]\b/i,
  /\bincorrect[oa]\b/i,
  /\bmal[,.]?\s+(?:el|la|los|las)\b/i,
  /\bte\s+equivocaste\b/i,
];

// ── Consecutive tracking (in-memory, per channel) ──

interface ChannelState {
  lowConfidenceStreak: number;
  correctionStreak: number;
}

const channelStates = new Map<string, ChannelState>();

function getChannelState(channelKey: string): ChannelState {
  const existing = channelStates.get(channelKey);
  if (existing) return existing;
  const fresh: ChannelState = { lowConfidenceStreak: 0, correctionStreak: 0 };
  channelStates.set(channelKey, fresh);
  return fresh;
}

// ── Safety Service ──

class SecretariaSafetyService {
  // --------------------------------------------------------------------------
  // Pre-execution safety check
  // --------------------------------------------------------------------------

  async checkSafety(params: SafetyCheckParams): Promise<SafetyCheckResult> {
    const { companyId, userId, intent, entities } = params;

    // Rule: Write operations require explicit confirmation
    if (WRITE_INTENTS.includes(intent)) {
      return {
        safe: false,
        requiresConfirmation: true,
        reason: `La operacion "${intent}" requiere confirmacion antes de ejecutarse.`,
      };
    }

    // Rule: Check for escalation request in the original text
    // (handled at message level in the service, but double-check here)
    const channelKey = `${companyId}:${userId}`;
    const state = getChannelState(channelKey);

    // Rule: 3 consecutive low-confidence classifications -> escalate
    if (state.lowConfidenceStreak >= 3) {
      state.lowConfidenceStreak = 0;
      return {
        safe: false,
        escalateToHuman: true,
        reason: 'Multiples mensajes consecutivos con baja confianza. Derivando a un humano.',
      };
    }

    // Rule: 3 consecutive corrections -> escalate
    if (state.correctionStreak >= 3) {
      state.correctionStreak = 0;
      return {
        safe: false,
        escalateToHuman: true,
        reason: 'El usuario corrigio la respuesta varias veces seguidas. Derivando a un humano.',
      };
    }

    // Rule: Amount > escalation threshold
    const amount = parseFloat(entities.amount || '0');
    if (amount > ESCALATION_AMOUNT_THRESHOLD) {
      return {
        safe: false,
        escalateToHuman: true,
        reason: `Monto de $${amount.toLocaleString('es-AR')} supera el umbral. Se recomienda verificacion humana.`,
      };
    }

    return { safe: true };
  }

  // --------------------------------------------------------------------------
  // Post-execution response validation
  // --------------------------------------------------------------------------

  async validateResponse(
    response: string,
    companyId: string,
  ): Promise<ResponseValidationResult> {
    let sanitized = response;
    let wasSanitized = false;

    // Rule: Block responses containing system internals
    for (const pattern of SYSTEM_INTERNALS_PATTERNS) {
      if (pattern.test(sanitized)) {
        logger.warn(
          { companyId, pattern: pattern.source },
          'SecretarIA safety: system internals detected in response — sanitizing',
        );
        sanitized = 'Soy SecretarIA, tu asistente de gestion. Como te puedo ayudar?';
        wasSanitized = true;
        break;
      }
    }

    // Rule: Block credential-sharing suggestions
    if (!wasSanitized) {
      for (const pattern of CREDENTIAL_SHARING_PATTERNS) {
        if (pattern.test(sanitized)) {
          logger.warn(
            { companyId },
            'SecretarIA safety: credential sharing suggestion detected — blocking',
          );
          sanitized = 'No puedo pedir ni procesar credenciales por este canal. Gestionalo directamente desde la app de GESTIA.';
          wasSanitized = true;
          break;
        }
      }
    }

    // Rule: Check for suspiciously large amounts (hallucination flag)
    if (!wasSanitized) {
      const amountMatches = sanitized.matchAll(/\$\s*([\d.,]+(?:\.\d{3})*(?:,\d{1,2})?)\b/g);
      for (const match of amountMatches) {
        const rawAmount = match[1]
          .replace(/\./g, '')    // Remove thousand separators
          .replace(',', '.');    // Normalize decimal
        const numericAmount = parseFloat(rawAmount);
        if (!isNaN(numericAmount) && numericAmount > MAX_AMOUNT_THRESHOLD) {
          logger.warn(
            { companyId, amount: numericAmount },
            'SecretarIA safety: amount exceeds $10M threshold — flagging for review',
          );
          sanitized += '\n\n_Nota: Este monto es inusualmente alto. Verificalo en la app antes de tomar accion._';
          wasSanitized = true;
          break;
        }
      }
    }

    if (wasSanitized) {
      return { safe: false, sanitizedResponse: sanitized };
    }

    return { safe: true };
  }

  // --------------------------------------------------------------------------
  // Escalation to human
  // --------------------------------------------------------------------------

  async escalateToHuman(
    companyId: string,
    userId: string,
    reason: string,
    context: string,
    channel: string = 'web',
    channelId: string = '',
  ): Promise<void> {
    try {
      await pool.query(
        `INSERT INTO secretaria_pending_actions
           (company_id, user_id, channel, channel_id, action_type, action_data, status, expires_at)
         VALUES ($1, $2, $3, $4, 'human_escalation', $5, 'pending', NOW() + INTERVAL '24 hours')`,
        [
          companyId,
          userId || null,
          channel,
          channelId,
          JSON.stringify({ reason, context: context.slice(0, 2000) }),
        ],
      );

      logger.info(
        { companyId, userId, reason },
        'SecretarIA: escalation to human registered',
      );

      // Best-effort: notify company admin via email
      await this.notifyCompanyAdmin(companyId, reason).catch((err) => {
        logger.warn({ err, companyId }, 'SecretarIA: failed to send escalation notification email');
      });
    } catch (error) {
      logger.error({ error, companyId }, 'SecretarIA: failed to register escalation');
    }
  }

  // --------------------------------------------------------------------------
  // Pending action management (confirmation flow)
  // --------------------------------------------------------------------------

  async createPendingAction(params: {
    companyId: string;
    userId: string | null;
    channel: string;
    channelId: string;
    actionType: string;
    actionData: Record<string, unknown>;
  }): Promise<string> {
    const result = await pool.query(
      `INSERT INTO secretaria_pending_actions
         (company_id, user_id, channel, channel_id, action_type, action_data, status, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending', NOW() + INTERVAL '5 minutes')
       RETURNING id`,
      [
        params.companyId,
        params.userId || null,
        params.channel,
        params.channelId,
        params.actionType,
        JSON.stringify(params.actionData),
      ],
    );

    return result.rows[0].id;
  }

  async getPendingAction(
    companyId: string,
    channelId: string,
  ): Promise<PendingAction | null> {
    const result = await pool.query(
      `SELECT * FROM secretaria_pending_actions
       WHERE company_id = $1
         AND channel_id = $2
         AND status = 'pending'
         AND expires_at > NOW()
       ORDER BY created_at DESC
       LIMIT 1`,
      [companyId, channelId],
    );

    if (result.rows.length === 0) return null;

    const row = result.rows[0] as any;
    return {
      id: row.id,
      companyId: row.company_id,
      userId: row.user_id,
      channel: row.channel,
      channelId: row.channel_id,
      actionType: row.action_type,
      actionData: typeof row.action_data === 'string' ? JSON.parse(row.action_data) : row.action_data,
      status: row.status,
      createdAt: new Date(row.created_at),
      expiresAt: new Date(row.expires_at),
    };
  }

  async confirmPendingAction(actionId: string): Promise<PendingAction | null> {
    const result = await pool.query(
      `UPDATE secretaria_pending_actions
       SET status = 'confirmed'
       WHERE id = $1 AND status = 'pending' AND expires_at > NOW()
       RETURNING *`,
      [actionId],
    );

    if (result.rows.length === 0) return null;

    const row = result.rows[0] as any;
    return {
      id: row.id,
      companyId: row.company_id,
      userId: row.user_id,
      channel: row.channel,
      channelId: row.channel_id,
      actionType: row.action_type,
      actionData: typeof row.action_data === 'string' ? JSON.parse(row.action_data) : row.action_data,
      status: 'confirmed',
      createdAt: new Date(row.created_at),
      expiresAt: new Date(row.expires_at),
    };
  }

  async cancelPendingAction(actionId: string): Promise<boolean> {
    const result = await pool.query(
      `UPDATE secretaria_pending_actions
       SET status = 'cancelled'
       WHERE id = $1 AND status = 'pending'`,
      [actionId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async expireStaleActions(): Promise<number> {
    const result = await pool.query(
      `UPDATE secretaria_pending_actions
       SET status = 'expired'
       WHERE status = 'pending' AND expires_at <= NOW()`,
    );
    return result.rowCount ?? 0;
  }

  // --------------------------------------------------------------------------
  // AI error / correction tracking
  // --------------------------------------------------------------------------

  async logAIError(
    companyId: string,
    userId: string,
    errorType: string,
    details: {
      userMessage?: string;
      aiResponse?: string;
      correction?: string;
      [key: string]: unknown;
    },
  ): Promise<void> {
    try {
      await pool.query(
        `INSERT INTO secretaria_ai_errors
           (company_id, user_id, user_message, ai_response, correction, error_type)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          companyId,
          userId || null,
          (details.userMessage || '').slice(0, 2000),
          (details.aiResponse || '').slice(0, 2000),
          (details.correction || '').slice(0, 2000),
          errorType,
        ],
      );
    } catch (error) {
      logger.error({ error, companyId }, 'SecretarIA: failed to log AI error');
    }
  }

  // --------------------------------------------------------------------------
  // Detection helpers (used by service pipeline)
  // --------------------------------------------------------------------------

  isEscalationRequest(text: string): boolean {
    return ESCALATION_KEYWORDS.some((pattern) => pattern.test(text));
  }

  isCorrection(text: string): boolean {
    return CORRECTION_PATTERNS.some((pattern) => pattern.test(text));
  }

  isConfirmation(text: string): boolean {
    const normalized = text.trim().toLowerCase();
    const confirmWords = ['si', 'sí', 'dale', 'confirmo', 'confirmar', 'ok', 'listo', 'adelante', 'hacelo'];
    return confirmWords.some((w) => normalized === w || normalized.startsWith(w + ' ') || normalized.startsWith(w + ','));
  }

  isCancellation(text: string): boolean {
    const normalized = text.trim().toLowerCase();
    const cancelWords = ['no', 'cancelar', 'cancela', 'dejalo', 'nada', 'olvidate', 'no quiero'];
    return cancelWords.some((w) => normalized === w || normalized.startsWith(w + ' ') || normalized.startsWith(w + ','));
  }

  // Track streaks for escalation triggers
  trackLowConfidence(channelKey: string, confidence: number): void {
    const state = getChannelState(channelKey);
    if (confidence < 0.3) {
      state.lowConfidenceStreak += 1;
    } else {
      state.lowConfidenceStreak = 0;
    }
  }

  trackCorrection(channelKey: string, isUserCorrection: boolean): void {
    const state = getChannelState(channelKey);
    if (isUserCorrection) {
      state.correctionStreak += 1;
    } else {
      state.correctionStreak = 0;
    }
  }

  resetStreaks(channelKey: string): void {
    channelStates.delete(channelKey);
  }

  // --------------------------------------------------------------------------
  // Cross-client learning check
  // --------------------------------------------------------------------------

  async checkCrossClientPatterns(): Promise<ReadonlyArray<{ error_type: string; count: number }>> {
    try {
      const result = await pool.query(
        `SELECT error_type, COUNT(DISTINCT company_id) as company_count, COUNT(*) as total_count
         FROM secretaria_ai_errors
         WHERE resolved = false
           AND created_at > NOW() - INTERVAL '30 days'
         GROUP BY error_type
         HAVING COUNT(DISTINCT company_id) >= 5
         ORDER BY total_count DESC
         LIMIT 10`,
      );
      return result.rows.map((row: any) => ({
        error_type: row.error_type,
        count: parseInt(row.total_count, 10),
      }));
    } catch {
      return [];
    }
  }

  // --------------------------------------------------------------------------
  // Validate tool result vs response consistency
  // --------------------------------------------------------------------------

  validateToolResultConsistency(
    toolResult: { data: unknown; formatted: string } | null,
    response: string,
  ): { consistent: boolean; warning?: string } {
    if (!toolResult || toolResult.data === null) {
      // Tool returned no data — check if response claims to have specific numbers
      const hasSpecificNumbers = /\$\s*[\d.,]+/.test(response);
      if (hasSpecificNumbers) {
        return {
          consistent: false,
          warning: 'La respuesta contiene numeros especificos pero la consulta no devolvio datos. Posible alucinacion.',
        };
      }
    }

    return { consistent: true };
  }

  // --------------------------------------------------------------------------
  // Private: notify company admin
  // --------------------------------------------------------------------------

  private async notifyCompanyAdmin(companyId: string, reason: string): Promise<void> {
    // Find company admin email
    const result = await pool.query(
      `SELECT u.email, u.name, c.name as company_name
       FROM users u
       JOIN companies c ON c.id = u.company_id
       WHERE u.company_id = $1 AND u.role IN ('admin', 'owner')
       LIMIT 1`,
      [companyId],
    );

    if (result.rows.length === 0) return;

    const admin = result.rows[0] as any;

    // Lazy-import email service to avoid circular dependency
    try {
      const { emailService } = await import('../email/email.service');
      await emailService.sendVerificationEmail(
        admin.email,
        admin.name || 'Admin',
        // Reuse verification email as notification (subject makes it clear)
        `SecretarIA - Escalacion pendiente: ${reason.slice(0, 100)}`,
      );
    } catch {
      // Email notification is best-effort
    }
  }
}

export const secretariaSafety = new SecretariaSafetyService();
