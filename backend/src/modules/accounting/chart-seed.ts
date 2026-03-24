import { db } from '../../config/db';
import { sql } from 'drizzle-orm';

interface SeedAccount {
  code: string;
  name: string;
  type: 'activo' | 'pasivo' | 'patrimonio' | 'ingreso' | 'egreso';
  parentCode: string | null;
  level: number;
  isHeader: boolean;
}

export const BASE_ACCOUNTS: SeedAccount[] = [
  // 1. ACTIVO
  { code: '1', name: 'ACTIVO', type: 'activo', parentCode: null, level: 1, isHeader: true },

  // 1.1 Disponibilidades
  { code: '1.1', name: 'Disponibilidades', type: 'activo', parentCode: '1', level: 2, isHeader: true },
  { code: '1.1.1', name: 'Caja', type: 'activo', parentCode: '1.1', level: 3, isHeader: false },
  { code: '1.1.2', name: 'Bancos', type: 'activo', parentCode: '1.1', level: 3, isHeader: true },
  // Subcuentas de bancos se crean dinamicamente por cada bank del sistema

  // 1.2 Creditos por Ventas
  { code: '1.2', name: 'Creditos por Ventas', type: 'activo', parentCode: '1', level: 2, isHeader: true },
  { code: '1.2.1', name: 'Deudores por Ventas', type: 'activo', parentCode: '1.2', level: 3, isHeader: false },
  { code: '1.2.2', name: 'Deudores Morosos', type: 'activo', parentCode: '1.2', level: 3, isHeader: false },

  // 1.3 Otros Creditos
  { code: '1.3', name: 'Otros Creditos', type: 'activo', parentCode: '1', level: 2, isHeader: true },
  { code: '1.3.1', name: 'IVA Credito Fiscal 21%', type: 'activo', parentCode: '1.3', level: 3, isHeader: false },
  { code: '1.3.2', name: 'IVA Credito Fiscal 10.5%', type: 'activo', parentCode: '1.3', level: 3, isHeader: false },
  { code: '1.3.3', name: 'IVA Credito Fiscal 27%', type: 'activo', parentCode: '1.3', level: 3, isHeader: false },
  { code: '1.3.4', name: 'IVA Credito Fiscal 5%', type: 'activo', parentCode: '1.3', level: 3, isHeader: false },
  { code: '1.3.5', name: 'IVA Credito Fiscal 2.5%', type: 'activo', parentCode: '1.3', level: 3, isHeader: false },
  { code: '1.3.6', name: 'Retenciones IIBB Sufridas', type: 'activo', parentCode: '1.3', level: 3, isHeader: false },
  { code: '1.3.7', name: 'Retencion Ganancias Sufrida', type: 'activo', parentCode: '1.3', level: 3, isHeader: false },
  { code: '1.3.8', name: 'Retencion IVA Sufrida', type: 'activo', parentCode: '1.3', level: 3, isHeader: false },
  { code: '1.3.9', name: 'Percepcion IIBB Sufrida', type: 'activo', parentCode: '1.3', level: 3, isHeader: false },
  { code: '1.3.10', name: 'Anticipos a Proveedores', type: 'activo', parentCode: '1.3', level: 3, isHeader: false },

  // 1.4 Bienes de Cambio
  { code: '1.4', name: 'Bienes de Cambio', type: 'activo', parentCode: '1', level: 2, isHeader: true },
  { code: '1.4.1', name: 'Mercaderias', type: 'activo', parentCode: '1.4', level: 3, isHeader: false },

  // 1.5 Valores a Depositar (Cheques)
  { code: '1.5', name: 'Valores a Depositar', type: 'activo', parentCode: '1', level: 2, isHeader: true },
  { code: '1.5.1', name: 'Cheques en Cartera', type: 'activo', parentCode: '1.5', level: 3, isHeader: false },
  { code: '1.5.2', name: 'Cheques Depositados', type: 'activo', parentCode: '1.5', level: 3, isHeader: false },

  // 1.6 Bienes de Uso
  { code: '1.6', name: 'Bienes de Uso', type: 'activo', parentCode: '1', level: 2, isHeader: true },
  { code: '1.6.1', name: 'Muebles y Utiles', type: 'activo', parentCode: '1.6', level: 3, isHeader: false },
  { code: '1.6.2', name: 'Equipos de Computacion', type: 'activo', parentCode: '1.6', level: 3, isHeader: false },

  // 2. PASIVO
  { code: '2', name: 'PASIVO', type: 'pasivo', parentCode: null, level: 1, isHeader: true },

  // 2.1 Deudas Comerciales
  { code: '2.1', name: 'Deudas Comerciales', type: 'pasivo', parentCode: '2', level: 2, isHeader: true },
  { code: '2.1.1', name: 'Proveedores', type: 'pasivo', parentCode: '2.1', level: 3, isHeader: false },

  // 2.2 Deudas Fiscales
  { code: '2.2', name: 'Deudas Fiscales', type: 'pasivo', parentCode: '2', level: 2, isHeader: true },
  { code: '2.2.1', name: 'IVA Debito Fiscal 21%', type: 'pasivo', parentCode: '2.2', level: 3, isHeader: false },
  { code: '2.2.2', name: 'IVA Debito Fiscal 10.5%', type: 'pasivo', parentCode: '2.2', level: 3, isHeader: false },
  { code: '2.2.3', name: 'IVA Debito Fiscal 27%', type: 'pasivo', parentCode: '2.2', level: 3, isHeader: false },
  { code: '2.2.4', name: 'IVA Debito Fiscal 5%', type: 'pasivo', parentCode: '2.2', level: 3, isHeader: false },
  { code: '2.2.5', name: 'IVA Debito Fiscal 2.5%', type: 'pasivo', parentCode: '2.2', level: 3, isHeader: false },
  { code: '2.2.6', name: 'Retencion IIBB a Depositar', type: 'pasivo', parentCode: '2.2', level: 3, isHeader: false },
  { code: '2.2.7', name: 'Retencion Ganancias a Depositar', type: 'pasivo', parentCode: '2.2', level: 3, isHeader: false },
  { code: '2.2.8', name: 'Retencion IVA a Depositar', type: 'pasivo', parentCode: '2.2', level: 3, isHeader: false },
  { code: '2.2.9', name: 'Retencion SUSS a Depositar', type: 'pasivo', parentCode: '2.2', level: 3, isHeader: false },
  { code: '2.2.10', name: 'Percepcion IIBB a Depositar', type: 'pasivo', parentCode: '2.2', level: 3, isHeader: false },

  // 2.3 Anticipos de Clientes
  { code: '2.3', name: 'Anticipos de Clientes', type: 'pasivo', parentCode: '2', level: 2, isHeader: true },
  { code: '2.3.1', name: 'Anticipos Recibidos', type: 'pasivo', parentCode: '2.3', level: 3, isHeader: false },

  // 3. PATRIMONIO NETO
  { code: '3', name: 'PATRIMONIO NETO', type: 'patrimonio', parentCode: null, level: 1, isHeader: true },
  { code: '3.1', name: 'Capital', type: 'patrimonio', parentCode: '3', level: 2, isHeader: false },
  { code: '3.2', name: 'Resultados Acumulados', type: 'patrimonio', parentCode: '3', level: 2, isHeader: false },
  { code: '3.3', name: 'Resultado del Ejercicio', type: 'patrimonio', parentCode: '3', level: 2, isHeader: false },

  // 4. INGRESOS
  { code: '4', name: 'INGRESOS', type: 'ingreso', parentCode: null, level: 1, isHeader: true },
  { code: '4.1', name: 'Ventas', type: 'ingreso', parentCode: '4', level: 2, isHeader: false },
  { code: '4.2', name: 'Otros Ingresos', type: 'ingreso', parentCode: '4', level: 2, isHeader: false },
  { code: '4.3', name: 'Diferencia de Cambio Positiva', type: 'ingreso', parentCode: '4', level: 2, isHeader: false },
  { code: '4.4', name: 'Ajustes CC Ingresos', type: 'ingreso', parentCode: '4', level: 2, isHeader: false },

  // 5. EGRESOS
  { code: '5', name: 'EGRESOS', type: 'egreso', parentCode: null, level: 1, isHeader: true },
  { code: '5.1', name: 'Costo de Mercaderias Vendidas', type: 'egreso', parentCode: '5', level: 2, isHeader: false },
  { code: '5.2', name: 'Gastos Administrativos', type: 'egreso', parentCode: '5', level: 2, isHeader: false },
  { code: '5.3', name: 'Gastos Financieros', type: 'egreso', parentCode: '5', level: 2, isHeader: true },
  { code: '5.3.1', name: 'Gastos Bancarios', type: 'egreso', parentCode: '5.3', level: 3, isHeader: false },
  { code: '5.3.2', name: 'Comisiones Bancarias', type: 'egreso', parentCode: '5.3', level: 3, isHeader: false },
  { code: '5.4', name: 'Cheques Rechazados', type: 'egreso', parentCode: '5', level: 2, isHeader: false },
  { code: '5.5', name: 'Diferencia de Cambio Negativa', type: 'egreso', parentCode: '5', level: 2, isHeader: false },
  { code: '5.6', name: 'Ajustes CC Egresos', type: 'egreso', parentCode: '5', level: 2, isHeader: false },
  { code: '5.7', name: 'Ajuste de Inventario', type: 'egreso', parentCode: '5', level: 2, isHeader: false },
];

