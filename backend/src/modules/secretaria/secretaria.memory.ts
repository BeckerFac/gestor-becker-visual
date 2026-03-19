// SecretarIA — Memory system, phone linking & usage tracking
import crypto from 'crypto';
import { pool } from '../../config/db';
import type { LinkedPhone, UsageTracking } from './secretaria.types';

// ── Memory Detection Patterns ──

interface MemoryPattern {
  readonly regex: RegExp;
  readonly type: string;
  readonly extractor: (match: RegExpMatchArray, message: string) => { key: string; value: string } | null;
}

const MEMORY_PATTERNS: readonly MemoryPattern[] = [
  // "siempre quiero X" / "siempre mando X"
  {
    regex: /siempre\s+(?:quiero|mando|pido|necesito|uso)\s+(.+)/i,
    type: 'preference',
    extractor: (match) => ({ key: `preference_${match[1].trim().slice(0, 50)}`, value: match[1].trim() }),
  },
  // "todos los dias a las HH:MM"
  {
    regex: /todos\s+los\s+d[ií]as?\s+(?:a\s+las?\s+)?(\d{1,2}[:.]\d{2})/i,
    type: 'schedule',
    extractor: (match) => ({ key: 'daily_schedule', value: match[1].replace('.', ':') }),
  },
  // "cada vez que X"
  {
    regex: /cada\s+vez\s+que\s+(.+)/i,
    type: 'preference',
    extractor: (match) => ({ key: `routine_${match[1].trim().slice(0, 50)}`, value: match[1].trim() }),
  },
  // "no, es X no Y" — correction
  {
    regex: /no[,.]?\s+es\s+(.+?)\s+no\s+(.+)/i,
    type: 'correction',
    extractor: (match) => ({ key: `correction_${match[2].trim().slice(0, 50)}`, value: match[1].trim() }),
  },
  // "cuando digo X me refiero a Y" — alias
  {
    regex: /cuando\s+digo\s+(.+?)\s+(?:me\s+refiero|hablo|es)\s+(?:a|de)?\s*(.+)/i,
    type: 'alias',
    extractor: (match) => ({ key: `alias_${match[1].trim().slice(0, 50)}`, value: match[2].trim() }),
  },
  // "mi proveedor de X es Y" — fact
  {
    regex: /mi\s+(?:proveedor|distribuidor|contacto)\s+de\s+(.+?)\s+es\s+(.+)/i,
    type: 'fact',
    extractor: (match) => ({ key: `supplier_${match[1].trim().slice(0, 50)}`, value: match[2].trim() }),
  },
  // "el brief a las HH:MM"
  {
    regex: /(?:el\s+)?brief\s+a\s+las?\s+(\d{1,2}[:.]\d{2})/i,
    type: 'preference',
    extractor: (match) => ({ key: 'brief_time', value: match[1].replace('.', ':') }),
  },
  // "prefiero tono X" / "hablame de X"
  {
    regex: /(?:prefiero|hablame|tratame)\s+(?:de\s+)?(?:manera\s+|tono\s+|forma\s+)?(\w+)/i,
    type: 'preference',
    extractor: (match) => ({ key: 'tone', value: match[1].trim() }),
  },
];

// ── Memory CRUD ──

interface MemoryRow {
  readonly id: string;
  readonly company_id: string;
  readonly user_id: string | null;
  readonly memory_type: string;
  readonly key: string;
  readonly value: string;
  readonly confidence: string;
  readonly source: string | null;
  readonly times_used: number;
  readonly last_used: Date;
  readonly created_at: Date;
}

interface SavedMemory {
  readonly key: string;
  readonly value: string;
  readonly type: string;
}

// ── Memory value sanitization (anti prompt-injection) ──

