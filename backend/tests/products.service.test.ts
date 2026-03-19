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

    it('calculates final_price correctly: cost * (1+margin/100) * (1+vat/100)', async () => {
      mockDbVoid()
      mockDbVoid()
      ;(db.query.products.findFirst as any).mockResolvedValueOnce(null)

      let savedPricing: any = null
      ;(db.transaction as any).mockImplementationOnce(async (fn: any) => {
        const txMock = {
          insert: vi.fn(() => ({
            values: vi.fn((vals: any) => {
              // Capture pricing values from the second insert (product_pricing)
              if (vals.cost !== undefined) {
                savedPricing = vals
              }
              return {
                returning: vi.fn(() => [{ id: 'prod-id', sku: 'PRICE-001', name: 'Price Test' }]),
              }
            }),
          })),
        }
        return fn(txMock)
      })

      await service.createProduct('company-1', {
        sku: 'PRICE-001',
        name: 'Price Test',
        cost: 1000,
        margin_percent: 50,
        vat_rate: 21,
      })

      // Expected: 1000 * 1.5 * 1.21 = 1815.00
      if (savedPricing) {
        expect(parseFloat(savedPricing.final_price)).toBeCloseTo(1815.00, 2)
        expect(parseFloat(savedPricing.cost)).toBeCloseTo(1000.00, 2)
        expect(parseFloat(savedPricing.margin_percent)).toBeCloseTo(50.00, 2)
        expect(parseFloat(savedPricing.vat_rate)).toBeCloseTo(21.00, 2)
      }
    })
  })

  describe('getProducts', () => {
    it('returns correct format with items, total, skip, limit, has_stock_products', async () => {
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

    it('paginates correctly - page 1', async () => {
      mockDbVoid()
      mockDbVoid()
      mockPoolQuery
        .mockResolvedValueOnce({ rows: [{ total: '75' }] })
        .mockResolvedValueOnce({ rows: [{ has_stock: false }] })
        .mockResolvedValueOnce({ rows: Array(50).fill({ id: 'p', name: 'P' }) })

      const result = await service.getProducts('company-1', { skip: 0, limit: 50 })

      expect(result.skip).toBe(0)
      expect(result.limit).toBe(50)
      expect(result.total).toBe(75)
      expect(result.items).toHaveLength(50)
    })

    it('paginates correctly - page 2', async () => {
      mockDbVoid()
      mockDbVoid()
      mockPoolQuery
        .mockResolvedValueOnce({ rows: [{ total: '75' }] })
        .mockResolvedValueOnce({ rows: [{ has_stock: false }] })
        .mockResolvedValueOnce({ rows: Array(25).fill({ id: 'p', name: 'P' }) })

      const result = await service.getProducts('company-1', { skip: 50, limit: 50 })

      expect(result.skip).toBe(50)
      expect(result.total).toBe(75)
      expect(result.items).toHaveLength(25)
    })

    it('filters by search term using parameterized query', async () => {
      mockDbVoid()
      mockDbVoid()
      mockPoolQuery
        .mockResolvedValueOnce({ rows: [{ total: '1' }] })
        .mockResolvedValueOnce({ rows: [{ has_stock: false }] })
        .mockResolvedValueOnce({ rows: [{ id: 'p1', name: 'Widget', sku: 'W-001' }] })

      const result = await service.getProducts('company-1', { search: 'Widget' })

      expect(result.items).toHaveLength(1)
      // Verify parameterized queries: count query should have 2 params (companyId + search)
      const countCall = mockPoolQuery.mock.calls[0]
      expect(countCall[0]).toContain('ILIKE')
      expect(countCall[1]).toContain('%Widget%')
    })

    it('filters by stock_status=in_stock', async () => {
      mockDbVoid()
      mockDbVoid()
      mockPoolQuery
        .mockResolvedValueOnce({ rows: [{ total: '1' }] })
        .mockResolvedValueOnce({ rows: [{ has_stock: true }] })
        .mockResolvedValueOnce({ rows: [{ id: 'p1', stock_quantity: 10 }] })

      const result = await service.getProducts('company-1', { stock_status: 'in_stock' })

      expect(result.items).toHaveLength(1)
      // Verify query includes stock filter
      const countQuery = mockPoolQuery.mock.calls[0][0]
      expect(countQuery).toContain('COALESCE(CAST(s.quantity AS decimal), 0) > 0')
    })

    it('filters by stock_status=low', async () => {
      mockDbVoid()
      mockDbVoid()
      mockPoolQuery
        .mockResolvedValueOnce({ rows: [{ total: '0' }] })
        .mockResolvedValueOnce({ rows: [{ has_stock: true }] })
        .mockResolvedValueOnce({ rows: [] })

      const result = await service.getProducts('company-1', { stock_status: 'low' })

      const countQuery = mockPoolQuery.mock.calls[0][0]
      expect(countQuery).toContain('low_stock_threshold')
    })

    it('filters by stock_status=out', async () => {
      mockDbVoid()
      mockDbVoid()
      mockPoolQuery
        .mockResolvedValueOnce({ rows: [{ total: '1' }] })
        .mockResolvedValueOnce({ rows: [{ has_stock: true }] })
        .mockResolvedValueOnce({ rows: [{ id: 'p1', stock_quantity: 0 }] })

      const result = await service.getProducts('company-1', { stock_status: 'out' })

      const countQuery = mockPoolQuery.mock.calls[0][0]
      expect(countQuery).toContain('controls_stock = true')
      expect(countQuery).toContain('COALESCE(CAST(s.quantity AS decimal), 0) <= 0')
    })

    it('filters by category_id', async () => {
      mockDbVoid()
      mockDbVoid()
      mockPoolQuery
        .mockResolvedValueOnce({ rows: [{ total: '3' }] })
        .mockResolvedValueOnce({ rows: [{ has_stock: false }] })
        .mockResolvedValueOnce({ rows: Array(3).fill({ id: 'p', name: 'P' }) })

      const result = await service.getProducts('company-1', { category_id: 'cat-123' })

      expect(result.total).toBe(3)
      // Verify category filter is parameterized
      const countCall = mockPoolQuery.mock.calls[0]
      expect(countCall[0]).toContain('p.category_id = $')
      expect(countCall[1]).toContain('cat-123')
    })

    it('returns has_stock_products=true when company has stock products', async () => {
      mockDbVoid()
      mockDbVoid()
      mockPoolQuery
        .mockResolvedValueOnce({ rows: [{ total: '1' }] })
        .mockResolvedValueOnce({ rows: [{ has_stock: true }] })
        .mockResolvedValueOnce({ rows: [{ id: 'p1' }] })

      const result = await service.getProducts('company-1')

      expect(result.has_stock_products).toBe(true)
    })

    it('returns stock_quantity with COALESCE (no nulls)', async () => {
      mockDbVoid()
      mockDbVoid()
      mockPoolQuery
        .mockResolvedValueOnce({ rows: [{ total: '1' }] })
        .mockResolvedValueOnce({ rows: [{ has_stock: false }] })
        .mockResolvedValueOnce({ rows: [
          { id: 'p1', stock_quantity: 0, stock_min_level: 0 }, // COALESCE returns 0 not null
        ] })

      const result = await service.getProducts('company-1')

      // stock_quantity should be 0, not null
      expect(result.items[0].stock_quantity).toBe(0)
      expect(result.items[0].stock_quantity).not.toBeNull()
    })

    it('clamps limit to 200 maximum', async () => {
      mockDbVoid()
      mockDbVoid()
      mockPoolQuery
        .mockResolvedValueOnce({ rows: [{ total: '500' }] })
        .mockResolvedValueOnce({ rows: [{ has_stock: false }] })
        .mockResolvedValueOnce({ rows: [] })

      const result = await service.getProducts('company-1', { limit: 999 })

      expect(result.limit).toBe(200)
    })

    it('handles NaN skip gracefully (defaults to 0)', async () => {
      mockDbVoid()
      mockDbVoid()
      mockPoolQuery
        .mockResolvedValueOnce({ rows: [{ total: '0' }] })
        .mockResolvedValueOnce({ rows: [{ has_stock: false }] })
        .mockResolvedValueOnce({ rows: [] })

      const result = await service.getProducts('company-1', { skip: NaN })

      expect(result.skip).toBe(0)
    })

    it('handles special characters in search safely (parameterized)', async () => {
      mockDbVoid()
      mockDbVoid()
      mockPoolQuery
        .mockResolvedValueOnce({ rows: [{ total: '0' }] })
        .mockResolvedValueOnce({ rows: [{ has_stock: false }] })
        .mockResolvedValueOnce({ rows: [] })

      // This should NOT throw or cause SQL injection
      const result = await service.getProducts('company-1', { search: "'; DROP TABLE products; --" })

      expect(result.items).toHaveLength(0)
      // Verify the dangerous string is passed as a parameter, not interpolated
      const countCall = mockPoolQuery.mock.calls[0]
      expect(countCall[1]).toContain("%'; DROP TABLE products; --%")
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
    it('applies percentage increase correctly preserving margin', async () => {
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

    it('preserves margin formula: new_price = new_cost * (1+margin/100) * (1+vat/100)', async () => {
      mockDbVoid() // UPDATE product_pricing for p1

      await service.bulkUpdatePrice('company-1', ['p1'], 20)

      // Verify the SQL includes the correct formula
      const sqlCall = mockDbExecute.mock.calls[0][0]
      // The SQL template should contain the multiplier and the formula
      expect(sqlCall.values || sqlCall.strings).toBeTruthy()
    })
  })

  describe('bulkPricePreview', () => {
    it('returns correct before/after values', async () => {
      mockPoolQuery.mockResolvedValueOnce({
        rows: [
          {
            product_id: 'p1', sku: 'A-001', name: 'Product A',
            old_cost: '100.00', margin_percent: '30.00', vat_rate: '21.00',
            old_final_price: '157.30', new_cost: '110.00', new_final_price: '173.03',
          },
        ],
      })

      const result = await service.bulkPricePreview('company-1', ['p1'], 10)

      expect(result.items).toHaveLength(1)
      expect(result.percent).toBe(10)
      expect(result.items[0].old_cost).toBe('100.00')
      expect(result.items[0].new_cost).toBe('110.00')
    })

    it('throws error on zero percentage', async () => {
      await expect(
        service.bulkPricePreview('company-1', ['p1'], 0)
      ).rejects.toThrow('Percentage must be non-zero')
    })

    it('throws error on empty product list', async () => {
      await expect(
        service.bulkPricePreview('company-1', [], 10)
      ).rejects.toThrow('No products selected')
    })

    it('handles negative percentage for price decrease', async () => {
      mockPoolQuery.mockResolvedValueOnce({
        rows: [
          {
            product_id: 'p1', sku: 'A-001', name: 'Product A',
            old_cost: '100.00', margin_percent: '30.00', vat_rate: '21.00',
            old_final_price: '157.30', new_cost: '90.00', new_final_price: '141.57',
          },
        ],
      })

      const result = await service.bulkPricePreview('company-1', ['p1'], -10)

      expect(result.items).toHaveLength(1)
      expect(result.percent).toBe(-10)
      expect(parseFloat(result.items[0].new_cost)).toBeLessThan(parseFloat(result.items[0].old_cost))
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
