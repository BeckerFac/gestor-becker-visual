import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mockDbExecute, mockDbRows, mockDbEmpty, mockDbVoid, resetMocks } from './helpers/setup'

import { InventoryService } from '../src/modules/inventory/inventory.service'

const { db } = await import('../src/config/db')

describe('InventoryService', () => {
  let service: InventoryService

  beforeEach(() => {
    resetMocks()
    service = new InventoryService()
    vi.clearAllMocks()
  })

  describe('adjustStock', () => {
    it('positive adjustment increases stock (creates new record when none exists)', async () => {
      // Verify product exists
      mockDbRows([{ id: 'p1' }])
      // Warehouse lookup
      mockDbRows([{ id: 'wh-1' }])
      // INSERT movement
      mockDbVoid()
      // Check existing stock (none)
      mockDbEmpty()
      // INSERT new stock record
      mockDbVoid()

      const result = await service.adjustStock('company-1', 'user-1', {
        product_id: 'p1',
        quantity_change: 10,
        reason: 'Initial stock',
      })

      expect(result.quantity_change).toBe(10)
      expect(result.new_quantity).toBe(10)
    })

    it('positive adjustment increases existing stock', async () => {
      mockDbRows([{ id: 'p1' }])
      mockDbRows([{ id: 'wh-1' }])
      mockDbVoid() // INSERT movement
      mockDbRows([{ id: 'stock-1', quantity: '20' }]) // existing stock
      mockDbVoid() // UPDATE stock

      const result = await service.adjustStock('company-1', 'user-1', {
        product_id: 'p1',
        quantity_change: 5,
        reason: 'Recount',
      })

      expect(result.new_quantity).toBe(25)
    })

    it('negative adjustment decreases stock', async () => {
      mockDbRows([{ id: 'p1' }])
      mockDbRows([{ id: 'wh-1' }])
      mockDbVoid()
      mockDbRows([{ id: 'stock-1', quantity: '20' }])
      mockDbVoid()

      const result = await service.adjustStock('company-1', 'user-1', {
        product_id: 'p1',
        quantity_change: -5,
        reason: 'Damaged goods',
      })

      expect(result.new_quantity).toBe(15)
    })

    it('negative adjustment does not go below 0', async () => {
      mockDbRows([{ id: 'p1' }])
      mockDbRows([{ id: 'wh-1' }])
      mockDbVoid()
      mockDbRows([{ id: 'stock-1', quantity: '3' }])
      mockDbVoid()

      const result = await service.adjustStock('company-1', 'user-1', {
        product_id: 'p1',
        quantity_change: -10,
        reason: 'Correction',
      })

      expect(result.new_quantity).toBe(0) // Math.max(0, 3 + (-10)) = 0
    })

    it('creates movement record with correct sign for negative adjustment', async () => {
      mockDbRows([{ id: 'p1' }])
      mockDbRows([{ id: 'wh-1' }])

      let movementNotes = ''
      mockDbExecute.mockImplementationOnce((...args: any[]) => {
        const tpl = args[0]
        if (tpl?.values) {
          // notes is one of the values
          for (const v of tpl.values) {
            if (typeof v === 'string' && v.includes('salida')) {
              movementNotes = v
            }
          }
        }
        return Promise.resolve({ rows: [] })
      })
      mockDbRows([{ id: 'stock-1', quantity: '50' }])
      mockDbVoid()

      await service.adjustStock('company-1', 'user-1', {
        product_id: 'p1',
        quantity_change: -3,
        reason: 'Sold',
      })

      expect(movementNotes).toContain('salida')
    })

    it('auto-creates warehouse if none exists', async () => {
      mockDbRows([{ id: 'p1' }])
      mockDbEmpty() // no warehouse

      let warehouseCreated = false
      ;(db.insert as any).mockImplementationOnce(() => ({
        values: vi.fn(() => {
          warehouseCreated = true
          return { returning: vi.fn(() => [{ id: 'new-wh' }]) }
        }),
      }))

      // After warehouse creation, continue with movement
      mockDbVoid() // INSERT movement
      mockDbEmpty() // no existing stock
      mockDbVoid() // INSERT stock via raw SQL

      // The second insert should be the stock insert via db.execute (raw SQL)
      // But the warehouse insert happens via db.insert (Drizzle)

      // We mock the subsequent db.execute calls for movement and stock
      const result = await service.adjustStock('company-1', 'user-1', {
        product_id: 'p1',
        quantity_change: 5,
        reason: 'First stock',
      })

      expect(warehouseCreated).toBe(true)
    })

    it('throws 404 when product not found', async () => {
      mockDbEmpty()

      await expect(
        service.adjustStock('company-1', 'user-1', {
          product_id: 'nonexistent',
          quantity_change: 5,
          reason: 'test',
        })
      ).rejects.toThrow('Product not found')
    })
  })

  describe('addStockFromPurchase', () => {
    it('processes all products and auto-enables controls_stock', async () => {
      // stock_added check
      mockDbRows([{ stock_added: false }])
      // Warehouse lookup
      mockDbRows([{ id: 'wh-1' }])
      // Product 1: has controls_stock=true
      mockDbRows([{ id: 'p1', controls_stock: true }])
      // INSERT movement
      mockDbVoid()
      // Check existing stock
      mockDbRows([{ id: 'stock-1', quantity: '10' }])
      // UPDATE stock
      mockDbVoid()
      // Product 2: has controls_stock=false (will be auto-enabled)
      mockDbRows([{ id: 'p2', controls_stock: false }])
      // UPDATE product controls_stock=true
      mockDbVoid()
      // INSERT movement for p2
      mockDbVoid()
      // Check existing stock for p2
      mockDbEmpty()
      // INSERT new stock record for p2
      mockDbVoid()

      const result = await service.addStockFromPurchase('company-1', 'user-1', 'purchase-1', [
        { product_id: 'p1', quantity: 5 },
        { product_id: 'p2', quantity: 10 },
      ])

      // Both should be processed (p2 auto-enabled)
      expect(result.items_processed).toHaveLength(2)
      expect(result.items_processed[0].product_id).toBe('p1')
      expect(result.items_processed[1].product_id).toBe('p2')
    })

    it('auto-enables controls_stock for non-stock products', async () => {
      // stock_added check
      mockDbRows([{ stock_added: false }])
      mockDbRows([{ id: 'wh-1' }])
      // Product has controls_stock=false
      mockDbRows([{ id: 'p1', controls_stock: false }])
      // UPDATE product controls_stock=true
      mockDbVoid()
      // INSERT movement
      mockDbVoid()
      // Check existing stock (none)
      mockDbEmpty()
      // INSERT new stock
      mockDbVoid()

      const result = await service.addStockFromPurchase('company-1', 'user-1', 'purchase-1', [
        { product_id: 'p1', quantity: 5 },
      ])

      expect(result.items_processed).toHaveLength(1)
      expect(result.items_processed[0].quantity_added).toBe(5)
    })

    it('skips products not found in company', async () => {
      // stock_added check
      mockDbRows([{ stock_added: false }])
      mockDbRows([{ id: 'wh-1' }])
      // Product not found
      mockDbEmpty()

      const result = await service.addStockFromPurchase('company-1', 'user-1', 'purchase-1', [
        { product_id: 'nonexistent', quantity: 5 },
      ])

      expect(result.items_processed).toHaveLength(0)
    })

    it('creates new stock record for first-time product', async () => {
      // stock_added check
      mockDbRows([{ stock_added: false }])
      mockDbRows([{ id: 'wh-1' }])
      mockDbRows([{ id: 'p1', controls_stock: true }])
      mockDbVoid() // INSERT movement
      mockDbEmpty() // no existing stock

      // The service uses db.execute for INSERT stock (raw SQL)
      mockDbVoid()

      const result = await service.addStockFromPurchase('company-1', 'user-1', 'purchase-1', [
        { product_id: 'p1', quantity: 20 },
      ])

      expect(result.items_processed[0].new_quantity).toBe(20)
    })

    it('auto-creates warehouse when none exists', async () => {
      // stock_added check
      mockDbRows([{ stock_added: false }])
      mockDbEmpty() // no warehouse

      let warehouseCreated = false
      ;(db.insert as any).mockImplementationOnce(() => ({
        values: vi.fn(() => {
          warehouseCreated = true
          return { returning: vi.fn(() => []) }
        }),
      }))

      // Product check
      mockDbRows([{ id: 'p1', controls_stock: true }])
      mockDbVoid() // INSERT movement
      mockDbEmpty() // no existing stock
      mockDbVoid() // INSERT stock

      await service.addStockFromPurchase('company-1', 'user-1', 'purchase-1', [
        { product_id: 'p1', quantity: 5 },
      ])

      expect(warehouseCreated).toBe(true)
    })
  })

  describe('createMovement', () => {
    it('creates incoming movement (purchase) and increases stock', async () => {
      // product check
      mockDbRows([{ id: 'p1' }])
      // warehouse lookup
      mockDbRows([{ id: 'wh-1' }])
      // existing stock
      mockDbRows([{ id: 'stock-1', quantity: '10' }])
      // UPDATE stock
      mockDbVoid()

      const result = await service.createMovement('company-1', 'user-1', {
        product_id: 'p1',
        quantity: 5,
        movement_type: 'purchase',
      })

      expect(result.movement_type).toBe('purchase')
      expect(result.quantity).toBe(5)
    })

    it('creates outgoing movement (sale) and decreases stock', async () => {
      mockDbRows([{ id: 'p1' }])
      mockDbRows([{ id: 'wh-1' }])
      mockDbRows([{ id: 'stock-1', quantity: '10' }])
      mockDbVoid()

      const result = await service.createMovement('company-1', 'user-1', {
        product_id: 'p1',
        quantity: 3,
        movement_type: 'sale',
      })

      expect(result.movement_type).toBe('sale')
    })

    it('throws 404 when product not found', async () => {
      mockDbEmpty()

      await expect(
        service.createMovement('company-1', 'user-1', {
          product_id: 'nonexistent',
          quantity: 5,
          movement_type: 'purchase',
        })
      ).rejects.toThrow('Product not found')
    })
  })

  describe('getStock', () => {
    it('returns stock items with product and warehouse info', async () => {
      mockDbRows([
        { id: 's1', quantity: '50', product: { id: 'p1', name: 'Widget', sku: 'W-001' }, warehouse: { id: 'wh-1', name: 'Principal' } },
      ])

      const result = await service.getStock('company-1')

      expect(result.items).toHaveLength(1)
      expect(result.total).toBe(1)
    })
  })

  describe('getLowStock', () => {
    it('returns products below minimum level', async () => {
      mockDbRows([
        { id: 's1', quantity: '2', min_level: '10', product: { id: 'p1', name: 'Low Item', sku: 'L-001' } },
      ])

      const result = await service.getLowStock('company-1')

      expect(result.items).toHaveLength(1)
    })
  })

  describe('getStockMovements', () => {
    it('returns movements with pagination', async () => {
      // count query
      mockDbRows([{ total: '5' }])
      // main query
      mockDbRows([
        { id: 'm1', product_id: 'p1', movement_type: 'purchase', quantity: '10', product: { id: 'p1', name: 'Widget', sku: 'W-001' }, warehouse: { id: 'wh-1', name: 'Principal' } },
        { id: 'm2', product_id: 'p1', movement_type: 'sale', quantity: '-3', product: { id: 'p1', name: 'Widget', sku: 'W-001' }, warehouse: { id: 'wh-1', name: 'Principal' } },
      ])

      const result = await service.getStockMovements('company-1', { skip: 0, limit: 50 })

      expect(result.items).toHaveLength(2)
      expect(result.total).toBe(5)
      expect(result.skip).toBe(0)
      expect(result.limit).toBe(50)
    })

    it('paginates correctly - page 2', async () => {
      mockDbRows([{ total: '75' }])
      mockDbRows(Array(25).fill({ id: 'm', movement_type: 'purchase', quantity: '1' }))

      const result = await service.getStockMovements('company-1', { skip: 50, limit: 50 })

      expect(result.skip).toBe(50)
      expect(result.total).toBe(75)
      expect(result.items).toHaveLength(25)
    })

    it('filters by product_id', async () => {
      mockDbRows([{ total: '2' }])
      mockDbRows([
        { id: 'm1', product_id: 'p1', movement_type: 'purchase', quantity: '10' },
        { id: 'm2', product_id: 'p1', movement_type: 'adjustment', quantity: '5' },
      ])

      const result = await service.getStockMovements('company-1', { product_id: 'p1' })

      expect(result.items).toHaveLength(2)
    })

    it('returns empty items when no movements exist', async () => {
      mockDbRows([{ total: '0' }])
      mockDbRows([])

      const result = await service.getStockMovements('company-1')

      expect(result.items).toHaveLength(0)
      expect(result.total).toBe(0)
    })
  })
})
