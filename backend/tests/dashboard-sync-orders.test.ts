import { describe, it, expect, beforeEach } from 'vitest'
import { mockDbExecute, resetMocks } from './helpers/setup'

import { ReportsService } from '../src/modules/reports/reports.service'
import { OrdersService } from '../src/modules/orders/orders.service'

/**
 * Regression guard for the Dashboard <-> /pedidos sync bug.
 *
 * Symptom: Dashboard showed different counts and a different "Ultimos Pedidos"
 * list than /pedidos. Root cause was two-fold:
 *
 *  1) Dashboard's /reports/insights ("Atencion" panel) never applied the
 *     Sol/Luna fiscal filter, so its counts (draft_invoices, pending_orders,
 *     delivered_not_invoiced, cheques, aging) included rows the user never
 *     saw in the list pages.
 *
 *  2) Dashboard frontend default `dashboardCircuit` was 'fiscal' while
 *     /pedidos defaulted to 'all' for Luna users. Same DB, different slice
 *     -> different numbers on screen.
 *
 * This test pins the invariant at the SQL layer: for any given circuit opts,
 * the Dashboard + Insights queries MUST filter by the SAME fiscal_type
 * criterion that `OrdersService.getOrders` would apply for the same user. If
 * future code ever drops the clause from one side, these tests fail.
 *
 * The SQL layer is mocked (see tests/helpers/setup.ts). We inspect the
 * emitted SQL fragments as strings, which is the single source of truth for
 * "did the query tell Postgres to filter by circuit?".
 */

function flattenSql(arg: any): string {
  // Recursively flatten a drizzle-style sql template object so nested
  // `sql\`\${whereClause} AND ...\`` compositions render into a single string.
  // The mock in tests/helpers/setup.ts returns either a literal string, a
  // { raw } object (from sql.raw), or { strings, values } (from sql``).
  if (arg === null || arg === undefined) return ''
  if (typeof arg === 'string') return arg
  if (typeof arg === 'number' || typeof arg === 'boolean') return String(arg)
  if (typeof arg.raw === 'string') return arg.raw
  const strings = arg.strings || []
  const values = arg.values || []
  if (!Array.isArray(strings)) return ''
  let out = ''
  for (let i = 0; i < strings.length; i++) {
    out += strings[i]
    if (i < values.length) out += ' ' + flattenSql(values[i]) + ' '
  }
  return out
}

function joinSqlStrings(call: any): string {
  return flattenSql(call?.[0])
}

function allCallsJoined(): string[] {
  return mockDbExecute.mock.calls.map(joinSqlStrings)
}

function queueMocks(n: number) {
  for (let i = 0; i < n; i++) mockDbExecute.mockResolvedValueOnce({ rows: [] })
}

const SOL_FRAGMENT = /ARRAY\['fiscal'\]::text\[\]/
const LUNA_FRAGMENT = /ARRAY\['no_fiscal'\]::text\[\]/
const BOTH_FRAGMENT = /ARRAY\['fiscal','no_fiscal'\]::text\[\]/

