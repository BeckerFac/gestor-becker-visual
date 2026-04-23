/**
 * Sol/Luna dual-circuit — orders service tests.
 *
 * Coverage:
 *  - createOrder: fiscal default, Luna gating, invalid value rejection.
 *  - updateOrder: lock check (423), fiscal_type immutability, payload filtering.
 *  - deleteOrder: lock check (423).
 *  - lockOrder / unlockOrder: idempotency, cascade-aware unlock.
 *  - getOrders: circuit filtering based on userCanAccessLuna.
 *  - getOrder: row-level 404 for Luna-as-Sol, 200 for Luna-as-Luna.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { mockDbExecute, mockClientQuery, resetMocks } from './helpers/setup'
import { OrdersService } from '../src/modules/orders/orders.service'

describe('Sol/Luna OrdersService', () => {
  let service: OrdersService

  beforeEach(() => {
    resetMocks()
    service = new OrdersService()
  })

  // ============================================================
  // Helpers
  // ============================================================

  /**
   * Build a mockDbExecute implementation covering the happy-path writes of
   * createOrder / updateOrder. We match on SQL fragments because the service
   * issues many sequential queries through the same execute function.
   */
  function mockCreateOrderHappyPath(orderRow: Record<string, any> = {}) {
    mockDbExecute.mockImplementation((...args: any[]) => {
      const tpl = args[0]
      const s = tpl?.strings ? tpl.strings.join('') : ''
      if (s.includes('FROM enterprises WHERE id')) return Promise.resolve({ rows: [{ id: 'ent-1' }] })
      if (s.includes('FROM customers WHERE id')) return Promise.resolve({ rows: [{ id: 'cust-1', enterprise_id: 'ent-1' }] })
      if (s.includes('FROM business_units WHERE id')) return Promise.resolve({ rows: [{ id: 'bu-1' }] })
      if (s.includes('SELECT id FROM business_units')) return Promise.resolve({ rows: [{ id: 'bu-1' }] })
      if (s.includes('COALESCE(MAX(order_number)')) return Promise.resolve({ rows: [{ next_number: '1' }] })
      return Promise.resolve({ rows: [orderRow] })
    })
    // Transaction queries go through pool.connect() -> client.query()
    mockClientQuery.mockResolvedValue({ rows: [] })
  }

  // ============================================================
  // createOrder
  // ============================================================

  describe('createOrder', () => {
    it('T1: defaults fiscal_type to "fiscal" when omitted', async () => {
      mockCreateOrderHappyPath()
      const result = await service.createOrder('company-1', 'user-1', {
        title: 'Pedido Sol',
        items: [{ product_name: 'item', quantity: 1, unit_price: 100, vat_rate: 21 }],
      })
      expect(result.fiscal_type).toBe('fiscal')
      // Transaction INSERT goes through pool.connect() -> client.query(text, params)
      const insertCall = mockClientQuery.mock.calls.find((c: any[]) =>
        typeof c[0] === 'string' && c[0].includes('INSERT INTO orders')
      )
      expect(insertCall).toBeDefined()
      const values = insertCall?.[1] || []
      expect(values).toContain('fiscal')
    })

    it('T2: Luna user can create a no_fiscal order', async () => {
      mockCreateOrderHappyPath()
      const result = await service.createOrder(
        'company-1',
        'user-1',
        {
          title: 'Pedido Luna',
          fiscal_type: 'no_fiscal',
          items: [{ product_name: 'item', quantity: 2, unit_price: 50 }],
        },
        { userCanAccessLuna: true }
      )
      expect(result.fiscal_type).toBe('no_fiscal')
      // Luna: total_amount equals subtotal (no IVA surcharge).
      expect(result.total_amount).toBe(100)
    })

    it('T3: non-Luna user is rejected with 403 when requesting no_fiscal', async () => {
      mockCreateOrderHappyPath()
      await expect(
        service.createOrder(
          'company-1',
          'user-1',
          { title: 'x', fiscal_type: 'no_fiscal', items: [{ product_name: 'a', quantity: 1, unit_price: 10 }] },
          { userCanAccessLuna: false }
        )
      ).rejects.toMatchObject({ statusCode: 403 })
    })

    it('T4: rejects invalid fiscal_type with 400', async () => {
      mockCreateOrderHappyPath()
      await expect(
        service.createOrder(
          'company-1',
          'user-1',
          { title: 'x', fiscal_type: 'pirata', items: [{ product_name: 'a', quantity: 1, unit_price: 10 }] },
          { userCanAccessLuna: true }
        )
      ).rejects.toMatchObject({ statusCode: 400 })
    })

    it('T15: new orders are inserted without a lock (columns untouched)', async () => {
      mockCreateOrderHappyPath()
      await service.createOrder('company-1', 'user-1', {
        title: 'Sin lock',
        items: [{ product_name: 'x', quantity: 1, unit_price: 10, vat_rate: 21 }],
      })
      // Transaction INSERT goes through pool.connect() -> client.query(text, params)
      const insertCall = mockClientQuery.mock.calls.find((c: any[]) =>
        typeof c[0] === 'string' && c[0].includes('INSERT INTO orders')
      )
      const sqlStr = insertCall?.[0] || ''
      // We never write locked_at on insert — DB default (NULL) is relied on.
      expect(sqlStr).not.toContain('locked_at')
    })

    it('Luna pricing: vat_rate forced to 0 on items', async () => {
      mockCreateOrderHappyPath()
      await service.createOrder(
        'company-1',
        'user-1',
        {
          title: 'Luna forced vat',
          fiscal_type: 'no_fiscal',
          items: [{ product_name: 'a', quantity: 1, unit_price: 100, vat_rate: 21 }],
        },
        { userCanAccessLuna: true }
      )
      // Transaction INSERT goes through pool.connect() -> client.query(text, params)
      const itemInsert = mockClientQuery.mock.calls.find((c: any[]) =>
        typeof c[0] === 'string' && c[0].includes('INSERT INTO order_items')
      )
      expect(itemInsert).toBeDefined()
      const values = itemInsert?.[1] || []
      // The vat_rate slot is the last parameter; it must be '0' for Luna.
      expect(values[values.length - 1]).toBe('0')
    })
  })

  // ============================================================
  // updateOrder
  // ============================================================

  describe('updateOrder', () => {
    it('T5: allows header-only update on locked order (partial edit)', async () => {
      // Updated 2026-04-23: the order-level 423 was relaxed so the user can still
      // edit header fields (notes, delivery, priority) and unlocked items even
      // after a comprobante was emitted. Locked ITEMS are still protected
      // (see orders-partial-edit.test.ts).
      mockDbExecute.mockImplementation((...args: any[]) => {
        const tpl = args[0]
        const s = tpl?.strings ? tpl.strings.join('') : ''
        if (s.includes('SELECT id, locked_at FROM orders')) {
          return Promise.resolve({ rows: [{ id: 'order-1', locked_at: '2026-04-01T00:00:00Z' }] })
        }
        return Promise.resolve({ rows: [] })
      })
      mockClientQuery.mockResolvedValue({ rows: [] })
      // Title-only update — no items in payload, so no per-item validation runs.
      const res = await service.updateOrder('company-1', 'order-1', { title: 'nuevo titulo' })
      expect(res).toEqual({ id: 'order-1', updated: true })
    })

    it('T7: silently drops fiscal_type from update payload', async () => {
      // Order exists, not locked.
      mockDbExecute.mockImplementation((...args: any[]) => {
        const tpl = args[0]
        const s = tpl?.strings ? tpl.strings.join('') : ''
        if (s.includes('SELECT id, locked_at FROM orders')) {
          return Promise.resolve({ rows: [{ id: 'order-1', locked_at: null }] })
        }
        return Promise.resolve({ rows: [] })
      })
      // Transaction queries go through pool.connect() -> client.query()
      mockClientQuery.mockResolvedValue({ rows: [] })
      const payload: any = { title: 'new', fiscal_type: 'no_fiscal' }
      await service.updateOrder('company-1', 'order-1', payload)
      // Service mutates the passed object as per spec ("silently drop").
      expect(payload.fiscal_type).toBeUndefined()
    })
  })

  // ============================================================
  // deleteOrder
  // ============================================================

  describe('deleteOrder', () => {
    it('T6: rejects delete on locked order with 423', async () => {
      mockDbExecute.mockImplementation((...args: any[]) => {
        const tpl = args[0]
        const s = tpl?.strings ? tpl.strings.join('') : ''
        if (s.includes('SELECT id, locked_at FROM orders')) {
          return Promise.resolve({ rows: [{ id: 'order-1', locked_at: '2026-04-01T00:00:00Z' }] })
        }
        return Promise.resolve({ rows: [] })
      })
      await expect(
        service.deleteOrder('company-1', 'order-1', 'user-1')
      ).rejects.toMatchObject({ statusCode: 423 })
    })
  })

  // ============================================================
  // lockOrder / unlockOrder
  // ============================================================

  describe('lockOrder', () => {
    it('T8: is idempotent — single UPDATE with WHERE locked_at IS NULL', async () => {
      mockDbExecute.mockResolvedValue({ rows: [] })
      await service.lockOrder('order-1', 'factura emitida', 'user-1')
      await service.lockOrder('order-1', 'factura emitida', 'user-1')
      const updateCalls = mockDbExecute.mock.calls.filter((c: any[]) =>
        c[0]?.strings?.join('').includes('UPDATE orders') &&
        c[0]?.strings?.join('').includes('locked_at = NOW()')
      )
      expect(updateCalls.length).toBe(2)
      // Each call must scope with "locked_at IS NULL" for idempotency at the SQL layer.
      for (const c of updateCalls) {
        expect(c[0].strings.join('')).toContain('locked_at IS NULL')
      }
    })
  })

  describe('unlockOrder', () => {
    it('T9: unlocks only when no active invoices/remitos/cobros remain', async () => {
      mockDbExecute.mockImplementation((...args: any[]) => {
        const tpl = args[0]
        const s = tpl?.strings ? tpl.strings.join('') : ''
        if (s.includes('SELECT company_id FROM orders')) return Promise.resolve({ rows: [{ company_id: 'company-1' }] })
        if (s.includes('FROM invoices i') && s.includes('COUNT')) return Promise.resolve({ rows: [{ cnt: 0 }] })
        if (s.includes('FROM remitos r') && s.includes('COUNT')) return Promise.resolve({ rows: [{ cnt: 0 }] })
        if (s.includes('FROM cobro_invoice_applications')) return Promise.resolve({ rows: [{ cnt: 0 }] })
        return Promise.resolve({ rows: [] })
      })
      await service.unlockOrder('order-1')
      const clearCall = mockDbExecute.mock.calls.find((c: any[]) =>
        c[0]?.strings?.join('').includes('locked_at = NULL')
      )
      expect(clearCall).toBeDefined()
    })

    it('T16: does NOT unlock when active invoices remain', async () => {
      mockDbExecute.mockImplementation((...args: any[]) => {
        const tpl = args[0]
        const s = tpl?.strings ? tpl.strings.join('') : ''
        if (s.includes('SELECT company_id FROM orders')) return Promise.resolve({ rows: [{ company_id: 'company-1' }] })
        if (s.includes('FROM invoices i') && s.includes('COUNT')) return Promise.resolve({ rows: [{ cnt: 1 }] })
        return Promise.resolve({ rows: [] })
      })
      await service.unlockOrder('order-1')
      const clearCall = mockDbExecute.mock.calls.find((c: any[]) =>
        c[0]?.strings?.join('').includes('locked_at = NULL')
      )
      expect(clearCall).toBeUndefined()
    })

    it('T17: does NOT unlock when active remitos remain', async () => {
      mockDbExecute.mockImplementation((...args: any[]) => {
        const tpl = args[0]
        const s = tpl?.strings ? tpl.strings.join('') : ''
        if (s.includes('SELECT company_id FROM orders')) return Promise.resolve({ rows: [{ company_id: 'company-1' }] })
        if (s.includes('FROM invoices i') && s.includes('COUNT')) return Promise.resolve({ rows: [{ cnt: 0 }] })
        if (s.includes('FROM remitos r') && s.includes('COUNT')) return Promise.resolve({ rows: [{ cnt: 2 }] })
        return Promise.resolve({ rows: [] })
      })
      await service.unlockOrder('order-1')
      const clearCall = mockDbExecute.mock.calls.find((c: any[]) =>
        c[0]?.strings?.join('').includes('locked_at = NULL')
      )
      expect(clearCall).toBeUndefined()
    })

    it('T18: does NOT unlock when active cobros remain', async () => {
      mockDbExecute.mockImplementation((...args: any[]) => {
        const tpl = args[0]
        const s = tpl?.strings ? tpl.strings.join('') : ''
        if (s.includes('SELECT company_id FROM orders')) return Promise.resolve({ rows: [{ company_id: 'company-1' }] })
        if (s.includes('FROM invoices i') && s.includes('COUNT')) return Promise.resolve({ rows: [{ cnt: 0 }] })
        if (s.includes('FROM remitos r') && s.includes('COUNT')) return Promise.resolve({ rows: [{ cnt: 0 }] })
        if (s.includes('FROM cobro_invoice_applications')) return Promise.resolve({ rows: [{ cnt: 3 }] })
        return Promise.resolve({ rows: [] })
      })
      await service.unlockOrder('order-1')
      const clearCall = mockDbExecute.mock.calls.find((c: any[]) =>
        c[0]?.strings?.join('').includes('locked_at = NULL')
      )
      expect(clearCall).toBeUndefined()
    })

    it('T19: returns silently when order does not exist', async () => {
      mockDbExecute.mockResolvedValueOnce({ rows: [] })
      await expect(service.unlockOrder('missing')).resolves.toBeUndefined()
    })
  })

  // ============================================================
  // getOrders circuit filtering
  // ============================================================

  describe('getOrders circuit filtering', () => {
    /**
     * Recursively flattens the nested drizzle sql`` template objects produced
     * by the helpers/setup.ts mock. The mock returns { strings, values } but
     * nested sql fragments (e.g. whereClause) live inside `values`, so a
     * simple strings.join('') misses literals buried in sub-fragments.
     */
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

    function someCallContains(fragment: string): boolean {
      return mockDbExecute.mock.calls.some((c: any[]) => flattenSql(c[0]).includes(fragment))
    }

    function primeMocks() {
      mockDbExecute.mockImplementation((...args: any[]) => {
        const tpl = args[0]
        const s = tpl?.strings ? tpl.strings.join('') : ''
        if (s.includes('SELECT 1 FROM cobros')) return Promise.resolve({ rows: [] })
        if (s.includes('FROM orders o')) return Promise.resolve({ rows: [] })
        if (s.includes('COUNT(*)') && s.includes('FILTER')) {
          return Promise.resolve({
            rows: [{
              total: '0', pendientes: '0', en_produccion: '0', terminados: '0',
              entregados: '0', total_facturado: '0', ganancia_total: '0',
            }],
          })
        }
        return Promise.resolve({ rows: [] })
      })
    }

    it('T10: non-Luna user: forces fiscal filter regardless of requested value', async () => {
      primeMocks()
      await service.getOrders('company-1', { fiscal_type: 'all', userCanAccessLuna: false })
      expect(someCallContains("o.fiscal_type = 'fiscal'")).toBe(true)
    })

    it('T11: Luna user with fiscal_type=fiscal returns only Sol', async () => {
      primeMocks()
      await service.getOrders('company-1', { fiscal_type: 'fiscal', userCanAccessLuna: true })
      expect(someCallContains("o.fiscal_type = 'fiscal'")).toBe(true)
    })

    it('T12: Luna user with fiscal_type=all has NO fiscal discriminator applied', async () => {
      primeMocks()
      await service.getOrders('company-1', { fiscal_type: 'all', userCanAccessLuna: true })
      expect(someCallContains("o.fiscal_type = 'fiscal'")).toBe(false)
      expect(someCallContains("o.fiscal_type = 'no_fiscal'")).toBe(false)
    })

    it('T20: Luna user filtering by no_fiscal narrows to Luna only', async () => {
      primeMocks()
      await service.getOrders('company-1', { fiscal_type: 'no_fiscal', userCanAccessLuna: true })
      expect(someCallContains("o.fiscal_type = 'no_fiscal'")).toBe(true)
    })
  })

  // ============================================================
  // getOrder row-level guard
  // ============================================================

  describe('getOrder row-level circuit guard', () => {
    function primeGetOrder(row: any) {
      mockDbExecute.mockImplementation((...args: any[]) => {
        const tpl = args[0]
        const s = tpl?.strings ? tpl.strings.join('') : ''
        if (s.includes('FROM orders o') && s.includes('LEFT JOIN')) {
          return Promise.resolve({ rows: [row] })
        }
        return Promise.resolve({ rows: [] })
      })
    }

    it('T13: non-Luna user fetching a Luna order gets 404', async () => {
      primeGetOrder({ id: 'order-1', fiscal_type: 'no_fiscal' })
      await expect(
        service.getOrder('company-1', 'order-1', { userCanAccessLuna: false })
      ).rejects.toMatchObject({ statusCode: 404 })
    })

    it('T14: Luna user fetching a Luna order succeeds', async () => {
      primeGetOrder({ id: 'order-1', fiscal_type: 'no_fiscal' })
      const result = await service.getOrder('company-1', 'order-1', { userCanAccessLuna: true })
      expect(result.id).toBe('order-1')
      expect(result.fiscal_type).toBe('no_fiscal')
    })

    it('(extra) Sol user fetching a Sol order succeeds', async () => {
      primeGetOrder({ id: 'order-1', fiscal_type: 'fiscal' })
      const result = await service.getOrder('company-1', 'order-1', { userCanAccessLuna: false })
      expect(result.id).toBe('order-1')
    })
  })
})
