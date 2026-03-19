// SecretarIA — Morning brief scheduler & proactive alerts
// Runs a cron job every minute, checks which companies need their brief sent,
// and delivers it via WhatsApp respecting the 24h session window.

import * as cron from 'node-cron';
import { pool } from '../../config/db';
import { whatsappClient } from './secretaria.whatsapp';
import { morningBrief } from './secretaria.tools';
import { secretariaMemory } from './secretaria.memory';
import { SECRETARIA_CONFIG } from './secretaria.config';
import logger from '../../config/logger';

// ── Types ──

interface BriefCandidate {
  readonly company_id: string;
  readonly morning_brief_time: string;
  readonly timezone: string;
  readonly brief_sections: readonly string[];
}

interface VerifiedPhone {
  readonly phone_number: string;
  readonly user_id: string;
  readonly display_name: string;
}

// ── Available brief sections ──

const AVAILABLE_SECTIONS = [
  'ventas',
  'pedidos',
  'cobros',
  'stock',
  'cheques',
  'pipeline',
] as const;

export type BriefSection = typeof AVAILABLE_SECTIONS[number];

// ── Concurrency limiter ──

async function parallelLimit<T>(
  tasks: ReadonlyArray<() => Promise<T>>,
  limit: number,
): Promise<readonly T[]> {
  const results: T[] = [];
  const executing: Set<Promise<void>> = new Set();

  for (const task of tasks) {
    const p = task().then(result => {
      results.push(result);
    });
    const tracked = p.finally(() => executing.delete(tracked));
    executing.add(tracked);

    if (executing.size >= limit) {
      await Promise.race(executing);
    }
  }

  await Promise.all(executing);
  return results;
}

// ── Timezone helper ──

function getCurrentTimeInTimezone(timezone: string): string {
  try {
    const formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    return formatter.format(new Date());
  } catch {
    // Fallback to Buenos Aires if invalid timezone
    const formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'America/Argentina/Buenos_Aires',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    return formatter.format(new Date());
  }
}

function getTodayDateInTimezone(timezone: string): string {
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    return formatter.format(new Date()); // YYYY-MM-DD
  } catch {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Argentina/Buenos_Aires',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    return formatter.format(new Date());
  }
}

// ── Validation helpers ──

export function isValidTimeFormat(time: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(time);
}

