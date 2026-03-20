// SecretarIA — AI Credit Packs service
// Handles credit pack purchases, consumption, and balance queries

import { pool } from '../../config/db';
import logger from '../../config/logger';

export interface CreditPack {
  readonly id: string;
  readonly companyId: string;
  readonly creditsTotal: number;
  readonly creditsRemaining: number;
  readonly purchasedAt: Date;
  readonly expiresAt: Date | null;
  readonly source: string;
}

class SecretariaCreditsService {
  private migrationsRun = false;

  async ensureMigrations(): Promise<void> {
    if (this.migrationsRun) return;
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS ai_credit_packs (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          company_id UUID NOT NULL REFERENCES companies(id),
          credits_total INTEGER NOT NULL,
          credits_remaining INTEGER NOT NULL,
          purchased_at TIMESTAMP DEFAULT NOW(),
          expires_at TIMESTAMP,
          source VARCHAR(50) DEFAULT 'purchase'
        )
      `);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_ai_credit_packs_company ON ai_credit_packs(company_id)`);
      this.migrationsRun = true;
    } catch (error) {
      logger.error({ error }, 'SecretarIA: ai_credit_packs migration failed');
    }
  }

  /**
   * Purchase a new credit pack for a company.
   */
  async purchaseCreditPack(
    companyId: string,
    packSize: number,
    source: 'purchase' | 'bonus' | 'promotion' = 'purchase',
    expiresAt?: Date,
  ): Promise<CreditPack> {
    await this.ensureMigrations();

    const result = await pool.query(
      `INSERT INTO ai_credit_packs (company_id, credits_total, credits_remaining, source, expires_at)
       VALUES ($1, $2, $2, $3, $4)
       RETURNING *`,
      [companyId, packSize, source, expiresAt?.toISOString() ?? null],
    );

    const row = result.rows[0] as any;
    return {
      id: row.id,
      companyId: row.company_id,
      creditsTotal: row.credits_total,
      creditsRemaining: row.credits_remaining,
      purchasedAt: new Date(row.purchased_at),
      expiresAt: row.expires_at ? new Date(row.expires_at) : null,
      source: row.source,
    };
  }

  /**
   * Consume one credit from the oldest pack with remaining credits.
   * Returns true if a credit was successfully consumed, false if no credits available.
   */
  async consumeCredit(companyId: string): Promise<boolean> {
    await this.ensureMigrations();

    // Atomically decrement from the oldest pack that still has credits
    const result = await pool.query(
      `UPDATE ai_credit_packs
       SET credits_remaining = credits_remaining - 1
       WHERE id = (
         SELECT id FROM ai_credit_packs
         WHERE company_id = $1
           AND credits_remaining > 0
           AND (expires_at IS NULL OR expires_at > NOW())
         ORDER BY purchased_at ASC
         LIMIT 1
       )
       RETURNING id`,
      [companyId],
    );

    return (result.rowCount ?? 0) > 0;
  }

  /**
   * Get total available credits across all packs for a company.
   */
  async getAvailableCredits(companyId: string): Promise<number> {
    await this.ensureMigrations();

    const result = await pool.query(
      `SELECT COALESCE(SUM(credits_remaining), 0) as total
       FROM ai_credit_packs
       WHERE company_id = $1
         AND credits_remaining > 0
         AND (expires_at IS NULL OR expires_at > NOW())`,
      [companyId],
    );

    return parseInt((result.rows[0] as any)?.total || '0', 10);
  }

  /**
   * Get all credit packs for a company (for display in frontend).
   */
  async getCreditPacks(companyId: string): Promise<readonly CreditPack[]> {
    await this.ensureMigrations();

    const result = await pool.query(
      `SELECT * FROM ai_credit_packs
       WHERE company_id = $1
       ORDER BY purchased_at DESC
       LIMIT 50`,
      [companyId],
    );

    return result.rows.map((row: any) => ({
      id: row.id,
      companyId: row.company_id,
      creditsTotal: row.credits_total,
      creditsRemaining: row.credits_remaining,
      purchasedAt: new Date(row.purchased_at),
      expiresAt: row.expires_at ? new Date(row.expires_at) : null,
      source: row.source,
    }));
  }
}

export const secretariaCredits = new SecretariaCreditsService();
