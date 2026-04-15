/**
 * Accounting supplier-side fixes (PR7-T20):
 *   C1 — Libro IVA Compras excludes received NCs
 *   C2 — Posicion IVA credito_fiscal excludes supplier NCs
 *   C3 — Libro IVA Compras handles currency / exchange_rate -> ARS columns
 *   C4 — createEntryForPurchaseInvoice iterates items with real vat_rate
 *   C5 — createEntryForPago posts retenciones a depositar
 *   C6 — createEntryForChequeTransition handles direction='emitido'
 *
 * These tests exercise the services through the shared db.execute mock
 * (see tests/helpers/setup.ts). They verify both SQL shape (NC exclusion,
 * ARS-equivalent columns) and journal line balance correctness.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDbExecute, mockDbRows, resetMocks } from './helpers/setup'

import {
  AccountingEntriesService,
  accountingEnabledCache,
  ACCOUNTS,
} from '../src/modules/accounting/accounting-entries.service'
import { AccountingService } from '../src/modules/reports/accounting.service'

describe('Accounting supplier-side fixes (PR7-T20)', () => {
  let entriesService: AccountingEntriesService
  let reportsService: AccountingService

  beforeEach(() => {
    resetMocks()
    vi.clearAllMocks()
    accountingEnabledCache.clear()
    entriesService = new AccountingEntriesService()
    reportsService = new AccountingService()
  })

  function mockAccountingEnabled() {
    mockDbRows([{ accounting_enabled: true }])
  }

  /**
   * Capture every SQL call so the individual tests can inspect the final
   * query text and the journal lines actually persisted.
   */
  function captureAllSql(rowsByCall: any[] = []) {
    const calls: any[] = []
    mockDbExecute.mockImplementation((q: any) => {
      calls.push(q)
      const idx = calls.length - 1
      return Promise.resolve({ rows: rowsByCall[idx] ?? [] })
    })
    return calls
  }

  function sqlText(q: any): string {
    // drizzle-orm mock returns { strings, values } — join strings for assertions
    if (q && Array.isArray(q.strings)) return q.strings.join(' ')
    return String(q)
  }

  // ── C1: Libro IVA Compras excludes NCs ────────────────────────────────────
  describe('C1 Libro IVA Compras - NC exclusion', () => {
    it('SQL filter excludes purchase_invoices.invoice_type LIKE NC%', async () => {
      const calls = captureAllSql([
        // Only one query executed by getLibroIVACompras
        [],
      ])

      await reportsService.getLibroIVACompras('company-1', '2026-01-01', '2026-01-31')

      expect(calls.length).toBeGreaterThanOrEqual(1)
      const text = sqlText(calls[0])
      expect(text).toContain("invoice_type::text NOT LIKE 'NC%'")
    })
  })

  // ── C2: Posicion IVA credito_fiscal excludes supplier NCs ────────────────
  describe('C2 Posicion IVA - NC exclusion on credito fiscal', () => {
    it('credito fiscal query excludes NCs of compra', async () => {
      const calls = captureAllSql([
        [], // debito
        [], // credito
      ])

      await reportsService.getPosicionIVA('company-1', '2026-01-01', '2026-01-31')

      expect(calls.length).toBeGreaterThanOrEqual(2)
      const creditoText = sqlText(calls[1])
      expect(creditoText).toContain("invoice_type::text NOT LIKE 'NC%'")
    })
  })

  // ── C3: Currency handling in Libro IVA Compras ────────────────────────────
  describe('C3 Libro IVA Compras - currency to ARS conversion', () => {
    it('returns ARS-equivalent columns for USD invoices', async () => {
      mockDbExecute.mockResolvedValueOnce({
        rows: [{
          date: '2026-01-15',
          invoice_type: 'A',
          punto_venta: '00003',
          invoice_number: '00000001',
          currency: 'USD',
          exchange_rate: '1000',
          enterprise_name: 'Proveedor USD',
          enterprise_cuit: '20123456789',
          neto_gravado: '100',
          neto_no_gravado: 0,
          op_exentas: 0,
          iva: '21',
          otros_tributos: 0,
          total: '121',
          neto_gravado_ars: '100000',
          iva_ars: '21000',
          otros_tributos_ars: '0',
          total_ars: '121000',
        }],
      })

      const result = await reportsService.getLibroIVACompras('company-1', '2026-01-01', '2026-01-31')

      expect(result.rows).toHaveLength(1)
      const row: any = result.rows[0]
      expect(row.currency).toBe('USD')
      expect(row.exchange_rate).toBe(1000)
      expect(row.total).toBe(121)
      expect(row.total_ars).toBe(121000)
      expect(row.iva_ars).toBe(21000)
      expect(row.neto_gravado_ars).toBe(100000)
      // Totals must aggregate the ARS columns
      expect((result.totals as any).total_ars).toBe(121000)
      expect((result.totals as any).iva_ars).toBe(21000)
    })

    it('SQL query selects currency, exchange_rate, and *_ars columns', async () => {
      const calls = captureAllSql([[]])
      await reportsService.getLibroIVACompras('company-1', '2026-01-01', '2026-01-31')
      const text = sqlText(calls[0])
      expect(text).toContain('pi.currency')
      expect(text).toContain('pi.exchange_rate')
      expect(text).toContain('total_ars')
      expect(text).toContain('iva_ars')
    })
  })

  // ── C4: createEntryForPurchaseInvoice iterates items with real vat_rate ──
  describe('C4 createEntryForPurchaseInvoice - per-item vat_rate mapping', () => {
    it('posts IVA CF 10.5% for items with vat_rate=10.5', async () => {
      // isAccountingEnabled -> true
      mockAccountingEnabled()
      // Collect all createEntry INSERT activity
      const capturedLines: Array<{ code: string; debit: number; credit: number }> = []

      // mock createEntry flow: entry INSERT then for each line -> resolveAccount + line INSERT
      // We intercept every execute and track which account_code appears.
      const entryId = { id: 'entry-1', entry_number: 1 }
      let call = 0
      mockDbExecute.mockImplementation((q: any) => {
        call++
        const text = sqlText(q)
        if (text.includes('INSERT INTO journal_entries')) {
          return Promise.resolve({ rows: [entryId] })
        }
        if (text.includes('FROM chart_of_accounts') && text.includes('code =')) {
          // resolveAccountId — the code is in q.values
          const code = (q.values || []).find((v: any) => typeof v === 'string' && /^\d+\.\d+/.test(v))
          capturedLines.push({ code, debit: 0, credit: 0 })
          return Promise.resolve({ rows: [{ id: `acc-${code}` }] })
        }
        if (text.includes('INSERT INTO journal_entry_lines')) {
          // values order: entry.id, accountId, line.debit, line.credit, description
          const vals = q.values || []
          const last = capturedLines[capturedLines.length - 1]
          if (last) {
            last.debit = Number(vals[2] || 0)
            last.credit = Number(vals[3] || 0)
          }
          return Promise.resolve({ rows: [{ id: `line-${call}` }] })
        }
        return Promise.resolve({ rows: [] })
      })

      await entriesService.createEntryForPurchaseInvoice({
        id: 'pi-1',
        company_id: 'company-1',
        date: '2026-01-15',
        total: 1105,
        subtotal: 1000,
        vat_amount: 105,
        invoice_type: 'A',
        items: [
          { quantity: 1, unit_price: 1000, vat_rate: 10.5 },
        ],
      })

      const codes = capturedLines.map(l => l.code)
      expect(codes).toContain(ACCOUNTS.CMV)
      expect(codes).toContain(ACCOUNTS.IVA_CF_105)
      expect(codes).toContain(ACCOUNTS.PROVEEDORES)
      // Must NOT post to IVA_CF_21 when the item is 10.5%
      expect(codes).not.toContain(ACCOUNTS.IVA_CF_21)

      // Totals balanced
      const totalDebit = capturedLines.reduce((s, l) => s + l.debit, 0)
      const totalCredit = capturedLines.reduce((s, l) => s + l.credit, 0)
      expect(Math.abs(totalDebit - totalCredit)).toBeLessThan(0.01)
      expect(totalDebit).toBeCloseTo(1105, 2)
    })

    it('NC of compra reverses debit/credit sides', async () => {
      mockAccountingEnabled()
      const capturedLines: Array<{ code: string; debit: number; credit: number }> = []
      mockDbExecute.mockImplementation((q: any) => {
        const text = sqlText(q)
        if (text.includes('INSERT INTO journal_entries')) {
          return Promise.resolve({ rows: [{ id: 'entry-nc', entry_number: 2 }] })
        }
        if (text.includes('FROM chart_of_accounts') && text.includes('code =')) {
          const code = (q.values || []).find((v: any) => typeof v === 'string' && /^\d+\.\d+/.test(v))
          capturedLines.push({ code, debit: 0, credit: 0 })
          return Promise.resolve({ rows: [{ id: `acc-${code}` }] })
        }
        if (text.includes('INSERT INTO journal_entry_lines')) {
          const vals = q.values || []
          // Match this line insert to the corresponding capturedLines entry
          // by accountId (vals[1]). Falls back to last-with-zero if needed.
          const accountId = vals[1]
          const target = capturedLines.find(l => `acc-${l.code}` === accountId && l.debit === 0 && l.credit === 0)
            || capturedLines[capturedLines.length - 1]
          if (target) {
            target.debit = Number(vals[2] || 0)
            target.credit = Number(vals[3] || 0)
          }
          return Promise.resolve({ rows: [{ id: 'line' }] })
        }
        return Promise.resolve({ rows: [] })
      })

      await entriesService.createEntryForPurchaseInvoice({
        id: 'pi-nc',
        company_id: 'company-1',
        date: '2026-01-20',
        total: 1210,
        subtotal: 1000,
        vat_amount: 210,
        invoice_type: 'NC_A',
        items: [{ quantity: 1, unit_price: 1000, vat_rate: 21 }],
      })

      const prov = capturedLines.find(l => l.code === ACCOUNTS.PROVEEDORES)
      const cmv = capturedLines.find(l => l.code === ACCOUNTS.CMV)
      const iva = capturedLines.find(l => l.code === ACCOUNTS.IVA_CF_21)

      expect(prov?.debit).toBeCloseTo(1210, 2)
      expect(cmv?.credit).toBeCloseTo(1000, 2)
      expect(iva?.credit).toBeCloseTo(210, 2)

      const totalDebit = capturedLines.reduce((s, l) => s + l.debit, 0)
      const totalCredit = capturedLines.reduce((s, l) => s + l.credit, 0)
      expect(Math.abs(totalDebit - totalCredit)).toBeLessThan(0.01)
    })
  })

  // ── C5: createEntryForPago with retenciones practicadas ──────────────────
  describe('C5 createEntryForPago - retenciones practicadas', () => {
    it('creates Retenciones a Depositar credit line', async () => {
      mockAccountingEnabled()
      const capturedLines: Array<{ code: string; debit: number; credit: number }> = []

      mockDbExecute.mockImplementation((q: any) => {
        const text = sqlText(q)
        if (text.includes('INSERT INTO journal_entries')) {
          return Promise.resolve({ rows: [{ id: 'entry-pago', entry_number: 3 }] })
        }
        if (text.includes('FROM chart_of_accounts') && text.includes('code =')) {
          const code = (q.values || []).find((v: any) => typeof v === 'string' && /^\d+\.\d+/.test(v))
          capturedLines.push({ code, debit: 0, credit: 0 })
          return Promise.resolve({ rows: [{ id: `acc-${code}` }] })
        }
        if (text.includes('INSERT INTO journal_entry_lines')) {
          const vals = q.values || []
          // Match this line insert to the corresponding capturedLines entry
          // by accountId (vals[1]). Falls back to last-with-zero if needed.
          const accountId = vals[1]
          const target = capturedLines.find(l => `acc-${l.code}` === accountId && l.debit === 0 && l.credit === 0)
            || capturedLines[capturedLines.length - 1]
          if (target) {
            target.debit = Number(vals[2] || 0)
            target.credit = Number(vals[3] || 0)
          }
          return Promise.resolve({ rows: [{ id: 'line' }] })
        }
        return Promise.resolve({ rows: [] })
      })

      // amount=900 cash, retencion iibb=100 -> total debt reduction=1000
      await entriesService.createEntryForPago({
        id: 'pago-1',
        company_id: 'company-1',
        date: '2026-01-10',
        amount: 900,
        total_amount: 1000,
        payment_method: 'transferencia',
        retenciones: [{ type: 'iibb', amount: 100, jurisdiction: 'caba' }],
      })

      const prov = capturedLines.find(l => l.code === ACCOUNTS.PROVEEDORES)
      const caja = capturedLines.find(l => l.code === ACCOUNTS.CAJA)
      const retLiab = capturedLines.find(l => l.code === ACCOUNTS.RET_IIBB_DEPOSITAR)

      expect(prov?.debit).toBeCloseTo(1000, 2)
      expect(caja?.credit).toBeCloseTo(900, 2)
      expect(retLiab?.credit).toBeCloseTo(100, 2)

      const totalDebit = capturedLines.reduce((s, l) => s + l.debit, 0)
      const totalCredit = capturedLines.reduce((s, l) => s + l.credit, 0)
      expect(Math.abs(totalDebit - totalCredit)).toBeLessThan(0.01)
    })

    it('pago by own cheque credits CHEQUES_EMITIDOS instead of Caja', async () => {
      mockAccountingEnabled()
      const capturedLines: Array<{ code: string; debit: number; credit: number }> = []

      mockDbExecute.mockImplementation((q: any) => {
        const text = sqlText(q)
        if (text.includes('INSERT INTO journal_entries')) {
          return Promise.resolve({ rows: [{ id: 'entry-pago-cq', entry_number: 4 }] })
        }
        if (text.includes('FROM chart_of_accounts') && text.includes('code =')) {
          const code = (q.values || []).find((v: any) => typeof v === 'string' && /^\d+\.\d+/.test(v))
          capturedLines.push({ code, debit: 0, credit: 0 })
          return Promise.resolve({ rows: [{ id: `acc-${code}` }] })
        }
        if (text.includes('INSERT INTO journal_entry_lines')) {
          const vals = q.values || []
          // Match this line insert to the corresponding capturedLines entry
          // by accountId (vals[1]). Falls back to last-with-zero if needed.
          const accountId = vals[1]
          const target = capturedLines.find(l => `acc-${l.code}` === accountId && l.debit === 0 && l.credit === 0)
            || capturedLines[capturedLines.length - 1]
          if (target) {
            target.debit = Number(vals[2] || 0)
            target.credit = Number(vals[3] || 0)
          }
          return Promise.resolve({ rows: [{ id: 'line' }] })
        }
        return Promise.resolve({ rows: [] })
      })

      await entriesService.createEntryForPago({
        id: 'pago-cheque',
        company_id: 'company-1',
        date: '2026-01-11',
        amount: 500,
        total_amount: 500,
        payment_method: 'cheque',
        retenciones: [],
      })

      const codes = capturedLines.map(l => l.code)
      expect(codes).toContain(ACCOUNTS.CHEQUES_EMITIDOS)
      expect(codes).not.toContain(ACCOUNTS.CAJA)
    })
  })

  // ── C6: createEntryForChequeTransition direction='emitido' ───────────────
  describe('C6 createEntryForChequeTransition - emitido direction', () => {
    it('emitido -> cobrado: D:Cheques Emitidos C:Caja', async () => {
      mockAccountingEnabled()
      const capturedLines: Array<{ code: string; debit: number; credit: number }> = []

      mockDbExecute.mockImplementation((q: any) => {
        const text = sqlText(q)
        if (text.includes('INSERT INTO journal_entries')) {
          return Promise.resolve({ rows: [{ id: 'entry-cq', entry_number: 5 }] })
        }
        if (text.includes('FROM chart_of_accounts') && text.includes('code =')) {
          const code = (q.values || []).find((v: any) => typeof v === 'string' && /^\d+\.\d+/.test(v))
          capturedLines.push({ code, debit: 0, credit: 0 })
          return Promise.resolve({ rows: [{ id: `acc-${code}` }] })
        }
        if (text.includes('INSERT INTO journal_entry_lines')) {
          const vals = q.values || []
          // Match this line insert to the corresponding capturedLines entry
          // by accountId (vals[1]). Falls back to last-with-zero if needed.
          const accountId = vals[1]
          const target = capturedLines.find(l => `acc-${l.code}` === accountId && l.debit === 0 && l.credit === 0)
            || capturedLines[capturedLines.length - 1]
          if (target) {
            target.debit = Number(vals[2] || 0)
            target.credit = Number(vals[3] || 0)
          }
          return Promise.resolve({ rows: [{ id: 'line' }] })
        }
        return Promise.resolve({ rows: [] })
      })

      await entriesService.createEntryForChequeTransition({
        id: 'cq-1',
        company_id: 'company-1',
        amount: 2000,
        old_status: 'entregado',
        new_status: 'cobrado',
        direction: 'emitido',
      })

      const emit = capturedLines.find(l => l.code === ACCOUNTS.CHEQUES_EMITIDOS)
      const caja = capturedLines.find(l => l.code === ACCOUNTS.CAJA)
      expect(emit?.debit).toBeCloseTo(2000, 2)
      expect(caja?.credit).toBeCloseTo(2000, 2)

      const totalDebit = capturedLines.reduce((s, l) => s + l.debit, 0)
      const totalCredit = capturedLines.reduce((s, l) => s + l.credit, 0)
      expect(Math.abs(totalDebit - totalCredit)).toBeLessThan(0.01)
    })

    it('emitido -> entregado is a no-op (pago already posted the entry)', async () => {
      mockAccountingEnabled()
      let insertCount = 0
      mockDbExecute.mockImplementation((q: any) => {
        const text = sqlText(q)
        if (text.includes('INSERT INTO journal_entries')) {
          insertCount++
        }
        return Promise.resolve({ rows: [] })
      })

      await entriesService.createEntryForChequeTransition({
        id: 'cq-2',
        company_id: 'company-1',
        amount: 500,
        old_status: 'emitido',
        new_status: 'entregado',
        direction: 'emitido',
      })

      expect(insertCount).toBe(0)
    })

    it('emitido -> rechazado: D:Cheques Emitidos C:Proveedores', async () => {
      mockAccountingEnabled()
      const capturedLines: Array<{ code: string; debit: number; credit: number }> = []

      mockDbExecute.mockImplementation((q: any) => {
        const text = sqlText(q)
        if (text.includes('INSERT INTO journal_entries')) {
          return Promise.resolve({ rows: [{ id: 'entry-rej', entry_number: 6 }] })
        }
        if (text.includes('FROM chart_of_accounts') && text.includes('code =')) {
          const code = (q.values || []).find((v: any) => typeof v === 'string' && /^\d+\.\d+/.test(v))
          capturedLines.push({ code, debit: 0, credit: 0 })
          return Promise.resolve({ rows: [{ id: `acc-${code}` }] })
        }
        if (text.includes('INSERT INTO journal_entry_lines')) {
          const vals = q.values || []
          // Match this line insert to the corresponding capturedLines entry
          // by accountId (vals[1]). Falls back to last-with-zero if needed.
          const accountId = vals[1]
          const target = capturedLines.find(l => `acc-${l.code}` === accountId && l.debit === 0 && l.credit === 0)
            || capturedLines[capturedLines.length - 1]
          if (target) {
            target.debit = Number(vals[2] || 0)
            target.credit = Number(vals[3] || 0)
          }
          return Promise.resolve({ rows: [{ id: 'line' }] })
        }
        return Promise.resolve({ rows: [] })
      })

      await entriesService.createEntryForChequeTransition({
        id: 'cq-3',
        company_id: 'company-1',
        amount: 750,
        old_status: 'entregado',
        new_status: 'rechazado',
        direction: 'emitido',
      })

      const emit = capturedLines.find(l => l.code === ACCOUNTS.CHEQUES_EMITIDOS)
      const prov = capturedLines.find(l => l.code === ACCOUNTS.PROVEEDORES)
      expect(emit?.debit).toBeCloseTo(750, 2)
      expect(prov?.credit).toBeCloseTo(750, 2)
    })
  })

  // ── C7: createEntryForRetencion standalone ───────────────────────────────
  describe('C7 createEntryForRetencion - standalone helper', () => {
    it('practicada: D:Proveedores C:Ret a Depositar', async () => {
      mockAccountingEnabled()
      const capturedLines: Array<{ code: string; debit: number; credit: number }> = []

      mockDbExecute.mockImplementation((q: any) => {
        const text = sqlText(q)
        if (text.includes('INSERT INTO journal_entries')) {
          return Promise.resolve({ rows: [{ id: 'entry-ret', entry_number: 7 }] })
        }
        if (text.includes('FROM chart_of_accounts') && text.includes('code =')) {
          const code = (q.values || []).find((v: any) => typeof v === 'string' && /^\d+\.\d+/.test(v))
          capturedLines.push({ code, debit: 0, credit: 0 })
          return Promise.resolve({ rows: [{ id: `acc-${code}` }] })
        }
        if (text.includes('INSERT INTO journal_entry_lines')) {
          const vals = q.values || []
          // Match this line insert to the corresponding capturedLines entry
          // by accountId (vals[1]). Falls back to last-with-zero if needed.
          const accountId = vals[1]
          const target = capturedLines.find(l => `acc-${l.code}` === accountId && l.debit === 0 && l.credit === 0)
            || capturedLines[capturedLines.length - 1]
          if (target) {
            target.debit = Number(vals[2] || 0)
            target.credit = Number(vals[3] || 0)
          }
          return Promise.resolve({ rows: [{ id: 'line' }] })
        }
        return Promise.resolve({ rows: [] })
      })

      await entriesService.createEntryForRetencion({
        id: 'ret-1',
        company_id: 'company-1',
        date: '2026-01-05',
        type: 'ganancias',
        amount: 150,
        direction: 'practicada',
      })

      const prov = capturedLines.find(l => l.code === ACCOUNTS.PROVEEDORES)
      const liab = capturedLines.find(l => l.code === ACCOUNTS.RET_GANANCIAS_DEPOSITAR)
      expect(prov?.debit).toBeCloseTo(150, 2)
      expect(liab?.credit).toBeCloseTo(150, 2)
    })
  })
})