const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?(previous\s+)?instructions/i,
  /system\s*prompt/i,
  /reveal\s+(your|the)\s+(prompt|instructions|system)/i,
  /pretend\s+(you('re| are)|to\s+be)/i,
  /act\s+as\s+(a\s+different|another)/i,
  /show\s+me\s+(the\s+)?(api|token|secret|key|password)/i,
  /\bDAN\b/,
  /jailbreak/i,
  /bypass\s+(safety|security|filter|rules)/i,
  /forget\s+(all|your|previous)\s+(instructions|rules)/i,
];

function sanitizeMemoryValue(value: string): string | null {
  // Reject values that look like prompt injection attempts
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(value)) {
      return null;
    }
  }

  // Limit length and strip control characters
  return value
    .slice(0, 200)
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
}

class SecretariaMemoryService {
  // ── Memory CRUD ──

  async getMemories(companyId: string, userId?: string): Promise<readonly MemoryRow[]> {
    const params: string[] = [companyId];
    let query = `
      SELECT * FROM secretaria_memory
      WHERE company_id = $1
    `;

    if (userId) {
      query += ` AND (user_id = $2 OR user_id IS NULL)`;
      params.push(userId);
    }

    query += ` ORDER BY confidence DESC, last_used DESC LIMIT 50`;

    const result = await pool.query(query, params);
    return result.rows;
  }

  async getMemoryContext(companyId: string, userId?: string): Promise<string> {
    const params: string[] = [companyId];
    let query = `
      SELECT key, value FROM secretaria_memory
      WHERE company_id = $1 AND confidence >= 0.5
    `;

    if (userId) {
      query += ` AND (user_id = $2 OR user_id IS NULL)`;
      params.push(userId);
    }

    query += ` ORDER BY confidence DESC, last_used DESC LIMIT 50`;

    const result = await pool.query(query, params);

    if (result.rows.length === 0) return '';

    const parts: string[] = [];
    let totalLength = 0;
    const prefix = 'Preferencias conocidas: ';
    totalLength += prefix.length;

    for (const row of result.rows) {
      const entry = `${row.key.replace(/^(preference_|alias_|correction_|supplier_|routine_)/, '')} = ${row.value}`;
      if (totalLength + entry.length + 2 > 500) break;
      parts.push(entry);
      totalLength += entry.length + 2; // ", " separator
    }

    if (parts.length === 0) return '';
    return prefix + parts.join(', ');
  }

  async setMemory(
    companyId: string,
    userId: string,
    key: string,
    value: string,
    source: 'explicit' | 'inferred',
    memoryType: string,
  ): Promise<void> {
    const confidence = source === 'explicit' ? 0.9 : 0.5;

    // Enforce max memory entries per company (prevent unbounded growth)
    const countResult = await pool.query(
      `SELECT COUNT(*) as cnt FROM secretaria_memory WHERE company_id = $1`,
      [companyId],
    );
    const currentCount = parseInt((countResult.rows[0] as any)?.cnt || '0', 10);

    if (currentCount >= 50) {
      // Evict lowest-confidence, oldest-used entry to make room
      await pool.query(
        `DELETE FROM secretaria_memory
         WHERE id = (
           SELECT id FROM secretaria_memory
           WHERE company_id = $1
           ORDER BY confidence ASC, last_used ASC
           LIMIT 1
         )`,
        [companyId],
      );
    }

    await pool.query(
      `INSERT INTO secretaria_memory (company_id, user_id, memory_type, key, value, confidence, source, last_used)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
       ON CONFLICT (company_id, user_id, memory_type, key) DO UPDATE SET
         value = EXCLUDED.value,
         confidence = EXCLUDED.confidence,
         source = EXCLUDED.source,
         last_used = NOW()`,
      [companyId, userId, memoryType, key, value, confidence, source],
    );
  }

  async confirmMemory(companyId: string, key: string): Promise<void> {
    await pool.query(
      `UPDATE secretaria_memory
       SET confidence = LEAST(confidence + 0.1, 1.0),
           times_used = times_used + 1,
           last_used = NOW()
       WHERE company_id = $1 AND key = $2`,
      [companyId, key],
    );
  }

