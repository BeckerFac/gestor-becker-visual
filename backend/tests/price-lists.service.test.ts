import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mockDbExecute, mockDbRows, mockDbEmpty, mockDbVoid, resetMocks } from './helpers/setup'

import { PriceListsService } from '../src/modules/price-lists/price-lists.service'

describe('PriceListsService', () => {
  let service: PriceListsService

  beforeEach(() => {
    resetMocks()
    service = new PriceListsService()
    vi.clearAllMocks()
  })

  // Helper: match SQL content to return specific results (robust against migration calls)
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
  // RULE CREATION
  // =============================================

  describe('addRule', () => {
    it('creates a percentage rule', async () => {
      mockByContent({
        'SELECT id FROM price_lists WHERE id': { rows: [{ id: 'pl-1' }] },
        'INSERT INTO price_list_rules': { rows: [] },
        'SELECT plr.*': { rows: [{
          id: 'rule-1', price_list_id: 'pl-1', product_id: null, category_id: null,
          rule_type: 'percentage', value: '-10.00', min_quantity: 1, priority: 0,
          product_name: null, product_sku: null, category_name: null,
        }] },
      })

      const result = await service.addRule('company-1', 'pl-1', {
        rule_type: 'percentage',
        value: -10,
      })

      expect(result).toBeDefined()
      expect(result.rule_type).toBe('percentage')
      expect(parseFloat(result.value)).toBe(-10)
    })

    it('creates a fixed rule', async () => {
      mockByContent({
        'SELECT id FROM price_lists WHERE id': { rows: [{ id: 'pl-1' }] },
        'INSERT INTO price_list_rules': { rows: [] },
        'SELECT plr.*': { rows: [{
          id: 'rule-2', price_list_id: 'pl-1', product_id: 'prod-1', category_id: null,
          rule_type: 'fixed', value: '800.00', min_quantity: 1, priority: 0,
          product_name: 'Widget', product_sku: 'W-001', category_name: null,
        }] },
      })

      const result = await service.addRule('company-1', 'pl-1', {
        product_id: 'prod-1',
        rule_type: 'fixed',
        value: 800,
      })

      expect(result.rule_type).toBe('fixed')
      expect(parseFloat(result.value)).toBe(800)
      expect(result.product_id).toBe('prod-1')
    })

    it('creates a formula rule', async () => {
      mockByContent({
        'SELECT id FROM price_lists WHERE id': { rows: [{ id: 'pl-1' }] },
        'INSERT INTO price_list_rules': { rows: [] },
        'SELECT plr.*': { rows: [{
          id: 'rule-3', price_list_id: 'pl-1', product_id: null, category_id: 'cat-1',
          rule_type: 'formula', value: '1.50', min_quantity: 1, priority: 0,
          product_name: null, product_sku: null, category_name: 'Electronics',
        }] },
      })

      const result = await service.addRule('company-1', 'pl-1', {
        category_id: 'cat-1',
        rule_type: 'formula',
        value: 1.5,
      })

      expect(result.rule_type).toBe('formula')
      expect(parseFloat(result.value)).toBe(1.5)
      expect(result.category_id).toBe('cat-1')
    })

    it('rejects invalid rule_type', async () => {
      mockByContent({
        'SELECT id FROM price_lists WHERE id': { rows: [{ id: 'pl-1' }] },
      })

      await expect(
        service.addRule('company-1', 'pl-1', {
          rule_type: 'invalid',
          value: 10,
        })
      ).rejects.toThrow('rule_type must be percentage, fixed, or formula')
    })

    it('throws 404 when price list not found', async () => {
      mockByContent({
        'SELECT id FROM price_lists WHERE id': { rows: [] },
      })

      await expect(
        service.addRule('company-1', 'nonexistent', {
          rule_type: 'percentage',
          value: -10,
        })
      ).rejects.toThrow('Price list not found')
    })

    it('preserves min_quantity=0 (applies always)', async () => {
      let insertedMinQty: any = null
      mockDbExecute.mockImplementation((...args: any[]) => {
        const tpl = args[0]
        const sqlStr = tpl?.strings ? tpl.strings.join('') : ''

        if (sqlStr.includes('SELECT id FROM price_lists WHERE id')) {
          return Promise.resolve({ rows: [{ id: 'pl-1' }] })
        }
        if (sqlStr.includes('INSERT INTO price_list_rules')) {
          // Capture min_quantity from the values
          if (tpl?.values) {
            insertedMinQty = tpl.values[6] // min_quantity is 7th value (index 6)
          }
          return Promise.resolve({ rows: [] })
        }
        if (sqlStr.includes('SELECT plr.*')) {
          return Promise.resolve({ rows: [{
            id: 'rule-1', rule_type: 'percentage', value: '-5', min_quantity: 0,
          }] })
        }
        return Promise.resolve({ rows: [] })
      })

      await service.addRule('company-1', 'pl-1', {
        rule_type: 'percentage',
        value: -5,
        min_quantity: 0,
      })

      // BUG FIX: min_quantity=0 should be preserved (not converted to 1)
      // The ternary check uses !== undefined && !== null, so 0 passes through
      expect(insertedMinQty).toBe(0)
    })
  })

  // =============================================
  // PRICE RESOLUTION - CORE 10 SCENARIOS
  // =============================================

  describe('resolvePrice', () => {
    // TEST 1: Percentage rule
    it('percentage rule: base $1000, rule -10% => resolved $900', async () => {
      mockByContent({
        'FROM products p': { rows: [{
          id: 'prod-1', name: 'Widget', category_id: 'cat-1',
          cost: '500.00', margin_percent: '30.00', vat_rate: '21.00', final_price: '1000.00',
        }] },
        'SELECT name FROM price_lists WHERE id': { rows: [{ name: 'Lista Mayorista' }] },
        'SELECT price, discount_percent FROM price_list_items': { rows: [] },
        'FROM price_list_rules plr': { rows: [{
          id: 'rule-1', product_id: null, category_id: null,
          rule_type: 'percentage', value: '-10', min_quantity: 1, priority: 0,
          active: true, category_name: null,
        }] },
        'SELECT parent_id FROM categories WHERE id': { rows: [] },
      })

      const result = await service.resolvePrice('company-1', 'pl-1', 'prod-1', 1)

      expect(result.base_price).toBe(1000)
      expect(result.resolved_price).toBe(900)
      expect(result.discount_percent).toBe(10)
      expect(result.price_list_name).toBe('Lista Mayorista')
      expect(result.rule_applied).toContain('-10%')
    })

    // TEST 2: Fixed rule
    it('fixed rule: base $1000, fixed $800 => resolved $800', async () => {
      mockByContent({
        'FROM products p': { rows: [{
          id: 'prod-1', name: 'Widget', category_id: null,
          cost: '500.00', margin_percent: '30.00', vat_rate: '21.00', final_price: '1000.00',
        }] },
        'SELECT name FROM price_lists WHERE id': { rows: [{ name: 'Lista Especial' }] },
        'SELECT price, discount_percent FROM price_list_items': { rows: [] },
        'FROM price_list_rules plr': { rows: [{
          id: 'rule-2', product_id: 'prod-1', category_id: null,
          rule_type: 'fixed', value: '800', min_quantity: 1, priority: 0,
          active: true, category_name: null,
        }] },
      })

      const result = await service.resolvePrice('company-1', 'pl-1', 'prod-1', 1)

      expect(result.base_price).toBe(1000)
      expect(result.resolved_price).toBe(800)
      expect(result.discount_percent).toBe(20) // (1000-800)/1000 * 100
      expect(result.rule_applied).toContain('Precio fijo')
    })

    // TEST 3: Formula rule
    it('formula rule: cost $500, formula 1.5 => cost*1.5 + IVA', async () => {
      mockByContent({
        'FROM products p': { rows: [{
          id: 'prod-1', name: 'Widget', category_id: null,
          cost: '500.00', margin_percent: '30.00', vat_rate: '21.00', final_price: '1000.00',
        }] },
        'SELECT name FROM price_lists WHERE id': { rows: [{ name: 'Lista Formula' }] },
        'SELECT price, discount_percent FROM price_list_items': { rows: [] },
        'FROM price_list_rules plr': { rows: [{
          id: 'rule-3', product_id: null, category_id: null,
          rule_type: 'formula', value: '1.5', min_quantity: 1, priority: 0,
          active: true, category_name: null,
        }] },
      })

      const result = await service.resolvePrice('company-1', 'pl-1', 'prod-1', 1)

      // formula: cost * coefficient * (1 + vat/100)
      // 500 * 1.5 = 750 * 1.21 = 907.50
      expect(result.base_price).toBe(1000)
      expect(result.resolved_price).toBe(907.5)
      expect(result.rule_applied).toContain('Costo x 1.5')
    })

    // TEST 4: Quantity breaks
    it('quantity breaks: qty 1 = base, qty 100 = discounted', async () => {
      // For qty=1, only min_quantity<=1 rules match
      mockByContent({
        'FROM products p': { rows: [{
          id: 'prod-1', name: 'Widget', category_id: null,
          cost: '500.00', margin_percent: '30.00', vat_rate: '21.00', final_price: '1000.00',
        }] },
        'SELECT name FROM price_lists WHERE id': { rows: [{ name: 'Lista Qty' }] },
        'SELECT price, discount_percent FROM price_list_items': { rows: [] },
        'FROM price_list_rules plr': { rows: [] }, // no rules for qty=1
      })

      const result1 = await service.resolvePrice('company-1', 'pl-1', 'prod-1', 1)
      expect(result1.resolved_price).toBe(1000) // base price, no discount

      // Now qty=100 - rule with min_quantity=50 applies
      resetMocks()
      mockByContent({
        'FROM products p': { rows: [{
          id: 'prod-1', name: 'Widget', category_id: null,
          cost: '500.00', margin_percent: '30.00', vat_rate: '21.00', final_price: '1000.00',
        }] },
        'SELECT name FROM price_lists WHERE id': { rows: [{ name: 'Lista Qty' }] },
        'SELECT price, discount_percent FROM price_list_items': { rows: [] },
        'FROM price_list_rules plr': { rows: [{
          id: 'rule-qty', product_id: null, category_id: null,
          rule_type: 'percentage', value: '-15', min_quantity: 50, priority: 0,
          active: true, category_name: null,
        }] },
      })

      // Need to re-instantiate to clear migrationsRun flag
      service = new PriceListsService()
      const result100 = await service.resolvePrice('company-1', 'pl-1', 'prod-1', 100)
      expect(result100.resolved_price).toBe(850) // 1000 * (1 - 15/100)
    })

    // TEST 5: Specificity (product > category > global)
    it('specificity: product rule wins over category, category wins over global', async () => {
      mockByContent({
        'FROM products p': { rows: [{
          id: 'prod-1', name: 'Widget', category_id: 'cat-1',
          cost: '500.00', margin_percent: '30.00', vat_rate: '21.00', final_price: '1000.00',
        }] },
        'SELECT name FROM price_lists WHERE id': { rows: [{ name: 'Lista Mix' }] },
        'SELECT price, discount_percent FROM price_list_items': { rows: [] },
        'FROM price_list_rules plr': { rows: [
          // All three specificity levels returned (query returns all active rules)
          { id: 'r-product', product_id: 'prod-1', category_id: null, rule_type: 'percentage', value: '-20', min_quantity: 1, priority: 0, active: true, category_name: null },
          { id: 'r-category', product_id: null, category_id: 'cat-1', rule_type: 'percentage', value: '-10', min_quantity: 1, priority: 0, active: true, category_name: 'Electronics' },
          { id: 'r-global', product_id: null, category_id: null, rule_type: 'percentage', value: '-5', min_quantity: 1, priority: 0, active: true, category_name: null },
        ] },
        'SELECT parent_id FROM categories WHERE id': { rows: [{ parent_id: null }] },
      })

      const result = await service.resolvePrice('company-1', 'pl-1', 'prod-1', 1)

      // Product rule wins: -20%
      expect(result.resolved_price).toBe(800) // 1000 * 0.80
      expect(result.rule_applied).toContain('-20%')
      expect(result.rule_applied).toContain('producto')
    })

    it('specificity: category rule wins when no product rule exists', async () => {
      mockByContent({
        'FROM products p': { rows: [{
          id: 'prod-1', name: 'Widget', category_id: 'cat-1',
          cost: '500.00', margin_percent: '30.00', vat_rate: '21.00', final_price: '1000.00',
        }] },
        'SELECT name FROM price_lists WHERE id': { rows: [{ name: 'Lista Cat' }] },
        'SELECT price, discount_percent FROM price_list_items': { rows: [] },
        'FROM price_list_rules plr': { rows: [
          { id: 'r-category', product_id: null, category_id: 'cat-1', rule_type: 'percentage', value: '-10', min_quantity: 1, priority: 0, active: true, category_name: 'Electronics' },
          { id: 'r-global', product_id: null, category_id: null, rule_type: 'percentage', value: '-5', min_quantity: 1, priority: 0, active: true, category_name: null },
        ] },
        'SELECT parent_id FROM categories WHERE id': { rows: [{ parent_id: null }] },
      })

      const result = await service.resolvePrice('company-1', 'pl-1', 'prod-1', 1)

      // Category rule wins: -10%
      expect(result.resolved_price).toBe(900) // 1000 * 0.90
      expect(result.rule_applied).toContain('-10%')
      expect(result.rule_applied).toContain('cat:')
    })

    // TEST 6: No rules = base price
    it('no rules: returns base price', async () => {
      mockByContent({
        'FROM products p': { rows: [{
          id: 'prod-1', name: 'Widget', category_id: null,
          cost: '500.00', margin_percent: '30.00', vat_rate: '21.00', final_price: '1000.00',
        }] },
        'SELECT name FROM price_lists WHERE id': { rows: [{ name: 'Lista Vacia' }] },
        'SELECT price, discount_percent FROM price_list_items': { rows: [] },
        'FROM price_list_rules plr': { rows: [] },
      })

      const result = await service.resolvePrice('company-1', 'pl-1', 'prod-1', 1)

      expect(result.resolved_price).toBe(1000)
      expect(result.base_price).toBe(1000)
      expect(result.discount_percent).toBe(0)
      expect(result.rule_applied).toBeNull()
    })

    // TEST 7: Enterprise without price list = base price
    it('enterprise without price list: returns base price', async () => {
      mockByContent({
        'FROM products p': { rows: [{
          id: 'prod-1', name: 'Widget', category_id: null,
          cost: '500.00', margin_percent: '30.00', vat_rate: '21.00', final_price: '1000.00',
        }] },
      })

      // No priceListId = '' (empty string), should return base price
      const result = await service.resolvePrice('company-1', '', 'prod-1', 1)

      expect(result.resolved_price).toBe(1000)
      expect(result.rule_applied).toBeNull()
      expect(result.price_list_name).toBeNull()
    })

    // BUG FIX TEST: Product with cost=0 and price=0 does not crash
    it('product with cost=0 and price=0: handles gracefully, returns 0 not NaN', async () => {
      mockByContent({
        'FROM products p': { rows: [{
          id: 'prod-zero', name: 'Free', category_id: null,
          cost: '0.00', margin_percent: '0.00', vat_rate: '21.00', final_price: '0.00',
        }] },
        'SELECT name FROM price_lists WHERE id': { rows: [{ name: 'Lista Test' }] },
        'SELECT price, discount_percent FROM price_list_items': { rows: [] },
        'FROM price_list_rules plr': { rows: [{
          id: 'rule-pct', product_id: null, category_id: null,
          rule_type: 'percentage', value: '-10', min_quantity: 1, priority: 0,
          active: true, category_name: null,
        }] },
      })

      const result = await service.resolvePrice('company-1', 'pl-1', 'prod-zero', 1)

      // base=0, 0 * 0.9 = 0
      expect(result.resolved_price).toBe(0)
      expect(result.base_price).toBe(0)
      // discount_percent should be 0 (not NaN), because basePrice > 0 check guards it
      expect(result.discount_percent).toBe(0)
      expect(Number.isNaN(result.discount_percent)).toBe(false)
    })

    it('product with cost=0: formula rule returns 0', async () => {
      mockByContent({
        'FROM products p': { rows: [{
          id: 'prod-zero', name: 'Free', category_id: null,
          cost: '0.00', margin_percent: '0.00', vat_rate: '21.00', final_price: '0.00',
        }] },
        'SELECT name FROM price_lists WHERE id': { rows: [{ name: 'Lista Test' }] },
        'SELECT price, discount_percent FROM price_list_items': { rows: [] },
        'FROM price_list_rules plr': { rows: [{
          id: 'rule-formula', product_id: null, category_id: null,
          rule_type: 'formula', value: '1.5', min_quantity: 1, priority: 0,
          active: true, category_name: null,
        }] },
      })

      const result = await service.resolvePrice('company-1', 'pl-1', 'prod-zero', 1)

      // formula: 0 * 1.5 * 1.21 = 0
      expect(result.resolved_price).toBe(0)
      expect(Number.isNaN(result.resolved_price)).toBe(false)
    })

    it('product with cost=0: fixed rule still works', async () => {
      mockByContent({
        'FROM products p': { rows: [{
          id: 'prod-zero', name: 'Free', category_id: null,
          cost: '0.00', margin_percent: '0.00', vat_rate: '21.00', final_price: '0.00',
        }] },
        'SELECT name FROM price_lists WHERE id': { rows: [{ name: 'Lista Test' }] },
        'SELECT price, discount_percent FROM price_list_items': { rows: [] },
        'FROM price_list_rules plr': { rows: [{
          id: 'rule-fixed', product_id: null, category_id: null,
          rule_type: 'fixed', value: '500', min_quantity: 1, priority: 0,
          active: true, category_name: null,
        }] },
      })

      const result = await service.resolvePrice('company-1', 'pl-1', 'prod-zero', 1)

      expect(result.resolved_price).toBe(500)
      // discount_percent: (0-500)/0 would be NaN, but guarded by basePrice > 0 check
      expect(result.discount_percent).toBe(0)
      expect(Number.isNaN(result.discount_percent)).toBe(false)
    })

    // BUG FIX TEST: Negative percentage = discount, positive = markup
    it('negative percentage (discount) works correctly: -10% on $1000 = $900', async () => {
      mockByContent({
        'FROM products p': { rows: [{
          id: 'prod-1', name: 'Widget', category_id: null,
          cost: '500.00', margin_percent: '30.00', vat_rate: '21.00', final_price: '1000.00',
        }] },
        'SELECT name FROM price_lists WHERE id': { rows: [{ name: 'Lista Desc' }] },
        'SELECT price, discount_percent FROM price_list_items': { rows: [] },
        'FROM price_list_rules plr': { rows: [{
          id: 'rule-disc', product_id: null, category_id: null,
          rule_type: 'percentage', value: '-10', min_quantity: 1, priority: 0,
          active: true, category_name: null,
        }] },
      })

      const result = await service.resolvePrice('company-1', 'pl-1', 'prod-1', 1)

      expect(result.resolved_price).toBe(900)
      // discount_percent is positive (it IS a discount)
      expect(result.discount_percent).toBe(10)
    })

    it('positive percentage (markup) works correctly: +15% on $1000 = $1150', async () => {
      mockByContent({
        'FROM products p': { rows: [{
          id: 'prod-1', name: 'Widget', category_id: null,
          cost: '500.00', margin_percent: '30.00', vat_rate: '21.00', final_price: '1000.00',
        }] },
        'SELECT name FROM price_lists WHERE id': { rows: [{ name: 'Lista Markup' }] },
        'SELECT price, discount_percent FROM price_list_items': { rows: [] },
        'FROM price_list_rules plr': { rows: [{
          id: 'rule-markup', product_id: null, category_id: null,
          rule_type: 'percentage', value: '15', min_quantity: 1, priority: 0,
          active: true, category_name: null,
        }] },
      })

      const result = await service.resolvePrice('company-1', 'pl-1', 'prod-1', 1)

      // +15% markup: 1000 * 1.15 = 1150
      expect(result.resolved_price).toBe(1150)
      // discount_percent is negative (it's a markup, not a discount)
      expect(result.discount_percent).toBe(-15)
    })

    it('formula with coefficient < 1: price below cost is allowed', async () => {
      mockByContent({
        'FROM products p': { rows: [{
          id: 'prod-1', name: 'Widget', category_id: null,
          cost: '500.00', margin_percent: '30.00', vat_rate: '21.00', final_price: '1000.00',
        }] },
        'SELECT name FROM price_lists WHERE id': { rows: [{ name: 'Lista Baja' }] },
        'SELECT price, discount_percent FROM price_list_items': { rows: [] },
        'FROM price_list_rules plr': { rows: [{
          id: 'rule-low', product_id: null, category_id: null,
          rule_type: 'formula', value: '0.8', min_quantity: 1, priority: 0,
          active: true, category_name: null,
        }] },
      })

      const result = await service.resolvePrice('company-1', 'pl-1', 'prod-1', 1)

      // formula: 500 * 0.8 = 400 * 1.21 = 484
      expect(result.resolved_price).toBe(484)
      // This is below cost (500), but the system allows it
      expect(result.resolved_price).toBeLessThan(500)
    })

    // BUG FIX TEST: Two rules same priority - deterministic tiebreaker
    it('two rules with same priority: deterministic tiebreaker by created_at/id', async () => {
      mockByContent({
        'FROM products p': { rows: [{
          id: 'prod-1', name: 'Widget', category_id: null,
          cost: '500.00', margin_percent: '30.00', vat_rate: '21.00', final_price: '1000.00',
        }] },
        'SELECT name FROM price_lists WHERE id': { rows: [{ name: 'Lista Dup' }] },
        'SELECT price, discount_percent FROM price_list_items': { rows: [] },
        'FROM price_list_rules plr': { rows: [
          // Both global, same priority, same min_quantity
          // ORDER BY priority DESC, min_quantity DESC, created_at ASC, id ASC
          // First by sort order wins deterministically
          { id: 'r-1', product_id: null, category_id: null, rule_type: 'percentage', value: '-10', min_quantity: 1, priority: 0, active: true, category_name: null, created_at: '2024-01-01' },
          { id: 'r-2', product_id: null, category_id: null, rule_type: 'percentage', value: '-20', min_quantity: 1, priority: 0, active: true, category_name: null, created_at: '2024-01-02' },
        ] },
      })

      const result = await service.resolvePrice('company-1', 'pl-1', 'prod-1', 1)

      // First rule in array wins (matchingRules[0]) - deterministic via ORDER BY ... created_at ASC, id ASC
      expect(result.resolved_price).toBe(900) // -10%
    })

    it('product not found: throws 404', async () => {
      mockByContent({
        'FROM products p': { rows: [] },
      })

      await expect(
        service.resolvePrice('company-1', 'pl-1', 'nonexistent', 1)
      ).rejects.toThrow('Product not found')
    })

    it('inactive price list: returns base price', async () => {
      mockByContent({
        'FROM products p': { rows: [{
          id: 'prod-1', name: 'Widget', category_id: null,
          cost: '500.00', margin_percent: '30.00', vat_rate: '21.00', final_price: '1000.00',
        }] },
        'SELECT name FROM price_lists WHERE id': { rows: [] }, // active = true filter excludes it
      })

      const result = await service.resolvePrice('company-1', 'pl-inactive', 'prod-1', 1)

      expect(result.resolved_price).toBe(1000)
      expect(result.rule_applied).toBeNull()
      expect(result.price_list_name).toBeNull()
    })

    // BUG FIX TEST: Category rule for parent applies to products in subcategories
    it('parent category rule applies to products in subcategories', async () => {
      // Product is in cat-child, rule is for cat-parent (parent of cat-child)
      let parentLookupCount = 0
      mockDbExecute.mockImplementation((...args: any[]) => {
        const tpl = args[0]
        const sqlStr = tpl?.strings ? tpl.strings.join('') : ''

        // Migration calls
        if (sqlStr.includes('ALTER TABLE') || sqlStr.includes('CREATE TABLE') || sqlStr.includes('CREATE INDEX')) {
          return Promise.resolve({ rows: [] })
        }
        // Product lookup
        if (sqlStr.includes('FROM products p') && sqlStr.includes('LEFT JOIN product_pricing')) {
          return Promise.resolve({ rows: [{
            id: 'prod-1', name: 'Widget', category_id: 'cat-child',
            cost: '500.00', margin_percent: '30.00', vat_rate: '21.00', final_price: '1000.00',
          }] })
        }
        // Price list name
        if (sqlStr.includes('SELECT name FROM price_lists WHERE id')) {
          return Promise.resolve({ rows: [{ name: 'Lista Herencia' }] })
        }
        // Legacy items
        if (sqlStr.includes('SELECT price, discount_percent FROM price_list_items')) {
          return Promise.resolve({ rows: [] })
        }
        // Rules: only a rule for cat-parent exists, no rule for cat-child
        if (sqlStr.includes('FROM price_list_rules plr')) {
          return Promise.resolve({ rows: [
            { id: 'r-parent-cat', product_id: null, category_id: 'cat-parent', rule_type: 'percentage', value: '-12', min_quantity: 1, priority: 0, active: true, category_name: 'Electronics' },
            { id: 'r-global', product_id: null, category_id: null, rule_type: 'percentage', value: '-5', min_quantity: 1, priority: 0, active: true, category_name: null },
          ] })
        }
        // Parent category lookup (for subcategory inheritance)
        if (sqlStr.includes('SELECT parent_id FROM categories WHERE id')) {
          parentLookupCount++
          if (parentLookupCount === 1) {
            // cat-child's parent is cat-parent
            return Promise.resolve({ rows: [{ parent_id: 'cat-parent' }] })
          }
          // cat-parent has no parent
          return Promise.resolve({ rows: [{ parent_id: null }] })
        }
        return Promise.resolve({ rows: [] })
      })

      const result = await service.resolvePrice('company-1', 'pl-1', 'prod-1', 1)

      // Parent category rule should apply: -12%
      expect(result.resolved_price).toBe(880) // 1000 * 0.88
      expect(result.rule_applied).toContain('-12%')
      expect(result.rule_applied).toContain('cat:')
    })
  })

  // =============================================
  // LEGACY COMPATIBILITY
  // =============================================

  describe('legacy price_list_items', () => {
    // TEST 10: Legacy compatibility
    it('old price_list_items still work and take precedence over rules', async () => {
      mockByContent({
        'FROM products p': { rows: [{
          id: 'prod-1', name: 'Widget', category_id: null,
          cost: '500.00', margin_percent: '30.00', vat_rate: '21.00', final_price: '1000.00',
        }] },
        'SELECT name FROM price_lists WHERE id': { rows: [{ name: 'Lista Legacy' }] },
        'SELECT price, discount_percent FROM price_list_items': { rows: [{
          price: '850.00', discount_percent: '15.00',
        }] },
        // Rules exist but should NOT be evaluated because legacy item was found
        'FROM price_list_rules plr': { rows: [{
          id: 'rule-1', product_id: null, category_id: null,
          rule_type: 'percentage', value: '-50', min_quantity: 1, priority: 0,
          active: true, category_name: null,
        }] },
      })

      const result = await service.resolvePrice('company-1', 'pl-1', 'prod-1', 1)

      expect(result.resolved_price).toBe(850)
      expect(result.rule_applied).toBe('Precio fijo (legacy)')
    })

    it('legacy item with base=0: discount_percent is 0, not NaN', async () => {
      mockByContent({
        'FROM products p': { rows: [{
          id: 'prod-zero', name: 'Free', category_id: null,
          cost: '0.00', margin_percent: '0.00', vat_rate: '0.00', final_price: '0.00',
        }] },
        'SELECT name FROM price_lists WHERE id': { rows: [{ name: 'Lista Legacy' }] },
        'SELECT price, discount_percent FROM price_list_items': { rows: [{
          price: '100.00', discount_percent: '0.00',
        }] },
      })

      const result = await service.resolvePrice('company-1', 'pl-1', 'prod-zero', 1)

      expect(result.resolved_price).toBe(100)
      // basePrice=0, so (0-100)/0 would be -Infinity, but guard returns 0
      expect(result.discount_percent).toBe(0)
      expect(Number.isFinite(result.discount_percent)).toBe(true)
    })
  })

  // =============================================
  // BULK OPERATIONS
  // =============================================

  describe('bulkUpdateRules', () => {
    // TEST 8: Bulk increase all rules by X%
    it('increase_percent: updates fixed rules and legacy items', async () => {
      const updatedOperations: string[] = []

      mockDbExecute.mockImplementation((...args: any[]) => {
        const tpl = args[0]
        const sqlStr = tpl?.strings ? tpl.strings.join('') : ''

        if (sqlStr.includes('SELECT id FROM price_lists WHERE id')) {
          return Promise.resolve({ rows: [{ id: 'pl-1' }] })
        }
        if (sqlStr.includes('UPDATE price_list_rules SET')) {
          updatedOperations.push('rules')
          return Promise.resolve({ rows: [] })
        }
        if (sqlStr.includes('UPDATE price_list_items SET')) {
          updatedOperations.push('items')
          return Promise.resolve({ rows: [] })
        }
        if (sqlStr.includes('SELECT') && sqlStr.includes('rule_count')) {
          return Promise.resolve({ rows: [{ rule_count: '3', item_count: '2' }] })
        }
        return Promise.resolve({ rows: [] })
      })

      const result = await service.bulkUpdateRules('company-1', 'pl-1', {
        type: 'increase_percent',
        percent: 10,
      })

      expect(result.success).toBe(true)
      expect(result.updated).toBe(5)
      expect(result.operation).toBe('increase_percent')
      expect(updatedOperations).toContain('rules')
      expect(updatedOperations).toContain('items')
    })

    it('increase_percent with percent=0 now works (bug fix: falsy check replaced)', async () => {
      const updatedOperations: string[] = []

      mockDbExecute.mockImplementation((...args: any[]) => {
        const tpl = args[0]
        const sqlStr = tpl?.strings ? tpl.strings.join('') : ''

        if (sqlStr.includes('SELECT id FROM price_lists WHERE id')) {
          return Promise.resolve({ rows: [{ id: 'pl-1' }] })
        }
        if (sqlStr.includes('UPDATE price_list_rules SET')) {
          updatedOperations.push('rules')
          return Promise.resolve({ rows: [] })
        }
        if (sqlStr.includes('UPDATE price_list_items SET')) {
          updatedOperations.push('items')
          return Promise.resolve({ rows: [] })
        }
        if (sqlStr.includes('SELECT') && sqlStr.includes('rule_count')) {
          return Promise.resolve({ rows: [{ rule_count: '1', item_count: '0' }] })
        }
        return Promise.resolve({ rows: [] })
      })

      // BUG FIX: percent=0 is now accepted (no longer falsy-checked)
      // Multiplier = 1 + 0/100 = 1.0 (no change, but operation runs)
      const result = await service.bulkUpdateRules('company-1', 'pl-1', {
        type: 'increase_percent',
        percent: 0,
      })

      expect(result.success).toBe(true)
      expect(result.operation).toBe('increase_percent')
      expect(result.percent).toBe(0)
    })

    // TEST 9: Bulk copy rules between lists with markup
    it('copy_from_list: copies rules with markup adjustment', async () => {
      let copiedRules: any[] = []

      mockDbExecute.mockImplementation((...args: any[]) => {
        const tpl = args[0]
        const sqlStr = tpl?.strings ? tpl.strings.join('') : ''

        if (sqlStr.includes('SELECT id FROM price_lists WHERE id')) {
          return Promise.resolve({ rows: [{ id: 'pl-1' }] })
        }
        if (sqlStr.includes('DELETE FROM price_list_rules WHERE')) {
          return Promise.resolve({ rows: [] })
        }
        if (sqlStr.includes('SELECT * FROM price_list_rules WHERE price_list_id')) {
          return Promise.resolve({ rows: [
            { id: 'src-r1', product_id: 'prod-1', category_id: null, rule_type: 'fixed', value: '800.00', min_quantity: 1, priority: 0 },
            { id: 'src-r2', product_id: null, category_id: null, rule_type: 'percentage', value: '-15.00', min_quantity: 1, priority: 0 },
          ] })
        }
        if (sqlStr.includes('INSERT INTO price_list_rules')) {
          copiedRules.push(tpl.values)
          return Promise.resolve({ rows: [] })
        }
        return Promise.resolve({ rows: [] })
      })

      const result = await service.bulkUpdateRules('company-1', 'pl-1', {
        type: 'copy_from_list',
        source_list_id: 'pl-source',
        markup_percent: 5,
      })

      expect(result.success).toBe(true)
      expect(result.copied).toBe(2)
      expect(copiedRules).toHaveLength(2)
    })

    it('copy_from_list adjusts fixed values by markup', async () => {
      let insertedValues: any[] = []

      mockDbExecute.mockImplementation((...args: any[]) => {
        const tpl = args[0]
        const sqlStr = tpl?.strings ? tpl.strings.join('') : ''

        if (sqlStr.includes('SELECT id FROM price_lists WHERE id')) {
          return Promise.resolve({ rows: [{ id: 'pl-1' }] })
        }
        if (sqlStr.includes('DELETE FROM price_list_rules')) {
          return Promise.resolve({ rows: [] })
        }
        if (sqlStr.includes('SELECT * FROM price_list_rules WHERE price_list_id')) {
          return Promise.resolve({ rows: [
            { id: 'src-r1', product_id: null, category_id: null, rule_type: 'fixed', value: '1000.00', min_quantity: 1, priority: 0 },
          ] })
        }
        if (sqlStr.includes('INSERT INTO price_list_rules')) {
          insertedValues = tpl.values
          return Promise.resolve({ rows: [] })
        }
        return Promise.resolve({ rows: [] })
      })

      await service.bulkUpdateRules('company-1', 'pl-1', {
        type: 'copy_from_list',
        source_list_id: 'pl-source',
        markup_percent: 10,
      })

      // Fixed rule: 1000 * 1.10 = 1100
      const valueParam = insertedValues?.find((v: any) => typeof v === 'string' && v.includes('1100'))
      expect(valueParam).toBeDefined()
    })

    it('copy_from_list adjusts percentage rules by adding markup', async () => {
      let insertedValue: string | null = null

      mockDbExecute.mockImplementation((...args: any[]) => {
        const tpl = args[0]
        const sqlStr = tpl?.strings ? tpl.strings.join('') : ''

        if (sqlStr.includes('SELECT id FROM price_lists WHERE id')) {
          return Promise.resolve({ rows: [{ id: 'pl-1' }] })
        }
        if (sqlStr.includes('DELETE FROM price_list_rules')) {
          return Promise.resolve({ rows: [] })
        }
        if (sqlStr.includes('SELECT * FROM price_list_rules WHERE price_list_id')) {
          return Promise.resolve({ rows: [
            { id: 'src-r1', product_id: null, category_id: null, rule_type: 'percentage', value: '-15.00', min_quantity: 1, priority: 0 },
          ] })
        }
        if (sqlStr.includes('INSERT INTO price_list_rules')) {
          // value is at index 5 in the INSERT values
          insertedValue = tpl.values?.[5]
          return Promise.resolve({ rows: [] })
        }
        return Promise.resolve({ rows: [] })
      })

      await service.bulkUpdateRules('company-1', 'pl-1', {
        type: 'copy_from_list',
        source_list_id: 'pl-source',
        markup_percent: 5,
      })

      // Percentage rule: -15 + 5 = -10
      expect(insertedValue).toBe('-10.00')
    })

    it('throws 404 when target list not found', async () => {
      mockByContent({
        'SELECT id FROM price_lists WHERE id': { rows: [] },
      })

      await expect(
        service.bulkUpdateRules('company-1', 'nonexistent', {
          type: 'increase_percent',
          percent: 10,
        })
      ).rejects.toThrow('Price list not found')
    })

    it('throws 404 when source list not found (copy)', async () => {
      let callNum = 0
      mockDbExecute.mockImplementation((...args: any[]) => {
        const tpl = args[0]
        const sqlStr = tpl?.strings ? tpl.strings.join('') : ''

        if (sqlStr.includes('SELECT id FROM price_lists WHERE id')) {
          callNum++
          if (callNum === 1) return Promise.resolve({ rows: [{ id: 'pl-1' }] }) // target found
          return Promise.resolve({ rows: [] }) // source not found
        }
        return Promise.resolve({ rows: [] })
      })

      await expect(
        service.bulkUpdateRules('company-1', 'pl-1', {
          type: 'copy_from_list',
          source_list_id: 'nonexistent',
        })
      ).rejects.toThrow('Source price list not found')
    })
  })

  // =============================================
  // ENTERPRISE LINKING
  // =============================================

  describe('getProductPriceForEnterprise', () => {
    it('resolves price for enterprise with linked price list', async () => {
      mockByContent({
        'SELECT price_list_id FROM enterprises WHERE id': { rows: [{ price_list_id: 'pl-1' }] },
        'FROM products p': { rows: [{
          id: 'prod-1', name: 'Widget', category_id: null,
          cost: '500.00', margin_percent: '30.00', vat_rate: '21.00', final_price: '1000.00',
        }] },
        'SELECT name FROM price_lists WHERE id': { rows: [{ name: 'Lista Empresa' }] },
        'SELECT price, discount_percent FROM price_list_items': { rows: [] },
        'FROM price_list_rules plr': { rows: [{
          id: 'rule-1', product_id: null, category_id: null,
          rule_type: 'percentage', value: '-10', min_quantity: 1, priority: 0,
          active: true, category_name: null,
        }] },
      })

      const result = await service.getProductPriceForEnterprise('company-1', 'prod-1', 'ent-1')

      expect(result).toBeDefined()
      expect(result!.resolved_price).toBe(900)
      expect(result!.price_list_name).toBe('Lista Empresa')
    })

    it('returns null for enterprise without price list', async () => {
      mockByContent({
        'SELECT price_list_id FROM enterprises WHERE id': { rows: [{ price_list_id: null }] },
      })

      const result = await service.getProductPriceForEnterprise('company-1', 'prod-1', 'ent-1')
      expect(result).toBeNull()
    })

    it('returns null for nonexistent enterprise', async () => {
      mockByContent({
        'SELECT price_list_id FROM enterprises WHERE id': { rows: [] },
      })

      const result = await service.getProductPriceForEnterprise('company-1', 'prod-1', 'nonexistent')
      expect(result).toBeNull()
    })
  })

  describe('linkEnterpriseToList', () => {
    it('links enterprise to price list', async () => {
      mockByContent({
        'SELECT id FROM enterprises WHERE id': { rows: [{ id: 'ent-1' }] },
        'SELECT id FROM price_lists WHERE id': { rows: [{ id: 'pl-1' }] },
        'UPDATE enterprises SET price_list_id': { rows: [] },
      })

      const result = await service.linkEnterpriseToList('company-1', 'ent-1', 'pl-1')
      expect(result.success).toBe(true)
    })

    it('unlinks enterprise from price list (null)', async () => {
      mockByContent({
        'SELECT id FROM enterprises WHERE id': { rows: [{ id: 'ent-1' }] },
        'UPDATE enterprises SET price_list_id': { rows: [] },
      })

      const result = await service.linkEnterpriseToList('company-1', 'ent-1', null)
      expect(result.success).toBe(true)
    })

    it('throws 404 for nonexistent enterprise', async () => {
      mockByContent({
        'SELECT id FROM enterprises WHERE id': { rows: [] },
      })

      await expect(
        service.linkEnterpriseToList('company-1', 'nonexistent', 'pl-1')
      ).rejects.toThrow('Enterprise not found')
    })

    it('throws 404 for nonexistent price list', async () => {
      let callNum = 0
      mockDbExecute.mockImplementation((...args: any[]) => {
        const tpl = args[0]
        const sqlStr = tpl?.strings ? tpl.strings.join('') : ''

        if (sqlStr.includes('SELECT id FROM enterprises WHERE id')) {
          return Promise.resolve({ rows: [{ id: 'ent-1' }] })
        }
        if (sqlStr.includes('SELECT id FROM price_lists WHERE id')) {
          return Promise.resolve({ rows: [] }) // not found
        }
        return Promise.resolve({ rows: [] })
      })

      await expect(
        service.linkEnterpriseToList('company-1', 'ent-1', 'nonexistent')
      ).rejects.toThrow('Price list not found')
    })
  })

  // =============================================
  // UPDATE RULE BUG FIXES
  // =============================================

  describe('updateRule', () => {
    it('preserves min_quantity=0 (bug fix: was converted to 1 by || operator)', async () => {
      let updatedMinQty: any = null

      mockDbExecute.mockImplementation((...args: any[]) => {
        const tpl = args[0]
        const sqlStr = tpl?.strings ? tpl.strings.join('') : ''

        // Ownership check
        if (sqlStr.includes('SELECT plr.id FROM price_list_rules plr')) {
          return Promise.resolve({ rows: [{ id: 'rule-1' }] })
        }
        // UPDATE SET: product_id(0), category_id(1), rule_type(2), value(3), min_quantity(4), priority(5), active(6), ruleId(7)
        if (sqlStr.includes('UPDATE price_list_rules SET')) {
          if (tpl?.values) {
            updatedMinQty = tpl.values[4]
          }
          return Promise.resolve({ rows: [] })
        }
        return Promise.resolve({ rows: [] })
      })

      await service.updateRule('company-1', 'pl-1', 'rule-1', {
        rule_type: 'percentage',
        value: -10,
        min_quantity: 0,
        priority: 0,
      })

      // BUG FIX: min_quantity=0 should be preserved, not converted to 1
      expect(updatedMinQty).toBe(0)
    })

    it('preserves priority=0 (bug fix: was converted to default by || operator)', async () => {
      let updatedPriority: any = null

      mockDbExecute.mockImplementation((...args: any[]) => {
        const tpl = args[0]
        const sqlStr = tpl?.strings ? tpl.strings.join('') : ''

        if (sqlStr.includes('SELECT plr.id FROM price_list_rules plr')) {
          return Promise.resolve({ rows: [{ id: 'rule-1' }] })
        }
        if (sqlStr.includes('UPDATE price_list_rules SET')) {
          if (tpl?.values) {
            // UPDATE SET: product_id(0), category_id(1), rule_type(2), value(3), min_quantity(4), priority(5), active(6), ruleId(7)
            updatedPriority = tpl.values[5]
          }
          return Promise.resolve({ rows: [] })
        }
        return Promise.resolve({ rows: [] })
      })

      await service.updateRule('company-1', 'pl-1', 'rule-1', {
        rule_type: 'percentage',
        value: -10,
        min_quantity: 1,
        priority: 0,
      })

      expect(updatedPriority).toBe(0)
    })
  })

  // =============================================
  // CRUD OPERATIONS
  // =============================================

  describe('getPriceLists', () => {
    it('returns list with counts', async () => {
      mockByContent({
        'FROM price_lists pl': { rows: [
          { id: 'pl-1', name: 'Lista A', item_count: '5', rule_count: '3', enterprise_count: '2' },
          { id: 'pl-2', name: 'Lista B', item_count: '0', rule_count: '1', enterprise_count: '0' },
        ] },
      })

      const result = await service.getPriceLists('company-1')
      expect(result).toHaveLength(2)
      expect(result[0].name).toBe('Lista A')
      expect(result[0].rule_count).toBe('3')
    })
  })

  describe('createPriceList', () => {
    it('creates price list and returns it', async () => {
      mockByContent({
        'INSERT INTO price_lists': { rows: [] },
        'SELECT * FROM price_lists WHERE id': { rows: [{
          id: 'pl-new', name: 'Nueva Lista', type: 'customer', active: true,
        }] },
      })

      const result = await service.createPriceList('company-1', {
        name: 'Nueva Lista',
        type: 'customer',
      })

      expect(result.name).toBe('Nueva Lista')
      expect(result.type).toBe('customer')
    })
  })

  describe('deletePriceList', () => {
    it('unlinks enterprises before deleting', async () => {
      const operations: string[] = []

      mockDbExecute.mockImplementation((...args: any[]) => {
        const tpl = args[0]
        const sqlStr = tpl?.strings ? tpl.strings.join('') : ''

        if (sqlStr.includes('SELECT id FROM price_lists WHERE id')) {
          return Promise.resolve({ rows: [{ id: 'pl-1' }] })
        }
        if (sqlStr.includes('UPDATE enterprises SET price_list_id = NULL')) {
          operations.push('UNLINK')
          return Promise.resolve({ rows: [] })
        }
        if (sqlStr.includes('DELETE FROM price_lists')) {
          operations.push('DELETE')
          return Promise.resolve({ rows: [] })
        }
        return Promise.resolve({ rows: [] })
      })

      const result = await service.deletePriceList('company-1', 'pl-1')

      expect(result.success).toBe(true)
      expect(operations).toContain('UNLINK')
      expect(operations).toContain('DELETE')
      expect(operations.indexOf('UNLINK')).toBeLessThan(operations.indexOf('DELETE'))
    })

    it('throws 404 when not found', async () => {
      mockByContent({
        'SELECT id FROM price_lists WHERE id': { rows: [] },
      })

      await expect(
        service.deletePriceList('company-1', 'nonexistent')
      ).rejects.toThrow('Price list not found')
    })
  })
})
