import { describe, it, expect, beforeEach } from 'vitest'
import { mockDbExecute, resetMocks } from './helpers/setup'

// Import services AFTER mocks are installed (vitest hoisting in ./helpers/setup).
import { OrdersService } from '../src/modules/orders/orders.service'
import { InvoicesService } from '../src/modules/invoices/invoices.service'
import { CobrosService } from '../src/modules/cobros/cobros.service'

/**
 * Nor-feedback (item 1 / item 8): regression test for the prod bug where
 * a just-created order/invoice/cobro with business_unit_id=NULL was invisible
 * in the listing when the axios interceptor auto-injected a stale
 * `gestia_active_business_unit_id` from localStorage.
 *
 * The fix flips the WHERE filter from:
 *   AND X.business_unit_id = $id
 * to:
 *   AND (X.business_unit_id = $id OR X.business_unit_id IS NULL)
 *
 * so orphan rows remain visible while the backfill migration (which
 * re-assigns them to the company's default BU) catches up.
 *
 * We assert on the generated SQL template — the mocked db.execute captures
 * the raw tagged template, and setup.ts's drizzle-orm mock joins `strings`
 * into a plain string that we can regex-match.
 */
describe('Business unit NULL visibility (Nor item 1 + 8)', () => {
  // Helper: concat the tagged-template `strings` back into readable SQL.
  function sqlOf(call: any): string {
    const tpl = call?.[0]
    return tpl?.strings ? tpl.strings.join(' ') : ''
  }

  beforeEach(() => {
    resetMocks()
  })

  describe('OrdersService.getOrders', () => {
    it('includes rows with business_unit_id IS NULL when BU filter is applied', async () => {
      mockDbExecute.mockResolvedValue({ rows: [] })
      const service = new OrdersService()
      ;(service as any).migrationsRun = true

      await service.getOrders('company-1', { business_unit_id: 'bu-xyz' })

      // The whereClause is built by CHAINING `sql` template literals: each call
      // returns `{ strings, values }` and we embed it as a value in the next one.
      // So the generated filter fragment travels as a child value, not as a joined
      // string on the top-level SELECT. We look for it BOTH on the outer call and
      // on any nested `values[].strings` fragment.
      const allFragments = mockDbExecute.mock.calls.flatMap(c => collectAllStrings(c?.[0]))
      const buFragment = allFragments.find(s =>
        s.includes('o.business_unit_id') && s.toLowerCase().includes('is null')
      )
      expect(buFragment, 'expected BU filter fragment to include IS NULL').toBeDefined()
    })

    it('does not append a BU filter when none is provided', async () => {
      mockDbExecute.mockResolvedValue({ rows: [] })
      const service = new OrdersService()
      ;(service as any).migrationsRun = true

      await service.getOrders('company-1', {})

      const allFragments = mockDbExecute.mock.calls.flatMap(c => collectAllStrings(c?.[0]))
      const buFragment = allFragments.find(s => s.includes('o.business_unit_id'))
      expect(buFragment, 'no BU filter should be attached when filter is absent').toBeUndefined()
    })
  })

  describe('InvoicesService.getInvoices', () => {
    it('includes rows with business_unit_id IS NULL when BU filter is applied', async () => {
      mockDbExecute.mockResolvedValue({ rows: [] })
      const service = new InvoicesService()
      ;(service as any).migrationsRun = true

      await service.getInvoices('company-1', { business_unit_id: 'bu-xyz', userCanAccessLuna: true })

      const allFragments = mockDbExecute.mock.calls.flatMap(c => collectAllStrings(c?.[0]))
      const buFragment = allFragments.find(s =>
        s.includes('i.business_unit_id') && s.toLowerCase().includes('is null')
      )
      expect(buFragment, 'expected invoices BU filter fragment to include IS NULL').toBeDefined()
    })
  })

  describe('CobrosService.getCobros', () => {
    it('includes rows with business_unit_id IS NULL when BU filter is applied', async () => {
      mockDbExecute.mockResolvedValue({ rows: [] })
      const service = new CobrosService()
      ;(service as any).tablesEnsured = true

      await service.getCobros('company-1', { business_unit_id: 'bu-xyz' })

      const allFragments = mockDbExecute.mock.calls.flatMap(c => collectAllStrings(c?.[0]))
      const buFragment = allFragments.find(s =>
        s.includes('c.business_unit_id') && s.toLowerCase().includes('is null')
      )
      expect(buFragment, 'expected cobros BU filter fragment to include IS NULL').toBeDefined()
    })
  })
})

// Walks a mocked drizzle `sql` template object tree, collecting every
// `strings` array concatenated to a single string. The mock returns
// `{ strings, values }` and we recursively descend into any nested
// template-tag object embedded as a value.
function collectAllStrings(tpl: any, out: string[] = []): string[] {
  if (!tpl) return out
  if (tpl.strings && Array.isArray(tpl.strings)) {
    out.push(tpl.strings.join(' '))
  }
  if (tpl.values && Array.isArray(tpl.values)) {
    for (const v of tpl.values) {
      if (v && typeof v === 'object') collectAllStrings(v, out)
    }
  }
  return out
}