export function isValidTimezone(tz: string): boolean {
  try {
    Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function isValidBriefSections(sections: readonly string[]): boolean {
  return sections.every(s => (AVAILABLE_SECTIONS as readonly string[]).includes(s));
}

// ── Scheduler ──

class SecretariaScheduler {
  private cronTask: cron.ScheduledTask | null = null;
  private running = false;

  /**
   * Start the scheduler. Called once from server startup.
   * Uses node-cron to run checkBriefs() every minute.
   */
  start(): void {
    if (this.cronTask) {
      logger.warn('SecretarIA scheduler already started');
      return;
    }

    this.cronTask = cron.schedule('* * * * *', () => {
      this.checkBriefs().catch(err => {
        logger.error({ err }, 'SecretarIA scheduler: unhandled error in checkBriefs');
      });
    });

    logger.info('SecretarIA morning brief scheduler started');
  }

  /**
   * Stop the scheduler. Called during graceful shutdown.
   */
  stop(): void {
    if (this.cronTask) {
      this.cronTask.stop();
      this.cronTask = null;
      logger.info('SecretarIA morning brief scheduler stopped');
    }
  }

  /**
   * Check all companies for pending morning briefs.
   * Uses advisory lock to prevent duplicate sends on multi-instance deployments.
   */
  async checkBriefs(): Promise<void> {
    // Prevent overlapping runs
    if (this.running) {
      return;
    }
    this.running = true;

    try {
      const candidates = await this.getBriefCandidates();

      if (candidates.length === 0) {
        return;
      }

      // Process companies in parallel with concurrency limit of 5
      const tasks = candidates.map(candidate => () => this.processBriefCandidate(candidate));
      await parallelLimit(tasks, 5);
    } finally {
      this.running = false;
    }
  }

  /**
   * Generate and send a brief immediately for a company (manual trigger).
   * Used when user says "mandame el brief ahora".
   */
  async sendBriefNow(companyId: string): Promise<boolean> {
    try {
      return await this.generateAndSendBrief(companyId);
    } catch (err) {
      logger.error({ err, companyId }, 'SecretarIA: error sending immediate brief');
      return false;
    }
  }

  /**
   * Send a proactive alert to all verified phones of a company.
   * For future use: stock alerts, collection reminders, cheque reminders.
   */
  async sendProactiveAlert(
    companyId: string,
    alertType: string,
    message: string,
  ): Promise<void> {
    try {
      const phones = await this.getVerifiedPhones(companyId);

      if (phones.length === 0) {
        logger.debug({ companyId, alertType }, 'SecretarIA alert: no verified phones, skipping');
        return;
      }

      for (const phone of phones) {
        const sent = await this.sendWithSessionCheck(phone.phone_number, companyId, message);

        if (sent) {
          logger.info(
            { companyId, alertType, phone: phone.phone_number },
            'SecretarIA proactive alert sent',
          );
        }
      }

      // Track usage
      await secretariaMemory.trackUsage(companyId, {
        messages_sent: phones.length,
      });
    } catch (err) {
      logger.error({ err, companyId, alertType }, 'SecretarIA: error sending proactive alert');
    }
  }

  // ── Private methods ──

  /**
   * Get all companies with morning brief enabled that haven't received their brief today.
   */
  private async getBriefCandidates(): Promise<readonly BriefCandidate[]> {
    const result = await pool.query(`
      SELECT
        company_id,
        morning_brief_time,
        timezone,
        COALESCE(brief_sections, ARRAY['ventas','pedidos','cobros','stock']) AS brief_sections
      FROM secretaria_config
      WHERE enabled = true
        AND morning_brief_enabled = true
    `);

    return result.rows as BriefCandidate[];
  }

  /**
   * Process a single brief candidate:
   * 1. Check if current time in company's timezone matches brief time
   * 2. Atomically claim the brief (idempotency via last_brief_date)
   * 3. Generate and send
   */
  private async processBriefCandidate(candidate: BriefCandidate): Promise<void> {
    const currentTime = getCurrentTimeInTimezone(candidate.timezone);
    const todayDate = getTodayDateInTimezone(candidate.timezone);

    // Only send if current time matches the configured brief time
    if (currentTime !== candidate.morning_brief_time) {
      return;
    }

    // Atomically claim the brief using advisory lock + date check
    // This prevents duplicate sends on multi-instance deployments
    const claimed = await this.claimBrief(candidate.company_id, todayDate);

    if (!claimed) {
      return; // Already sent today or another instance claimed it
    }

    logger.info(
      { companyId: candidate.company_id, time: currentTime, timezone: candidate.timezone },
      'SecretarIA: sending morning brief',
    );

    await this.generateAndSendBrief(candidate.company_id);
  }

  /**
   * Atomically claim the brief for today using UPDATE ... WHERE.
   * Returns true if this instance successfully claimed it.
   */
  private async claimBrief(companyId: string, todayDate: string): Promise<boolean> {
    // Use pg_advisory_xact_lock to prevent race conditions across instances
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Advisory lock scoped to this company's brief
      await client.query(
        `SELECT pg_advisory_xact_lock(hashtext($1))`,
        [`secretaria_brief_${companyId}`],
      );

      // Check and update atomically
      const result = await client.query(
        `UPDATE secretaria_config
         SET last_brief_date = $2::date
         WHERE company_id = $1
           AND (last_brief_date IS NULL OR last_brief_date < $2::date)
         RETURNING company_id`,
        [companyId, todayDate],
      );

      await client.query('COMMIT');
      return (result.rowCount ?? 0) > 0;
    } catch (err) {
      await client.query('ROLLBACK');
      logger.error({ err, companyId }, 'SecretarIA: error claiming brief');
      return false;
    } finally {
      client.release();
    }
  }

  /**
   * Generate the morning brief data and send it to all verified phones.
   */
  private async generateAndSendBrief(companyId: string): Promise<boolean> {
    let briefText: string;

    try {
      const briefResult = await morningBrief(companyId);
      briefText = briefResult.formatted;
    } catch (err) {
      logger.error({ err, companyId }, 'SecretarIA: error generating brief data');
      briefText = '*Buenos dias!*\nAlgunos datos no pudieron cargarse. Escribime "brief" para reintentar.';
    }

    const phones = await this.getVerifiedPhones(companyId);

    if (phones.length === 0) {
      logger.debug({ companyId }, 'SecretarIA brief: no verified phones, skipping send');
      return false;
    }

    let sentCount = 0;

    for (const phone of phones) {
      const sent = await this.sendWithSessionCheck(phone.phone_number, companyId, briefText);

      if (sent) {
        sentCount++;
      }
    }

    // Track usage
    if (sentCount > 0) {
      await secretariaMemory.trackUsage(companyId, {
        messages_sent: sentCount,
      });
    }

    logger.info(
      { companyId, sentCount, totalPhones: phones.length },
      'SecretarIA: morning brief delivery complete',
    );

    return sentCount > 0;
  }

  /**
   * Send a message checking the 24h session window.
   * If within window: send as regular text.
   * If outside window: send as template message (Meta-approved).
   */
  private async sendWithSessionCheck(
    phoneNumber: string,
    companyId: string,
    text: string,
  ): Promise<boolean> {
    try {
      const withinWindow = await this.isWithin24hWindow(phoneNumber, companyId);

      if (withinWindow) {
        return await whatsappClient.sendTextMessage(phoneNumber, text);
      }

      // Outside 24h window: use template message
      // Template "morning_brief" must be pre-approved by Meta
      const sent = await whatsappClient.sendTemplate(phoneNumber, 'morning_brief', [
        { type: 'text', text },
      ]);

      if (!sent) {
        logger.warn(
          { phoneNumber, companyId },
          'SecretarIA: template send failed (may not be approved by Meta), skipping',
        );
      }

      return sent;
    } catch (err) {
      logger.error(
        { err, phoneNumber, companyId },
        'SecretarIA: error sending message to phone',
      );
      return false;
    }
  }

  /**
   * Check if the user sent a message in the last 24 hours
   * (WhatsApp Business API session window).
   */
  private async isWithin24hWindow(phoneNumber: string, companyId: string): Promise<boolean> {
    const result = await pool.query(
      `SELECT 1 FROM secretaria_conversations
       WHERE company_id = $1
         AND phone_number = $2
         AND role = 'user'
         AND created_at >= NOW() - INTERVAL '24 hours'
       LIMIT 1`,
      [companyId, phoneNumber],
    );

    return (result.rows?.length ?? 0) > 0;
  }

  /**
   * Get all verified phones for a company with user display names.
   */
  private async getVerifiedPhones(companyId: string): Promise<readonly VerifiedPhone[]> {
    const result = await pool.query(
      `SELECT slp.phone_number, slp.user_id, u.name AS display_name
       FROM secretaria_linked_phones slp
       JOIN users u ON u.id = slp.user_id
       WHERE slp.company_id = $1 AND slp.verified = true`,
      [companyId],
    );

    return result.rows as VerifiedPhone[];
  }
}

// ── Singleton export ──

export const secretariaScheduler = new SecretariaScheduler();
