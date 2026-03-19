import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mockDbExecute, mockDbRows, mockDbEmpty, mockDbVoid, mockPoolQuery, resetMocks } from './helpers/setup'

import { ProductsService } from '../src/modules/products/products.service'

const { db } = await import('../src/config/db')

describe('Categories - ProductsService', () => {
  let service: ProductsService

  beforeEach(() => {
    resetMocks()
    service = new ProductsService()
    vi.clearAllMocks()
  })

  // Helper to skip the 7 migration ALTER TABLE calls
  function skipMigrations() {
    for (let i = 0; i < 7; i++) {
      mockDbVoid()
    }
  }

  // Helper: match SQL content to return specific results
  function mockByContent(overrides: Record<string, any>) {
    mockDbExecute.mockImplementation((...args: any[]) => {
      const tpl = args[0]
      const sqlStr = tpl?.strings ? tpl.strings.join('') : ''

      for (const [pattern, result] of Object.entries(overrides)) {
        if (sqlStr.includes(pattern)) {
          return typeof result === 'function' ? result(tpl) : Promise.resolve(result)
        }
      }
      return Promise.resolve({ rows: [] })
    })
  }

  // =============================================
  // CATEGORY DEFAULTS INHERITANCE
  // =============================================

  describe('getCategoryDefaults', () => {
    it('returns defaults from the category itself', async () => {
      skipMigrations()

      mockDbRows([{
        default_vat_rate: '21.00',
        default_margin_percent: '30.00',
        default_supplier_id: 'supplier-1',
        parent_id: null,
      }])

      const result = await service.getCategoryDefaults('company-1', 'cat-1')

      expect(result.vat_rate).toBe(21)
      expect(result.margin_percent).toBe(30)
      expect(result.supplier_id).toBe('supplier-1')
    })

    it('inherits from parent when child has no defaults', async () => {
      skipMigrations()

      // Child category: no defaults, has parent_id
      mockDbRows([{
        default_vat_rate: null,
        default_margin_percent: null,
        default_supplier_id: null,
        parent_id: 'cat-parent',
      }])

      // Parent category: has defaults
      mockDbRows([{
        default_vat_rate: '10.50',
        default_margin_percent: '45.00',
        default_supplier_id: 'supplier-parent',
        parent_id: null,
      }])

      const result = await service.getCategoryDefaults('company-1', 'cat-child')

      expect(result.vat_rate).toBe(10.5)
      expect(result.margin_percent).toBe(45)
      expect(result.supplier_id).toBe('supplier-parent')
    })

    it('inherits from grandparent (3 levels)', async () => {
      skipMigrations()

      // Level 3 (grandchild): no defaults
      mockDbRows([{
        default_vat_rate: null,
        default_margin_percent: null,
        default_supplier_id: null,
        parent_id: 'cat-parent',
      }])

      // Level 2 (parent): partial defaults
      mockDbRows([{
        default_vat_rate: '10.50',
        default_margin_percent: null,
        default_supplier_id: null,
        parent_id: 'cat-grandparent',
      }])

      // Level 1 (grandparent): remaining defaults
      mockDbRows([{
        default_vat_rate: '21.00', // Won't override, already set from level 2
        default_margin_percent: '25.00',
        default_supplier_id: 'supplier-gp',
        parent_id: null,
      }])

      const result = await service.getCategoryDefaults('company-1', 'cat-grandchild')

      expect(result.vat_rate).toBe(10.5) // From parent (level 2)
      expect(result.margin_percent).toBe(25) // From grandparent (level 1)
      expect(result.supplier_id).toBe('supplier-gp') // From grandparent (level 1)
    })

    it('returns empty object for nonexistent category', async () => {
      skipMigrations()
      mockDbEmpty()

      const result = await service.getCategoryDefaults('company-1', 'nonexistent')

      expect(result).toEqual({})
    })

    it('handles category with default_vat_rate = null correctly (should inherit)', async () => {
      skipMigrations()

      // Child with explicit null vat
      mockDbRows([{
        default_vat_rate: null,
        default_margin_percent: '30.00',
        default_supplier_id: null,
        parent_id: 'cat-parent',
      }])

      // Parent with vat set
      mockDbRows([{
        default_vat_rate: '21.00',
        default_margin_percent: '50.00', // Won't override, already set from child
        default_supplier_id: null,
        parent_id: null,
      }])

      const result = await service.getCategoryDefaults('company-1', 'cat-child')

      expect(result.vat_rate).toBe(21) // Inherited from parent
      expect(result.margin_percent).toBe(30) // From child itself
    })
  })

  // =============================================
  // MAX DEPTH ENFORCEMENT
  // =============================================

  describe('createCategory', () => {
    it('creates root category (no parent)', async () => {
      skipMigrations()

      mockByContent({
        'MAX(sort_order)': { rows: [{ max_order: 2 }] },
      })

      // Mock the Drizzle insert chain
      ;(db.insert as any).mockReturnValueOnce({
        values: vi.fn(() => ({
          returning: vi.fn(() => [{ id: 'new-cat', name: 'Root Cat' }]),
        })),
      })
      mockPoolQuery.mockResolvedValueOnce({ rows: [] }) // UPDATE for extra fields

      const result = await service.createCategory('company-1', {
        name: 'Root Cat',
        default_vat_rate: 21,
      })

      expect(result.name).toBe('Root Cat')
      expect(result.parent_id).toBeNull()
    })

    it('creates level 2 category (under root)', async () => {
      skipMigrations()

      // Check parent: exists, parent_id is null (level 1)
      mockDbRows([{ parent_id: null }])

      // max sort_order
      mockDbRows([{ max_order: 0 }])

      ;(db.insert as any).mockReturnValueOnce({
        values: vi.fn(() => ({
          returning: vi.fn(() => [{ id: 'new-cat', name: 'Sub Cat' }]),
        })),
      })
      mockPoolQuery.mockResolvedValueOnce({ rows: [] })

      const result = await service.createCategory('company-1', {
        name: 'Sub Cat',
        parent_id: 'cat-root',
      })

      expect(result.name).toBe('Sub Cat')
      expect(result.parent_id).toBe('cat-root')
    })

    it('creates level 3 category (max depth)', async () => {
      skipMigrations()

      // Check parent: exists, has parent_id (level 2)
      mockDbRows([{ parent_id: 'cat-root' }])

      // Check grandparent: exists, has NO parent_id (level 1) => 3rd level OK
      mockDbRows([{ parent_id: null }])

      // max sort_order
      mockDbRows([{ max_order: 0 }])

      ;(db.insert as any).mockReturnValueOnce({
        values: vi.fn(() => ({
          returning: vi.fn(() => [{ id: 'new-cat', name: 'Deep Cat' }]),
        })),
      })
      mockPoolQuery.mockResolvedValueOnce({ rows: [] })

      const result = await service.createCategory('company-1', {
        name: 'Deep Cat',
        parent_id: 'cat-level2',
      })

      expect(result.name).toBe('Deep Cat')
    })

    it('BLOCKS 4th level category creation', async () => {
      skipMigrations()

      // Check parent: exists, has parent_id (level 3)
      mockDbRows([{ parent_id: 'cat-level2' }])

      // Check grandparent: has parent_id (level 2) => would create level 4
      mockDbRows([{ parent_id: 'cat-root' }])

      await expect(
        service.createCategory('company-1', {
          name: 'Too Deep',
          parent_id: 'cat-level3',
        })
      ).rejects.toThrow('Maximo 3 niveles de profundidad en categorias')
    })
  })

  // =============================================
  // CATEGORY WITH PRODUCTS
  // =============================================

  describe('deleteCategory', () => {
    it('unlinks products from deleted category', async () => {
      const operations: string[] = []

      mockDbExecute.mockImplementation((...args: any[]) => {
        const tpl = args[0]
        const sqlStr = tpl?.strings ? tpl.strings.join('') : ''

        if (sqlStr.includes("SELECT COUNT(*) as count FROM products WHERE category_id")) {
          return Promise.resolve({ rows: [{ count: '3' }] }) // has products
        }
        if (sqlStr.includes("SELECT COUNT(*) as count FROM categories WHERE parent_id")) {
          return Promise.resolve({ rows: [{ count: '0' }] }) // no children
        }
        if (sqlStr.includes('DELETE FROM categories')) {
          operations.push('DELETE')
          return Promise.resolve({ rows: [] })
        }
        return Promise.resolve({ rows: [] })
      })

      // Mock drizzle update for unlinking products
      ;(db.update as any).mockReturnValueOnce({
        set: vi.fn(() => ({
          where: vi.fn(() => {
            operations.push('UNLINK_PRODUCTS')
            return Promise.resolve()
          }),
        })),
      })

      const result = await service.deleteCategory('company-1', 'cat-1')

      expect(result.success).toBe(true)
      expect(operations).toContain('UNLINK_PRODUCTS')
      expect(operations).toContain('DELETE')
    })

    it('reparents children when deleting category with subcategories', async () => {
      const operations: string[] = []

      mockDbExecute.mockImplementation((...args: any[]) => {
        const tpl = args[0]
        const sqlStr = tpl?.strings ? tpl.strings.join('') : ''

        if (sqlStr.includes("SELECT COUNT(*) as count FROM products WHERE category_id")) {
          return Promise.resolve({ rows: [{ count: '0' }] }) // no products
        }
        if (sqlStr.includes("SELECT COUNT(*) as count FROM categories WHERE parent_id")) {
          return Promise.resolve({ rows: [{ count: '2' }] }) // has 2 children
        }
        if (sqlStr.includes("SELECT parent_id FROM categories WHERE id")) {
          return Promise.resolve({ rows: [{ parent_id: 'cat-grandparent' }] })
        }
        if (sqlStr.includes('UPDATE categories SET parent_id')) {
          operations.push('REPARENT')
          return Promise.resolve({ rows: [] })
        }
        if (sqlStr.includes('DELETE FROM categories')) {
          operations.push('DELETE')
          return Promise.resolve({ rows: [] })
        }
        return Promise.resolve({ rows: [] })
      })

      const result = await service.deleteCategory('company-1', 'cat-parent')

      expect(result.success).toBe(true)
      expect(operations).toContain('REPARENT')
      expect(operations).toContain('DELETE')
      expect(operations.indexOf('REPARENT')).toBeLessThan(operations.indexOf('DELETE'))
    })

    it('deletes empty category without children', async () => {
      mockByContent({
        "SELECT COUNT(*) as count FROM products WHERE category_id": { rows: [{ count: '0' }] },
        "SELECT COUNT(*) as count FROM categories WHERE parent_id": { rows: [{ count: '0' }] },
        'DELETE FROM categories': { rows: [] },
      })

      const result = await service.deleteCategory('company-1', 'cat-1')
      expect(result.success).toBe(true)
    })
  })

  // =============================================
  // CATEGORY REORDER
  // =============================================

  describe('reorderCategories', () => {
    it('updates sort_order correctly', async () => {
      skipMigrations()

      const updates: { id: string; order: number }[] = []
      mockPoolQuery.mockImplementation((...args: any[]) => {
        const [query, params] = args
        if (query.includes('UPDATE categories SET sort_order')) {
          updates.push({ id: params[1], order: params[0] })
        }
        return Promise.resolve({ rows: [] })
      })

      const result = await service.reorderCategories('company-1', ['cat-3', 'cat-1', 'cat-2'])

      expect(result.success).toBe(true)
      expect(updates).toHaveLength(3)
      expect(updates[0]).toEqual({ id: 'cat-3', order: 0 })
      expect(updates[1]).toEqual({ id: 'cat-1', order: 1 })
      expect(updates[2]).toEqual({ id: 'cat-2', order: 2 })
    })
  })

  // =============================================
  // PRODUCT COUNT INCLUDES CHILDREN
  // =============================================

  describe('getCategories', () => {
    it('returns product_count and child_product_count', async () => {
      skipMigrations()

      mockDbRows([
        {
          id: 'cat-parent', name: 'Electronics', parent_id: null,
          product_count: '5', child_product_count: '12',
          default_vat_rate: '21.00', default_margin_percent: '30.00',
          default_supplier_id: null, sort_order: 0, color: null,
        },
        {
          id: 'cat-child', name: 'Phones', parent_id: 'cat-parent',
          product_count: '8', child_product_count: '0',
          default_vat_rate: null, default_margin_percent: null,
          default_supplier_id: null, sort_order: 1, color: '#FF0000',
        },
      ])

      const result = await service.getCategories('company-1')

      expect(result).toHaveLength(2)
      expect(result[0].product_count).toBe('5')
      expect(result[0].child_product_count).toBe('12')
      expect(result[1].parent_id).toBe('cat-parent')
    })
  })

  // =============================================
  // UPDATE CATEGORY
  // =============================================

  describe('updateCategory', () => {
    it('updates defaults correctly', async () => {
      skipMigrations()

      const executedParams: any[] = []

      mockDbExecute.mockImplementation((...args: any[]) => {
        const tpl = args[0]
        const sqlStr = tpl?.strings ? tpl.strings.join('') : ''

        if (sqlStr.includes('SELECT id FROM categories WHERE id')) {
          return Promise.resolve({ rows: [{ id: 'cat-1' }] })
        }
        return Promise.resolve({ rows: [] })
      })

      mockPoolQuery.mockImplementation((...args: any[]) => {
        executedParams.push(args)
        return Promise.resolve({ rows: [] })
      })

      const result = await service.updateCategory('company-1', 'cat-1', {
        name: 'Updated Cat',
        default_vat_rate: 10.5,
        default_margin_percent: 40,
        color: '#FF0000',
        sort_order: 5,
      })

      expect(result.success).toBe(true)
      // Verify pool.query was called with UPDATE
      expect(mockPoolQuery).toHaveBeenCalled()
      const updateCall = mockPoolQuery.mock.calls[0]
      expect(updateCall[0]).toContain('UPDATE categories SET')
    })

    it('throws 404 when category not found', async () => {
      skipMigrations()

      mockByContent({
        'SELECT id FROM categories WHERE id': { rows: [] },
      })

      await expect(
        service.updateCategory('company-1', 'nonexistent', { name: 'X' })
      ).rejects.toThrow('Category not found')
    })

    it('allows setting default_vat_rate to null', async () => {
      skipMigrations()

      mockDbExecute.mockImplementation((...args: any[]) => {
        const tpl = args[0]
        const sqlStr = tpl?.strings ? tpl.strings.join('') : ''

        if (sqlStr.includes('SELECT id FROM categories WHERE id')) {
          return Promise.resolve({ rows: [{ id: 'cat-1' }] })
        }
        return Promise.resolve({ rows: [] })
      })

      mockPoolQuery.mockImplementation((...args: any[]) => {
        return Promise.resolve({ rows: [] })
      })

      const result = await service.updateCategory('company-1', 'cat-1', {
        default_vat_rate: null,
      })

      expect(result.success).toBe(true)
      // Verify null is passed as parameter
      const updateCall = mockPoolQuery.mock.calls[0]
      expect(updateCall[1]).toContain(null)
    })
  })
})
