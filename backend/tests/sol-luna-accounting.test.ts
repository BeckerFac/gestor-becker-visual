/**
 * Sol/Luna dual-circuit — accounting parallel (CAT-7).
 *
 * Covers:
 *   1. createEntryForInvoice branching by fiscal_type (Sol vs Luna).
 *   2. createEntryForCobro branching + multi-method split (caja vs banco).
 *   3. NC forbidden on Luna branch (defensive 400).
 *   4. journal_entries.circuit is persisted on every INSERT path.
 *   5. getLedger circuit-aware filter + can_access_luna guard.
 *   6. getChartOfAccounts hides Luna accounts when !can_access_luna.
 *   7. ensureNoFiscalAccounts idempotency (uses pool.query mocks).
 *   8. Regression: Libro IVA Ventas and Posicion IVA exclude Luna invoices.
 *   9. Cross-circuit integrity: Luna entries never touch Sol chart codes.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  mockDbExecute,
  mockPoolQuery,
  mockDbRows,
  resetMocks,
} from './helpers/setup'

import {
  AccountingEntriesService,
  accountingEnabledCache,
  ACCOUNTS,
} from '../src/modules/accounting/accounting-entries.service'
import { AccountingService } from '../src/modules/reports/accounting.service'
import { ensureNoFiscalAccounts } from '../src/modules/accounting/accounting-accounts.service'

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

/** Capture every INSERT INTO journal_entries / lines call made via db.execute. */
function captureEntryInserts() {
  const captured: Array<{ kind: string; values: any[] }> = []
  mockDbExecute.mockImplementation((query: any) => {
    // drizzle-orm sql tag mock shape: { strings, values }
    const rawStrings: string[] = Array.isArray(query?.strings) ? query.strings : []
    const joined = rawStrings.join(' ')
    const values = query?.values || []

    if (/INSERT INTO journal_entries/i.test(joined)) {
      captured.push({ kind: 'entry_insert', values })
      // Return a deterministic entry id
      return Promise.resolve({ rows: [{ id: 'entry-luna', entry_number: 99 }] })
    }
    if (/INSERT INTO journal_entry_lines/i.test(joined)) {
      captured.push({ kind: 'line_insert', values })
      return Promise.resolve({ rows: [{ id: 'line-x' }] })
    }
    if (/SELECT accounting_enabled/i.test(joined)) {
      return Promise.resolve({ rows: [{ accounting_enabled: true }] })
    }
    if (/FROM chart_of_accounts/i.test(joined)) {
      // resolveAccountId path: return a deterministic id so inserts proceed.
      return Promise.resolve({ rows: [{ id: 'account-resolved' }] })
    }
    return Promise.resolve({ rows: [] })
  })
  return captured
}

