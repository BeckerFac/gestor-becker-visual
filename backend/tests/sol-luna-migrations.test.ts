/**
 * Sol/Luna dual-circuit — CAT-1 DB Foundation tests.
 *
 * Verifies that runCriticalMigrations() establishes all schema changes
 * required by the Luna (no fiscal) circuit:
 *   - New columns on orders/remitos/cobros/users/invoices/audit_log
 *   - invoice_type enum contains 'LUN' (or is VARCHAR — both valid)
 *   - Backfills leave ZERO NULLs in the target columns
 *   - ensureNoFiscalAccounts is idempotent
 *   - runCriticalMigrations is idempotent (running twice is a no-op)
 *
 * Opt-in: requires DATABASE_URL + RUN_INTEGRATION_TESTS=1. Skips otherwise
 * so pre-push hooks don't break when no ephemeral DB is available.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(__dirname, '../../.env') });

const DATABASE_URL = process.env.DATABASE_URL;
const shouldRun = !!DATABASE_URL && process.env.RUN_INTEGRATION_TESTS === '1';

describe.skipIf(!shouldRun)('Sol/Luna CAT-1 migrations', () => {
  let pool: Pool;

  beforeAll(async () => {
    const needsSsl = /neon|render|supabase|amazonaws|azure/i.test(DATABASE_URL || '');
    pool = new Pool({
      connectionString: DATABASE_URL,
      ssl: needsSsl ? { rejectUnauthorized: false } : false,
      max: 2,
      idleTimeoutMillis: 3000,
    });

    // Run critical migrations once before assertions.
    const { runCriticalMigrations } = await import('../src/config/db');
    await runCriticalMigrations();
  }, 60000);

  afterAll(async () => {
    if (pool) await pool.end();
  });

  const colExists = async (table: string, column: string): Promise<boolean> => {
    const r = await pool.query(
      `SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = $2 LIMIT 1`,
      [table, column]
    );
    return (r.rowCount || 0) > 0;
  };

  // ═══════════════════════════════════════════════════════════════════
  // Schema assertions — every column exists in information_schema
  // ═══════════════════════════════════════════════════════════════════

  it('orders has fiscal_type + lock columns', async () => {
    expect(await colExists('orders', 'fiscal_type')).toBe(true);
    expect(await colExists('orders', 'locked_at')).toBe(true);
    expect(await colExists('orders', 'locked_reason')).toBe(true);
    expect(await colExists('orders', 'locked_by')).toBe(true);
  });

  it('remitos has fiscal_type', async () => {
    expect(await colExists('remitos', 'fiscal_type')).toBe(true);
  });

  it('cobros has fiscal_type', async () => {
    expect(await colExists('cobros', 'fiscal_type')).toBe(true);
  });

  it('users has can_access_luna', async () => {
    expect(await colExists('users', 'can_access_luna')).toBe(true);
  });

  it('invoices has fiscal_type', async () => {
    expect(await colExists('invoices', 'fiscal_type')).toBe(true);
  });

  it('audit_log has circuit', async () => {
    expect(await colExists('audit_log', 'circuit')).toBe(true);
  });

  // ═══════════════════════════════════════════════════════════════════
  // invoice_type accepts 'LUN'
  //   - If invoice_type is a Postgres enum, it must contain 'LUN'.
  //   - If it's a VARCHAR column (current GoBecker state), nothing to
  //     assert: 'LUN' is a valid 3-char value.
  // ═══════════════════════════════════════════════════════════════════
  it("invoice_type accepts 'LUN' (enum contains it, or column is VARCHAR)", async () => {
    const enumRes = await pool.query(`
      SELECT e.enumlabel
      FROM pg_type t
      JOIN pg_enum e ON e.enumtypid = t.oid
      WHERE t.typname = 'invoice_type'
    `);
    if (enumRes.rowCount && enumRes.rowCount > 0) {
      const labels = enumRes.rows.map((r) => r.enumlabel);
      expect(labels).toContain('LUN');
    } else {
      // VARCHAR path: verify the column exists and is character type
      const colRes = await pool.query(
        `SELECT data_type FROM information_schema.columns
         WHERE table_name = 'invoices' AND column_name = 'invoice_type' LIMIT 1`
      );
      expect(colRes.rowCount).toBeGreaterThan(0);
      expect(colRes.rows[0].data_type).toMatch(/character/);
    }
  });

  // ═══════════════════════════════════════════════════════════════════
  // Backfills — 0 NULLs in target columns
  // ═══════════════════════════════════════════════════════════════════

  it('backfills: no NULL fiscal_type anywhere', async () => {
    for (const table of ['orders', 'remitos', 'cobros']) {
      const r = await pool.query(`SELECT COUNT(*)::int AS n FROM ${table} WHERE fiscal_type IS NULL`);
      expect(r.rows[0].n).toBe(0);
    }
  });

  it('backfills: no legacy invoices.fiscal_type=interno remains', async () => {
    const r = await pool.query(`SELECT COUNT(*)::int AS n FROM invoices WHERE fiscal_type = 'interno'`);
    expect(r.rows[0].n).toBe(0);
  });

  it('backfills: no users with NULL can_access_luna', async () => {
    const r = await pool.query(`SELECT COUNT(*)::int AS n FROM users WHERE can_access_luna IS NULL`);
    expect(r.rows[0].n).toBe(0);
  });

  it('backfills: all owners/admins have can_access_luna = TRUE', async () => {
    const r = await pool.query(
      `SELECT COUNT(*)::int AS n FROM users
       WHERE role IN ('owner','admin') AND can_access_luna IS DISTINCT FROM TRUE`
    );
    expect(r.rows[0].n).toBe(0);
  });

  // ═══════════════════════════════════════════════════════════════════
  // ensureNoFiscalAccounts idempotency
  // ═══════════════════════════════════════════════════════════════════

  it('ensureNoFiscalAccounts is idempotent (two consecutive calls = same state)', async () => {
    const companies = await pool.query(`SELECT id FROM companies LIMIT 1`);
    if (!companies.rowCount) return; // nothing to test
    const companyId = companies.rows[0].id;

    const { ensureNoFiscalAccounts, LUNA_ACCOUNTS } = await import(
      '../src/modules/accounting/accounting-accounts.service'
    );

    await ensureNoFiscalAccounts(companyId);
    const snapshot1 = await pool.query(
      `SELECT code, name, type FROM chart_of_accounts
       WHERE company_id = $1 AND code = ANY($2::text[])
       ORDER BY code`,
      [companyId, LUNA_ACCOUNTS.map((a: any) => a.code)]
    );

    const secondCallCreated = await ensureNoFiscalAccounts(companyId);
    const snapshot2 = await pool.query(
      `SELECT code, name, type FROM chart_of_accounts
       WHERE company_id = $1 AND code = ANY($2::text[])
       ORDER BY code`,
      [companyId, LUNA_ACCOUNTS.map((a: any) => a.code)]
    );

    expect(secondCallCreated).toBe(0);
    expect(snapshot2.rows).toEqual(snapshot1.rows);
    // All 4 Luna accounts must exist after the call
    expect(snapshot2.rowCount).toBe(LUNA_ACCOUNTS.length);
  });

  // ═══════════════════════════════════════════════════════════════════
  // runCriticalMigrations global idempotency
  // ═══════════════════════════════════════════════════════════════════

  it('runCriticalMigrations is idempotent (second run changes nothing)', async () => {
    const snapshotTargets = [
      `SELECT column_name, data_type, column_default FROM information_schema.columns
         WHERE table_name IN ('orders','remitos','cobros','users','invoices','audit_log')
           AND column_name IN ('fiscal_type','locked_at','locked_reason','locked_by','can_access_luna','circuit')
         ORDER BY table_name, column_name`,
    ];

    const before = await pool.query(snapshotTargets[0]);

    const { runCriticalMigrations } = await import('../src/config/db');
    await runCriticalMigrations();

    const after = await pool.query(snapshotTargets[0]);
    expect(after.rows).toEqual(before.rows);
  });
});
