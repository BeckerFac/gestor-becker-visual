import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mockDbExecute, mockDbRows, mockDbEmpty, mockDbVoid, mockPoolQuery, resetMocks } from './helpers/setup'

import { ProductsService } from '../src/modules/products/products.service'

const { db } = await import('../src/config/db')

describe('ProductsService', () => {
  let service: ProductsService

  beforeEach(() => {
    resetMocks()
    service = new ProductsService()
    vi.clearAllMocks()
  })

  describe('createProduct', () => {
    it('creates product with pricing', async () => {
      // migrations
      mockDbVoid()
      mockDbVoid()

      // findFirst for duplicate SKU check returns null (no duplicate)
      ;(db.query.products.findFirst as any).mockResolvedValueOnce(null)

      const result = await service.createProduct('company-1', {
        sku: 'TEST-001',
        name: 'Test Product',
        description: 'A test product',
        cost: 100,
        margin_percent: 30,
        vat_rate: 21,
      })

      expect(result).toHaveProperty('id')
      expect(result.sku).toBe('TEST-001')
    })

    it('throws 409 on duplicate SKU', async () => {
      mockDbVoid() // migrations
      mockDbVoid()

      // findFirst returns existing product
      ;(db.query.products.findFirst as any).mockResolvedValueOnce({ id: 'existing', sku: 'DUP-001' })

      await expect(
        service.createProduct('company-1', { sku: 'DUP-001', name: 'Duplicate' })
      ).rejects.toThrow('SKU already exists')
    })

    it('rejects price exceeding decimal(12,2) max', async () => {
      mockDbVoid()
      mockDbVoid()
      ;(db.query.products.findFirst as any).mockResolvedValueOnce(null)

      // Mock transaction to throw on overflow
      ;(db.transaction as any).mockImplementationOnce(async (fn: any) => {
        const txMock = {
          insert: vi.fn(() => ({
            values: vi.fn(() => ({
              returning: vi.fn(() => [{ id: 'test-id', sku: 'EXP-001', name: 'Expensive' }]),
            })),
          })),
        }
        return fn(txMock)
      })

      await expect(
        service.createProduct('company-1', {
          sku: 'EXP-001',
          name: 'Expensive',
          cost: 9999999999,
          margin_percent: 100,
          vat_rate: 21,
        })
      ).rejects.toThrow('El precio final excede el maximo permitido')
    })

    it('saves controls_stock and low_stock_threshold via pool.query', async () => {
      mockDbVoid()
      mockDbVoid()
      ;(db.query.products.findFirst as any).mockResolvedValueOnce(null)
      mockPoolQuery.mockResolvedValue({ rows: [] })

      await service.createProduct('company-1', {
        sku: 'STOCK-001',
        name: 'Stock Product',
        controls_stock: true,
        low_stock_threshold: 10,
      })

      // pool.query should be called for controls_stock and low_stock_threshold
      expect(mockPoolQuery).toHaveBeenCalled()
    })
  })

  describe('getProducts', () => {
    it('returns correct format with items, total, skip, limit', async () => {
      mockDbVoid() // migrations
      mockDbVoid()

      // getProducts now uses pool.query for count, has_stock check, and main query
      mockPoolQuery
        .mockResolvedValueOnce({ rows: [{ total: '2' }] }) // count query
        .mockResolvedValueOnce({ rows: [{ has_stock: false }] }) // has_stock_products query
        .mockResolvedValueOnce({ rows: [
          { id: 'p1', name: 'Product A', sku: 'A-001', pricing: { cost: '100', final_price: '150' }, stock_quantity: 0, stock_min_level: 0 },
          { id: 'p2', name: 'Product B', sku: 'B-001', pricing: null, stock_quantity: 0, stock_min_level: 0 },
        ] }) // main query

      const result = await service.getProducts('company-1')

      expect(result).toHaveProperty('items')
      expect(result).toHaveProperty('total')
      expect(result).toHaveProperty('skip')
      expect(result).toHaveProperty('limit')
      expect(result).toHaveProperty('has_stock_products')
      expect(result.items).toHaveLength(2)
      expect(result.total).toBe(2)
    })
  })

  describe('updateProduct', () => {
    it('updates controls_stock and low_stock_threshold', async () => {
      // getProduct internals
      ;(db.query.products.findFirst as any).mockResolvedValueOnce({
        id: 'p1', sku: 'TEST', name: 'Test', company_id: 'company-1',
      })
      mockPoolQuery.mockResolvedValue({ rows: [] })

      const result = await service.updateProduct('company-1', 'p1', {
        controls_stock: true,
        low_stock_threshold: 5,
      })

      expect(mockPoolQuery).toHaveBeenCalledWith(
        'UPDATE products SET controls_stock = $1 WHERE id = $2',
        [true, 'p1']
      )
      expect(mockPoolQuery).toHaveBeenCalledWith(
        'UPDATE products SET low_stock_threshold = $1 WHERE id = $2',
        [5, 'p1']
      )
    })
  })

  describe('bulkUpdatePrice', () => {
    it('applies percentage increase correctly', async () => {
      mockDbVoid() // UPDATE product_pricing
      mockDbVoid()

      const result = await service.bulkUpdatePrice('company-1', ['p1', 'p2'], 10)

      expect(result.updated).toBe(2)
      expect(mockDbExecute).toHaveBeenCalledTimes(2)
    })

    it('applies negative percentage (decrease)', async () => {
      mockDbVoid()

      const result = await service.bulkUpdatePrice('company-1', ['p1'], -15)

      expect(result.updated).toBe(1)
    })

    it('throws error on zero percentage', async () => {
      await expect(
        service.bulkUpdatePrice('company-1', ['p1'], 0)
      ).rejects.toThrow('Percentage must be non-zero')
    })

    it('throws error on empty product list', async () => {
      await expect(
        service.bulkUpdatePrice('company-1', [], 10)
      ).rejects.toThrow('No products selected')
    })
  })

  describe('getCategories', () => {
    it('returns hierarchical structure ordered by parent_id', async () => {
      mockDbRows([
        { id: 'cat-1', name: 'Electronics', parent_id: null, product_count: '5' },
        { id: 'cat-2', name: 'Phones', parent_id: 'cat-1', product_count: '3' },
      ])

      const result = await service.getCategories('company-1')

      expect(result).toHaveLength(2)
      expect(result[0].name).toBe('Electronics')
      expect(result[1].parent_id).toBe('cat-1')
    })

    it('returns empty array on error', async () => {
      mockDbExecute.mockRejectedValueOnce(new Error('DB error'))

      const result = await service.getCategories('company-1')
      expect(result).toEqual([])
    })
  })

  describe('deleteProduct', () => {
    it('deletes existing product', async () => {
      ;(db.query.products.findFirst as any).mockResolvedValueOnce({ id: 'p1', sku: 'DEL', name: 'Delete Me' })

      const result = await service.deleteProduct('company-1', 'p1')
      expect(result.success).toBe(true)
    })

    it('throws 404 when product not found', async () => {
      ;(db.query.products.findFirst as any).mockResolvedValueOnce(null)

      await expect(
        service.deleteProduct('company-1', 'nonexistent')
      ).rejects.toThrow('Product not found')
    })
  })
})
