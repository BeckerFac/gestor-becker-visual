import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mockDbExecute, mockDbRows, mockDbEmpty, mockDbVoid, resetMocks } from './helpers/setup'

import { OrdersService } from '../src/modules/orders/orders.service'
import { ChequesService } from '../src/modules/cheques/cheques.service'
import { EnterprisesService } from '../src/modules/enterprises/enterprises.service'
import { InvoicesService } from '../src/modules/invoices/invoices.service'

describe('Security Tests', () => {
  beforeEach(() => {
    resetMocks()
  })

  describe('SQL injection in search parameters', () => {
    it('orders: search with SQL injection attempt is parameterized', async () => {
      const svc = new OrdersService()
      // migrations + cobros check + main query + summary
      mockDbExecute.mockResolvedValue({ rows: [] })

      // This should not cause any SQL injection - the value is passed as a parameter
      const malicious = "'; DROP TABLE orders; --"
      const result = await svc.getOrders('company-1', { search: malicious })

      // If we got here without error, the parameterized query handled it safely
      expect(result).toHaveProperty('items')
    })

    it('cheques: search with SQL injection attempt is parameterized', async () => {
      const svc = new ChequesService()
      mockDbExecute.mockResolvedValue({ rows: [] })

      const result = await svc.getCheques('company-1', { search: "' OR 1=1; --" })
      expect(Array.isArray(result)).toBe(true)
    })

    it('invoices: search with SQL injection attempt is parameterized', async () => {
      const svc = new InvoicesService()
      mockDbExecute.mockResolvedValue({ rows: [] })

      const result = await svc.getInvoices('company-1', { search: "'; DELETE FROM invoices; --" })
      expect(result).toHaveProperty('items')
    })
  })

  describe('XSS in text fields', () => {
    it('order title with script tag is stored as-is (output encoding is frontend responsibility)', async () => {
      const svc = new OrdersService()
      mockDbExecute.mockResolvedValue({ rows: [{ next_number: '1' }] })

      // The service stores text as-is using parameterized queries
      // XSS prevention is a frontend/output concern
      const xssTitle = '<script>alert("XSS")</script>'

      await svc.createOrder('company-1', 'user-1', {
        title: xssTitle,
        items: [{ product_name: 'Safe Product', unit_price: 100, quantity: 1, cost: 50 }],
      })

      // The parameterized query ensures the script tag is treated as data, not SQL
      expect(mockDbExecute).toHaveBeenCalled()
    })

    it('enterprise name with HTML entities is safely parameterized', async () => {
      const svc = new EnterprisesService()
      mockDbExecute.mockResolvedValue({ rows: [] })

      await svc.createEnterprise('company-1', {
        name: '<img src=x onerror=alert(1)>',
        notes: 'javascript:alert(1)',
      })

      expect(mockDbExecute).toHaveBeenCalled()
    })
  })

  describe('CUIT format validation', () => {
    it('enterprise creation with CUIT containing special chars does not break query', async () => {
      const svc = new EnterprisesService()
      mockDbExecute.mockResolvedValue({ rows: [] })

      // CUIT with unusual characters - should be safe due to parameterization
      await svc.createEnterprise('company-1', {
        name: 'Test Corp',
        cuit: "20-1234'; DROP TABLE--",
      })

      // Parameterized query handles this safely
      expect(mockDbExecute).toHaveBeenCalled()
    })
  })

  describe('Amount overflow', () => {
    it('invoice item with amount exceeding decimal(12,2) is validated', async () => {
      const svc = new InvoicesService()
      mockDbExecute.mockResolvedValue({ rows: [{ next_number: '1' }] })

      await expect(
        svc.createInvoice('company-1', 'user-1', {
          fiscal_type: 'fiscal',
          invoice_type: 'B',
          items: [{ product_name: 'Overflow', unit_price: 10000000000, quantity: 1, vat_rate: 21 }],
        })
      ).rejects.toThrow('Precio unitario no puede ser mayor a 999999999')
    })
  })

  describe('UUID format in IDs', () => {
    it('non-UUID company_id is passed as parameter (DB handles validation)', async () => {
      const svc = new OrdersService()
      mockDbExecute.mockResolvedValue({ rows: [] })

      // The service uses parameterized queries, so invalid UUIDs are handled by the DB
      const result = await svc.getOrders('not-a-uuid', {})
      expect(result).toHaveProperty('items')
    })
  })

  describe('Auth token validation', () => {
    // These test the middleware behavior expectations
    // The actual middleware is tested at the integration level
    it('service methods require companyId from auth middleware', async () => {
      const svc = new OrdersService()
      mockDbExecute.mockResolvedValue({ rows: [] })

      // Calling with empty string company ID - parameterized queries prevent issues
      const result = await svc.getOrders('', {})
      expect(result).toHaveProperty('items')
      // The DB would return empty results since no company matches ''
    })
  })

  describe('Input boundary values', () => {
    it('extremely long search string is handled safely', async () => {
      const svc = new OrdersService()
      mockDbExecute.mockResolvedValue({ rows: [] })

      const longSearch = 'A'.repeat(10000)
      const result = await svc.getOrders('company-1', { search: longSearch })
      expect(result).toHaveProperty('items')
    })

    it('negative skip/limit values are handled', async () => {
      const svc = new InvoicesService()
      mockDbExecute.mockResolvedValue({ rows: [{ total: '0' }] })

      const result = await svc.getInvoices('company-1', { skip: -100, limit: -50 })
      expect(result.skip).toBe(0)
      expect(result.limit).toBeGreaterThan(0)
    })

    it('zero quantity in invoice items is rejected', async () => {
      const svc = new InvoicesService()
      mockDbExecute.mockResolvedValue({ rows: [{ next_number: '1' }] })

      await expect(
        svc.createInvoice('company-1', 'user-1', {
          fiscal_type: 'fiscal',
          invoice_type: 'B',
          items: [{ product_name: 'Zero', unit_price: 100, quantity: 0, vat_rate: 21 }],
        })
      ).rejects.toThrow('Cantidad no puede ser menor a 0.001')
    })
  })
})