/**
 * Seed the base Argentine chart of accounts for a company.
 * Skips accounts that already exist (idempotent).
 */
export async function seedChartOfAccounts(companyId: string): Promise<{ created: number; skipped: number }> {
  let created = 0;
  let skipped = 0;

  // Build a map of code -> id for parent resolution
  const codeToId: Record<string, string> = {};

  // First pass: check existing accounts
  const existing = await db.execute(sql`
    SELECT code, id FROM chart_of_accounts WHERE company_id = ${companyId}
  `);
  const existingRows = (existing as any).rows || existing || [];
  for (const row of existingRows) {
    codeToId[row.code] = row.id;
  }

  // Insert accounts in order (parents first)
  for (const account of BASE_ACCOUNTS) {
    if (codeToId[account.code]) {
      skipped++;
      continue;
    }

    const parentId = account.parentCode ? codeToId[account.parentCode] : null;

    const result = await db.execute(sql`
      INSERT INTO chart_of_accounts (company_id, code, name, type, parent_id, level, is_header)
      VALUES (${companyId}, ${account.code}, ${account.name}, ${account.type}, ${parentId}, ${account.level}, ${account.isHeader})
      ON CONFLICT (company_id, code) DO NOTHING
      RETURNING id
    `);

    const rows = (result as any).rows || result || [];
    if (rows.length > 0) {
      codeToId[account.code] = rows[0].id;
      created++;
    } else {
      skipped++;
    }
  }

  return { created, skipped };
}

