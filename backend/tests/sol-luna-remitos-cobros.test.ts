/**
 * Sol/Luna dual-circuit — remitos & cobros service tests (CAT-5).
 *
 * Mocking strategy: we mock `db.execute`, `pool.connect`, and the
 * `ordersService` side-effects (lockOrder / unlockOrder) so we can assert
 * the lock/unlock contract without a real database.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mockDbExecute, mockPoolQuery, mockClientQuery, mockClientRelease, resetMocks } from './helpers/setup'

// Spy on orders service lock/unlock BEFORE importing the modules under test.
// We hoist the spies via vi.mock so the imported services see the mocks.
vi.mock('../src/modules/orders/orders.service', () => {
  return {
    ordersService: {
      lockOrder: vi.fn().mockResolvedValue(undefined),
      unlockOrder: vi.fn().mockResolvedValue(undefined),
    },
    OrdersService: class {},
  }
})

import { RemitosService } from '../src/modules/remitos/remitos.service'
import { CobrosService } from '../src/modules/cobros/cobros.service'
import { ordersService } from '../src/modules/orders/orders.service'

// Helper: produce a raw client.query mock that routes by SQL fragment.
function routeClientQuery(handlers: Array<[RegExp, (sql: string, params: any[]) => any]>) {
  mockClientQuery.mockImplementation((sqlText: string, params: any[] = []) => {
    for (const [pat, fn] of handlers) {
      if (pat.test(sqlText)) return Promise.resolve(fn(sqlText, params))
    }
    return Promise.resolve({ rows: [] })
  })
}

describe('Sol/Luna RemitosService (CAT-5)', () => {
  let svc: RemitosService

  beforeEach(() => {
    resetMocks()
    ;(ordersService.lockOrder as any).mockClear()
    ;(ordersService.unlockOrder as any).mockClear()
    svc = new RemitosService()
    // tables already "ensured" — force flag
    ;(svc as any).tablesEnsured = true
    // pool.query is used by: (a) ensureTables migrations (empty ok), and
    // (b) the IDOR enterprise/customer pre-checks. Route by SQL to satisfy both.
    mockPoolQuery.mockImplementation((text: string, _params: any[] = []) => {
      if (/FROM enterprises WHERE id/i.test(text)) return Promise.resolve({ rows: [{ id: 'ent-1' }] })
      if (/FROM customers WHERE id/i.test(text)) return Promise.resolve({ rows: [{ id: 'cust-1', enterprise_id: 'ent-1' }] })
      return Promise.resolve({ rows: [] })
    })
    // Default db.execute: empty rows.
    mockDbExecute.mockResolvedValue({ rows: [] })
  })

  // ────────────────────────────────────────────────────────────────
  // Helpers: wire client.query to emulate the createRemito happy path.
  // ────────────────────────────────────────────────────────────────

  function primeCreateRemitoClient(opts: {
    fiscalTypes: string[]          // distinct fiscal_types returned by derivation query
    orderItemIds?: string[]        // populated from payload
    orderIdForItem?: string
    enterpriseIdForItem?: string
  }) {
    const orderItemId = 'oi-1'
    routeClientQuery([
      [/^BEGIN/i, () => ({ rows: [] })],
      [/^COMMIT/i, () => ({ rows: [] })],
      [/^ROLLBACK/i, () => ({ rows: [] })],
      [/pg_advisory_xact_lock/i, () => ({ rows: [] })],
      [/COALESCE\(MAX\(remito_number\)/i, () => ({ rows: [{ next_number: '1' }] })],
      [/FROM enterprises WHERE id/i, () => ({ rows: [{ id: 'ent-1' }] })],
      [/FROM customers WHERE id/i, () => ({ rows: [{ id: 'cust-1', enterprise_id: 'ent-1' }] })],
      // order_items lock query
      [/FROM order_items oi JOIN orders o/i, () => ({
        rows: (opts.orderItemIds || []).map(id => ({
          id,
          quantity: '10',
          qty_delivered: '0',
          enterprise_id: opts.enterpriseIdForItem || 'ent-1',
          order_id: opts.orderIdForItem || 'ord-1',
          order_status: 'pendiente',
          fiscal_type: opts.fiscalTypes[0] || 'fiscal',
        })),
      })],
      // Derivation: SELECT DISTINCT fiscal_type FROM orders
      [/SELECT DISTINCT COALESCE\(fiscal_type/i, () => ({
        rows: opts.fiscalTypes.map(ft => ({ fiscal_type: ft })),
      })],
      // INSERT remito
      [/INSERT INTO remitos/i, () => ({ rows: [] })],
      // INSERT remito_items
      [/INSERT INTO remito_items/i, () => ({ rows: [] })],
      // UPDATE order_items qty_delivered
      [/UPDATE order_items SET qty_delivered/i, () => ({ rows: [] })],
      // SELECT product_id FROM order_items
      [/SELECT product_id FROM order_items/i, () => ({ rows: [{ product_id: null }] })],
      // products lookup — none
      [/FROM products WHERE/i, () => ({ rows: [] })],
      // remito_orders insert
      [/INSERT INTO remito_orders/i, () => ({ rows: [] })],
      // order status cascade
      [/FROM order_items oi\s+WHERE oi\.order_id/i, () => ({ rows: [{ pending_count: 1, total_count: 1 }] })],
      [/SELECT id, enterprise_id, status FROM orders/i, () => ({
        rows: [{ id: opts.orderIdForItem || 'ord-1', enterprise_id: 'ent-1', status: 'pendiente' }],
      })],
      [/UPDATE orders/i, () => ({ rows: [] })],
    ])
    void orderItemId
  }

  // ────────────────────────────────────────────────────────────────
  // createRemito
  // ────────────────────────────────────────────────────────────────

  describe('createRemito fiscal_type derivation', () => {
    const baseData = (extra: any = {}) => ({
      customer_id: 'cust-1',
      items: [{ product_name: 'Producto A', quantity: 1, order_item_id: 'oi-1' }],
      ...extra,
    })

    it('R1: derives fiscal_type="fiscal" from a Sol order', async () => {
      primeCreateRemitoClient({ fiscalTypes: ['fiscal'], orderItemIds: ['oi-1'] })
      const result = await svc.createRemito('company-1', 'user-1', baseData(), { userCanAccessLuna: false })
      expect(result.fiscal_type).toBe('fiscal')
      // Assert INSERT INTO remitos was called with 'fiscal' as the fiscal_type param.
      const insertCall = mockClientQuery.mock.calls.find((c: any[]) => /INSERT INTO remitos/i.test(c[0] || ''))
      expect(insertCall).toBeDefined()
      expect(insertCall?.[1]).toContain('fiscal')
    })

    it('R2: derives fiscal_type="no_fiscal" from a Luna order (Luna user)', async () => {
      primeCreateRemitoClient({ fiscalTypes: ['no_fiscal'], orderItemIds: ['oi-1'] })
      const result = await svc.createRemito('company-1', 'user-1', baseData(), { userCanAccessLuna: true })
      expect(result.fiscal_type).toBe('no_fiscal')
    })

    it('R3: rejects mixed-circuit orders with 400', async () => {
      primeCreateRemitoClient({ fiscalTypes: ['fiscal', 'no_fiscal'], orderItemIds: ['oi-1'] })
      await expect(
        svc.createRemito('company-1', 'user-1', baseData(), { userCanAccessLuna: true }),
      ).rejects.toMatchObject({ statusCode: 400 })
    })

    it('R4: standalone remito — non-Luna user sending fiscal_type=no_fiscal is rejected with 403', async () => {
      primeCreateRemitoClient({ fiscalTypes: [] })
      await expect(
        svc.createRemito(
          'company-1',
          'user-1',
          { customer_id: 'cust-1', items: [{ product_name: 'Manual', quantity: 1 }], fiscal_type: 'no_fiscal' },
          { userCanAccessLuna: false },
        ),
      ).rejects.toMatchObject({ statusCode: 403 })
    })

    it('R5: post-create, lockOrder is called once per linked order', async () => {
      primeCreateRemitoClient({ fiscalTypes: ['fiscal'], orderItemIds: ['oi-1'], orderIdForItem: 'ord-1' })
      await svc.createRemito('company-1', 'user-1', baseData(), { userCanAccessLuna: false })
      expect(ordersService.lockOrder).toHaveBeenCalledWith('ord-1', 'remito emitido', 'user-1')
    })

    it('R6: Luna order + non-Luna user → 403', async () => {
      primeCreateRemitoClient({ fiscalTypes: ['no_fiscal'], orderItemIds: ['oi-1'] })
      await expect(
        svc.createRemito('company-1', 'user-1', baseData(), { userCanAccessLuna: false }),
      ).rejects.toMatchObject({ statusCode: 403 })
    })
  })

  // ────────────────────────────────────────────────────────────────
  // anularRemito → unlockOrder
  // ────────────────────────────────────────────────────────────────

  describe('anularRemito', () => {
    it('R7: calls unlockOrder for every previously linked order', async () => {
      routeClientQuery([
        [/^BEGIN/i, () => ({ rows: [] })],
        [/^COMMIT/i, () => ({ rows: [] })],
        [/SELECT id, status FROM remitos WHERE id/i, () => ({ rows: [{ id: 'rem-1', status: 'pendiente' }] })],
        [/SELECT id, order_item_id, product_id, quantity FROM remito_items/i, () => ({ rows: [] })],
        [/UPDATE remitos SET status = 'anulado'/i, () => ({ rows: [] })],
        [/SELECT DISTINCT order_id FROM remito_orders/i, () => ({ rows: [{ order_id: 'ord-1' }, { order_id: 'ord-2' }] })],
        [/DELETE FROM remito_orders/i, () => ({ rows: [] })],
      ])
      await svc.anularRemito('company-1', 'rem-1', 'user-1')
      expect(ordersService.unlockOrder).toHaveBeenCalledWith('ord-1')
      expect(ordersService.unlockOrder).toHaveBeenCalledWith('ord-2')
    })
  })

  // ────────────────────────────────────────────────────────────────
  // getRemitos filter by fiscal_type
  // ────────────────────────────────────────────────────────────────

  describe('getRemitos circuit filter', () => {
    function flattenSql(node: any): string {
      if (node == null) return ''
      if (typeof node === 'string') return node
      if (typeof node === 'number' || typeof node === 'boolean') return String(node)
      if (Array.isArray(node)) return node.map(flattenSql).join(' ')
      if (node.strings && Array.isArray(node.strings)) {
        const parts: string[] = []
        for (let i = 0; i < node.strings.length; i++) {
          parts.push(node.strings[i])
          if (node.values && i < node.values.length) parts.push(flattenSql(node.values[i]))
        }
        return parts.join('')
      }
      return ''
    }
    function some(fragment: string): boolean {
      return mockDbExecute.mock.calls.some((c: any[]) => flattenSql(c[0]).includes(fragment))
    }

    it('R8: non-Luna user forces fiscal filter regardless of request', async () => {
      mockDbExecute.mockResolvedValue({ rows: [] })
      await svc.getRemitos('company-1', { fiscal_type: 'all', userCanAccessLuna: false })
      expect(some("r.fiscal_type = 'fiscal'")).toBe(true)
    })

    it('R9: Luna user filtering by no_fiscal narrows to Luna', async () => {
      mockDbExecute.mockResolvedValue({ rows: [] })
      await svc.getRemitos('company-1', { fiscal_type: 'no_fiscal', userCanAccessLuna: true })
      expect(some("r.fiscal_type = 'no_fiscal'")).toBe(true)
    })
  })

  // ────────────────────────────────────────────────────────────────
  // getRemito row-level guard
  // ────────────────────────────────────────────────────────────────

  describe('getRemito row-level circuit guard', () => {
    it('R10: non-Luna user fetching a Luna remito gets 404', async () => {
      mockDbExecute.mockImplementation((...args: any[]) => {
        const tpl = args[0]
        const s = tpl?.strings ? tpl.strings.join('') : ''
        if (s.includes('FROM remitos r')) {
          return Promise.resolve({ rows: [{ id: 'rem-1', fiscal_type: 'no_fiscal' }] })
        }
        return Promise.resolve({ rows: [] })
      })
      mockPoolQuery.mockResolvedValue({ rows: [] })
      await expect(
        svc.getRemito('company-1', 'rem-1', { userCanAccessLuna: false }),
      ).rejects.toMatchObject({ statusCode: 404 })
    })
  })
})

describe('Sol/Luna CobrosService (CAT-5)', () => {
  let svc: CobrosService

  beforeEach(() => {
    resetMocks()
    ;(ordersService.lockOrder as any).mockClear()
    ;(ordersService.unlockOrder as any).mockClear()
    svc = new CobrosService()
    ;(svc as any).tablesEnsured = true
    mockPoolQuery.mockResolvedValue({ rows: [] })
  })

  // Helper: drive db.execute for the createCobro happy path.
  // Takes a map of invoice fiscal_types that will be returned by the
  // cross-circuit check query.
  function primeCreateCobro(opts: {
    invoiceFiscalTypes?: Record<string, 'fiscal' | 'no_fiscal'>
    cobroFinalRow?: any
  }) {
    // Cross-circuit fiscal_type lookup now runs via pool.query because
    // drizzle's sql`` tag cannot coerce JS arrays to PG uuid[].
    mockPoolQuery.mockImplementation((sqlStr: any, _params?: any[]) => {
      if (typeof sqlStr === 'string' && sqlStr.includes('FROM invoices') && sqlStr.includes('fiscal_type')) {
        const ids = Object.keys(opts.invoiceFiscalTypes || {})
        return Promise.resolve({
          rows: ids.map(id => ({ id, fiscal_type: opts.invoiceFiscalTypes![id] })),
        })
      }
      return Promise.resolve({ rows: [] })
    })
    mockDbExecute.mockImplementation((...args: any[]) => {
      const tpl = args[0]
      const s = tpl?.strings ? tpl.strings.join('') : ''
      // Banks tenant check
      if (s.includes('FROM banks WHERE id')) return Promise.resolve({ rows: [{ id: 'bank-1' }] })
      if (s.includes('FROM business_units')) return Promise.resolve({ rows: [{ id: 'bu-1' }] })
      // Invoice pre-check (legacy direct binding)
      if (s.includes('FROM invoices WHERE id') && s.includes('payment_status')) {
        return Promise.resolve({ rows: [] })
      }
      // next receipt number
      if (s.includes('COALESCE(MAX(receipt_number)')) {
        return Promise.resolve({ rows: [{ next_number: '1' }] })
      }
      // Invoice FOR UPDATE check (per-invoice validation)
      if (s.includes('SELECT id, enterprise_id, business_unit_id, status, payment_status')) {
        return Promise.resolve({
          rows: [{
            id: 'inv-1',
            enterprise_id: null,
            business_unit_id: null,
            status: 'authorized',
            payment_status: 'pendiente',
            invoice_type: 'A',
            invoice_number: 1,
            total_amount: '1000',
            currency: 'ARS',
          }],
        })
      }
      // Invoice balance check
      if (s.includes('applied_cash') && s.includes('retenciones_total')) {
        return Promise.resolve({ rows: [{ total: '1000', applied_cash: '0', retenciones_total: '0' }] })
      }
      // SELECT ... FROM invoices ... UNION invoice_orders (lockOrder derivation)
      if (s.includes('FROM invoices WHERE id = ANY') || s.includes('FROM invoice_orders WHERE invoice_id = ANY')) {
        return Promise.resolve({ rows: [{ order_id: 'ord-1' }] })
      }
      // Final fetch row
      if (s.includes('FROM cobros c') && s.includes('LEFT JOIN enterprises e')) {
        return Promise.resolve({ rows: [opts.cobroFinalRow || { id: 'cob-1', fiscal_type: 'fiscal' }] })
      }
      // All other queries — BEGIN/COMMIT/INSERT/etc — succeed empty.
      return Promise.resolve({ rows: [] })
    })
  }

  const basePayload = (extra: any = {}) => ({
    enterprise_id: null,
    amount: 1000,
    payment_method: 'transferencia',
    bank_id: 'bank-1',
    payment_methods: [{ method: 'transferencia', amount: 1000, bank_id: 'bank-1' }],
    payment_date: '2026-04-14',
    invoice_items: [{ invoice_id: 'inv-1', amount: 1000 }],
    ...extra,
  })

  // ────────────────────────────────────────────────────────────────
  // createCobro — fiscal_type handling
  // ────────────────────────────────────────────────────────────────

  describe('createCobro fiscal_type', () => {
    it('C1: Luna cobro is persisted with fiscal_type="no_fiscal"', async () => {
      primeCreateCobro({
        invoiceFiscalTypes: { 'inv-1': 'no_fiscal' },
        cobroFinalRow: { id: 'cob-1', fiscal_type: 'no_fiscal' },
      })
      const out = await svc.createCobro(
        'company-1', 'user-1',
        basePayload({ fiscal_type: 'no_fiscal' }),
        { userCanAccessLuna: true },
      )
      expect(out?.fiscal_type).toBe('no_fiscal')
      // Check the INSERT used 'no_fiscal' at the end.
      const insertCall = mockDbExecute.mock.calls.find((c: any[]) =>
        (c[0]?.strings?.join('') || '').includes('INSERT INTO cobros')
      )
      expect(insertCall).toBeDefined()
      const insertedValues = insertCall?.[0]?.values || []
      expect(insertedValues).toContain('no_fiscal')
    })

    it('C2: Luna cobro applying a Sol invoice → 400', async () => {
      primeCreateCobro({ invoiceFiscalTypes: { 'inv-1': 'fiscal' } })
      await expect(
        svc.createCobro('company-1', 'user-1', basePayload({ fiscal_type: 'no_fiscal' }), { userCanAccessLuna: true }),
      ).rejects.toMatchObject({ statusCode: 400 })
    })

    it('C3: Sol cobro applying a Luna invoice → 400', async () => {
      primeCreateCobro({ invoiceFiscalTypes: { 'inv-1': 'no_fiscal' } })
      await expect(
        svc.createCobro('company-1', 'user-1', basePayload(), { userCanAccessLuna: true }),
      ).rejects.toMatchObject({ statusCode: 400 })
    })

    it('C4: Luna cobro carrying retenciones → 400', async () => {
      primeCreateCobro({ invoiceFiscalTypes: { 'inv-1': 'no_fiscal' } })
      await expect(
        svc.createCobro(
          'company-1', 'user-1',
          basePayload({
            fiscal_type: 'no_fiscal',
            retenciones_sufridas: [{ type: 'iibb', base_amount: 100, rate: 3, amount: 3, enabled: true }],
          }),
          { userCanAccessLuna: true },
        ),
      ).rejects.toMatchObject({ statusCode: 400 })
    })

    it('C5: non-Luna user requesting fiscal_type=no_fiscal → 403', async () => {
      primeCreateCobro({ invoiceFiscalTypes: { 'inv-1': 'no_fiscal' } })
      await expect(
        svc.createCobro('company-1', 'user-1', basePayload({ fiscal_type: 'no_fiscal' }), { userCanAccessLuna: false }),
      ).rejects.toMatchObject({ statusCode: 403 })
    })

    it('C6: Sol cobro with retenciones — existing path works (regression)', async () => {
      primeCreateCobro({
        invoiceFiscalTypes: { 'inv-1': 'fiscal' },
        cobroFinalRow: { id: 'cob-1', fiscal_type: 'fiscal' },
      })
      // Note: retenciones_sufridas require base_amount>0, amount<=base*1.1.
      const out = await svc.createCobro(
        'company-1', 'user-1',
        basePayload({
          retenciones_sufridas: [{ type: 'iibb', base_amount: 100, rate: 3, amount: 3, enabled: true }],
        }),
        { userCanAccessLuna: false },
      )
      // Shouldn't throw. Result may or may not include fiscal_type; assert the call succeeded.
      expect(out).toBeDefined()
    })

    it('C7: post-create, lockOrder is called for each derived order', async () => {
      primeCreateCobro({ invoiceFiscalTypes: { 'inv-1': 'fiscal' } })
      await svc.createCobro('company-1', 'user-1', basePayload(), { userCanAccessLuna: false })
      expect(ordersService.lockOrder).toHaveBeenCalledWith('ord-1', 'cobro aplicado', 'user-1')
    })

    it('C8: empty invoice_items in Luna — accepted (pending_invoice), no circuit error', async () => {
      primeCreateCobro({
        invoiceFiscalTypes: {},
        cobroFinalRow: { id: 'cob-1', fiscal_type: 'no_fiscal' },
      })
      await expect(
        svc.createCobro(
          'company-1', 'user-1',
          { ...basePayload({ fiscal_type: 'no_fiscal' }), invoice_items: [] },
          { userCanAccessLuna: true },
        ),
      ).resolves.toBeDefined()
    })

    it('C9: mixed-circuit invoice_items → 400', async () => {
      // Two invoices with mismatched fiscal types.
      primeCreateCobro({ invoiceFiscalTypes: { 'inv-1': 'fiscal', 'inv-2': 'no_fiscal' } })
      await expect(
        svc.createCobro(
          'company-1', 'user-1',
          basePayload({
            fiscal_type: 'fiscal',
            invoice_items: [
              { invoice_id: 'inv-1', amount: 500 },
              { invoice_id: 'inv-2', amount: 500 },
            ],
          }),
          { userCanAccessLuna: true },
        ),
      ).rejects.toMatchObject({ statusCode: 400 })
    })
  })

  // ────────────────────────────────────────────────────────────────
  // deleteCobro / anular → unlockOrder
  // ────────────────────────────────────────────────────────────────

  describe('deleteCobro (anular)', () => {
    it('C10: calls unlockOrder for each affected order', async () => {
      mockDbExecute.mockImplementation((...args: any[]) => {
        const tpl = args[0]
        const s = tpl?.strings ? tpl.strings.join('') : ''
        if (s.includes('SELECT id, order_id, company_id, status')) {
          return Promise.resolve({ rows: [{ id: 'cob-1', order_id: 'ord-1', company_id: 'company-1', status: 'activo' }] })
        }
        if (s.includes('SELECT invoice_id FROM cobro_invoice_applications')) {
          return Promise.resolve({ rows: [{ invoice_id: 'inv-1' }] })
        }
        if (s.includes('FROM invoices WHERE id = ANY') || s.includes('FROM invoice_orders WHERE invoice_id = ANY')) {
          return Promise.resolve({ rows: [{ order_id: 'ord-1' }] })
        }
        return Promise.resolve({ rows: [] })
      })
      await svc.deleteCobro('company-1', 'cob-1', 'user-1', 'fix')
      expect(ordersService.unlockOrder).toHaveBeenCalledWith('ord-1')
    })
  })

  // ────────────────────────────────────────────────────────────────
  // getCobros filter
  // ────────────────────────────────────────────────────────────────

  describe('getCobros circuit filter', () => {
    function flattenSql(node: any): string {
      if (node == null) return ''
      if (typeof node === 'string') return node
      if (Array.isArray(node)) return node.map(flattenSql).join(' ')
      if (node.strings && Array.isArray(node.strings)) {
        const parts: string[] = []
        for (let i = 0; i < node.strings.length; i++) {
          parts.push(node.strings[i])
          if (node.values && i < node.values.length) parts.push(flattenSql(node.values[i]))
        }
        return parts.join('')
      }
      return ''
    }
    function some(fragment: string): boolean {
      return mockDbExecute.mock.calls.some((c: any[]) => flattenSql(c[0]).includes(fragment))
    }

    it('C11: non-Luna user never sees Luna rows (fiscal forced)', async () => {
      mockDbExecute.mockResolvedValue({ rows: [] })
      await svc.getCobros('company-1', { fiscal_type: 'all', userCanAccessLuna: false })
      expect(some("c.fiscal_type = 'fiscal'")).toBe(true)
    })
  })

  // ────────────────────────────────────────────────────────────────
  // getCobroById row-level
  // ────────────────────────────────────────────────────────────────

  describe('getCobroById row-level guard', () => {
    it('C12: non-Luna user fetching Luna cobro → 404', async () => {
      mockDbExecute.mockResolvedValueOnce({ rows: [{ id: 'cob-1', fiscal_type: 'no_fiscal' }] })
      await expect(
        svc.getCobroById('company-1', 'cob-1', { userCanAccessLuna: false }),
      ).rejects.toMatchObject({ statusCode: 404 })
    })

    it('C13: Luna user fetching Luna cobro → success', async () => {
      mockDbExecute.mockResolvedValueOnce({ rows: [{ id: 'cob-1', fiscal_type: 'no_fiscal' }] })
      const out = await svc.getCobroById('company-1', 'cob-1', { userCanAccessLuna: true })
      expect(out.id).toBe('cob-1')
    })
  })
})
