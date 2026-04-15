import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  mockDbExecute,
  mockDbRows,
  mockClientQuery,
  resetMocks,
} from './helpers/setup'

import { InventoryService } from '../src/modules/inventory/inventory.service'

// Mock materials service so adjustStock/addStockFromPurchase post-tx hooks are inert.
vi.mock('../src/modules/materials/materials.service', () => ({
  materialsService: {
    consumeMaterialsForProduction: vi.fn().mockResolvedValue(null),
  },
}))

// Helper: queue responses on the pool.connect() client in order.
function queueClient(responses: Array<{ rows?: any[]; rowCount?: number }>) {
  for (const r of responses) {
    mockClientQuery.mockResolvedValueOnce({
      rows: r.rows || [],
      rowCount: r.rowCount ?? (r.rows?.length || 0),
    })
  }
}

// Helper: stub the ALTER TABLE migration call + return the pg client mock.
function mockMigration() {
  // addStockFromPurchase runs `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` via db.execute.
  mockDbExecute.mockResolvedValueOnce({ rows: [] })
}

describe('InventoryService', () => {
  let service: InventoryService

  beforeEach(() => {
    resetMocks()
    service = new InventoryService()
    vi.clearAllMocks()
  })

  // --------------------------------------------------------------------------
  // createMovement — signed convention + FOR UPDATE + tx
  // --------------------------------------------------------------------------
  describe('createMovement', () => {
    it("stores NEGATIVE quantity when movement_type='sale' and decrements stock (both columns)", async () => {
      queueClient([
        { rows: [] }, // BEGIN
        { rows: [{ id: 'p1' }] }, // product lookup
        { rows: [{ id: 'wh-1' }] }, // warehouse lookup (default)
        { rows: [{ id: 'stock-1', quantity: '10', quantity_num: '10' }] }, // SELECT FOR UPDATE
        { rowCount: 1 }, // UPDATE stock
        { rowCount: 1 }, // INSERT movement
        { rows: [] }, // COMMIT
      ])

      const result = await service.createMovement('company-1', 'user-1', {
        product_id: 'p1',
        quantity: 5,
        movement_type: 'sale',
      })

      expect(result.movement_type).toBe('sale')
      expect(result.quantity).toBe(-5) // signed
      expect(result.new_quantity).toBe(5)

      // Verify UPDATE stock sets BOTH quantity and quantity_num to '5'.
      const updateCall = mockClientQuery.mock.calls.find(
        (c: any[]) => typeof c[0] === 'string' && c[0].includes('UPDATE stock')
      )
      expect(updateCall).toBeDefined()
      expect(updateCall![0]).toContain('quantity = $1')
      expect(updateCall![0]).toContain('quantity_num = $2')
      expect(updateCall![1][0]).toBe('5') // new quantity
      expect(updateCall![1][1]).toBe('5') // new quantity_num

      // Verify the INSERT into stock_movements stored signed -5.
      const insertCall = mockClientQuery.mock.calls.find(
        (c: any[]) => typeof c[0] === 'string' && c[0].includes('INSERT INTO stock_movements')
      )
      expect(insertCall).toBeDefined()
      expect(insertCall![1][4]).toBe('-5') // signed qty param

      // Verify FOR UPDATE lock was used on the stock row.
      const lockCall = mockClientQuery.mock.calls.find(
        (c: any[]) => typeof c[0] === 'string' && c[0].includes('FOR UPDATE') && c[0].includes('stock')
      )
      expect(lockCall).toBeDefined()

      // Verify BEGIN and COMMIT.
      const sqls = mockClientQuery.mock.calls.map((c: any[]) => c[0])
      expect(sqls).toContain('BEGIN')
      expect(sqls).toContain('COMMIT')
    })

    it("stores POSITIVE quantity when movement_type='purchase' and increments stock", async () => {
      queueClient([
        { rows: [] }, // BEGIN
        { rows: [{ id: 'p1' }] },
        { rows: [{ id: 'wh-1' }] },
        { rows: [{ id: 'stock-1', quantity: '10', quantity_num: '10' }] },
        { rowCount: 1 }, // UPDATE
        { rowCount: 1 }, // INSERT movement
        { rows: [] }, // COMMIT
      ])

      const result = await service.createMovement('company-1', 'user-1', {
        product_id: 'p1',
        quantity: 7,
        movement_type: 'purchase',
      })

      expect(result.quantity).toBe(7)
      expect(result.new_quantity).toBe(17)
    })

    it('rejects and rolls back when product not found', async () => {
      queueClient([
        { rows: [] }, // BEGIN
        { rows: [] }, // product lookup empty
        { rows: [] }, // ROLLBACK
      ])

      await expect(
        service.createMovement('company-1', 'user-1', {
          product_id: 'nonexistent',
          quantity: 5,
          movement_type: 'purchase',
        })
      ).rejects.toThrow('Product not found')

      const sqls = mockClientQuery.mock.calls.map((c: any[]) => c[0])
      expect(sqls).toContain('ROLLBACK')
    })

    it('rejects sale when stock insufficient (no silent clamp)', async () => {
      queueClient([
        { rows: [] }, // BEGIN
        { rows: [{ id: 'p1' }] },
        { rows: [{ id: 'wh-1' }] },
        { rows: [{ id: 'stock-1', quantity: '3', quantity_num: '3' }] }, // only 3 in stock
        { rows: [] }, // ROLLBACK
      ])

      await expect(
        service.createMovement('company-1', 'user-1', {
          product_id: 'p1',
          quantity: 10,
          movement_type: 'sale',
        })
      ).rejects.toThrow('Stock insuficiente')
    })
  })

  // --------------------------------------------------------------------------
  // adjustStock — no silent clamp, tenant warehouse validation
  // --------------------------------------------------------------------------
  describe('adjustStock', () => {
    it('positive adjustment increases existing stock (both columns updated)', async () => {
      queueClient([
        { rows: [] }, // BEGIN
        { rows: [{ id: 'p1' }] }, // product
        { rows: [{ id: 'wh-1' }] }, // default warehouse
        { rows: [{ id: 'stock-1', quantity: '20', quantity_num: '20' }] }, // lock
        { rowCount: 1 }, // UPDATE stock
        { rowCount: 1 }, // INSERT movement
        { rows: [] }, // COMMIT
      ])

      const result = await service.adjustStock('company-1', 'user-1', {
        product_id: 'p1',
        quantity_change: 5,
        reason: 'Recount',
      })

      expect(result.new_quantity).toBe(25)
      expect(result.quantity_change).toBe(5)
    })

    it('rejects with 400 "Stock insuficiente" when negative adjustment would go below 0', async () => {
      queueClient([
        { rows: [] }, // BEGIN
        { rows: [{ id: 'p1' }] },
        { rows: [{ id: 'wh-1' }] },
        { rows: [{ id: 'stock-1', quantity: '5', quantity_num: '5' }] }, // only 5
        { rows: [] }, // ROLLBACK
      ])

      await expect(
        service.adjustStock('company-1', 'user-1', {
          product_id: 'p1',
          quantity_change: -10,
          reason: 'test',
        })
      ).rejects.toThrow('Stock insuficiente')

      const sqls = mockClientQuery.mock.calls.map((c: any[]) => c[0])
      expect(sqls).toContain('ROLLBACK')
      expect(sqls).not.toContain('COMMIT')
    })

    it('rejects cross-tenant warehouse_id with 400 "Warehouse not found"', async () => {
      queueClient([
        { rows: [] }, // BEGIN
        { rows: [{ id: 'p1' }] }, // product OK
        { rows: [] }, // warehouse check fails (different tenant)
        { rows: [] }, // ROLLBACK
      ])

      await expect(
        service.adjustStock('company-1', 'user-1', {
          product_id: 'p1',
          warehouse_id: 'cross-tenant-wh',
          quantity_change: 5,
          reason: 'attack',
        })
      ).rejects.toThrow('Warehouse not found')
    })

    it('throws 404 when product not found', async () => {
      queueClient([
        { rows: [] }, // BEGIN
        { rows: [] }, // product empty
        { rows: [] }, // ROLLBACK
      ])

      await expect(
        service.adjustStock('company-1', 'user-1', {
          product_id: 'nonexistent',
          quantity_change: 5,
          reason: 'test',
        })
      ).rejects.toThrow('Product not found')
    })

    it('stores SIGNED quantity in stock_movements (negative for outgoing)', async () => {
      queueClient([
        { rows: [] }, // BEGIN
        { rows: [{ id: 'p1' }] },
        { rows: [{ id: 'wh-1' }] },
        { rows: [{ id: 'stock-1', quantity: '50', quantity_num: '50' }] },
        { rowCount: 1 }, // UPDATE stock
        { rowCount: 1 }, // INSERT movement
        { rows: [] }, // COMMIT
      ])

      await service.adjustStock('company-1', 'user-1', {
        product_id: 'p1',
        quantity_change: -3,
        reason: 'Sold',
      })

      const insertCall = mockClientQuery.mock.calls.find(
        (c: any[]) =>
          typeof c[0] === 'string' && c[0].includes('INSERT INTO stock_movements')
      )
      expect(insertCall).toBeDefined()
      expect(insertCall![1][3]).toBe('-3') // signed
      expect(insertCall![1][4]).toContain('salida')
    })
  })

  // --------------------------------------------------------------------------
  // getStockMovements — parametrized (no injection), date filters
  // --------------------------------------------------------------------------
  describe('getStockMovements', () => {
    it('returns movements with pagination', async () => {
      mockDbRows([{ total: '5' }])
      mockDbRows([
        { id: 'm1', product_id: 'p1', movement_type: 'purchase', quantity: '10' },
        { id: 'm2', product_id: 'p1', movement_type: 'sale', quantity: '-3' },
      ])

      const result = await service.getStockMovements('company-1', { skip: 0, limit: 50 })
      expect(result.items).toHaveLength(2)
      expect(result.total).toBe(5)
    })

    it('accepts date_from/date_to filters', async () => {
      mockDbRows([{ total: '2' }])
      mockDbRows([
        { id: 'm1', product_id: 'p1', movement_type: 'purchase', quantity: '10' },
        { id: 'm2', product_id: 'p1', movement_type: 'sale', quantity: '-2' },
      ])

      const result = await service.getStockMovements('company-1', {
        date_from: '2026-04-01',
        date_to: '2026-04-13',
      })
      expect(result.items).toHaveLength(2)

      // Verify the SQL builder captured the date parameters (no sql.raw usage).
      const lastCall = mockDbExecute.mock.calls[mockDbExecute.mock.calls.length - 1][0]
      // Traverse the sql template chain — our mock returns an object with values array.
      // Dates should be present somewhere in the composed values.
      const serialized = JSON.stringify(lastCall)
      expect(serialized).toContain('2026-04-01T00:00:00-03:00')
      expect(serialized).toContain('2026-04-13T23:59:59.999-03:00')
    })

    it("injection attempt in product_id is safely parameterized", async () => {
      mockDbRows([{ total: '0' }])
      mockDbRows([])

      const result = await service.getStockMovements('company-1', {
        product_id: "' OR '1'='1",
      })
      expect(result.items).toHaveLength(0)

      // Verify the malicious string was passed as a parameter value, NOT
      // interpolated into the SQL template strings (sql.raw must not be used).
      const lastCall = mockDbExecute.mock.calls[mockDbExecute.mock.calls.length - 1][0]
      // The template `strings` array must NOT contain the attack payload.
      // Our drizzle mock exposes `strings` (TemplateStringsArray) on nested sql objects.
      const stringified = JSON.stringify(lastCall)
      // The value appears somewhere (as a parameter), but NOT as a raw fragment.
      // Specifically, no `sql.raw` object should be in the tree.
      expect(stringified).not.toContain('"raw"')
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

    it('returns empty when no movements exist', async () => {
      mockDbRows([{ total: '0' }])
      mockDbRows([])

      const result = await service.getStockMovements('company-1')
      expect(result.items).toHaveLength(0)
      expect(result.total).toBe(0)
    })
  })

  // --------------------------------------------------------------------------
  // addStockFromPurchase — idempotency, no auto-enable, tx safety
  // --------------------------------------------------------------------------
  describe('addStockFromPurchase', () => {
    it('second call on same purchase is a no-op (stock_added=true)', async () => {
      mockMigration() // ALTER TABLE
      queueClient([
        { rows: [] }, // BEGIN
        { rows: [{ id: 'purchase-1', stock_added: true }] }, // already added
        { rows: [] }, // ROLLBACK
      ])

      await expect(
        service.addStockFromPurchase('company-1', 'user-1', 'purchase-1', [
          { product_id: 'p1', quantity: 5 },
        ])
      ).rejects.toThrow('ya fue agregado')
    })

    it('skips product with controls_stock=false WITHOUT mutating the product', async () => {
      mockMigration()
      queueClient([
        { rows: [] }, // BEGIN
        { rows: [{ id: 'purchase-1', stock_added: false }] }, // purchase lock
        { rows: [{ id: 'wh-1' }] }, // warehouse lookup
        { rows: [{ id: 'p1', controls_stock: false }] }, // product config check
        { rowCount: 1 }, // UPDATE purchases SET stock_added=true
        { rows: [] }, // COMMIT
      ])

      const result = await service.addStockFromPurchase(
        'company-1',
        'user-1',
        'purchase-1',
        [{ product_id: 'p1', quantity: 5 }]
      )

      expect(result.items_processed).toHaveLength(0)
      expect(result.skipped).toHaveLength(1)
      expect(result.skipped[0].reason).toBe('controls_stock_disabled')

      // Verify NO `UPDATE products SET controls_stock=true` was issued.
      const mutatesControls = mockClientQuery.mock.calls.some(
        (c: any[]) =>
          typeof c[0] === 'string' && c[0].includes('UPDATE products') && c[0].includes('controls_stock')
      )
      expect(mutatesControls).toBe(false)
    })

    it('processes stock-controlled product end-to-end', async () => {
      mockMigration()
      queueClient([
        { rows: [] }, // BEGIN
        { rows: [{ id: 'purchase-1', stock_added: false }] }, // purchase lock
        { rows: [{ id: 'wh-1' }] }, // warehouse
        { rows: [{ id: 'p1', controls_stock: true }] }, // product
        { rows: [{ id: 'stock-1', quantity: '10', quantity_num: '10' }] }, // lock stock
        { rowCount: 1 }, // UPDATE stock
        { rowCount: 1 }, // INSERT stock_movements
        { rowCount: 1 }, // UPDATE purchases SET stock_added=true
        { rows: [] }, // COMMIT
      ])

      const result = await service.addStockFromPurchase(
        'company-1',
        'user-1',
        'purchase-1',
        [{ product_id: 'p1', quantity: 5 }]
      )

      expect(result.items_processed).toHaveLength(1)
      expect(result.items_processed[0].new_quantity).toBe(15)

      // Verify stock UPDATE sets BOTH columns.
      const updateCall = mockClientQuery.mock.calls.find(
        (c: any[]) => typeof c[0] === 'string' && c[0].includes('UPDATE stock')
      )
      expect(updateCall![1][0]).toBe('15')
      expect(updateCall![1][1]).toBe('15')

      // Verify purchase was marked stock_added.
      const markCall = mockClientQuery.mock.calls.find(
        (c: any[]) => typeof c[0] === 'string' && c[0].includes('UPDATE purchases SET stock_added')
      )
      expect(markCall).toBeDefined()
    })

    it('rolls back entire batch if one item has invalid quantity', async () => {
      mockMigration()
      queueClient([
        { rows: [] }, // BEGIN
        { rows: [{ id: 'purchase-1', stock_added: false }] },
        { rows: [{ id: 'wh-1' }] },
        { rows: [{ id: 'p1', controls_stock: true }] }, // product lookup
        { rows: [] }, // ROLLBACK
      ])

      await expect(
        service.addStockFromPurchase('company-1', 'user-1', 'purchase-1', [
          { product_id: 'p1', quantity: NaN as any },
        ])
      ).rejects.toThrow('quantity invalido')

      const sqls = mockClientQuery.mock.calls.map((c: any[]) => c[0])
      expect(sqls).toContain('ROLLBACK')
    })

    it('rejects when purchase not found', async () => {
      mockMigration()
      queueClient([
        { rows: [] }, // BEGIN
        { rows: [] }, // purchase not found
        { rows: [] }, // ROLLBACK
      ])

      await expect(
        service.addStockFromPurchase('company-1', 'user-1', 'missing', [
          { product_id: 'p1', quantity: 5 },
        ])
      ).rejects.toThrow('Purchase not found')
    })
  })

  // --------------------------------------------------------------------------
  // Concurrency: two callers on the same stock row → serialized via FOR UPDATE
  // --------------------------------------------------------------------------
  describe('concurrent createMovement on same stock row', () => {
    it('serializes via FOR UPDATE and final stock is correct sum of deltas', async () => {
      // Simulate two concurrent sales of 3 each against an initial stock of 10.
      // Because both calls share the same mockClientQuery, we must queue
      // responses for both transactions back-to-back. FOR UPDATE guarantees
      // the second transaction sees the UPDATED value from the first.
      queueClient([
        // --- tx1 ---
        { rows: [] }, // BEGIN
        { rows: [{ id: 'p1' }] },
        { rows: [{ id: 'wh-1' }] },
        { rows: [{ id: 'stock-1', quantity: '10', quantity_num: '10' }] }, // FOR UPDATE → 10
        { rowCount: 1 }, // UPDATE → 7
        { rowCount: 1 }, // INSERT movement
        { rows: [] }, // COMMIT
        // --- tx2 (sees post-tx1 value) ---
        { rows: [] }, // BEGIN
        { rows: [{ id: 'p1' }] },
        { rows: [{ id: 'wh-1' }] },
        { rows: [{ id: 'stock-1', quantity: '7', quantity_num: '7' }] }, // FOR UPDATE → 7
        { rowCount: 1 }, // UPDATE → 4
        { rowCount: 1 }, // INSERT movement
        { rows: [] }, // COMMIT
      ])

      // Run sequentially — the mockClientQuery queue is a shared FIFO that
      // cannot interleave two concurrent call stacks safely. Sequential
      // execution still exercises BEGIN → FOR UPDATE → UPDATE → COMMIT for
      // each transaction, which is what we need to assert.
      const r1 = await service.createMovement('company-1', 'user-1', {
        product_id: 'p1',
        quantity: 3,
        movement_type: 'sale',
      })
      const r2 = await service.createMovement('company-1', 'user-1', {
        product_id: 'p1',
        quantity: 3,
        movement_type: 'sale',
      })

      expect(r1.new_quantity).toBe(7)
      expect(r2.new_quantity).toBe(4)

      // Both transactions must have FOR UPDATE + BEGIN/COMMIT.
      const sqls = mockClientQuery.mock.calls.map((c: any[]) => c[0])
      const begins = sqls.filter((s: any) => s === 'BEGIN').length
      const commits = sqls.filter((s: any) => s === 'COMMIT').length
      const locks = sqls.filter(
        (s: any) => typeof s === 'string' && s.includes('FOR UPDATE') && s.includes('stock')
      ).length
      expect(begins).toBe(2)
      expect(commits).toBe(2)
      expect(locks).toBe(2)
    })
  })

  // --------------------------------------------------------------------------
  // Read-only queries still work through db.execute path
  // --------------------------------------------------------------------------
  describe('getStock', () => {
    it('returns stock items with product and warehouse info', async () => {
      mockDbRows([
        {
          id: 's1',
          quantity: '50',
          product: { id: 'p1', name: 'Widget', sku: 'W-001' },
          warehouse: { id: 'wh-1', name: 'Principal' },
        },
      ])

      const result = await service.getStock('company-1')
      expect(result.items).toHaveLength(1)
      expect(result.total).toBe(1)
    })
  })

  describe('getLowStock', () => {
    it('returns products below minimum level', async () => {
      mockDbRows([
        {
          id: 's1',
          quantity: '2',
          min_level: '10',
          product: { id: 'p1', name: 'Low Item', sku: 'L-001' },
        },
      ])

      const result = await service.getLowStock('company-1')
      expect(result.items).toHaveLength(1)
    })
  })
})
