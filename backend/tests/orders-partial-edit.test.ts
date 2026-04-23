import { describe, it, expect, beforeEach } from 'vitest'
import { mockDbExecute, mockPoolQuery, mockClientQuery, resetMocks } from './helpers/setup'
import { OrdersService } from '../src/modules/orders/orders.service'

// Partial-edit: when an order is locked (has invoices/remitos) the user can still
// edit header fields and unlocked items, but cannot mutate locked items or remove them.
// These tests cover the validation + UPSERT path in OrdersService.updateOrder.

describe('OrdersService.updateOrder — partial edit when locked', () => {
  let service: OrdersService
  const companyId = 'company-1'
  const orderId = 'order-1'
  const userId = 'user-1'

  beforeEach(() => {
    resetMocks()
    service = new OrdersService()
    // Migrations: no-op
    mockDbExecute.mockImplementation((tpl: any) => {
      const s = tpl?.strings ? tpl.strings.join('') : ''
      if (s.includes('SELECT id, locked_at FROM orders')) {
        return Promise.resolve({ rows: [{ id: orderId, locked_at: '2026-04-10T10:00:00Z' }] })
      }
      return Promise.resolve({ rows: [] })
    })
    // In-tx client queries default to success.
    mockClientQuery.mockResolvedValue({ rows: [] })
  })

  const setupLockQuery = (items: Array<any>) => {
    mockPoolQuery.mockImplementation((sqlStr: string, _params: any[]) => {
      if (sqlStr.includes('COALESCE(SUM(ii.quantity)')) {
        return Promise.resolve({ rows: items })
      }
      return Promise.resolve({ rows: [] })
    })
  }

  it('rejects when a locked item is removed from payload', async () => {
    setupLockQuery([
      { id: 'oi-1', product_id: 'p1', product_name: 'Banner', quantity: 10, unit_price: '100.00', vat_rate: '21.00', invoiced_qty: 5, shipped_qty: 0 },
      { id: 'oi-2', product_id: 'p2', product_name: 'Ploteo', quantity: 2, unit_price: '500.00', vat_rate: '21.00', invoiced_qty: 0, shipped_qty: 0 },
    ])

    await expect(service.updateOrder(companyId, orderId, {
      // oi-1 missing → attempt to delete a locked item
      items: [
        { order_item_id: 'oi-2', product_id: 'p2', product_name: 'Ploteo', quantity: 2, unit_price: 500, vat_rate: 21 },
      ],
    }, userId)).rejects.toThrow(/facturado o remitado/i)
  })

  it('rejects when a locked item changes unit_price', async () => {
    setupLockQuery([
      { id: 'oi-1', product_id: 'p1', product_name: 'Banner', quantity: 10, unit_price: '100.00', vat_rate: '21.00', invoiced_qty: 5, shipped_qty: 0 },
    ])

    await expect(service.updateOrder(companyId, orderId, {
      items: [
        { order_item_id: 'oi-1', product_id: 'p1', product_name: 'Banner', quantity: 10, unit_price: 999, vat_rate: 21 },
      ],
    }, userId)).rejects.toThrow(/precio/i)
  })

  it('rejects when a locked item changes vat_rate', async () => {
    setupLockQuery([
      { id: 'oi-1', product_id: 'p1', product_name: 'Banner', quantity: 10, unit_price: '100.00', vat_rate: '21.00', invoiced_qty: 5, shipped_qty: 0 },
    ])

    await expect(service.updateOrder(companyId, orderId, {
      items: [
        { order_item_id: 'oi-1', product_id: 'p1', product_name: 'Banner', quantity: 10, unit_price: 100, vat_rate: 10.5 },
      ],
    }, userId)).rejects.toThrow(/IVA/i)
  })

  it('rejects when a locked item lowers quantity below invoiced', async () => {
    setupLockQuery([
      { id: 'oi-1', product_id: 'p1', product_name: 'Banner', quantity: 10, unit_price: '100.00', vat_rate: '21.00', invoiced_qty: 5, shipped_qty: 0 },
    ])

    await expect(service.updateOrder(companyId, orderId, {
      items: [
        { order_item_id: 'oi-1', product_id: 'p1', product_name: 'Banner', quantity: 3, unit_price: 100, vat_rate: 21 },
      ],
    }, userId)).rejects.toThrow(/cantidad/i)
  })

  it('rejects when a locked item changes product_id', async () => {
    setupLockQuery([
      { id: 'oi-1', product_id: 'p1', product_name: 'Banner', quantity: 10, unit_price: '100.00', vat_rate: '21.00', invoiced_qty: 5, shipped_qty: 0 },
    ])

    await expect(service.updateOrder(companyId, orderId, {
      items: [
        { order_item_id: 'oi-1', product_id: 'p-other', product_name: 'Banner', quantity: 10, unit_price: 100, vat_rate: 21 },
      ],
    }, userId)).rejects.toThrow(/producto/i)
  })

  it('rejects when a shipped-only item is modified even without invoice', async () => {
    setupLockQuery([
      { id: 'oi-1', product_id: 'p1', product_name: 'Banner', quantity: 10, unit_price: '100.00', vat_rate: '21.00', invoiced_qty: 0, shipped_qty: 7 },
    ])

    await expect(service.updateOrder(companyId, orderId, {
      items: [
        { order_item_id: 'oi-1', product_id: 'p1', product_name: 'Banner', quantity: 10, unit_price: 150, vat_rate: 21 },
      ],
    }, userId)).rejects.toThrow(/precio/i)
  })

  it('accepts quantity increase on locked item (only lowering is blocked)', async () => {
    setupLockQuery([
      { id: 'oi-1', product_id: 'p1', product_name: 'Banner', quantity: 10, unit_price: '100.00', vat_rate: '21.00', invoiced_qty: 5, shipped_qty: 0 },
    ])

    await service.updateOrder(companyId, orderId, {
      items: [
        { order_item_id: 'oi-1', product_id: 'p1', product_name: 'Banner', quantity: 20, unit_price: 100, vat_rate: 21 },
      ],
    }, userId)

    // Should have gone through COMMIT (no throw).
    const calls = mockClientQuery.mock.calls.map((c: any) => c[0])
    expect(calls).toContain('COMMIT')
  })

  it('accepts description change on locked item (description is not financially sensitive)', async () => {
    setupLockQuery([
      { id: 'oi-1', product_id: 'p1', product_name: 'Banner', quantity: 10, unit_price: '100.00', vat_rate: '21.00', invoiced_qty: 5, shipped_qty: 0 },
    ])

    await service.updateOrder(companyId, orderId, {
      items: [
        { order_item_id: 'oi-1', product_id: 'p1', product_name: 'Banner', quantity: 10, unit_price: 100, vat_rate: 21, description: 'actualizada' },
      ],
    }, userId)

    const calls = mockClientQuery.mock.calls.map((c: any) => c[0])
    expect(calls).toContain('COMMIT')
  })

  it('accepts adding a new item alongside locked ones', async () => {
    setupLockQuery([
      { id: 'oi-1', product_id: 'p1', product_name: 'Banner', quantity: 10, unit_price: '100.00', vat_rate: '21.00', invoiced_qty: 5, shipped_qty: 0 },
    ])

    await service.updateOrder(companyId, orderId, {
      items: [
        { order_item_id: 'oi-1', product_id: 'p1', product_name: 'Banner', quantity: 10, unit_price: 100, vat_rate: 21 },
        { order_item_id: null, product_id: 'p2', product_name: 'Nuevo', quantity: 3, unit_price: 200, vat_rate: 21 },
      ],
    }, userId)

    const calls = mockClientQuery.mock.calls.map((c: any) => c[0])
    expect(calls).toContain('COMMIT')
    // At least one INSERT for the new item.
    expect(calls.some((c: string) => /INSERT INTO order_items/.test(c))).toBe(true)
    // At least one UPDATE for the kept locked item.
    expect(calls.some((c: string) => /UPDATE order_items SET/.test(c))).toBe(true)
  })

  it('accepts deleting an UNLOCKED item while keeping locked ones', async () => {
    setupLockQuery([
      { id: 'oi-1', product_id: 'p1', product_name: 'Banner', quantity: 10, unit_price: '100.00', vat_rate: '21.00', invoiced_qty: 5, shipped_qty: 0 },
      { id: 'oi-2', product_id: 'p2', product_name: 'Ploteo', quantity: 2, unit_price: '500.00', vat_rate: '21.00', invoiced_qty: 0, shipped_qty: 0 },
    ])

    await service.updateOrder(companyId, orderId, {
      // Drop oi-2 (not locked) and keep oi-1.
      items: [
        { order_item_id: 'oi-1', product_id: 'p1', product_name: 'Banner', quantity: 10, unit_price: 100, vat_rate: 21 },
      ],
    }, userId)

    const calls = mockClientQuery.mock.calls
    const deleteCall = calls.find((c: any) => /DELETE FROM order_items WHERE id/.test(c[0]))
    expect(deleteCall).toBeTruthy()
    expect(deleteCall[1]).toEqual(['oi-2'])
  })
})

