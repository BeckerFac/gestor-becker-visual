import { describe, it, expect, beforeEach } from 'vitest'
import { mockDbExecute, resetMocks } from './helpers/setup'

import {
  BusinessService,
  resolveFiscalTypes,
  buildFiscalClause,
} from '../src/modules/reports/business.service'
import { ReportsService } from '../src/modules/reports/reports.service'

/**
 * CAT-8 — Sol/Luna dual-circuit filter for business reports + dashboard KPIs.
 *
 * Rules under test:
 *  - Default (no opts)                                -> ['fiscal']  (Sol only)
 *  - Luna user + ['fiscal']                           -> Sol only
 *  - Luna user + ['no_fiscal']                        -> Luna only
 *  - Luna user + ['fiscal','no_fiscal']               -> both
 *  - Non-Luna user + anything other than ['fiscal']   -> silently downgraded to Sol
 *  - Empty fiscal_types array                         -> default to ['fiscal']
 *  - Invalid tokens                                   -> silently dropped
 *  - NC exclusion MUST still apply per circuit
 *
 * The SQL layer is mocked, so we assert the injected COALESCE(...) = ANY(ARRAY[...])
 * fragment appears (or not) in the emitted SQL. That is the single source of
 * truth: if the fragment reaches the DB, Postgres will filter. If it doesn't,
 * the report leaks Luna data to Sol, or vice-versa.
 */

function joinSqlStrings(call: any): string {
  // The test harness sql tag mock returns { strings, values, raw? }.
  const arg = call?.[0]
  if (!arg) return ''
  if (typeof arg === 'string') return arg
  if (typeof arg.raw === 'string') return arg.raw
  const strings = arg.strings || []
  const values = arg.values || []
  let out = Array.isArray(strings) ? strings.join(' ') : ''
  // Also append interpolated values so raw() fragments appear in the text we inspect.
  for (const v of values) {
    if (v && typeof v === 'object' && typeof v.raw === 'string') out += ' ' + v.raw
  }
  return out
}

function allCallsJoined(): string[] {
  return mockDbExecute.mock.calls.map(joinSqlStrings)
}

function queueVentasMocks(n: number = 6) {
  // getVentasReport emits 6 queries, all can safely return empty rows.
  for (let i = 0; i < n; i++) mockDbExecute.mockResolvedValueOnce({ rows: [] })
}

function queueRentabilidadMocks() {
  // getRentabilidadReport emits 2 queries.
  mockDbExecute.mockResolvedValueOnce({ rows: [] })
  mockDbExecute.mockResolvedValueOnce({ rows: [{ revenue: '0', costo: '0' }] })
}

function queueClientesMocks() {
  // getClientesReport emits 6 queries.
  for (let i = 0; i < 6; i++) mockDbExecute.mockResolvedValueOnce({ rows: [] })
}

function queueDashboardMocks() {
  // getDashboard with full permissions emits up to ~7 queries; we queue 10 to be safe.
  for (let i = 0; i < 10; i++) mockDbExecute.mockResolvedValueOnce({ rows: [] })
}

const SOL_FRAGMENT = /ARRAY\['fiscal'\]::text\[\]/
const LUNA_FRAGMENT = /ARRAY\['no_fiscal'\]::text\[\]/
const BOTH_FRAGMENT = /ARRAY\['fiscal','no_fiscal'\]::text\[\]/