  async contradictMemory(companyId: string, key: string): Promise<void> {
    // Decrement confidence; delete if below threshold
    await pool.query(
      `UPDATE secretaria_memory
       SET confidence = confidence - 0.2
       WHERE company_id = $1 AND key = $2`,
      [companyId, key],
    );

    await pool.query(
      `DELETE FROM secretaria_memory
       WHERE company_id = $1 AND key = $2 AND confidence < 0.2`,
      [companyId, key],
    );
  }

  async decayMemories(): Promise<void> {
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    // Reduce confidence for stale memories
    await pool.query(
      `UPDATE secretaria_memory
       SET confidence = confidence - 0.1
       WHERE last_used < $1`,
      [sixMonthsAgo.toISOString()],
    );

    // Delete memories that fell below threshold
    await pool.query(
      `DELETE FROM secretaria_memory WHERE confidence < 0.2`,
    );
  }

  detectAndSaveMemory(
    companyId: string,
    userId: string,
    userMessage: string,
    _agentResponse: string,
  ): Promise<readonly SavedMemory[]> {
    const detected: Array<{ key: string; value: string; type: string }> = [];

    for (const pattern of MEMORY_PATTERNS) {
      const match = userMessage.match(pattern.regex);
      if (!match) continue;

      const extracted = pattern.extractor(match, userMessage);
      if (!extracted) continue;

      // Sanitize memory values to prevent prompt injection via stored memories
      const sanitizedValue = sanitizeMemoryValue(extracted.value);
      if (!sanitizedValue) continue;

      detected.push({ key: extracted.key, value: sanitizedValue, type: pattern.type });
    }

    if (detected.length === 0) return Promise.resolve([]);

    // Save all detected memories in parallel
    const saves = detected.map((mem) =>
      this.setMemory(companyId, userId, mem.key, mem.value, 'inferred', mem.type),
    );

    return Promise.all(saves).then(() => detected);
  }

  // ── Phone Linking ──

  async generateLinkingCode(companyId: string, userId: string, phoneNumber: string): Promise<string> {
    // Check if phone is already linked to a DIFFERENT company
    const existing = await pool.query(
      `SELECT company_id, verified FROM secretaria_linked_phones
       WHERE phone_number = $1 AND verified = true`,
      [phoneNumber],
    );

    if (existing.rows.length > 0 && existing.rows[0].company_id !== companyId) {
      throw new Error('Este telefono ya esta vinculado a otra empresa');
    }

    // Generate cryptographically random 6-digit code
    const code = crypto.randomInt(100000, 999999).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    await pool.query(
      `INSERT INTO secretaria_linked_phones (company_id, user_id, phone_number, linking_code, linking_code_expires, verified)
       VALUES ($1, $2, $3, $4, $5, false)
       ON CONFLICT (company_id, phone_number) DO UPDATE SET
         user_id = EXCLUDED.user_id,
         linking_code = EXCLUDED.linking_code,
         linking_code_expires = EXCLUDED.linking_code_expires,
         verified = false`,
      [companyId, userId, phoneNumber, code, expiresAt.toISOString()],
    );

    return code;
  }

