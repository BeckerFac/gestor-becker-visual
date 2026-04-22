import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  mockDbExecute,
  mockDbRows,
  mockDbEmpty,
  mockDbVoid,
  mockClientQuery,
  mockPoolQuery,
  resetMocks,
} from './helpers/setup'

import { PurchasesService } from '../src/modules/purchases/purchases.service'

// Helpers: the service hits db.execute() many times in ensureTables() + validateTenantRefs().
// We push enough void responses to "drain" those bookkeeping calls, then push the
// interesting row responses for the assertion-worthy queries.
function drainEnsureTables() {
  // CREATE TABLE purchases, CREATE TABLE purchase_items, ALTER product_id,
  // ALTER vat_rate, ALTER stock_added, ALTER business_unit_id, CREATE INDEX
  for (let i = 0; i < 7; i++) mockDbVoid()
}

describe('PurchasesService', () => {
  let service: PurchasesService

  beforeEach(() => {
    resetMocks()
    service = new PurchasesService()
  })

  // ------------------------------------------------------------------
  // C1 — Tenant isolation (IDOR defense)
  // ------------------------------------------------------------------
  describe('C1 — tenant validation (IDOR)', () => {
    it('rejects enterprise_id from another company', async () => {
      drainEnsureTables()
      mockDbEmpty() // validateTenantRefs: enterprises lookup -> empty

      await expect(
        service.createPurchase('company-A', 'user-1', {
          enterprise_id: 'enterprise-from-company-B',
          items: [{ product_name: 'X', quantity: 1, unit_price: 100 }],
        })
      ).rejects.toThrow(/Proveedor no encontrado/)
    })

    it('rejects bank_id from another company', async () => {
      drainEnsureTables()
      mockDbRows([{ id: 'enterprise-ok' }]) // enterprise found
      mockDbEmpty() // bank lookup -> empty (cross-tenant)

      await expect(
        service.createPurchase('company-A', 'user-1', {
          enterprise_id: 'enterprise-ok',
          bank_id: 'bank-from-company-B',
          items: [{ product_name: 'X', quantity: 1, unit_price: 100 }],
        })
      ).rejects.toThrow(/Banco no encontrado/)
    })

    it('rejects product_id in items when product belongs to another company', async () => {
      drainEnsureTables()
      mockDbRows([{ id: 'enterprise-ok' }]) // enterprise
      // no bank_id, no business_unit_id
      // products lookup now uses pool.query (was drizzle sql`` which broke
      // JS array → PG uuid[] coercion). Returns no matching product ids.
      mockPoolQuery.mockResolvedValueOnce({ rows: [] })
      // Note: the service then iterates productIds and throws for the first missing.

      await expect(
        service.createPurchase('company-A', 'user-1', {
          enterprise_id: 'enterprise-ok',
          items: [
            { product_name: 'X', product_id: '00000000-0000-0000-0000-00000000beef', quantity: 1, unit_price: 100 },
          ],
        })
      ).rejects.toThrow(/Producto .* no encontrado en tu empresa/)
    })
  })

  // ------------------------------------------------------------------
  // C2 — Numeric validation
  // ------------------------------------------------------------------
  describe('C2 — numeric validation', () => {
    it('rejects negative quantity', async () => {
      drainEnsureTables()
      // validateTenantRefs: no enterprise/bank/business_unit, no product_ids → no DB calls.
      // Auto-default BU lookup:
      mockDbRows([]) // business_units default lookup

      await expect(
        service.createPurchase('company-A', 'user-1', {
          items: [{ product_name: 'X', quantity: -5, unit_price: 100 }],
        })
      ).rejects.toThrow(/Cantidad no puede ser menor/)
    })

    it('rejects NaN unit_price', async () => {
      drainEnsureTables()
      mockDbRows([]) // default BU lookup

      await expect(
        service.createPurchase('company-A', 'user-1', {
          items: [{ product_name: 'X', quantity: 1, unit_price: 'abc' }],
        })
      ).rejects.toThrow(/Precio unitario invalido/)
    })
  })

  // ------------------------------------------------------------------
  // C3 — vat_rate per item respected (not hardcoded 21%)
  // ------------------------------------------------------------------
  describe('C3 — per-item vat_rate', () => {
    it('persists vat_rate=10.5 and computes total accordingly', async () => {
      drainEnsureTables()
      mockDbRows([]) // default BU lookup

      // Capture all client.query calls so we can assert the INSERT params
      const captured: Array<{ sql: string; params: any[] }> = []
      mockClientQuery.mockImplementation((sqlStr: string, params?: any[]) => {
        captured.push({ sql: String(sqlStr), params: params || [] })
        // Respond appropriately based on query
        if (/COALESCE\(MAX\(purchase_number/.test(String(sqlStr))) {
          return Promise.resolve({ rows: [{ next_number: '1' }] })
        }
        return Promise.resolve({ rows: [] })
      })

      // After TX: getPurchase() → db.execute for header + items
      mockDbRows([{ id: 'p-1', company_id: 'company-A', total_amount: '110.50' }])
      mockDbRows([{ id: 'i-1', vat_rate: '10.50', quantity: '1', unit_price: '100', subtotal: '100' }])

      const result = await service.createPurchase('company-A', 'user-1', {
        items: [{ product_name: 'Libro', quantity: 1, unit_price: 100, vat_rate: 10.5 }],
      })

      // BEGIN, advisory lock, number query, INSERT purchase, INSERT item, COMMIT
      const purchaseInsert = captured.find(c => /INSERT INTO purchases/.test(c.sql))
      const itemInsert = captured.find(c => /INSERT INTO purchase_items/.test(c.sql))

      expect(purchaseInsert).toBeDefined()
      expect(itemInsert).toBeDefined()

      // purchase INSERT: params (positions): 9=subtotal, 10=vat_amount, 11=total
      expect(purchaseInsert!.params[8]).toBe('100')           // subtotal
      expect(purchaseInsert!.params[9]).toBe('10.5')          // vat_amount
      expect(purchaseInsert!.params[10]).toBe('110.5')        // total

      // item INSERT: params 6=quantity, 7=unit_price, 8=vat_rate, 9=subtotal  (0-indexed: [5],[6],[7],[8])
      expect(itemInsert!.params[5]).toBe(1)     // quantity
      expect(itemInsert!.params[6]).toBe(100)   // unit_price
      expect(itemInsert!.params[7]).toBe(10.5)  // vat_rate <-- KEY ASSERTION
      expect(itemInsert!.params[8]).toBe(100)   // subtotal

      expect(result).toBeDefined()
    })

    it('computes mixed vat rates correctly (21% + 10.5% + 0%)', async () => {
      drainEnsureTables()
      mockDbRows([]) // default BU lookup

      const captured: Array<{ sql: string; params: any[] }> = []
      mockClientQuery.mockImplementation((sqlStr: string, params?: any[]) => {
        captured.push({ sql: String(sqlStr), params: params || [] })
        if (/COALESCE\(MAX\(purchase_number/.test(String(sqlStr))) {
          return Promise.resolve({ rows: [{ next_number: '1' }] })
        }
        return Promise.resolve({ rows: [] })
      })

      mockDbRows([{ id: 'p-1', total_amount: '331' }])
      mockDbRows([])

      await service.createPurchase('company-A', 'user-1', {
        items: [
          { product_name: 'A', quantity: 1, unit_price: 100, vat_rate: 21 },   // 100 + 21 = 121
          { product_name: 'B', quantity: 2, unit_price: 50, vat_rate: 10.5 },  // 100 + 10.5 = 110.5
          { product_name: 'C', quantity: 1, unit_price: 100, vat_rate: 0 },    //  100 +  0  = 100
        ],
      })

      const purchaseInsert = captured.find(c => /INSERT INTO purchases/.test(c.sql))!
      // subtotal = 100 + 100 + 100 = 300
      // vat = 21 + 10.5 + 0 = 31.5
      // total = 331.5
      expect(purchaseInsert.params[8]).toBe('300')
      expect(purchaseInsert.params[9]).toBe('31.5')
      expect(purchaseInsert.params[10]).toBe('331.5')
    })
  })

  // ------------------------------------------------------------------
  // C4 — real TX with advisory lock on SAME client
  // ------------------------------------------------------------------
  describe('C4 — advisory lock runs on pooled client', () => {
    it('issues BEGIN, advisory_xact_lock, number SELECT, INSERTs, COMMIT on one client', async () => {
      drainEnsureTables()
      mockDbRows([]) // default BU lookup

      const calls: string[] = []
      mockClientQuery.mockImplementation((sqlStr: string) => {
        calls.push(String(sqlStr).trim().split('\n')[0])
        if (/COALESCE\(MAX\(purchase_number/.test(String(sqlStr))) {
          return Promise.resolve({ rows: [{ next_number: '7' }] })
        }
        return Promise.resolve({ rows: [] })
      })

      mockDbRows([{ id: 'p-1' }])
      mockDbRows([])

      await service.createPurchase('company-A', 'user-1', {
        items: [{ product_name: 'X', quantity: 1, unit_price: 100 }],
      })

      // Order matters
      const beginIdx = calls.findIndex(c => /^BEGIN/.test(c))
      const lockIdx = calls.findIndex(c => /pg_advisory_xact_lock/.test(c))
      const insertIdx = calls.findIndex(c => /INSERT INTO purchases/.test(c))
      const commitIdx = calls.findIndex(c => /^COMMIT/.test(c))

      expect(beginIdx).toBeGreaterThanOrEqual(0)
      expect(lockIdx).toBeGreaterThan(beginIdx)
      expect(insertIdx).toBeGreaterThan(lockIdx)
      expect(commitIdx).toBeGreaterThan(insertIdx)
    })
  })

  // ------------------------------------------------------------------
  // C5 — business_unit_id column is declared in ensureTables
  // ------------------------------------------------------------------
  describe('C5 — ensureTables adds business_unit_id', () => {
    it('runs ALTER TABLE purchases ADD COLUMN IF NOT EXISTS business_unit_id', async () => {
      const executed: string[] = []
      mockDbExecute.mockImplementation((tpl: any) => {
        if (tpl?.strings) executed.push(tpl.strings.join(' '))
        else if (tpl?.raw) executed.push(tpl.raw)
        return Promise.resolve({ rows: [] })
      })

      await service.ensureTables()

      const joined = executed.join(' | ')
      expect(joined).toMatch(/ADD COLUMN IF NOT EXISTS business_unit_id/)
      expect(joined).toMatch(/CREATE INDEX IF NOT EXISTS idx_purchases_business_unit/)
    })
  })

  // ------------------------------------------------------------------
  // C6 — deletePurchase: guards + stock revert
  // ------------------------------------------------------------------
  describe('C6 — deletePurchase guards and stock revert', () => {
    it('throws 409 when linked non-cancelled purchase_invoice exists', async () => {
      drainEnsureTables()

      mockClientQuery.mockImplementation((sqlStr: string) => {
        const s = String(sqlStr)
        if (/BEGIN/.test(s)) return Promise.resolve({ rows: [] })
        if (/FOR UPDATE/.test(s)) return Promise.resolve({ rows: [{ id: 'p-1', stock_added: false, payment_status: 'pendiente' }] })
        if (/purchase_invoices WHERE purchase_id/.test(s)) return Promise.resolve({ rows: [{ c: 1 }] })
        if (/pago_invoice_applications/.test(s)) return Promise.resolve({ rows: [{ c: 0 }] })
        return Promise.resolve({ rows: [] })
      })

      await expect(
        service.deletePurchase('company-A', 'p-1', 'user-1')
      ).rejects.toThrow(/factura\(s\) de compra asociada/)
    })

    it('throws 409 when applied pagos exist', async () => {
      drainEnsureTables()

      mockClientQuery.mockImplementation((sqlStr: string) => {
        const s = String(sqlStr)
        if (/FOR UPDATE/.test(s)) return Promise.resolve({ rows: [{ id: 'p-1', stock_added: false }] })
        if (/purchase_invoices WHERE purchase_id/.test(s)) return Promise.resolve({ rows: [{ c: 0 }] })
        if (/pago_invoice_applications/.test(s)) return Promise.resolve({ rows: [{ c: 2 }] })
        return Promise.resolve({ rows: [] })
      })

      await expect(
        service.deletePurchase('company-A', 'p-1', 'user-1')
      ).rejects.toThrow(/pagos aplicados/)
    })

    it('reverts stock with return_supplier movement when stock_added=true', async () => {
      drainEnsureTables()

      const captured: Array<{ sql: string; params: any[] }> = []
      mockClientQuery.mockImplementation((sqlStr: string, params?: any[]) => {
        const s = String(sqlStr)
        captured.push({ sql: s, params: params || [] })
        if (/FOR UPDATE/.test(s) && /FROM purchases/.test(s)) {
          return Promise.resolve({ rows: [{ id: 'p-1', stock_added: true, payment_status: 'pendiente' }] })
        }
        if (/purchase_invoices WHERE purchase_id/.test(s)) return Promise.resolve({ rows: [{ c: 0 }] })
        if (/pago_invoice_applications/.test(s)) return Promise.resolve({ rows: [{ c: 0 }] })
        if (/FROM purchase_items WHERE purchase_id/.test(s)) {
          return Promise.resolve({ rows: [{ product_id: 'prod-1', quantity: '5' }] })
        }
        if (/FROM stock_movements/.test(s) && /reference_type = 'purchase'/.test(s)) {
          return Promise.resolve({ rows: [{ warehouse_id: 'wh-1' }] })
        }
        return Promise.resolve({ rows: [] })
      })

      const result = await service.deletePurchase('company-A', 'p-1', 'user-1')

      expect(result).toEqual({ success: true })

      const movementInsert = captured.find(c =>
        /INSERT INTO stock_movements/.test(c.sql) && /return_supplier/.test(c.sql)
      )
      expect(movementInsert).toBeDefined()
      expect(movementInsert!.params).toEqual(
        expect.arrayContaining(['company-A', 'prod-1', 'wh-1', 5])
      )

      // Stock decremented
      const stockUpdate = captured.find(c => /UPDATE stock/.test(c.sql))
      expect(stockUpdate).toBeDefined()

      // purchase deleted
      const delPurchase = captured.find(c => /DELETE FROM purchases/.test(c.sql))
      expect(delPurchase).toBeDefined()

      // COMMIT happened
      expect(captured.some(c => /^COMMIT/.test(c.sql.trim()))).toBe(true)
    })

    it('deletes a clean purchase (no linkage, no stock) successfully', async () => {
      drainEnsureTables()

      const calls: string[] = []
      mockClientQuery.mockImplementation((sqlStr: string) => {
        const s = String(sqlStr)
        calls.push(s.trim().split('\n')[0])
        if (/FOR UPDATE/.test(s) && /FROM purchases/.test(s)) {
          return Promise.resolve({ rows: [{ id: 'p-1', stock_added: false }] })
        }
        if (/purchase_invoices WHERE purchase_id/.test(s)) return Promise.resolve({ rows: [{ c: 0 }] })
        if (/pago_invoice_applications/.test(s)) return Promise.resolve({ rows: [{ c: 0 }] })
        return Promise.resolve({ rows: [] })
      })

      const result = await service.deletePurchase('company-A', 'p-1', 'user-1')
      expect(result).toEqual({ success: true })
      expect(calls.some(c => /DELETE FROM purchases/.test(c))).toBe(true)
      expect(calls.some(c => /^COMMIT/.test(c))).toBe(true)
    })
  })

  // ------------------------------------------------------------------
  // C7 — updatePurchase locked when linked to invoices/pagos
  // ------------------------------------------------------------------
  // ------------------------------------------------------------------
  // Wave 2A-3 / Bug 3 — POST purchase with retenciones[] succeeds (smoke).
  // Regression after Wave 1C fixed the missing retenciones.created_by column.
  // ------------------------------------------------------------------
  describe('Wave 2A-3: POST purchase with retenciones smoke test', () => {
    it('inserts retencion rows with created_by populated and does not 500', async () => {
      drainEnsureTables()
      mockDbRows([]) // default BU lookup

      const captured: Array<{ sql: string; params: any[] }> = []
      mockClientQuery.mockImplementation((sqlStr: string, params?: any[]) => {
        const s = String(sqlStr)
        captured.push({ sql: s, params: params || [] })
        if (/COALESCE\(MAX\(purchase_number/.test(s)) {
          return Promise.resolve({ rows: [{ next_number: '1' }] })
        }
        return Promise.resolve({ rows: [] })
      })

      mockDbRows([{ id: 'p-1', total_amount: '100' }])
      mockDbRows([])

      await service.createPurchase('company-A', 'user-42', {
        items: [{ product_name: 'X', quantity: 1, unit_price: 100, vat_rate: 0 }],
        retenciones: [
          // base 100 * 2% = 2 — within tolerance
          { type: 'ganancias', base_amount: 100, rate: 2, amount: 2 },
        ],
      })

      const retInsert = captured.find(c => /INSERT INTO retenciones/.test(c.sql))
      expect(retInsert).toBeDefined()
      // Position of created_by in the INSERT params (see purchases.service.ts):
      // [uuid, companyId, type, regime, enterprise_id, purchaseId,
      //  base(6), rate(7), amount(8), cert(9), date(10), period(11), created_by(12), jurisdiction(13)]
      expect(retInsert!.params[12]).toBe('user-42')
    })
  })

  describe('C7 — updatePurchase locked when invoiced/paid', () => {
    it('throws 409 when trying to change items on a purchase with linked invoice', async () => {
      drainEnsureTables()
      mockDbRows([{ id: 'p-1', purchase_number: 7 }]) // ownership check

      mockClientQuery.mockImplementation((sqlStr: string) => {
        const s = String(sqlStr)
        if (/purchase_invoices WHERE purchase_id/.test(s)) return Promise.resolve({ rows: [{ c: 1 }] })
        if (/pago_invoice_applications/.test(s)) return Promise.resolve({ rows: [{ c: 0 }] })
        return Promise.resolve({ rows: [] })
      })

      await expect(
        service.updatePurchase('company-A', 'p-1', 'user-1', {
          items: [{ product_name: 'X', quantity: 1, unit_price: 999 }],
          total_amount: 999,
        })
      ).rejects.toThrow(/factura\(s\).*pago\(s\)/)
    })
  })
})
