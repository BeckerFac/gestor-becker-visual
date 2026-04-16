/**
 * Accounting accounts service — Sol/Luna dual-circuit feature (CAT-1).
 *
 * Ensures the "no fiscal" (Luna 🌙) set of chart-of-accounts rows exist for
 * a given company. Idempotent: safe to call on every startup.
 *
 * The base Argentine chart of accounts (see chart-seed.ts) uses the 5 canonical
 * account types: activo | pasivo | patrimonio | ingreso | egreso. The Luna
 * accounts reuse those categories but add NEW codes dedicated to the no-fiscal
 * circuit so Luna movements never mix with Sol journal lines.
 */
import { pool } from '../../config/db';

interface NoFiscalAccount {
  code: string;
  name: string;
  /** High-level category for the base chart of accounts. */
  type: 'activo' | 'ingreso';
  /** Logical role within the Luna circuit (for callers that need it). */
  role: 'venta' | 'deudor' | 'caja' | 'banco';
  parentCode: string | null;
  level: number;
  isHeader: boolean;
}

export const LUNA_ACCOUNTS: NoFiscalAccount[] = [
  { code: '4.2.1', name: 'VENTAS_NO_FISCALES', type: 'ingreso', role: 'venta', parentCode: '4.2', level: 3, isHeader: false },
  { code: '1.2.1.1', name: 'DEUDORES_NO_FISCALES', type: 'activo', role: 'deudor', parentCode: '1.2.1', level: 4, isHeader: false },
  { code: '1.1.1.1', name: 'COBROS_NO_FISCALES_EN_CAJA', type: 'activo', role: 'caja', parentCode: '1.1.1', level: 4, isHeader: false },
  { code: '1.1.2.1', name: 'COBROS_NO_FISCALES_EN_BANCO', type: 'activo', role: 'banco', parentCode: '1.1.2', level: 4, isHeader: false },
];

/**
 * Ensure all Luna (no fiscal) accounting accounts exist for a company.
 * Uses ON CONFLICT DO NOTHING so it is fully idempotent.
 *
 * Parent accounts (e.g. '4.2', '1.2.1', '1.1.1', '1.1.2') may or may not exist
 * depending on whether the company has seeded the base chart. We look them up
 * best-effort and set parent_id to NULL if not found — this keeps the service
 * non-fatal and avoids FK violations.
 *
 * @returns number of accounts created (0 if all already existed).
 */
export async function ensureNoFiscalAccounts(companyId: string): Promise<number> {
  let created = 0;

  for (const acc of LUNA_ACCOUNTS) {
    let parentId: string | null = null;
    if (acc.parentCode) {
      try {
        const parentRes = await pool.query(
          `SELECT id FROM chart_of_accounts WHERE company_id = $1 AND code = $2 LIMIT 1`,
          [companyId, acc.parentCode]
        );
        parentId = parentRes.rows[0]?.id || null;
      } catch {
        parentId = null;
      }
    }

    try {
      const res = await pool.query(
        `INSERT INTO chart_of_accounts (company_id, code, name, type, parent_id, level, is_header)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (company_id, code) DO NOTHING
         RETURNING id`,
        [companyId, acc.code, acc.name, acc.type, parentId, acc.level, acc.isHeader]
      );
      if (res.rowCount && res.rowCount > 0) created++;
    } catch (e: any) {
      // Non-fatal: log and continue. Startup must complete.
      console.error(`[ensureNoFiscalAccounts] ${companyId} ${acc.code}: ${e?.message || e}`);
    }
  }

  return created;
}
