import { describe, it, expect, beforeEach } from 'vitest'
import { mockDbExecute, mockDbRows, mockDbEmpty, mockDbVoid, resetMocks } from './helpers/setup'

import { ReceiptsService } from '../src/modules/receipts/receipts.service'

describe('ReceiptsService', () => {
  let service: ReceiptsService

  beforeEach(() => {
    resetMocks()
    service = new ReceiptsService()
  })

  describe('createReceipt', () => {
    it('creates receipt with single invoice item', async () => {
      // migrations
      mockDbVoid() // CREATE TABLE receipts
      mockDbVoid() // CREATE TABLE receipt_items
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
      mockDbVoid() // CREATE receipts
      mockDbVoid() // CREATE receipt_items
      mockDbRows([{ next_number: '5' }])
      mockDbVoid() // BEGIN
      mockDbVoid() // INSERT receipt
      // First item
      mockDbVoid() // INSERT receipt_item
      mockDbRows([{ enterprise_id: 'ent-1', order_id: 'order-1' }]) // invoice lookup
      mockDbVoid() // INSERT cobro
      // Second item
      mockDbVoid() // INSERT receipt_item
      mockDbRows([{ enterprise_id: 'ent-2', order_id: 'order-2' }])
      mockDbVoid() // INSERT cobro
      mockDbVoid() // COMMIT

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

    it('uses transaction (BEGIN/COMMIT)', async () => {
      mockDbVoid() // CREATE receipts
      mockDbVoid() // CREATE receipt_items
      mockDbRows([{ next_number: '1' }])

      const executeCalls: string[] = []
      mockDbExecute.mockImplementation((...args: any[]) => {
        const tpl = args[0]
        if (tpl?.strings) {
          const first = tpl.strings[0] || ''
          if (first.includes('BEGIN')) executeCalls.push('BEGIN')
          if (first.includes('COMMIT')) executeCalls.push('COMMIT')
        }
        return Promise.resolve({ rows: [{ enterprise_id: null, order_id: null }] })
      })

      await service.createReceipt('company-1', 'user-1', {
        items: [{ invoice_id: 'inv-1', amount: '100' }],
      })

      expect(executeCalls).toContain('BEGIN')
      expect(executeCalls).toContain('COMMIT')
    })

    it('rolls back on failure (ROLLBACK)', async () => {
      mockDbVoid() // CREATE receipts
      mockDbVoid() // CREATE receipt_items
      mockDbRows([{ next_number: '1' }])

      const executeCalls: string[] = []
      let callIndex = 0
      mockDbExecute.mockImplementation((...args: any[]) => {
        callIndex++
        const tpl = args[0]
        if (tpl?.strings) {
          const first = tpl.strings[0] || ''
          if (first.includes('BEGIN')) executeCalls.push('BEGIN')
          if (first.includes('ROLLBACK')) executeCalls.push('ROLLBACK')
          if (first.includes('INSERT INTO receipts (')) {
            return Promise.reject(new Error('DB connection lost'))
          }
        }
        return Promise.resolve({ rows: [] })
      })

      await expect(
        service.createReceipt('company-1', 'user-1', {
          items: [{ invoice_id: 'inv-1', amount: '100' }],
        })
      ).rejects.toThrow()

      expect(executeCalls).toContain('BEGIN')
      expect(executeCalls).toContain('ROLLBACK')
    })

    it('throws error with empty items array', async () => {
      mockDbVoid() // CREATE receipts
      mockDbVoid() // CREATE receipt_items

      await expect(
        service.createReceipt('company-1', 'user-1', { items: [] })
      ).rejects.toThrow('El recibo debe tener al menos un item')
    })

    it('throws error with missing items', async () => {
      mockDbVoid()
      mockDbVoid()

      await expect(
        service.createReceipt('company-1', 'user-1', {})
      ).rejects.toThrow('El recibo debe tener al menos un item')
    })

    it('throws error when item has zero amount', async () => {
      mockDbVoid()
      mockDbVoid()

      await expect(
        service.createReceipt('company-1', 'user-1', {
          items: [{ invoice_id: 'inv-1', amount: '0' }],
        })
      ).rejects.toThrow('Cada item debe tener un monto mayor a 0')
    })

    it('throws error when item missing invoice_id', async () => {
      mockDbVoid()
      mockDbVoid()

      await expect(
        service.createReceipt('company-1', 'user-1', {
          items: [{ amount: '100' }],
        })
      ).rejects.toThrow('Cada item debe tener una factura asociada')
    })

    it('auto-generates sequential receipt_number', async () => {
      mockDbVoid()
      mockDbVoid()
      mockDbRows([{ next_number: '42' }])
      mockDbVoid() // BEGIN
      mockDbVoid() // INSERT receipt
      mockDbVoid() // INSERT receipt_item
      mockDbRows([{ enterprise_id: null, order_id: null }])
      mockDbVoid() // INSERT cobro
      mockDbVoid() // COMMIT

      const result = await service.createReceipt('company-1', 'user-1', {
        items: [{ invoice_id: 'inv-1', amount: '100' }],
      })

      expect(result.receipt_number).toBe(42)
    })
  })

  describe('deleteReceipt', () => {
    it('deletes receipt and cascade deletes cobros', async () => {
      mockDbVoid() // migrations
      mockDbVoid()
      // Verify receipt exists
      mockDbRows([{ id: 'receipt-1', receipt_number: 5 }])
      // DELETE cobros
      mockDbVoid()
      // DELETE receipt_items
      mockDbVoid()
      // DELETE receipt
      mockDbVoid()

      const result = await service.deleteReceipt('company-1', 'receipt-1')
      expect(result.deleted).toBe(true)
    })

    it('throws 404 when receipt not found', async () => {
      mockDbVoid()
      mockDbVoid()
      mockDbEmpty()

      await expect(
        service.deleteReceipt('company-1', 'nonexistent')
      ).rejects.toThrow('Recibo no encontrado')
    })
  })

  describe('getReceipts', () => {
    it('returns receipts list', async () => {
      mockDbVoid() // migrations
      mockDbVoid()
      mockDbRows([
        { id: 'r1', receipt_number: 1, total_amount: '1000', items: [] },
        { id: 'r2', receipt_number: 2, total_amount: '2000', items: [] },
      ])

      const result = await service.getReceipts('company-1')
      expect(result).toHaveLength(2)
    })
  })
})