describe('Dashboard <-> /pedidos sync', () => {
  let reports: ReportsService
  let orders: OrdersService

  beforeEach(() => {
    resetMocks()
    reports = new ReportsService()
    orders = new OrdersService()
    // OrdersService.getOrders runs ensureMigrations first + a probe for the
    // cobros table. Silence those with a generous mock queue.
    queueMocks(40)
  })

  describe('getInsights now respects the circuit filter', () => {
    it('default (no opts) -> pedidos/invoices insights filter by Sol only', async () => {
      await reports.getInsights('c', undefined, undefined)
      const calls = allCallsJoined()

      // pending_orders, draft_invoices, delivered_not_invoiced, aging and due-soon
      // all run; every query that touches orders or invoices MUST carry the
      // Sol fragment after the fix.
      const relevant = calls.filter(s => /FROM orders|FROM invoices/i.test(s))
      expect(relevant.length).toBeGreaterThan(0)
      for (const q of relevant) {
        expect(q).toMatch(SOL_FRAGMENT)
        expect(q).not.toMatch(LUNA_FRAGMENT)
      }
    })

    it('Luna user + [no_fiscal] -> insights filter to Luna only', async () => {
      await reports.getInsights('c', undefined, {
        fiscal_types: ['no_fiscal'],
        userCanAccessLuna: true,
      })
      const calls = allCallsJoined()
      const relevant = calls.filter(s => /FROM orders|FROM invoices/i.test(s))
      expect(relevant.length).toBeGreaterThan(0)
      for (const q of relevant) {
        expect(q).toMatch(LUNA_FRAGMENT)
        expect(q).not.toMatch(SOL_FRAGMENT)
      }
    })

    it('Luna user + all -> insights include both circuits', async () => {
      await reports.getInsights('c', undefined, {
        fiscal_types: ['fiscal', 'no_fiscal'],
        userCanAccessLuna: true,
      })
      const calls = allCallsJoined()
      const relevant = calls.filter(s => /FROM orders|FROM invoices/i.test(s))
      expect(relevant.length).toBeGreaterThan(0)
      for (const q of relevant) expect(q).toMatch(BOTH_FRAGMENT)
    })

    it('non-Luna user asking for [no_fiscal] is silently downgraded to Sol', async () => {
      await reports.getInsights('c', undefined, {
        fiscal_types: ['no_fiscal'],
        userCanAccessLuna: false,
      })
      const calls = allCallsJoined()
      const relevant = calls.filter(s => /FROM orders|FROM invoices/i.test(s))
      expect(relevant.length).toBeGreaterThan(0)
      for (const q of relevant) {
        expect(q).toMatch(SOL_FRAGMENT)
        expect(q).not.toMatch(LUNA_FRAGMENT)
      }
    })
  })

  describe('getAgingReport now respects the circuit filter', () => {
    it('default (no opts) -> aging invoices/orders filter by Sol only', async () => {
      await reports.getAgingReport('c', undefined)
      const calls = allCallsJoined()
      const relevant = calls.filter(s => /FROM invoices i|FROM orders o/i.test(s))
      expect(relevant.length).toBeGreaterThan(0)
      for (const q of relevant) {
        expect(q).toMatch(SOL_FRAGMENT)
      }
    })

    it('Luna user + [no_fiscal] -> aging filters to Luna only', async () => {
      await reports.getAgingReport('c', {
        fiscal_types: ['no_fiscal'],
        userCanAccessLuna: true,
      })
      const calls = allCallsJoined()
      const relevant = calls.filter(s => /FROM invoices i|FROM orders o/i.test(s))
      expect(relevant.length).toBeGreaterThan(0)
      for (const q of relevant) {
        expect(q).toMatch(LUNA_FRAGMENT)
      }
    })
  })

  describe('Dashboard SQL slice matches /pedidos SQL slice', () => {
    // The point of these tests is to pin BOTH endpoints to the same fiscal
    // criterion. If someone tightens one and forgets the other, the counts
    // on Dashboard diverge from what /pedidos shows -> the exact bug the
    // user reported.
    it('Luna user + all -> Dashboard recent_orders and getOrders list both see both circuits', async () => {
      // Dashboard side
      await reports.getDashboard('c', '2026-04-01', '2026-04-30', undefined, {
        fiscal_types: ['fiscal', 'no_fiscal'],
        userCanAccessLuna: true,
      })
      const dashCalls = allCallsJoined()
      const dashRecent = dashCalls.find(s => /FROM orders o/i.test(s) && /LIMIT/i.test(s))
      expect(dashRecent, 'recent_orders query must exist in dashboard').toBeDefined()
      expect(dashRecent!).toMatch(BOTH_FRAGMENT)

      // /pedidos side — reset and call getOrders with the equivalent filter.
      resetMocks()
      queueMocks(40)
      await orders.getOrders('c', {
        userCanAccessLuna: true,
        fiscal_type: 'all',
      })
      const pedidosCalls = allCallsJoined()
      const pedidosList = pedidosCalls.find(s => /FROM orders o/i.test(s) && /LIMIT/i.test(s))
      expect(pedidosList, 'main /pedidos list query must exist').toBeDefined()
      // /pedidos uses its own "no fiscal filter at all" for 'all' mode (because
      // the WHERE clause is built conditionally). This asserts both query
      // shapes include / exclude the fiscal clause consistently for 'all'.
      // In 'all' mode, /pedidos omits the clause entirely, while Dashboard
      // emits BOTH_FRAGMENT. Both mean "every circuit" — but we want to lock
      // the contract so neither side silently drops one circuit.
      expect(pedidosList!).not.toMatch(/fiscal_type = 'fiscal'/)
      expect(pedidosList!).not.toMatch(/fiscal_type = 'no_fiscal'/)
    })

    it('Luna user + no_fiscal -> Dashboard KPIs and /pedidos list filter to Luna only', async () => {
      // Dashboard
      await reports.getDashboard('c', '2026-04-01', '2026-04-30', undefined, {
        fiscal_types: ['no_fiscal'],
        userCanAccessLuna: true,
      })
      const dashCalls = allCallsJoined()
      const dashOrders = dashCalls.filter(s => /\bFROM orders\b/i.test(s))
      expect(dashOrders.length).toBeGreaterThan(0)
      for (const q of dashOrders) {
        expect(q).toMatch(LUNA_FRAGMENT)
        expect(q).not.toMatch(/ARRAY\['fiscal'\]::text\[\]/)
      }

      // /pedidos with matching filter
      resetMocks()
      queueMocks(40)
      await orders.getOrders('c', {
        userCanAccessLuna: true,
        fiscal_type: 'no_fiscal',
      })
      const pedidosCalls = allCallsJoined()
      const pedidosList = pedidosCalls.find(s => /FROM orders o/i.test(s))
      expect(pedidosList).toBeDefined()
      // /pedidos uses literal SQL: AND o.fiscal_type = 'no_fiscal'
      expect(pedidosList!).toMatch(/o\.fiscal_type = 'no_fiscal'/)
      expect(pedidosList!).not.toMatch(/o\.fiscal_type = 'fiscal'/)
    })

    it('Non-Luna user -> Dashboard + /pedidos both see Sol only (even if Luna was requested)', async () => {
      await reports.getDashboard('c', '2026-04-01', '2026-04-30', undefined, {
        fiscal_types: ['no_fiscal'],
        userCanAccessLuna: false,
      })
      const dashCalls = allCallsJoined()
      const dashOrders = dashCalls.filter(s => /\bFROM orders\b/i.test(s))
      expect(dashOrders.length).toBeGreaterThan(0)
      for (const q of dashOrders) {
        expect(q).toMatch(SOL_FRAGMENT)
        expect(q).not.toMatch(LUNA_FRAGMENT)
      }

      resetMocks()
      queueMocks(40)
      await orders.getOrders('c', {
        userCanAccessLuna: false,
        fiscal_type: 'no_fiscal', // requested Luna, should be ignored
      })
      const pedidosCalls = allCallsJoined()
      const pedidosList = pedidosCalls.find(s => /FROM orders o/i.test(s))
      expect(pedidosList).toBeDefined()
      // Non-Luna user forced to Sol: "(o.fiscal_type = 'fiscal' OR o.fiscal_type IS NULL)"
      expect(pedidosList!).toMatch(/o\.fiscal_type = 'fiscal'/)
      expect(pedidosList!).not.toMatch(/o\.fiscal_type = 'no_fiscal'/)
    })
  })
})