  async verifyLinkingCode(
    phoneNumber: string,
    code: string,
  ): Promise<{ success: true; companyId: string; userId: string; companyName: string } | { success: false; reason: 'invalid_code' | 'expired' | 'not_found' | 'too_many_attempts' }> {
    const result = await pool.query(
      `SELECT slp.*, c.name AS company_name
       FROM secretaria_linked_phones slp
       JOIN companies c ON c.id = slp.company_id
       WHERE slp.phone_number = $1 AND slp.verified = false`,
      [phoneNumber],
    );

    if (result.rows.length === 0) {
      return { success: false, reason: 'not_found' };
    }

    const record = result.rows[0];

    // Rate limit: max 5 failed attempts per linking code (anti brute-force)
    const failedAttempts = record.failed_attempts ?? 0;
    if (failedAttempts >= 5) {
      // Invalidate the code entirely after too many attempts
      await pool.query(
        `UPDATE secretaria_linked_phones
         SET linking_code = NULL, linking_code_expires = NULL
         WHERE id = $1`,
        [record.id],
      );
      return { success: false, reason: 'too_many_attempts' };
    }

    if (record.linking_code !== code) {
      // Increment failed attempts counter
      await pool.query(
        `UPDATE secretaria_linked_phones
         SET failed_attempts = COALESCE(failed_attempts, 0) + 1
         WHERE id = $1`,
        [record.id],
      );
      return { success: false, reason: 'invalid_code' };
    }

    if (new Date(record.linking_code_expires) < new Date()) {
      return { success: false, reason: 'expired' };
    }

    // Mark as verified and clear linking code + failed attempts
    await pool.query(
      `UPDATE secretaria_linked_phones
       SET verified = true, linking_code = NULL, linking_code_expires = NULL, failed_attempts = 0
       WHERE id = $1`,
      [record.id],
    );

    return {
      success: true,
      companyId: record.company_id,
      userId: record.user_id,
      companyName: record.company_name,
    };
  }

  async lookupPhone(phoneNumber: string): Promise<{ companyId: string; userId: string; displayName: string } | null> {
    const result = await pool.query(
      `SELECT slp.company_id, slp.user_id, u.name AS display_name
       FROM secretaria_linked_phones slp
       JOIN users u ON u.id = slp.user_id
       WHERE slp.phone_number = $1 AND slp.verified = true
       LIMIT 1`,
      [phoneNumber],
    );

    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    return {
      companyId: row.company_id,
      userId: row.user_id,
      displayName: row.display_name,
    };
  }

  async getLinkedPhones(companyId: string): Promise<readonly LinkedPhone[]> {
    const result = await pool.query(
      `SELECT slp.id, slp.company_id, slp.user_id, slp.phone_number,
              slp.linking_code, slp.linking_code_expires, slp.verified, slp.created_at,
              u.name AS user_name
       FROM secretaria_linked_phones slp
       JOIN users u ON u.id = slp.user_id
       WHERE slp.company_id = $1
       ORDER BY slp.created_at DESC`,
      [companyId],
    );

    return result.rows.map((row: any) => ({
      id: row.id,
      companyId: row.company_id,
      userId: row.user_id,
      phoneNumber: row.phone_number,
      linkingCode: null, // Never expose active linking codes to frontend
      linkingCodeExpires: row.linking_code_expires ? new Date(row.linking_code_expires) : null,
      verified: row.verified,
      createdAt: new Date(row.created_at),
      userName: row.user_name,
    }));
  }

  async unlinkPhone(companyId: string, phoneId: string): Promise<boolean> {
    const result = await pool.query(
      `DELETE FROM secretaria_linked_phones
       WHERE id = $1 AND company_id = $2`,
      [phoneId, companyId],
    );

    return (result.rowCount ?? 0) > 0;
  }

  // ── Usage Tracking ──