/**
 * Migration mapping: old code -> new code for companies with the old chart.
 * Reassigns journal_entry_lines from old leaf accounts to new ones.
 */
const MIGRATION_MAP: Record<string, string> = {
  // Old '1.1' (Caja y Bancos) was a leaf -> now '1.1.1' (Caja)
  '1.1': '1.1.1',
  // Old '1.2' (Creditos por Ventas / Deudores) -> now '1.2.1' (Deudores por Ventas)
  '1.2': '1.2.1',
  // Old '1.3' (Bienes de Cambio) -> now '1.4.1' (Mercaderias)
  '1.3': '1.4.1',
  // Old '1.4' (Bienes de Uso) -> now '1.6' (Bienes de Uso) - stays as header
  // Old '1.5' (IVA Credito Fiscal) -> now '1.3.1' (IVA Credito Fiscal 21%)
  '1.5': '1.3.1',
  // Old '2.1' (Deudas Comerciales / Proveedores) -> now '2.1.1' (Proveedores)
  '2.1': '2.1.1',
  // Old '2.3' (IVA Debito Fiscal) -> now '2.2.1' (IVA Debito Fiscal 21%)
  '2.3': '2.2.1',
  // Old '5.1' (Costo de Ventas) -> now '5.1' (Costo de Mercaderias Vendidas) - same code, just rename
  // Old '5.3' (Gastos Financieros) -> now '5.3' is a header, move lines to '5.3.1'
  '5.3': '5.3.1',
};

