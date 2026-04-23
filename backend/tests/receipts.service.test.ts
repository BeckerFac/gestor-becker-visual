import { describe, it, expect, beforeEach } from 'vitest'
import { mockDbExecute, mockDbRows, mockDbEmpty, mockDbVoid, mockClientQuery, resetMocks } from './helpers/setup'

import { ReceiptsService } from '../src/modules/receipts/receipts.service'

describe('ReceiptsService', () => {
  let service: ReceiptsService

  beforeEach(() => {
    resetMocks()
    service = new ReceiptsService()
  })

  // Helper: mock migration calls (CREATE TABLE x2 + ALTER TABLE x5 + migration check + unmigrated cobros check)
  function mockMigrations() {
    mockDbVoid() // CREATE TABLE receipts
    mockDbVoid() // CREATE TABLE receipt_items
    mockDbVoid() // ALTER TABLE enterprise_id
    mockDbVoid() // ALTER TABLE bank_id
    mockDbVoid() // ALTER TABLE reference
    mockDbVoid() // ALTER TABLE cheques cobro_id
    mockDbVoid() // ALTER TABLE cobros migrated_to_receipt
    mockDbRows([{ cnt: '0' }]) // migration check: no cobros migrated yet
    mockDbRows([]) // unmigrated cobros: none found
  }

  describe('createReceipt', () => {
    it('creates receipt with single invoice item', async () => {
      mockMigrations()
      // next number
      mockDbRows([{ next_number: '1' }])
      // BEGIN
      mockDbVoid()
      // INSERT receipt
      mockDbVoid()
      // INSERT receipt_item
      mockDbVoid()
      // SELECT invoice for cobro
      mockDbRows([{ enterprise_id: 'ent-1', order_id: 'order-1' }])
      // INSERT cobro
      mockDbVoid()
      // COMMIT
      mockDbVoid()

      const result = await service.createReceipt('company-1', 'user-1', {
        receipt_date: '2025-01-15',
        payment_method: 'efectivo',
        items: [{ invoice_id: 'inv-1', amount: '1500.00' }],
      })

      expect(result).toHaveProperty('id')
      expect(result.receipt_number).toBe(1)
      expect(result.total_amount).toBe(1500)
    })

    it('creates receipt with multiple invoice items (partial payments)', async () => {
      mockMigrations()
      // Wave 3A: MAX, BEGIN, INSERTs, COMMIT all go through mockClientQuery.
      mockClientQuery.mockImplementation((sqlStr: string) => {
        const s = String(sqlStr)
        if (/COALESCE\(MAX\(receipt_number/.test(s)) return Promise.resolve({ rows: [{ next_number: '5' }] })
        if (/FROM invoices WHERE id/.test(s)) return Promise.resolve({ rows: [{ enterprise_id: 'ent-1', order_id: 'order-1' }] })
        return Promise.resolve({ rows: [] })
      })

      const result = await service.createReceipt('company-1', 'user-1', {
        receipt_date: '2025-01-15',
        payment_method: 'transferencia',
        items: [
          { invoice_id: 'inv-1', amount: '500.00' },
          { invoice_id: 'inv-2', amount: '750.00' },
        ],
      })

      expect(result.total_amount).toBe(1250)
      expect(result.receipt_number).toBe(5)
    })

    it('creates simple receipt without invoice items (direct amount)', async () => {
      mockMigrations()
      mockClientQuery.mockImplementation((sqlStr: string) => {
        const s = String(sqlStr)
        if (/COALESCE\(MAX\(receipt_number/.test(s)) return Promise.resolve({ rows: [{ next_number: '3' }] })
        return Promise.resolve({ rows: [] })
      })

      const result = await service.createReceipt('company-1', 'user-1', {
        receipt_date: '2025-01-20',
        payment_method: 'efectivo',
        amount: 2500,
        enterprise_id: 'ent-1',
      })

      expect(result).toHaveProperty('id')
      expect(result.receipt_number).toBe(3)
      expect(result.total_amount).toBe(2500)
    })

    it('uses transaction (BEGIN/COMMIT)', async () => {
      mockMigrations()

      const clientCalls: string[] = []
      mockClientQuery.mockImplementation((sqlStr: string) => {
        const s = String(sqlStr).trim()
        if (/^BEGIN/i.test(s)) clientCalls.push('BEGIN')
        if (/^COMMIT/i.test(s)) clientCalls.push('COMMIT')
        if (/COALESCE\(MAX\(receipt_number/.test(s)) return Promise.resolve({ rows: [{ next_number: '1' }] })
        if (/FROM invoices WHERE id/.test(s)) return Promise.resolve({ rows: [{ enterprise_id: null, order_id: null }] })
        return Promise.resolve({ rows: [] })
      })

      await service.createReceipt('company-1', 'user-1', {
        items: [{ invoice_id: 'inv-1', amount: '100' }],
      })

      expect(clientCalls).toContain('BEGIN')
      expect(clientCalls).toContain('COMMIT')
    })

    it('rolls back on failure (ROLLBACK)', async () => {
      mockMigrations()

      const clientCalls: string[] = []
      mockClientQuery.mockImplementation((sqlStr: string) => {
        const s = String(sqlStr).trim()
        if (/^BEGIN/i.test(s)) clientCalls.push('BEGIN')
        if (/^ROLLBACK/i.test(s)) clientCalls.push('ROLLBACK')
        if (/COALESCE\(MAX\(receipt_number/.test(s)) return Promise.resolve({ rows: [{ next_number: '1' }] })
        if (/INSERT INTO receipts/.test(s)) return Promise.reject(new Error('DB connection lost'))
        return Promise.resolve({ rows: [] })
      })

      await expect(
        service.createReceipt('company-1', 'user-1', {
          items: [{ invoice_id: 'inv-1', amount: '100' }],
        })
      ).rejects.toThrow()

      expect(clientCalls).toContain('BEGIN')
      expect(clientCalls).toContain('ROLLBACK')
    })

    it('throws error with empty items array and no amount', async () => {
      mockMigrations()

      await expect(
        service.createReceipt('company-1', 'user-1', { items: [] })
      ).rejects.toThrow('El recibo debe tener un monto mayor a 0')
    })

    it('throws error with missing items and no amount', async () => {
      mockMigrations()

      await expect(
        service.createReceipt('company-1', 'user-1', {})
      ).rejects.toThrow('El recibo debe tener un monto mayor a 0')
    })

    it('throws error when item has zero amount', async () => {
      mockMigrations()

      await expect(
        service.createReceipt('company-1', 'user-1', {
          items: [{ invoice_id: 'inv-1', amount: '0' }],
        })
      ).rejects.toThrow('Cada item debe tener un monto mayor a 0')
    })

    it('throws error when item missing invoice_id', async () => {
      mockMigrations()

      await expect(
        service.createReceipt('company-1', 'user-1', {
          items: [{ amount: '100' }],
        })
      ).rejects.toThrow('Cada item debe tener una factura asociada')
    })

    it('auto-generates sequential receipt_number', async () => {
      mockMigrations()
      mockClientQuery.mockImplementation((sqlStr: string) => {
        const s = String(sqlStr)
        if (/COALESCE\(MAX\(receipt_number/.test(s)) return Promise.resolve({ rows: [{ next_number: '42' }] })
        if (/FROM invoices WHERE id/.test(s)) return Promise.resolve({ rows: [{ enterprise_id: null, order_id: null }] })
        return Promise.resolve({ rows: [] })
      })

      const result = await service.createReceipt('company-1', 'user-1', {
        items: [{ invoice_id: 'inv-1', amount: '100' }],
      })

      expect(result.receipt_number).toBe(42)
    })
  })

  describe('deleteReceipt', () => {
    it('deletes receipt and cascade deletes cobros', async () => {
      mockMigrations()
      // Verify receipt exists
      mockDbRows([{ id: 'receipt-1', receipt_number: 5 }])
      // DELETE cobros (invoice-based)
      mockDbVoid()
      // DELETE cobros (simple, no invoice)
      mockDbVoid()
      // DELETE receipt_items
      mockDbVoid()
      // DELETE receipt
      mockDbVoid()

      const result = await service.deleteReceipt('company-1', 'receipt-1')
      expect(result.deleted).toBe(true)
    })

    it('throws 404 when receipt not found', async () => {
      mockMigrations()
      mockDbEmpty()

      await expect(
        service.deleteReceipt('company-1', 'nonexistent')
      ).rejects.toThrow('Recibo no encontrado')
    })
  })

  describe('getReceipts', () => {
    it('returns receipts list', async () => {
      mockMigrations()
      mockDbRows([
        { id: 'r1', receipt_number: 1, total_amount: '1000', items: [] },
        { id: 'r2', receipt_number: 2, total_amount: '2000', items: [] },
      ])

      const result = await service.getReceipts('company-1')
      expect(result).toHaveLength(2)
    })
  })
})