describe('CAT-8 Sol/Luna — business reports + dashboard', () => {
  let business: BusinessService
  let reports: ReportsService

  beforeEach(() => {
    resetMocks()
    business = new BusinessService()
    reports = new ReportsService()
  })

  describe('resolveFiscalTypes (pure logic)', () => {
    it('defaults to [fiscal] when opts is undefined', () => {
      expect(resolveFiscalTypes(undefined)).toEqual(['fiscal'])
    })

    it('defaults to [fiscal] when fiscal_types is an empty array', () => {
      expect(resolveFiscalTypes({ fiscal_types: [], userCanAccessLuna: true })).toEqual(['fiscal'])
    })

    it('drops invalid tokens silently', () => {
      const out = resolveFiscalTypes({
        fiscal_types: ['fiscal', 'garbage' as any, 'no_fiscal'],
        userCanAccessLuna: true,
      })
      expect(out).toEqual(['fiscal', 'no_fiscal'])
    })

    it('silently downgrades non-Luna user asking for no_fiscal to [fiscal]', () => {
      expect(
        resolveFiscalTypes({ fiscal_types: ['no_fiscal'], userCanAccessLuna: false }),
      ).toEqual(['fiscal'])
    })

    it('silently downgrades non-Luna user asking for both to [fiscal]', () => {
      expect(
        resolveFiscalTypes({ fiscal_types: ['fiscal', 'no_fiscal'], userCanAccessLuna: false }),
      ).toEqual(['fiscal'])
    })

    it('Luna user + [no_fiscal] -> [no_fiscal]', () => {
      expect(
        resolveFiscalTypes({ fiscal_types: ['no_fiscal'], userCanAccessLuna: true }),
      ).toEqual(['no_fiscal'])
    })

    it('Luna user + [fiscal, no_fiscal] -> both', () => {
      expect(
        resolveFiscalTypes({ fiscal_types: ['fiscal', 'no_fiscal'], userCanAccessLuna: true }),
      ).toEqual(['fiscal', 'no_fiscal'])
    })
  })

  describe('buildFiscalClause', () => {
    it('emits a COALESCE(...) ANY(ARRAY[...]) SQL fragment for Sol', () => {
      const frag = buildFiscalClause(['fiscal'], 'i') as any
      expect(frag.raw).toMatch(/COALESCE\(i\.fiscal_type, 'fiscal'\)/)
      expect(frag.raw).toMatch(/ARRAY\['fiscal'\]::text\[\]/)
    })
    it('emits the correct array for both circuits', () => {
      const frag = buildFiscalClause(['fiscal', 'no_fiscal'], 'i') as any
      expect(frag.raw).toMatch(/ARRAY\['fiscal','no_fiscal'\]::text\[\]/)
    })
    it('supports empty alias for bare invoices tables', () => {
      const frag = buildFiscalClause(['no_fiscal'], '') as any
      expect(frag.raw).toMatch(/COALESCE\(fiscal_type, 'fiscal'\)/)
      expect(frag.raw).not.toMatch(/\.fiscal_type/)
    })
  })

  describe('getVentasReport', () => {
    it('default (no opts) -> only Sol fragment, NC exclusion still applied', async () => {
      queueVentasMocks()
      await business.getVentasReport('company-1', '2026-04-01', '2026-04-30')

      const calls = allCallsJoined()
      const invoiceQueries = calls.filter(s => /\binvoices\b/i.test(s))
      expect(invoiceQueries.length).toBeGreaterThan(0)
      for (const q of invoiceQueries) {
        expect(q).toMatch(SOL_FRAGMENT)
        expect(q).not.toMatch(LUNA_FRAGMENT)
        expect(q).toMatch(/invoice_type::text NOT LIKE 'NC%'/)
      }
    })

    it('fiscal_types=[fiscal] + Luna user -> only Sol fragment', async () => {
      queueVentasMocks()
      await business.getVentasReport('c', '2026-04-01', '2026-04-30', {
        fiscal_types: ['fiscal'],
        userCanAccessLuna: true,
      })
      const invoiceQueries = allCallsJoined().filter(s => /\binvoices\b/i.test(s))
      for (const q of invoiceQueries) {
        expect(q).toMatch(SOL_FRAGMENT)
        expect(q).not.toMatch(LUNA_FRAGMENT)
      }
    })

    it('fiscal_types=[no_fiscal] + Luna user -> only Luna fragment', async () => {
      queueVentasMocks()
      await business.getVentasReport('c', '2026-04-01', '2026-04-30', {
        fiscal_types: ['no_fiscal'],
        userCanAccessLuna: true,
      })
      const invoiceQueries = allCallsJoined().filter(s => /\binvoices\b/i.test(s))
      for (const q of invoiceQueries) {
        expect(q).toMatch(LUNA_FRAGMENT)
        expect(q).not.toMatch(/ARRAY\['fiscal'\]::text\[\]/)
      }
    })

    it('fiscal_types=[fiscal,no_fiscal] + Luna user -> both circuits', async () => {
      queueVentasMocks()
      await business.getVentasReport('c', '2026-04-01', '2026-04-30', {
        fiscal_types: ['fiscal', 'no_fiscal'],
        userCanAccessLuna: true,
      })
      const invoiceQueries = allCallsJoined().filter(s => /\binvoices\b/i.test(s))
      for (const q of invoiceQueries) {
        expect(q).toMatch(BOTH_FRAGMENT)
      }
    })

    it('non-Luna user + [no_fiscal] -> silently downgraded to Sol', async () => {
      queueVentasMocks()
      await business.getVentasReport('c', '2026-04-01', '2026-04-30', {
        fiscal_types: ['no_fiscal'],
        userCanAccessLuna: false,
      })
      const invoiceQueries = allCallsJoined().filter(s => /\binvoices\b/i.test(s))
      for (const q of invoiceQueries) {
        expect(q).toMatch(SOL_FRAGMENT)
        expect(q).not.toMatch(LUNA_FRAGMENT)
      }
    })

    it('empty fiscal_types array falls back to Sol default', async () => {
      queueVentasMocks()
      await business.getVentasReport('c', '2026-04-01', '2026-04-30', {
        fiscal_types: [],
        userCanAccessLuna: true,
      })
      const invoiceQueries = allCallsJoined().filter(s => /\binvoices\b/i.test(s))
      for (const q of invoiceQueries) expect(q).toMatch(SOL_FRAGMENT)
    })

    it('invalid tokens in fiscal_types are dropped (Luna user)', async () => {
      queueVentasMocks()
      await business.getVentasReport('c', '2026-04-01', '2026-04-30', {
        fiscal_types: ['garbage' as any, 'no_fiscal'],
        userCanAccessLuna: true,
      })
      const invoiceQueries = allCallsJoined().filter(s => /\binvoices\b/i.test(s))
      for (const q of invoiceQueries) expect(q).toMatch(LUNA_FRAGMENT)
    })
  })

  describe('getClientesReport', () => {
    it('respects fiscal_types filter (Luna only, Luna user)', async () => {
      queueClientesMocks()
      await business.getClientesReport('c', '2026-04-01', '2026-04-30', {
        fiscal_types: ['no_fiscal'],
        userCanAccessLuna: true,
      })
      const calls = allCallsJoined().filter(s => /\binvoices\b/i.test(s))
      expect(calls.length).toBeGreaterThan(0)
      for (const q of calls) expect(q).toMatch(LUNA_FRAGMENT)
    })
  })

  describe('getRentabilidadReport', () => {
    it('respects fiscal_types filter and still excludes NCs', async () => {
      queueRentabilidadMocks()
      await business.getRentabilidadReport('c', '2026-04-01', '2026-04-30', {
        fiscal_types: ['no_fiscal'],
        userCanAccessLuna: true,
      })
      const calls = allCallsJoined().filter(s => /JOIN invoices/.test(s))
      expect(calls.length).toBeGreaterThan(0)
      for (const q of calls) {
        expect(q).toMatch(LUNA_FRAGMENT)
        expect(q).toMatch(/i\.invoice_type::text NOT LIKE 'NC%'/)
      }
    })
  })

  describe('top_productos (productos mas vendidos, inside VentasReport)', () => {
    it('respects fiscal_types filter on the JOIN invoices clause', async () => {
      queueVentasMocks()
      await business.getVentasReport('c', '2026-04-01', '2026-04-30', {
        fiscal_types: ['fiscal', 'no_fiscal'],
        userCanAccessLuna: true,
      })
      const calls = allCallsJoined()
      const topProd = calls.find(s => /invoice_items/.test(s) && /JOIN invoices/.test(s))
      expect(topProd).toBeDefined()
      expect(topProd!).toMatch(BOTH_FRAGMENT)
    })
  })

  describe('Dashboard (reports.service.getDashboard) KPIs', () => {
    it('default -> only Sol fragment in invoices queries', async () => {
      queueDashboardMocks()
      await reports.getDashboard('c', '2026-04-01', '2026-04-30', undefined, undefined)

      const invoiceQueries = allCallsJoined().filter(s => /\binvoices\b/i.test(s))
      expect(invoiceQueries.length).toBeGreaterThan(0)
      for (const q of invoiceQueries) {
        expect(q).toMatch(SOL_FRAGMENT)
        expect(q).not.toMatch(LUNA_FRAGMENT)
      }
    })

    it('Luna user + all -> both fragments (Sol + Luna in one query)', async () => {
      queueDashboardMocks()
      await reports.getDashboard('c', '2026-04-01', '2026-04-30', undefined, {
        fiscal_types: ['fiscal', 'no_fiscal'],
        userCanAccessLuna: true,
      })
      const invoiceQueries = allCallsJoined().filter(s => /\binvoices\b/i.test(s))
      expect(invoiceQueries.length).toBeGreaterThan(0)
      for (const q of invoiceQueries) expect(q).toMatch(BOTH_FRAGMENT)
    })

    it('non-Luna user + [no_fiscal] -> silently downgraded (dashboard)', async () => {
      queueDashboardMocks()
      await reports.getDashboard('c', '2026-04-01', '2026-04-30', undefined, {
        fiscal_types: ['no_fiscal'],
        userCanAccessLuna: false,
      })
      const invoiceQueries = allCallsJoined().filter(s => /\binvoices\b/i.test(s))
      for (const q of invoiceQueries) {
        expect(q).toMatch(SOL_FRAGMENT)
        expect(q).not.toMatch(LUNA_FRAGMENT)
      }
    })
  })

  describe('Cross-contamination guard', () => {
    it('Sol report never emits a Luna-only fragment', async () => {
      queueVentasMocks()
      await business.getVentasReport('c', '2026-04-01', '2026-04-30', {
        fiscal_types: ['fiscal'],
        userCanAccessLuna: true,
      })
      const joined = allCallsJoined().join(' ')
      // Must contain Sol fragment, must NOT contain a Luna-only ARRAY literal.
      expect(joined).toMatch(SOL_FRAGMENT)
      expect(joined).not.toMatch(LUNA_FRAGMENT)
    })
  })
})