describe('OrdersService.updateOrder — unlocked order keeps DELETE+INSERT behaviour', () => {
  let service: OrdersService
  const companyId = 'company-1'
  const orderId = 'order-1'

  beforeEach(() => {
    resetMocks()
    service = new OrdersService()
    mockDbExecute.mockImplementation((tpl: any) => {
      const s = tpl?.strings ? tpl.strings.join('') : ''
      if (s.includes('SELECT id, locked_at FROM orders')) {
        return Promise.resolve({ rows: [{ id: orderId, locked_at: null }] })
      }
      return Promise.resolve({ rows: [] })
    })
    mockClientQuery.mockResolvedValue({ rows: [] })
  })

  it('deletes all order_items and re-inserts (legacy path)', async () => {
    await service.updateOrder(companyId, orderId, {
      items: [
        { order_item_id: 'oi-existing', product_id: 'p1', product_name: 'X', quantity: 1, unit_price: 10, vat_rate: 21 },
      ],
    }, 'user-1')

    const calls = mockClientQuery.mock.calls.map((c: any) => c[0])
    expect(calls.some((c: string) => /DELETE FROM order_items WHERE order_id/.test(c))).toBe(true)
    expect(calls.some((c: string) => /INSERT INTO order_items/.test(c))).toBe(true)
  })
})
