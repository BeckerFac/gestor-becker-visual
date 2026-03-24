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

const BASE_ACCOUNTS: SeedAccount[] = [
  // Level 1 headers
  { code: '1', name: 'ACTIVO', type: 'activo', parentCode: null, level: 1, isHeader: true },
  { code: '2', name: 'PASIVO', type: 'pasivo', parentCode: null, level: 1, isHeader: true },
  { code: '3', name: 'PATRIMONIO NETO', type: 'patrimonio', parentCode: null, level: 1, isHeader: true },
  { code: '4', name: 'INGRESOS', type: 'ingreso', parentCode: null, level: 1, isHeader: true },
  { code: '5', name: 'EGRESOS', type: 'egreso', parentCode: null, level: 1, isHeader: true },

  // Activo
  { code: '1.1', name: 'Caja y Bancos', type: 'activo', parentCode: '1', level: 2, isHeader: false },
  { code: '1.2', name: 'Creditos por Ventas (Deudores)', type: 'activo', parentCode: '1', level: 2, isHeader: false },
  { code: '1.3', name: 'Bienes de Cambio', type: 'activo', parentCode: '1', level: 2, isHeader: false },
  { code: '1.4', name: 'Bienes de Uso', type: 'activo', parentCode: '1', level: 2, isHeader: false },
  { code: '1.5', name: 'IVA Credito Fiscal', type: 'activo', parentCode: '1', level: 2, isHeader: false },

  // Pasivo
  { code: '2.1', name: 'Deudas Comerciales (Proveedores)', type: 'pasivo', parentCode: '2', level: 2, isHeader: false },
  { code: '2.2', name: 'Deudas Fiscales', type: 'pasivo', parentCode: '2', level: 2, isHeader: false },
  { code: '2.3', name: 'IVA Debito Fiscal', type: 'pasivo', parentCode: '2', level: 2, isHeader: false },

  // Patrimonio Neto
  { code: '3.1', name: 'Capital', type: 'patrimonio', parentCode: '3', level: 2, isHeader: false },
  { code: '3.2', name: 'Resultados Acumulados', type: 'patrimonio', parentCode: '3', level: 2, isHeader: false },

  // Ingresos
  { code: '4.1', name: 'Ventas', type: 'ingreso', parentCode: '4', level: 2, isHeader: false },
  { code: '4.2', name: 'Otros Ingresos', type: 'ingreso', parentCode: '4', level: 2, isHeader: false },

  // Egresos
  { code: '5.1', name: 'Costo de Ventas', type: 'egreso', parentCode: '5', level: 2, isHeader: false },
  { code: '5.2', name: 'Gastos Administrativos', type: 'egreso', parentCode: '5', level: 2, isHeader: false },
  { code: '5.3', name: 'Gastos Financieros', type: 'egreso', parentCode: '5', level: 2, isHeader: false },
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
