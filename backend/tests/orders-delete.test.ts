import { describe, it, expect, beforeEach } from 'vitest'
import { mockDbExecute, resetMocks } from './helpers/setup'

import { OrdersService } from '../src/modules/orders/orders.service'

/**
 * Tests para deleteOrder — guardrails de integridad fiscal.
 *
 * Cubre:
 *  - 404 cuando el pedido no existe
 *  - 409 con remitos via N:N
 *  - 409 con factura autorizada via N:N invoice_orders
 *  - 409 con factura autorizada via legacy invoices.order_id
 *  - 409 con cobros aplicados
 *  - OK con solo facturas DRAFT (cascade-delete)
 *  - OK sin dependencias (hard-delete)
 *  - soft mode bloqueado por factura autorizada
 *  - soft mode OK sin dependencias
 */
describe('OrdersService.deleteOrder', () => {
  let service: OrdersService

  const companyId = 'company-1'
  const userId = 'user-1'
  const orderId = 'order-1'

  beforeEach(() => {
    resetMocks()
    service = new OrdersService()
  })

  type Counts = {
    remito?: number
    authorized?: number
    draft?: number
    cobros?: number
    invDetails?: any[]
  }

  /**
   * Configura mocks segun el SQL ejecutado por deleteOrder.
   * Por defecto: pedido existe, sin dependencias.
   */
  function setupCheckMocks(counts: Counts = {}) {
    const remito = counts.remito ?? 0
    const authorized = counts.authorized ?? 0
    const draft = counts.draft ?? 0
    const cobros = counts.cobros ?? 0
    const invDetails = counts.invDetails ?? []

    mockDbExecute.mockImplementation((...args: any[]) => {
      const tpl = args[0]
      const sqlStr = tpl?.strings ? tpl.strings.join('') : ''

      // 1. SELECT id FROM orders WHERE id ...
      if (sqlStr.includes('SELECT id FROM orders WHERE id')) {
        return Promise.resolve({ rows: [{ id: orderId }] })
      }
      // 2. Remitos check
      if (sqlStr.includes('FROM remitos r') && sqlStr.includes('remito_orders')) {
        return Promise.resolve({ rows: [{ cnt: remito }] })
      }
      // 3. Invoices CTE check
      if (sqlStr.includes('linked_invoices') && sqlStr.includes('authorized_count')) {
        return Promise.resolve({
          rows: [{ authorized_count: authorized, draft_count: draft, details: invDetails }],
        })
      }
      // 4. Cobros applied check
      if (sqlStr.includes('FROM cobro_invoice_applications cia') && sqlStr.includes('JOIN cobros c')) {
        return Promise.resolve({ rows: [{ cnt: cobros }] })
      }

      // Cascade DELETEs / UPDATEs / BEGIN / COMMIT / ROLLBACK / ALTER — no-op.
      return Promise.resolve({ rows: [] })
    })
  }

  it('404 cuando el pedido no existe', async () => {
    mockDbExecute.mockImplementation(() => Promise.resolve({ rows: [] }))
    await expect(service.deleteOrder(companyId, orderId, userId)).rejects.toMatchObject({
      statusCode: 404,
    })
  })

  it('409 cuando el pedido tiene remitos asociados (N:N)', async () => {
    setupCheckMocks({ remito: 2 })
    await expect(service.deleteOrder(companyId, orderId, userId)).rejects.toMatchObject({
      statusCode: 409,
      message: expect.stringContaining('remito'),
    })
  })

  it('409 cuando el pedido tiene factura autorizada via N:N invoice_orders', async () => {
    setupCheckMocks({
      authorized: 1,
      invDetails: [
        { id: 'inv-1', number: 'A-0001-00000001', type: 'A', status: 'authorized' },
      ],
    })
    await expect(service.deleteOrder(companyId, orderId, userId)).rejects.toMatchObject({
      statusCode: 409,
      message: expect.stringContaining('autorizada'),
      details: { authorized_invoices: expect.any(Array) },
    })
  })

  it('409 cuando el pedido tiene factura autorizada via legacy order_id (mismo CTE)', async () => {
    // Mismo CTE — solo cambia el path interno; el mock devuelve authorized > 0.
    setupCheckMocks({
      authorized: 1,
      invDetails: [
        { id: 'inv-2', number: 'B-0001-00000005', type: 'B', status: 'emitido' },
      ],
    })
    await expect(service.deleteOrder(companyId, orderId, userId)).rejects.toMatchObject({
      statusCode: 409,
      message: expect.stringMatching(/CAE|autorizada/i),
    })
  })

  it('409 cuando el pedido tiene cobros aplicados', async () => {
    setupCheckMocks({ cobros: 3 })
    await expect(service.deleteOrder(companyId, orderId, userId)).rejects.toMatchObject({
      statusCode: 409,
      message: expect.stringContaining('cobro'),
    })
  })

  it('OK cuando solo hay facturas DRAFT — cascade-delete', async () => {
    setupCheckMocks({ draft: 2 })
    const result = await service.deleteOrder(companyId, orderId, userId)
    expect(result).toMatchObject({ id: orderId, deleted: true, mode: 'hard' })
  })

  it('OK sin dependencias — hard-delete', async () => {
    setupCheckMocks({})
    const result = await service.deleteOrder(companyId, orderId, userId)
    expect(result).toMatchObject({ id: orderId, deleted: true, mode: 'hard' })
  })

  it('soft mode: bloqueado por factura autorizada (mismas reglas que hard)', async () => {
    setupCheckMocks({ authorized: 1, invDetails: [{ id: 'inv-3', status: 'authorized' }] })
    await expect(
      service.deleteOrder(companyId, orderId, userId, { mode: 'soft', reason: 'duplicado' })
    ).rejects.toMatchObject({ statusCode: 409 })
  })

  it('soft mode: OK sin dependencias — marca cancelado', async () => {
    setupCheckMocks({})
    const result = await service.deleteOrder(companyId, orderId, userId, {
      mode: 'soft',
      reason: 'cliente cancelo',
    })
    expect(result).toMatchObject({ id: orderId, cancelled: true, mode: 'soft' })
  })
})