  async trackUsage(
    companyId: string,
    data: {
      messages_received?: number;
      messages_sent?: number;
      llm_tokens_input?: number;
      llm_tokens_output?: number;
      stt_minutes?: number;
      estimated_cost_usd?: number;
    },
  ): Promise<void> {
    const month = new Date().toISOString().slice(0, 7); // YYYY-MM

    await pool.query(
      `INSERT INTO secretaria_usage (company_id, month,
         messages_received, messages_sent, llm_tokens_input, llm_tokens_output,
         stt_minutes, estimated_cost_usd)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (company_id, month) DO UPDATE SET
         messages_received = secretaria_usage.messages_received + COALESCE(EXCLUDED.messages_received, 0),
         messages_sent = secretaria_usage.messages_sent + COALESCE(EXCLUDED.messages_sent, 0),
         llm_tokens_input = secretaria_usage.llm_tokens_input + COALESCE(EXCLUDED.llm_tokens_input, 0),
         llm_tokens_output = secretaria_usage.llm_tokens_output + COALESCE(EXCLUDED.llm_tokens_output, 0),
         stt_minutes = secretaria_usage.stt_minutes + COALESCE(EXCLUDED.stt_minutes, 0),
         estimated_cost_usd = secretaria_usage.estimated_cost_usd + COALESCE(EXCLUDED.estimated_cost_usd, 0)`,
      [
        companyId,
        month,
        data.messages_received ?? 0,
        data.messages_sent ?? 0,
        data.llm_tokens_input ?? 0,
        data.llm_tokens_output ?? 0,
        data.stt_minutes ?? 0,
        data.estimated_cost_usd ?? 0,
      ],
    );
  }

  async getUsage(companyId: string, month?: string): Promise<UsageTracking | null> {
    const targetMonth = month ?? new Date().toISOString().slice(0, 7);

    const result = await pool.query(
      `SELECT * FROM secretaria_usage
       WHERE company_id = $1 AND month = $2`,
      [companyId, targetMonth],
    );

    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    return {
      companyId: row.company_id,
      month: row.month,
      messagesReceived: row.messages_received,
      messagesSent: row.messages_sent,
      llmTokensInput: row.llm_tokens_input,
      llmTokensOutput: row.llm_tokens_output,
      sttMinutes: parseFloat(row.stt_minutes),
      estimatedCostUsd: parseFloat(row.estimated_cost_usd),
    };
  }

  async checkUsageLimits(companyId: string): Promise<{
    withinLimits: boolean;
    messagesUsed: number;
    messagesLimit: number;
    percentUsed: number;
    warning?: string;
  }> {
    // Base plan limits
    const MESSAGES_LIMIT = 500;

    const usage = await this.getUsage(companyId);
    const messagesUsed = usage ? usage.messagesReceived + usage.messagesSent : 0;
    const percentUsed = Math.round((messagesUsed / MESSAGES_LIMIT) * 100);

    const result: {
      withinLimits: boolean;
      messagesUsed: number;
      messagesLimit: number;
      percentUsed: number;
      warning?: string;
    } = {
      withinLimits: percentUsed <= 100,
      messagesUsed,
      messagesLimit: MESSAGES_LIMIT,
      percentUsed,
    };

    if (percentUsed > 100) {
      result.warning = 'Limite de mensajes excedido. Servicio degradado a solo lectura.';
      result.withinLimits = false;
    } else if (percentUsed > 80) {
      result.warning = `Atencion: ${percentUsed}% del limite de mensajes usado (${messagesUsed}/${MESSAGES_LIMIT}).`;
    }

    return result;
  }
}

export const secretariaMemory = new SecretariaMemoryService();

// ── Standalone function exports (used by secretaria.service.ts) ──

/**
 * Load memory as a key-value map for injection into SecretariaContext.
 */
export async function loadMemory(companyId: string): Promise<Record<string, string>> {
  const memories = await secretariaMemory.getMemories(companyId);
  const result: Record<string, string> = {};
  for (const mem of memories) {
    if (parseFloat(mem.confidence) >= 0.5) {
      result[mem.key] = mem.value;
    }
  }
  return result;
}

/**
 * Detect and save memories from a conversation turn.
 * Called after each message exchange.
 */
export async function detectAndSaveMemory(
  companyId: string,
  userId: string,
  userMessage: string,
  agentResponse: string,
): Promise<readonly SavedMemory[]> {
  if (!userId) {
    // Avoid creating memory entries with empty user_id
    return [];
  }
  return secretariaMemory.detectAndSaveMemory(companyId, userId, userMessage, agentResponse);
}
