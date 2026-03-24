import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mockDbExecute, mockDbRows, mockDbEmpty, mockDbVoid, resetMocks } from './helpers/setup'

import { InvoicesService } from '../src/modules/invoices/invoices.service'

// Get reference to the mocked db for chainable methods
const { db } = await import('../src/config/db')

describe('InvoicesService', () => {
  let service: InvoicesService

  beforeEach(() => {
    resetMocks()
    service = new InvoicesService()
    vi.clearAllMocks()
  })

  describe('createInvoice', () => {
    it('creates fiscal invoice in draft status', async () => {
      // migrations
      for (let i = 0; i < 26; i++) mockDbVoid()
      // next number query
      mockDbRows([{ next_number: '10' }])
      // customer enterprise lookup
      mockDbRows([{ enterprise_id: 'ent-1' }])
      // INSERT via drizzle (mocked by db.insert chain)
      // UPDATE for order_id, enterprise_id, fiscal_type
      mockDbVoid()

      const result = await service.createInvoice('company-1', 'user-1', {
        fiscal_type: 'fiscal',
        invoice_type: 'A',
        customer_id: 'cust-1',
      })

      expect(result).toHaveProperty('id')
      expect(result.fiscal_type).toBe('fiscal')
    })

    it('creates no_fiscal invoice with status emitido', async () => {
      for (let i = 0; i < 26; i++) mockDbVoid()
      // next number for no_fiscal
      mockDbRows([{ next_number: '1' }])
      // customer enterprise
      mockDbEmpty()
      // INSERT via raw SQL (no_fiscal path)
      mockDbVoid()
      // UPDATE order_id, enterprise_id
      mockDbVoid()

      const result = await service.createInvoice('company-1', 'user-1', {
        fiscal_type: 'no_fiscal',
        customer_id: 'cust-1',
      })

      expect(result.fiscal_type).toBe('no_fiscal')
    })

    it('creates interno invoice', async () => {
      for (let i = 0; i < 26; i++) mockDbVoid()
      mockDbRows([{ next_number: '1' }])
      mockDbEmpty()
      mockDbVoid() // raw INSERT
      mockDbVoid() // UPDATE

      const result = await service.createInvoice('company-1', 'user-1', {
        fiscal_type: 'interno',
      })

      expect(result.fiscal_type).toBe('interno')
    })

    it('creates invoice with items and calculates totals', async () => {
      for (let i = 0; i < 26; i++) mockDbVoid()
      mockDbRows([{ next_number: '1' }])
      mockDbEmpty() // no customer enterprise
      mockDbVoid() // INSERT invoice

      // UPDATE for order_id, enterprise_id
      mockDbVoid()

      const result = await service.createInvoice('company-1', 'user-1', {
        fiscal_type: 'fiscal',
        invoice_type: 'B',
        items: [
          { product_name: 'Widget', unit_price: 100, quantity: 2, vat_rate: 21 },
          { product_name: 'Gadget', unit_price: 50, quantity: 3, vat_rate: 21 },
        ],
      })

      expect(result).toHaveProperty('id')
      // subtotal = (100*2)+(50*3) = 350
      // vat = 350 * 0.21 = 73.5
      // total = 423.5
    })

    it('validates quantity is greater than zero', async () => {
      for (let i = 0; i < 26; i++) mockDbVoid()
      mockDbRows([{ next_number: '1' }])
      mockDbEmpty()
      mockDbVoid() // INSERT invoice
      mockDbVoid() // UPDATE

      await expect(
        service.createInvoice('company-1', 'user-1', {
          fiscal_type: 'fiscal',
          invoice_type: 'B',
          items: [{ product_name: 'Widget', unit_price: 100, quantity: 0, vat_rate: 21 }],
        })
      ).rejects.toThrow('Cantidad no puede ser menor a 0.001')
    })

    it('validates unit_price max boundary', async () => {
      for (let i = 0; i < 26; i++) mockDbVoid()
      mockDbRows([{ next_number: '1' }])
      mockDbEmpty()
      mockDbVoid()
      mockDbVoid()

      await expect(
        service.createInvoice('company-1', 'user-1', {
          fiscal_type: 'fiscal',
          invoice_type: 'B',
          items: [{ product_name: 'Expensive', unit_price: 10000000000, quantity: 1, vat_rate: 21 }],
        })
      ).rejects.toThrow('Precio unitario no puede ser mayor a 999999999')
    })

    it('resolves enterprise_id from customer when not provided', async () => {
      for (let i = 0; i < 26; i++) mockDbVoid()
      mockDbRows([{ next_number: '1' }])
      // customer enterprise lookup returns enterprise
      mockDbRows([{ enterprise_id: 'resolved-ent' }])
      mockDbVoid() // INSERT
      mockDbVoid() // UPDATE

      const result = await service.createInvoice('company-1', 'user-1', {
        fiscal_type: 'fiscal',
        invoice_type: 'B',
        customer_id: 'cust-1',
      })

      expect(result.enterprise_id).toBe('resolved-ent')
    })
  })

  describe('getInvoices', () => {
    it('returns invoices with correct format', async () => {
      for (let i = 0; i < 26; i++) mockDbVoid() // migrations
      // main query
      mockDbRows([{ id: 'inv-1', invoice_number: 1, status: 'draft', total_amount: '1000' }])
      // count query
      mockDbRows([{ total: '1' }])

      const result = await service.getInvoices('company-1')

      expect(result).toHaveProperty('items')
      expect(result).toHaveProperty('total')
      expect(result).toHaveProperty('skip')
      expect(result).toHaveProperty('limit')
    })

    it('filters by fiscal_type interno', async () => {
      for (let i = 0; i < 26; i++) mockDbVoid()
      mockDbEmpty()
      mockDbRows([{ total: '0' }])

      const result = await service.getInvoices('company-1', { fiscal_type: 'interno' })
      expect(result.items).toEqual([])
    })

    it('filters by fiscal_type no_fiscal', async () => {
      for (let i = 0; i < 26; i++) mockDbVoid()
      mockDbEmpty()
      mockDbRows([{ total: '0' }])

      const result = await service.getInvoices('company-1', { fiscal_type: 'no_fiscal' })
      expect(result.items).toEqual([])
    })

    it('filters by enterprise_id', async () => {
      for (let i = 0; i < 26; i++) mockDbVoid()
      mockDbEmpty()
      mockDbRows([{ total: '0' }])

      const result = await service.getInvoices('company-1', { enterprise_id: 'ent-1' })
      expect(result.total).toBe(0)
    })

    it('clamps skip and limit to safe ranges', async () => {
      for (let i = 0; i < 26; i++) mockDbVoid()
      mockDbEmpty()
      mockDbRows([{ total: '0' }])

      const result = await service.getInvoices('company-1', { skip: -10, limit: 999 })
      expect(result.skip).toBe(0)
      expect(result.limit).toBe(200) // clamped to max 200
    })
  })

  describe('authorizeInvoice', () => {
    it('blocks no_fiscal invoices from AFIP authorization', async () => {
      mockDbRows([{ fiscal_type: 'no_fiscal' }])

      await expect(
        service.authorizeInvoice('company-1', 'inv-1')
      ).rejects.toThrow('Los comprobantes internos/no fiscales no pueden autorizarse en AFIP')
    })

    it('blocks interno invoices from AFIP authorization', async () => {
      mockDbRows([{ fiscal_type: 'interno' }])

      await expect(
        service.authorizeInvoice('company-1', 'inv-1')
      ).rejects.toThrow('Los comprobantes internos/no fiscales no pueden autorizarse en AFIP')
    })
  })

  describe('updateDraftInvoice', () => {
    it('only works on draft or emitido invoices', async () => {
      for (let i = 0; i < 26; i++) mockDbVoid() // migrations
      // Invoice is 'authorized' - not editable
      mockDbRows([{ id: 'inv-1', status: 'authorized' }])

      await expect(
        service.updateDraftInvoice('company-1', 'inv-1', { items: [] })
      ).rejects.toThrow('Solo se pueden editar facturas en borrador o comprobantes internos')
    })

    it('throws 404 when invoice not found', async () => {
      for (let i = 0; i < 26; i++) mockDbVoid()
      mockDbEmpty()

      await expect(
        service.updateDraftInvoice('company-1', 'nonexistent', {})
      ).rejects.toThrow('Factura no encontrada')
    })
  })

  describe('deleteDraftInvoice', () => {
    it('only works on draft or emitido invoices', async () => {
      for (let i = 0; i < 26; i++) mockDbVoid()
      mockDbRows([{ id: 'inv-1', status: 'authorized', order_id: null }])

      await expect(
        service.deleteDraftInvoice('company-1', 'inv-1')
      ).rejects.toThrow('Solo se pueden eliminar facturas en borrador o comprobantes internos')
    })

    it('deletes draft invoice and recalculates order has_invoice', async () => {
      for (let i = 0; i < 26; i++) mockDbVoid()
      mockDbRows([{ id: 'inv-1', status: 'draft', order_id: 'order-1' }])
      // Count remaining invoices for the order
      mockDbRows([{ cnt: '0' }])
      // Update order has_invoice to false
      mockDbVoid()

      const result = await service.deleteDraftInvoice('company-1', 'inv-1')
      expect(result.deleted).toBe(true)
    })

    it('throws 404 when invoice not found', async () => {
      for (let i = 0; i < 26; i++) mockDbVoid()
      mockDbEmpty()

      await expect(
        service.deleteDraftInvoice('company-1', 'nonexistent')
      ).rejects.toThrow('Factura no encontrada')
    })
  })

  describe('edge cases', () => {
    it('handles invoice with negative amount in validation', async () => {
      for (let i = 0; i < 26; i++) mockDbVoid()
      mockDbRows([{ next_number: '1' }])
      mockDbEmpty()
      mockDbVoid()
      mockDbVoid()

      await expect(
        service.createInvoice('company-1', 'user-1', {
          fiscal_type: 'fiscal',
          invoice_type: 'B',
          items: [{ product_name: 'Bad', unit_price: -50, quantity: 1, vat_rate: 21 }],
        })
      ).rejects.toThrow('Precio unitario no puede ser menor a 0')
    })
  })
})
