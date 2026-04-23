/**
 * Wave 3B — leak-defense regression tests for the 4 CRITICAL + 4 HIGH +
 * 2 MEDIUM Sol/Luna holes found by the 3B audit.
 *
 * Coverage:
 *  - L2. invoices.getInvoiceDetail      -> Luna-as-Sol returns null (→ 404)
 *  - L3. accounting-entries.getEntries  -> COALESCE(je.circuit,'fiscal')='fiscal' gate
 *  - L4. accounting-entries.getBalance  -> same gate, applied in the LEFT JOIN
 *  - H5. cheques.getCheques             -> cobro-alias fiscal filter for non-Luna
 *  - H6. retenciones.getRetentions      -> cobro/pago-alias fiscal filter for non-Luna
 *  - M8. enterprises.getEnterprise      -> strips default_fiscal_type for non-Luna
 *
 * The SQL layer is mocked — every assertion checks that the fragment reaches
 * the DB. If the fragment is absent, Postgres will happily return Luna rows
 * to a Sol-only user, so text-based SQL assertions are the right level.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mockDbExecute, resetMocks } from './helpers/setup'

// Stub the activity audit so service calls don't blow up when they call log().
vi.mock('../src/modules/activity/activity.service', () => ({
  activityService: { log: vi.fn().mockResolvedValue(undefined) },
}))

import { AccountingEntriesService } from '../src/modules/accounting/accounting-entries.service'
import { ChequesService } from '../src/modules/cheques/cheques.service'
import { RetencionesService } from '../src/modules/retenciones/retenciones.service'
import { EnterprisesService } from '../src/modules/enterprises/enterprises.service'
import { InvoicesService } from '../src/modules/invoices/invoices.service'

function joinSqlStrings(call: any): string {
  const arg = call?.[0]
  if (!arg) return ''
  if (typeof arg === 'string') return arg
  if (typeof arg.raw === 'string') return arg.raw
  const strings = arg.strings || []
  const values = arg.values || []
  let out = Array.isArray(strings) ? strings.join(' ') : ''
  for (const v of values) {
    if (v && typeof v === 'object' && typeof v.raw === 'string') out += ' ' + v.raw
    else if (v && typeof v === 'object' && Array.isArray(v.strings)) {
      out += ' ' + v.strings.join(' ')
      for (const vv of v.values || []) {
        if (vv && typeof vv === 'object' && typeof vv.raw === 'string') out += ' ' + vv.raw
      }
    }
  }
  return out
}

function allCallsJoined(): string[] {
  return mockDbExecute.mock.calls.map(joinSqlStrings)
}

describe('Wave 3B — Sol/Luna leak defenses', () => {
  beforeEach(() => {
    resetMocks()
  })

  // ═════════════════════════════════════════════════════════════════════
  // L2. invoices.getInvoiceDetail Luna gate
  // ═════════════════════════════════════════════════════════════════════

  describe('L2. invoices.getInvoiceDetail', () => {
    it('returns null (→404) when a non-Luna user requests a Luna invoice', async () => {
      const service = new InvoicesService()
      // First query (invoice row) resolves with a Luna invoice.
      mockDbExecute.mockResolvedValueOnce({ rows: [{ fiscal_type: 'no_fiscal', total_amount: '100' }] })
      const out = await service.getInvoiceDetail('c', 'inv-1', false)
      expect(out).toBeNull()
      // Items/cobros sub-queries must NOT have been emitted — we short-circuit.
      expect(mockDbExecute).toHaveBeenCalledTimes(1)
    })

    it('returns the detail when a Luna user requests a Luna invoice', async () => {
      const service = new InvoicesService()
      mockDbExecute.mockResolvedValueOnce({ rows: [{ fiscal_type: 'no_fiscal', total_amount: '100' }] })
      mockDbExecute.mockResolvedValueOnce({ rows: [] }) // items
      mockDbExecute.mockResolvedValueOnce({ rows: [] }) // cobros
      const out = await service.getInvoiceDetail('c', 'inv-1', true)
      expect(out).not.toBeNull()
      expect(out?.total).toBe(100)
    })

    it('returns the detail when any user requests a Sol invoice', async () => {
      const service = new InvoicesService()
      mockDbExecute.mockResolvedValueOnce({ rows: [{ fiscal_type: 'fiscal', total_amount: '50' }] })
      mockDbExecute.mockResolvedValueOnce({ rows: [] })
      mockDbExecute.mockResolvedValueOnce({ rows: [] })
      const out = await service.getInvoiceDetail('c', 'inv-1', false)
      expect(out).not.toBeNull()
      expect(out?.total).toBe(50)
    })

    it('defaults to userCanAccessLuna=true when no arg is provided (back-compat)', async () => {
      const service = new InvoicesService()
      mockDbExecute.mockResolvedValueOnce({ rows: [{ fiscal_type: 'no_fiscal', total_amount: '1' }] })
      mockDbExecute.mockResolvedValueOnce({ rows: [] })
      mockDbExecute.mockResolvedValueOnce({ rows: [] })
      const out = await service.getInvoiceDetail('c', 'inv-1')
      expect(out).not.toBeNull()
    })
  })

  // ═════════════════════════════════════════════════════════════════════
  // L3. accounting-entries.getEntries circuit gate
  // Note: getEntries uses sql.join(...) which isn't exposed by the test mock.
  // We therefore verify the gate indirectly: we spy on the `conditions` array
  // by intercepting the raw SQL fragments emitted — the gate is an extra
  // `sql` fragment pushed to `conditions` when !canAccessLuna.
  // ═════════════════════════════════════════════════════════════════════

  describe('L3. accounting-entries.getEntries', () => {
    // The mock sql template doesn't support sql.join, so we can't run the full
    // getEntries without erroring. Instead, we assert the gate text ships via
    // direct source inspection on the built condition list.
    it('non-Luna user -> SQL carries the fiscal-only circuit filter', async () => {
      const svc = new AccountingEntriesService()
      // Call — even if it throws on sql.join, we only care about the conditions
      // that got pushed BEFORE the join call. We mock sql.join synchronously
      // by patching it onto the sql fn on this test run.
      const drizzle = await import('drizzle-orm')
      ;(drizzle.sql as any).join = (parts: any[], _sep: any) => ({ parts, __join: true })
      mockDbExecute.mockResolvedValueOnce({ rows: [{ total: 0 }] })
      mockDbExecute.mockResolvedValueOnce({ rows: [] })
      await svc.getEntries('c', {}, false)
      const joined = mockDbExecute.mock.calls
        .map(c => JSON.stringify(c[0]))
        .join(' ')
      expect(joined).toMatch(/COALESCE\(je\.circuit, 'fiscal'\) = 'fiscal'/)
    })

    it('Luna user -> no circuit filter (all entries visible)', async () => {
      const svc = new AccountingEntriesService()
      const drizzle = await import('drizzle-orm')
      ;(drizzle.sql as any).join = (parts: any[], _sep: any) => ({ parts, __join: true })
      mockDbExecute.mockResolvedValueOnce({ rows: [{ total: 0 }] })
      mockDbExecute.mockResolvedValueOnce({ rows: [] })
      await svc.getEntries('c', {}, true)
      const joined = mockDbExecute.mock.calls
        .map(c => JSON.stringify(c[0]))
        .join(' ')
      expect(joined).not.toMatch(/COALESCE\(je\.circuit, 'fiscal'\) = 'fiscal'/)
    })

    it('default (no flag) -> treated as non-Luna (gate applied)', async () => {
      const svc = new AccountingEntriesService()
      const drizzle = await import('drizzle-orm')
      ;(drizzle.sql as any).join = (parts: any[], _sep: any) => ({ parts, __join: true })
      mockDbExecute.mockResolvedValueOnce({ rows: [{ total: 0 }] })
      mockDbExecute.mockResolvedValueOnce({ rows: [] })
      await svc.getEntries('c', {})
      const joined = mockDbExecute.mock.calls
        .map(c => JSON.stringify(c[0]))
        .join(' ')
      expect(joined).toMatch(/COALESCE\(je\.circuit, 'fiscal'\) = 'fiscal'/)
    })
  })

  // ═════════════════════════════════════════════════════════════════════
  // L4. accounting-entries.getBalance circuit gate
  // ═════════════════════════════════════════════════════════════════════

  describe('L4. accounting-entries.getBalance', () => {
    it('non-Luna user -> JOIN carries the fiscal-only circuit filter', async () => {
      const svc = new AccountingEntriesService()
      mockDbExecute.mockResolvedValueOnce({ rows: [] })
      await svc.getBalance('c', {}, false)
      const joined = allCallsJoined().join(' ')
      expect(joined).toMatch(/COALESCE\(je\.circuit, 'fiscal'\) = 'fiscal'/)
    })

    it('Luna user -> no circuit filter', async () => {
      const svc = new AccountingEntriesService()
      mockDbExecute.mockResolvedValueOnce({ rows: [] })
      await svc.getBalance('c', {}, true)
      const joined = allCallsJoined().join(' ')
      expect(joined).not.toMatch(/COALESCE\(je\.circuit, 'fiscal'\) = 'fiscal'/)
    })

    it('default (no flag) -> treated as non-Luna (gate applied)', async () => {
      const svc = new AccountingEntriesService()
      mockDbExecute.mockResolvedValueOnce({ rows: [] })
      await svc.getBalance('c', {})
      const joined = allCallsJoined().join(' ')
      expect(joined).toMatch(/COALESCE\(je\.circuit, 'fiscal'\) = 'fiscal'/)
    })
  })

  // ═════════════════════════════════════════════════════════════════════
  // H5. cheques.getCheques circuit gate via cobro alias
  // ═════════════════════════════════════════════════════════════════════

  describe('H5. cheques.getCheques', () => {
    it('non-Luna user -> emitido OR fiscal-cobro gate is applied', async () => {
      const svc = new ChequesService()
      mockDbExecute.mockResolvedValueOnce({ rows: [] })
      await svc.getCheques('c', { canAccessLuna: false })
      const joined = allCallsJoined().join(' ')
      expect(joined).toMatch(/c\.direction = 'emitido'/)
      expect(joined).toMatch(/COALESCE\(co\.fiscal_type, 'fiscal'\) = 'fiscal'/)
    })

    it('Luna user -> no cheque-side fiscal gate applied', async () => {
      const svc = new ChequesService()
      mockDbExecute.mockResolvedValueOnce({ rows: [] })
      await svc.getCheques('c', { canAccessLuna: true })
      const joined = allCallsJoined().join(' ')
      // The emitido-or-fiscal disjunction MUST NOT be present for Luna users.
      expect(joined).not.toMatch(/c\.direction = 'emitido' OR COALESCE\(co\.fiscal_type/)
    })
  })

  // ═════════════════════════════════════════════════════════════════════
  // H6. retenciones.getRetentions cobro/pago-alias circuit gate
  // ═════════════════════════════════════════════════════════════════════

  describe('H6. retenciones.getRetentions', () => {
    it('non-Luna user -> gate via cobro/pago fiscal_type alias', async () => {
      const svc = new RetencionesService()
      mockDbExecute.mockResolvedValueOnce({ rows: [] })
      await svc.getRetentions('c', { canAccessLuna: false })
      const joined = allCallsJoined().join(' ')
      expect(joined).toMatch(/LEFT JOIN cobros co ON r\.cobro_id = co\.id/)
      expect(joined).toMatch(/LEFT JOIN pagos pa ON r\.pago_id = pa\.id/)
      expect(joined).toMatch(/COALESCE\(co\.fiscal_type, 'fiscal'\) = 'fiscal'/)
      expect(joined).toMatch(/COALESCE\(pa\.fiscal_type, 'fiscal'\) = 'fiscal'/)
    })

    it('Luna user -> no fiscal-side filter emitted', async () => {
      const svc = new RetencionesService()
      mockDbExecute.mockResolvedValueOnce({ rows: [] })
      await svc.getRetentions('c', { canAccessLuna: true })
      const joined = allCallsJoined().join(' ')
      expect(joined).not.toMatch(/COALESCE\(co\.fiscal_type, 'fiscal'\) = 'fiscal'/)
      expect(joined).not.toMatch(/COALESCE\(pa\.fiscal_type, 'fiscal'\) = 'fiscal'/)
    })
  })

  // ═════════════════════════════════════════════════════════════════════
  // M8. enterprises.getEnterprise strips default_fiscal_type for non-Luna
  // ═════════════════════════════════════════════════════════════════════

  describe('M8. enterprises.getEnterprise', () => {
    /**
     * EnterprisesService.ensureTables() fires many migrations that each end in
     * `.catch(() => {})`. Our mock returns `undefined` when no mock is queued,
     * which breaks the chain. We override mockImplementation per-test to
     * return a resolved thenable for every call, routing the enterprise
     * SELECT to the row we want and everything else to `{rows: []}`.
     */

    it('non-Luna user -> default_fiscal_type is stripped from the payload', async () => {
      const svc = new EnterprisesService()
      // We need: ensureTables -> many (empty ok), enterprise select -> 1 row,
      // contacts select -> 0 rows. The default implementation returns rows=[]
      // so we only need to inject the enterprise row AFTER the migrations
      // consume the default. Simplest trick: overwrite mock to match SQL text.
      mockDbExecute.mockImplementation((tpl: any) => {
        const s = tpl?.strings ? tpl.strings.join('') : ''
        if (/SELECT \* FROM enterprises WHERE id/.test(s)) {
          return Promise.resolve({ rows: [{ id: 'e1', name: 'X', default_fiscal_type: 'no_fiscal' }] })
        }
        return Promise.resolve({ rows: [] })
      })
      const out: any = await svc.getEnterprise('c', 'e1', false)
      expect(out.id).toBe('e1')
      expect(out).not.toHaveProperty('default_fiscal_type')
    })

    it('Luna user -> default_fiscal_type is preserved', async () => {
      const svc = new EnterprisesService()
      mockDbExecute.mockImplementation((tpl: any) => {
        const s = tpl?.strings ? tpl.strings.join('') : ''
        if (/SELECT \* FROM enterprises WHERE id/.test(s)) {
          return Promise.resolve({ rows: [{ id: 'e1', name: 'X', default_fiscal_type: 'no_fiscal' }] })
        }
        return Promise.resolve({ rows: [] })
      })
      const out: any = await svc.getEnterprise('c', 'e1', true)
      expect(out.default_fiscal_type).toBe('no_fiscal')
    })
  })
})
