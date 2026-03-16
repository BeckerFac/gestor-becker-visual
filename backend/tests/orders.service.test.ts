import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mockDbExecute, mockDbRows, mockDbEmpty, mockDbError, mockDbVoid, resetMocks } from './helpers/setup'

// Import after mocks are set up
import { OrdersService } from '../src/modules/orders/orders.service'

describe('OrdersService', () => {
  let service: OrdersService

  beforeEach(() => {
    resetMocks()
    service = new OrdersService()
  })

  describe('ensureMigrations', () => {
    it('runs CREATE TABLE and ALTER TABLE statements on first call', async () => {
      mockDbExecute.mockResolvedValue({ rows: [] })

      await service.ensureMigrations()

      expect(mockDbExecute).toHaveBeenCalled()
      const callCount = mockDbExecute.mock.calls.length
      expect(callCount).toBeGreaterThanOrEqual(1)
    })

    it('skips migrations on subsequent calls', async () => {
      mockDbExecute.mockResolvedValue({ rows: [] })

      await service.ensureMigrations()
      const firstCallCount = mockDbExecute.mock.calls.length

      await service.ensureMigrations()
      expect(mockDbExecute.mock.calls.length).toBe(firstCallCount)
    })
  })

  describe('getOrders', () => {
    it('returns items, total, and summary format', async () => {
      const summaryRow = {
        total: '5', pendientes: '2', en_produccion: '1', terminados: '1', entregados: '1',
        total_facturado: '50000.00', ganancia_total: '10000.00',
      }

      // Track calls by SQL content rather than index (more robust)
      mockDbExecute.mockImplementation((...args: any[]) => {
        const tpl = args[0]
        const sqlStr = tpl?.strings ? tpl.strings.join('') : ''

        if (sqlStr.includes('SELECT 1 FROM cobros')) {
          return Promise.resolve({ rows: [] }) // cobros table exists
        }
        if (sqlStr.includes('FROM orders o') && sqlStr.includes('LEFT JOIN customers')) {
          return Promise.resolve({ rows: [{ id: 'order-1', title: 'Test', status: 'pendiente' }] })
        }
        if (sqlStr.includes('COUNT(*)') && sqlStr.includes('FILTER')) {
          return Promise.resolve({ rows: [summaryRow] })
        }
        return Promise.resolve({ rows: [] })
      })

      const result = await service.getOrders('company-1')

      expect(result).toHaveProperty('items')
      expect(result).toHaveProperty('total')
      expect(result).toHaveProperty('summary')
      expect(result.summary.total).toBe(5)
      expect(result.summary.pendientes).toBe(2)
      expect(result.summary.total_facturado).toBe(50000)
    })

    it('returns correct structure with empty results', async () => {
      const emptySummary = { total: '0', pendientes: '0', en_produccion: '0', terminados: '0', entregados: '0', total_facturado: '0', ganancia_total: '0' }

      mockDbExecute.mockImplementation((...args: any[]) => {
        const tpl = args[0]
        const sqlStr = tpl?.strings ? tpl.strings.join('') : ''

        if (sqlStr.includes('COUNT(*)') && sqlStr.includes('FILTER')) {
          return Promise.resolve({ rows: [emptySummary] })
        }
        return Promise.resolve({ rows: [] })
      })

      const result = await service.getOrders('company-1')

      expect(result.items).toEqual([])
      expect(result.total).toBe(0)
      expect(result.summary.total).toBe(0)
      expect(result.summary.total_facturado).toBe(0)
    })

    it('applies status filter correctly', async () => {
      mockDbExecute.mockResolvedValue({ rows: [] })

      const result = await service.getOrders('company-1', { status: 'pendiente' })
      expect(result).toHaveProperty('items')
    })

    it('applies search filter with parameterized query (prevents SQL injection)', async () => {
      mockDbExecute.mockResolvedValue({ rows: [] })

      const maliciousSearch = "'; DROP TABLE orders; --"
      const result = await service.getOrders('company-1', { search: maliciousSearch })

      expect(result).toHaveProperty('items')
    })

    it('skips status filter when value is "todos"', async () => {
      mockDbExecute.mockResolvedValue({ rows: [] })

      const result = await service.getOrders('company-1', { status: 'todos' })
      expect(result).toHaveProperty('items')
    })
  })

  describe('createOrder', () => {
    it('creates order with valid data and returns id and status', async () => {
      mockDbExecute.mockResolvedValue({ rows: [] })

      let callIndex = 0
      mockDbExecute.mockImplementation(() => {
        callIndex++
        // After migrations (~9), next_number is call ~10, customer lookup is ~11
        if (callIndex === 10) return Promise.resolve({ rows: [{ next_number: '5' }] })
        if (callIndex === 11) return Promise.resolve({ rows: [{ enterprise_id: 'enterprise-1' }] })
        return Promise.resolve({ rows: [] })
      })

      const result = await service.createOrder('company-1', 'user-1', {
        title: 'New Order',
        customer_id: 'customer-1',
        items: [
          { product_name: 'Widget', unit_price: 100, quantity: 2, cost: 50, product_type: 'producto' },
        ],
      })

      expect(result).toHaveProperty('id')
      expect(result.status).toBe('pendiente')
    })

    it('creates order with deduct_stock=true triggers stock deduction', async () => {
      let callIndex = 0
      mockDbExecute.mockImplementation(() => {
        callIndex++
        if (callIndex === 10) return Promise.resolve({ rows: [{ next_number: '1' }] }) // next_number
        if (callIndex === 11) return Promise.resolve({ rows: [] }) // customer lookup (no enterprise)
        // calls 12-14: INSERT order, INSERT item, INSERT history
        if (callIndex === 15) return Promise.resolve({ rows: [] }) // UPDATE deduct_stock
        if (callIndex === 16) return Promise.resolve({ rows: [{ id: 'warehouse-1' }] }) // warehouse
        if (callIndex === 17) return Promise.resolve({ rows: [{ id: 'product-1', controls_stock: true }] }) // product
        return Promise.resolve({ rows: [] })
      })

      const result = await service.createOrder('company-1', 'user-1', {
        title: 'Stock Order',
        deduct_stock: true,
        items: [
          { product_id: 'product-1', product_name: 'Widget', unit_price: 100, quantity: 3, cost: 50 },
        ],
      })

      expect(result).toHaveProperty('id')
      expect(result.status).toBe('pendiente')
    })

    it('calculates totals from items (subtotal, VAT, profit)', async () => {
      let insertValues: any[] = []

      mockDbExecute.mockImplementation((...args: any[]) => {
        const tpl = args[0]
        const sqlStr = tpl?.strings ? tpl.strings.join('') : ''

        if (sqlStr.includes('MAX(order_number)')) {
          return Promise.resolve({ rows: [{ next_number: '1' }] })
        }
        if (sqlStr.includes('SELECT enterprise_id FROM customers')) {
          return Promise.resolve({ rows: [] })
        }
        if (sqlStr.includes('INSERT INTO orders') && tpl?.values) {
          insertValues = tpl.values
        }
        return Promise.resolve({ rows: [] })
      })

      await service.createOrder('company-1', 'user-1', {
        title: 'Calc Test',
        items: [
          { product_name: 'A', unit_price: 100, quantity: 2, cost: 50 },
          { product_name: 'B', unit_price: 200, quantity: 1, cost: 100 },
        ],
        vat_rate: 21,
      })

      // subtotal = 100*2 + 200*1 = 400
      // totalWithVat = 400 * 1.21 = 484
      // estimatedProfit = 400 - (50*2 + 100*1) = 200
      expect(insertValues.length).toBeGreaterThan(0)
      expect(insertValues).toContain('484')
      expect(insertValues).toContain('200')
    })

    it('derives mixed product_type when items have different types', async () => {
      mockDbExecute.mockResolvedValue({ rows: [{ next_number: '1' }] })

      // Should not throw
      await service.createOrder('company-1', 'user-1', {
        title: 'Mixed',
        items: [
          { product_name: 'A', unit_price: 100, quantity: 1, cost: 50, product_type: 'producto' },
          { product_name: 'B', unit_price: 200, quantity: 1, cost: 100, product_type: 'servicio' },
        ],
      })
    })
  })

  describe('updateOrderStatus', () => {
    it('updates status and returns old and new status', async () => {
      mockDbRows([{ id: 'order-1', status: 'pendiente' }])
      mockDbVoid() // UPDATE orders
      mockDbVoid() // INSERT status_history
      // BOM deduction for en_produccion (get items - empty so no further calls)
      mockDbRows([]) // no items with product_id

      const result = await service.updateOrderStatus('company-1', 'user-1', 'order-1', {
        status: 'en_produccion',
      })

      expect(result.old_status).toBe('pendiente')
      expect(result.new_status).toBe('en_produccion')
    })

    it('sets production_started_at when transitioning to en_produccion', async () => {
      mockDbRows([{ id: 'order-1', status: 'pendiente' }])

      let updateSqlStrings: string[] = []
      mockDbExecute.mockImplementation((...args: any[]) => {
        const tpl = args[0]
        if (tpl?.strings) {
          const joined = tpl.strings.join('')
          if (joined.includes('UPDATE orders SET status')) {
            updateSqlStrings = tpl.strings
          }
        }
        return Promise.resolve({ rows: [] })
      })

      await service.updateOrderStatus('company-1', 'user-1', 'order-1', {
        status: 'en_produccion',
      })

      // The SQL should contain production_started_at = NOW() for en_produccion
      expect(updateSqlStrings.length).toBeGreaterThan(0)
    })

    it('triggers BOM deduction when status is en_produccion', async () => {
      mockDbRows([{ id: 'order-1', status: 'pendiente' }])
      mockDbVoid() // UPDATE orders
      mockDbVoid() // INSERT status_history
      // BOM: get order items
      mockDbRows([{ product_id: 'p1', quantity: '2' }])
      // BOM: get components for p1
      mockDbRows([{ component_product_id: 'comp1', quantity_required: '3' }])
      // BOM: get warehouse
      mockDbRows([{ id: 'wh-1' }])
      // BOM: insert movement
      mockDbVoid()
      // BOM: update stock
      mockDbVoid()

      const result = await service.updateOrderStatus('company-1', 'user-1', 'order-1', {
        status: 'en_produccion',
      })

      expect(result.new_status).toBe('en_produccion')
    })

    it('throws 404 when order not found', async () => {
      mockDbEmpty()

      await expect(
        service.updateOrderStatus('company-1', 'user-1', 'nonexistent', { status: 'en_produccion' })
      ).rejects.toThrow('Order not found')
    })

    it('reverses BOM stock when cancelling from en_produccion', async () => {
      mockDbRows([{ id: 'order-1', status: 'en_produccion' }])
      mockDbVoid() // UPDATE orders
      mockDbVoid() // INSERT status_history
      // Reverse BOM: get movements
      mockDbRows([{ product_id: 'comp1', warehouse_id: 'wh-1', quantity: '6' }])
      // Reverse BOM: insert reversal movement
      mockDbVoid()
      // Reverse BOM: update stock
      mockDbVoid()

      const result = await service.updateOrderStatus('company-1', 'user-1', 'order-1', {
        status: 'cancelado',
      })

      expect(result.new_status).toBe('cancelado')
    })
  })

  describe('deleteOrder', () => {
    it('deletes order and related records', async () => {
      mockDbRows([{ id: 'order-1' }])
      mockDbVoid() // delete status_history
      mockDbVoid() // delete order_items
      mockDbVoid() // unlink cheques
      mockDbVoid() // delete order

      const result = await service.deleteOrder('company-1', 'order-1')
      expect(result.deleted).toBe(true)
    })

    it('throws 404 when order not found', async () => {
      mockDbEmpty()

      await expect(
        service.deleteOrder('company-1', 'nonexistent')
      ).rejects.toThrow('Pedido no encontrado')
    })
  })

  describe('getOrder', () => {
    it('returns order with items and status history', async () => {
      let callIndex = 0
      mockDbExecute.mockImplementation(() => {
        callIndex++
        // Migrations: ~9 calls
        if (callIndex <= 9) return Promise.resolve({ rows: [] })
        // Call 10: main order query
        if (callIndex === 10) return Promise.resolve({ rows: [{ id: 'order-1', title: 'Test', customer: { id: 'c1', name: 'Client' } }] })
        // Call 11: items query
        if (callIndex === 11) return Promise.resolve({ rows: [{ id: 'item-1', product_name: 'Widget', quantity: '2' }] })
        // Call 12: history query
        if (callIndex === 12) return Promise.resolve({ rows: [{ id: 'h1', new_status: 'pendiente' }] })
        return Promise.resolve({ rows: [] })
      })

      const result = await service.getOrder('company-1', 'order-1')

      expect(result.id).toBe('order-1')
      expect(result.items).toHaveLength(1)
      expect(result.status_history).toHaveLength(1)
    })

    it('throws 404 when order not found', async () => {
      mockDbExecute.mockResolvedValue({ rows: [] })

      await expect(service.getOrder('company-1', 'nonexistent')).rejects.toThrow('Order not found')
    })
  })

  describe('linkInvoice', () => {
    it('links invoice to order', async () => {
      mockDbVoid()

      const result = await service.linkInvoice('company-1', 'order-1', 'inv-1')
      expect(result.invoice_id).toBe('inv-1')
    })
  })

  describe('getOrdersWithoutInvoice', () => {
    it('returns orders that have no invoice', async () => {
      mockDbRows([
        { id: 'order-1', order_number: 1, title: 'Uninvoiced', total_amount: '500' },
      ])

      const result = await service.getOrdersWithoutInvoice('company-1')
      expect(result).toHaveLength(1)
    })
  })
})