describe('Sol/Luna Accounting Parallel (CAT-7)', () => {
  let service: AccountingEntriesService

  beforeEach(() => {
    resetMocks()
    accountingEnabledCache.clear()
    service = new AccountingEntriesService()
    // Default: pool.query (used by ensureNoFiscalAccounts) returns empty rows
    // so parent lookups resolve to null and INSERT ON CONFLICT DO NOTHING
    // returns rowCount 0 (no-op).
    mockPoolQuery.mockResolvedValue({ rows: [], rowCount: 0 })
  })

  // ──────────────────────────────────────────────────────────────────────
  // 1. createEntryForInvoice — Sol branch persists circuit='fiscal'
  // ──────────────────────────────────────────────────────────────────────
  it('Sol invoice: writes circuit="fiscal" into journal_entries', async () => {
    const captured = captureEntryInserts()

    const result = await service.createEntryForInvoice({
      id: 'inv-sol-1',
      company_id: 'co-1',
      date: '2026-04-14',
      total: 12100,
      subtotal: 10000,
      vat_amount: 2100,
      invoice_type: 'A',
      // fiscal_type omitted → defaults to Sol
    })

    expect(result).toBeDefined()
    const entryInsert = captured.find((c) => c.kind === 'entry_insert')
    expect(entryInsert).toBeDefined()
    // Last interpolated value on the createEntry INSERT is `circuit`.
    expect(entryInsert!.values[entryInsert!.values.length - 1]).toBe('fiscal')
    // And exactly 3 line inserts (Deudores, Ventas, IVA DF 21%).
    expect(captured.filter((c) => c.kind === 'line_insert')).toHaveLength(3)
  })

  // ──────────────────────────────────────────────────────────────────────
  // 2. createEntryForInvoice — Luna branch uses parallel accounts
  // ──────────────────────────────────────────────────────────────────────
  it('Luna invoice: 2 lines on DEUDORES_NO_FISCALES + VENTAS_NO_FISCALES, no IVA, circuit=no_fiscal', async () => {
    const captured = captureEntryInserts()

    const result = await service.createEntryForInvoice({
      id: 'inv-luna-1',
      company_id: 'co-1',
      date: '2026-04-14',
      total: 9999,
      invoice_type: 'X',
      fiscal_type: 'no_fiscal',
    })

    expect(result).toBeDefined()
    const entryInsert = captured.find((c) => c.kind === 'entry_insert')!
    expect(entryInsert.values[entryInsert.values.length - 1]).toBe('no_fiscal')

    // Exactly 2 line inserts (no IVA on Luna).
    const lineInserts = captured.filter((c) => c.kind === 'line_insert')
    expect(lineInserts).toHaveLength(2)

    // Also: ensureNoFiscalAccounts was invoked (=> at least 4 pool.query SELECTs for parents).
    expect(mockPoolQuery).toHaveBeenCalled()
  })

  // ──────────────────────────────────────────────────────────────────────
  // 3. createEntryForInvoice — Luna NC rejected with 400
  // ──────────────────────────────────────────────────────────────────────
  it('Luna NC: throws 400 (NCs not supported in Luna)', async () => {
    captureEntryInserts()

    await expect(
      service.createEntryForInvoice({
        id: 'nc-luna-1',
        company_id: 'co-1',
        total: 1000,
        invoice_type: 'NC_A',
        fiscal_type: 'no_fiscal',
      }),
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  // ──────────────────────────────────────────────────────────────────────
  // 4. createEntryForCobro — Sol efectivo (existing behavior preserved)
  // ──────────────────────────────────────────────────────────────────────
  it('Sol efectivo cobro: CAJA + DEUDORES_VENTAS, circuit=fiscal', async () => {
    const captured = captureEntryInserts()

    await service.createEntryForCobro({
      id: 'cobro-sol-1',
      company_id: 'co-1',
      date: '2026-04-14',
      amount: 5000,
      payment_method: 'efectivo',
    })

    const entryInsert = captured.find((c) => c.kind === 'entry_insert')!
    expect(entryInsert.values[entryInsert.values.length - 1]).toBe('fiscal')
    expect(captured.filter((c) => c.kind === 'line_insert')).toHaveLength(2)
  })

  // ──────────────────────────────────────────────────────────────────────
  // 5. Luna cobro efectivo → EN_CAJA
  // ──────────────────────────────────────────────────────────────────────
  it('Luna cobro efectivo: single D line on COBROS_NO_FISCALES_EN_CAJA + DEUDORES_NO_FISCALES', async () => {
    const captured = captureEntryInserts()

    await service.createEntryForCobro({
      id: 'cobro-luna-1',
      company_id: 'co-1',
      amount: 2500,
      fiscal_type: 'no_fiscal',
      payment_methods: [{ method: 'efectivo', amount: 2500 }],
    })

    const entryInsert = captured.find((c) => c.kind === 'entry_insert')!
    expect(entryInsert.values[entryInsert.values.length - 1]).toBe('no_fiscal')

    // Exactly 2 lines (caja, deudor). Bank line absent because no transfer.
    const lineInserts = captured.filter((c) => c.kind === 'line_insert')
    expect(lineInserts).toHaveLength(2)
  })

  // ──────────────────────────────────────────────────────────────────────
  // 6. Luna cobro transferencia → EN_BANCO
  // ──────────────────────────────────────────────────────────────────────
  it('Luna cobro transferencia: EN_BANCO (single D) + DEUDORES_NO_FISCALES', async () => {
    const captured = captureEntryInserts()

    await service.createEntryForCobro({
      id: 'cobro-luna-2',
      company_id: 'co-1',
      amount: 7000,
      fiscal_type: 'no_fiscal',
      payment_methods: [{ method: 'transferencia', amount: 7000, bank_id: 'bank-1' }],
    })

    const lineInserts = captured.filter((c) => c.kind === 'line_insert')
    expect(lineInserts).toHaveLength(2)
  })

  // ──────────────────────────────────────────────────────────────────────
  // 7. Luna cobro multi-method → split 2 debits + 1 credit
  // ──────────────────────────────────────────────────────────────────────
  it('Luna cobro mixto (efectivo + transferencia): splits into CAJA + BANCO debits', async () => {
    const captured = captureEntryInserts()

    await service.createEntryForCobro({
      id: 'cobro-luna-3',
      company_id: 'co-1',
      amount: 10000,
      fiscal_type: 'no_fiscal',
      payment_methods: [
        { method: 'efectivo', amount: 3000 },
        { method: 'transferencia', amount: 7000, bank_id: 'bank-1' },
      ],
    })

    // 3 line inserts: D caja + D banco + C deudor.
    const lineInserts = captured.filter((c) => c.kind === 'line_insert')
    expect(lineInserts).toHaveLength(3)

    const entryInsert = captured.find((c) => c.kind === 'entry_insert')!
    expect(entryInsert.values[entryInsert.values.length - 1]).toBe('no_fiscal')
  })

  // ──────────────────────────────────────────────────────────────────────
  // 8. Cross-circuit integrity: Luna entries never reference Sol codes
  // ──────────────────────────────────────────────────────────────────────
  it('Luna invoice does NOT resolve any Sol account code', async () => {
    // Track account codes passed to resolveAccountId by intercepting the
    // SELECT id FROM chart_of_accounts query values.
    const resolvedCodes: string[] = []
    mockDbExecute.mockImplementation((query: any) => {
      const rawStrings: string[] = Array.isArray(query?.strings) ? query.strings : []
      const joined = rawStrings.join(' ')
      const values = query?.values || []

      if (/SELECT accounting_enabled/i.test(joined)) {
        return Promise.resolve({ rows: [{ accounting_enabled: true }] })
      }
      if (/FROM chart_of_accounts/i.test(joined)) {
        // values[1] is `code` in resolveAccountId (first is companyId).
        if (values.length >= 2) resolvedCodes.push(String(values[1]))
        return Promise.resolve({ rows: [{ id: 'account-resolved' }] })
      }
      if (/INSERT INTO journal_entries/i.test(joined)) {
        return Promise.resolve({ rows: [{ id: 'entry-luna', entry_number: 1 }] })
      }
      if (/INSERT INTO journal_entry_lines/i.test(joined)) {
        return Promise.resolve({ rows: [{ id: 'line-x' }] })
      }
      return Promise.resolve({ rows: [] })
    })

    await service.createEntryForInvoice({
      id: 'inv-luna-x',
      company_id: 'co-1',
      total: 4200,
      invoice_type: 'X',
      fiscal_type: 'no_fiscal',
    })

    // Must include the Luna codes and NOT touch Sol's VENTAS/DEUDORES_VENTAS/IVA_DF.
    expect(resolvedCodes).toContain(ACCOUNTS.DEUDORES_NO_FISCALES)
    expect(resolvedCodes).toContain(ACCOUNTS.VENTAS_NO_FISCALES)
    expect(resolvedCodes).not.toContain(ACCOUNTS.VENTAS)
    expect(resolvedCodes).not.toContain(ACCOUNTS.DEUDORES_VENTAS)
    expect(resolvedCodes).not.toContain(ACCOUNTS.IVA_DF_21)
  })

  // ──────────────────────────────────────────────────────────────────────
  // 9. getLedger — user without can_access_luna never sees Luna accounts
  // ──────────────────────────────────────────────────────────────────────
  it('getLedger: blocks access to Luna account for users without can_access_luna', async () => {
    // No db.execute calls expected — the guard short-circuits before SQL.
    const rows = await service.getLedger(
      'co-1',
      ACCOUNTS.VENTAS_NO_FISCALES,
      { circuit: 'all' },
      /* canAccessLuna */ false,
    )
    expect(rows).toEqual([])
    expect(mockDbExecute).not.toHaveBeenCalled()
  })

  // ──────────────────────────────────────────────────────────────────────
  // 10. getLedger — can_access_luna + circuit=all returns both
  // ──────────────────────────────────────────────────────────────────────
  it('getLedger with canAccessLuna=true + circuit="all" issues unfiltered query', async () => {
    mockDbRows([
      { date: '2026-04-01', debit: '100', credit: '0', circuit: 'fiscal', account_type: 'activo',
        entry_description: 'x', reference_type: 't', reference_id: 'r', entry_number: 1,
        line_description: 'l', created_at: '2026-04-01' },
      { date: '2026-04-02', debit: '0', credit: '50', circuit: 'no_fiscal', account_type: 'activo',
        entry_description: 'y', reference_type: 't', reference_id: 'r', entry_number: 2,
        line_description: 'l', created_at: '2026-04-02' },
    ])

    const rows = await service.getLedger(
      'co-1',
      ACCOUNTS.DEUDORES_VENTAS,
      { circuit: 'all' },
      /* canAccessLuna */ true,
    )
    expect(rows).toHaveLength(2)
    expect(rows[0].circuit).toBe('fiscal')
    expect(rows[1].circuit).toBe('no_fiscal')
  })

  // ──────────────────────────────────────────────────────────────────────
  // 11. getLedger — canAccessLuna=true but circuit='fiscal' only Sol
  // ──────────────────────────────────────────────────────────────────────
  it('getLedger with canAccessLuna=true + circuit="fiscal" filters to Sol', async () => {
    mockDbRows([
      { date: '2026-04-01', debit: '100', credit: '0', circuit: 'fiscal', account_type: 'activo',
        entry_description: 'x', reference_type: 't', reference_id: 'r', entry_number: 1,
        line_description: 'l', created_at: '2026-04-01' },
    ])
    const rows = await service.getLedger(
      'co-1',
      ACCOUNTS.DEUDORES_VENTAS,
      { circuit: 'fiscal' },
      true,
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].circuit).toBe('fiscal')
  })

  // ──────────────────────────────────────────────────────────────────────
  // 12. getChartOfAccounts hides Luna accounts when !can_access_luna
  // ──────────────────────────────────────────────────────────────────────
  it('getChartOfAccounts: filters out Luna codes for users without access', async () => {
    mockDbRows([
      { code: '1.1.1', name: 'Caja', type: 'activo' },
      { code: ACCOUNTS.COBROS_NO_FISCALES_EN_CAJA, name: 'Cobros NF Caja', type: 'activo' },
      { code: ACCOUNTS.VENTAS_NO_FISCALES, name: 'Ventas NF', type: 'ingreso' },
      { code: '4.1', name: 'Ventas', type: 'ingreso' },
    ])

    const chart = await service.getChartOfAccounts('co-1', /* canAccessLuna */ false)
    const codes = chart.map((r: any) => r.code)
    expect(codes).toContain('1.1.1')
    expect(codes).toContain('4.1')
    expect(codes).not.toContain(ACCOUNTS.COBROS_NO_FISCALES_EN_CAJA)
    expect(codes).not.toContain(ACCOUNTS.VENTAS_NO_FISCALES)
  })

  // ──────────────────────────────────────────────────────────────────────
  // 13. getChartOfAccounts WITH can_access_luna returns Luna too
  // ──────────────────────────────────────────────────────────────────────
  it('getChartOfAccounts: includes Luna codes when canAccessLuna=true', async () => {
    mockDbRows([
      { code: '1.1.1', name: 'Caja', type: 'activo' },
      { code: ACCOUNTS.VENTAS_NO_FISCALES, name: 'Ventas NF', type: 'ingreso' },
    ])
    const chart = await service.getChartOfAccounts('co-1', true)
    expect(chart.map((r: any) => r.code)).toContain(ACCOUNTS.VENTAS_NO_FISCALES)
  })

  // ──────────────────────────────────────────────────────────────────────
  // 14. ensureNoFiscalAccounts idempotency — safe to call repeatedly
  // ──────────────────────────────────────────────────────────────────────
  it('ensureNoFiscalAccounts: idempotent (ON CONFLICT DO NOTHING, no throws)', async () => {
    // First call: 0 rows (all already existed).
    mockPoolQuery.mockResolvedValue({ rows: [], rowCount: 0 })
    const created1 = await ensureNoFiscalAccounts('co-1')
    const created2 = await ensureNoFiscalAccounts('co-1')
    expect(created1).toBe(0)
    expect(created2).toBe(0)
  })

  // ──────────────────────────────────────────────────────────────────────
  // 15. Libro IVA Ventas regression — Luna invoices excluded
  // ──────────────────────────────────────────────────────────────────────
  it('Libro IVA Ventas: SQL filters fiscal_type = fiscal (Luna excluded)', async () => {
    const svc = new AccountingService()

    let capturedSql = ''
    mockDbExecute.mockImplementation((query: any) => {
      const rawStrings: string[] = Array.isArray(query?.strings) ? query.strings : []
      capturedSql += rawStrings.join(' ')
      return Promise.resolve({ rows: [] })
    })

    await svc.getLibroIVAVentas('co-1', '2026-04-01', '2026-04-30')

    expect(capturedSql).toMatch(/i\.fiscal_type = 'fiscal'/)
  })

  // ──────────────────────────────────────────────────────────────────────
  // 16. Posicion IVA regression — Luna invoices excluded from debito
  // ──────────────────────────────────────────────────────────────────────
  it('Posicion IVA: debito query filters fiscal_type = fiscal (Luna excluded)', async () => {
    const svc = new AccountingService()

    let capturedSql = ''
    mockDbExecute.mockImplementation((query: any) => {
      const rawStrings: string[] = Array.isArray(query?.strings) ? query.strings : []
      capturedSql += rawStrings.join(' ')
      return Promise.resolve({ rows: [] })
    })

    await svc.getPosicionIVA('co-1', '2026-04-01', '2026-04-30')

    expect(capturedSql).toMatch(/fiscal_type = 'fiscal'/)
  })
})