/**
 * Codes that should become isHeader=true in the new chart.
 * These are codes that existed as leaf accounts but are now headers.
 */
const CODES_TO_MARK_HEADER = ['1.1', '1.2', '1.3', '1.4', '1.5', '2.1', '2.2', '2.3', '5.3'];

/**
 * Migrate a company from the old chart of accounts to the new one.
 * 1. Detects if the company has the old chart (no level 3 accounts)
 * 2. Seeds the new accounts (idempotent)
 * 3. Reassigns journal_entry_lines from old accounts to new ones
 * 4. Marks intermediate accounts as isHeader=true
 */
export async function migrateChartOfAccounts(companyId: string): Promise<{
  migrated: boolean;
  linesReassigned: number;
  accountsCreated: number;
  headersUpdated: number;
}> {
  // Step 1: Detect if old chart (no level 3 accounts = old)
  const level3Check = await db.execute(sql`
    SELECT COUNT(*)::int as cnt FROM chart_of_accounts
    WHERE company_id = ${companyId} AND level = 3
  `);
  const level3Rows = (level3Check as any).rows || level3Check || [];
  const level3Count = level3Rows[0]?.cnt || 0;

  if (level3Count > 0) {
    // Already migrated
    return { migrated: false, linesReassigned: 0, accountsCreated: 0, headersUpdated: 0 };
  }

  // Step 2: Seed new accounts (adds missing ones without duplicating)
  const { created: accountsCreated } = await seedChartOfAccounts(companyId);

  // Step 3: Reassign journal_entry_lines
  let linesReassigned = 0;

  for (const [oldCode, newCode] of Object.entries(MIGRATION_MAP)) {
    // Get old account ID
    const oldResult = await db.execute(sql`
      SELECT id FROM chart_of_accounts
      WHERE company_id = ${companyId} AND code = ${oldCode}
      LIMIT 1
    `);
    const oldRows = (oldResult as any).rows || oldResult || [];
    if (oldRows.length === 0) continue;
    const oldAccountId = oldRows[0].id;

    // Get new account ID
    const newResult = await db.execute(sql`
      SELECT id FROM chart_of_accounts
      WHERE company_id = ${companyId} AND code = ${newCode}
      LIMIT 1
    `);
    const newRows = (newResult as any).rows || newResult || [];
    if (newRows.length === 0) continue;
    const newAccountId = newRows[0].id;

    // Reassign lines
    const updateResult = await db.execute(sql`
      UPDATE journal_entry_lines
      SET account_id = ${newAccountId}
      WHERE account_id = ${oldAccountId}
    `);
    const rowCount = (updateResult as any).rowCount || 0;
    linesReassigned += rowCount;
  }

  // Step 4: Mark intermediate accounts as isHeader=true and update names
  let headersUpdated = 0;
  for (const code of CODES_TO_MARK_HEADER) {
    const matchingAccount = BASE_ACCOUNTS.find((a) => a.code === code);
    if (!matchingAccount) continue;

    const updateResult = await db.execute(sql`
      UPDATE chart_of_accounts
      SET is_header = true, name = ${matchingAccount.name}
      WHERE company_id = ${companyId} AND code = ${code} AND is_header = false
    `);
    const rowCount = (updateResult as any).rowCount || 0;
    headersUpdated += rowCount;
  }

  return { migrated: true, linesReassigned, accountsCreated, headersUpdated };
}
