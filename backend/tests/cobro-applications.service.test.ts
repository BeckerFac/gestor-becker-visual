import { describe, it, expect, beforeEach } from 'vitest'
import { mockDbExecute, mockDbRows, mockDbEmpty, mockDbVoid, resetMocks } from './helpers/setup'

import { CobroApplicationsService } from '../src/modules/cobro-applications/cobro-applications.service'

describe('CobroApplicationsService', () => {
  let service: CobroApplicationsService

  beforeEach(() => {
    resetMocks()
    service = new CobroApplicationsService()
  })

  const companyId = 'company-1'
  const userId = 'user-1'
  const cobroId = 'cobro-1'
  const invoiceId = 'invoice-1'

  const validCobro = {
    id: cobroId,
    company_id: companyId,
    enterprise_id: 'ent-1',
    business_unit_id: 'bu-1',
    amount: '10000',
    pending_status: 'pending_invoice',
  }

  const validInvoice = {
    id: invoiceId,
    company_id: companyId,
    enterprise_id: 'ent-1',
    business_unit_id: 'bu-1',
    total_amount: '10000',
    status: 'active',
    payment_status: 'pendiente',
    order_id: null,
  }

  // Helper: set up all mocks for a successful linkCobroToInvoice
  function setupLinkHappyPath() {
    mockDbExecute.mockImplementation((...args: any[]) => {
      const tpl = args[0]
      const sqlStr = tpl?.strings ? tpl.strings.join('') : ''

      // 1. Get cobro
      if (sqlStr.includes('FROM cobros WHERE id')) {
        return Promise.resolve({ rows: [validCobro] })
      }
      // 2. Get invoice
      if (sqlStr.includes('FROM invoices WHERE id')) {
        return Promise.resolve({ rows: [validInvoice] })
      }
      // 3. Check duplicate
      if (sqlStr.includes('FROM cobro_invoice_applications') && sqlStr.includes('WHERE cobro_id')) {
        return Promise.resolve({ rows: [] })
      }
      // 4. Cobro unallocated balance (getCobroUnallocatedBalance)
      if (sqlStr.includes('FROM cobros c') && sqlStr.includes('LEFT JOIN cobro_invoice_applications')) {
        return Promise.resolve({ rows: [{ total: '10000', allocated: '0' }] })
      }
      // 5. Invoice remaining balance (getInvoiceRemainingBalance)
      if (sqlStr.includes('FROM invoices i') && sqlStr.includes('LEFT JOIN cobro_invoice_applications')) {
        return Promise.resolve({ rows: [{ total: '10000', applied: '0' }] })
      }
      // 6. INSERT application
      if (sqlStr.includes('INSERT INTO cobro_invoice_applications')) {
        return Promise.resolve({ rows: [] })
      }
      // 7. Recalculate invoice payment_status (SELECT)
      if (sqlStr.includes('FROM invoices i') && sqlStr.includes('GROUP BY i.id')) {
        return Promise.resolve({ rows: [{ total: '10000', applied: '5000' }] })
      }
      // 8. UPDATE invoices SET payment_status
      if (sqlStr.includes('UPDATE invoices SET payment_status')) {
        return Promise.resolve({ rows: [] })
      }
      // 9. UPDATE cobros SET pending_status
      if (sqlStr.includes('UPDATE cobros SET pending_status')) {
        return Promise.resolve({ rows: [] })
      }
      // 10. Return created application
      if (sqlStr.includes('FROM cobro_invoice_applications cia') && sqlStr.includes('JOIN invoices i')) {
        return Promise.resolve({
          rows: [{
            id: 'app-1',
            cobro_id: cobroId,
            invoice_id: invoiceId,
            amount_applied: '5000',
            invoice_number: 'FC-001',
            invoice_type: 'A',
            invoice_total: '10000',
            invoice_status: 'active',
            invoice_payment_status: 'parcial',
          }],
        })
      }
      return Promise.resolve({ rows: [] })
    })
  }

  describe('linkCobroToInvoice', () => {
    it('happy path: links cobro to invoice and returns application', async () => {
      setupLinkHappyPath()

      const result = await service.linkCobroToInvoice(companyId, userId, cobroId, invoiceId, 5000)

      expect(result).toBeDefined()
      expect(result.cobro_id).toBe(cobroId)
      expect(result.invoice_id).toBe(invoiceId)
      expect(result.amount_applied).toBe('5000')
    })

    it('throws 400 when amount <= 0', async () => {
      await expect(
        service.linkCobroToInvoice(companyId, userId, cobroId, invoiceId, 0)
      ).rejects.toThrow('El monto a aplicar debe ser mayor a 0')

      await expect(
        service.linkCobroToInvoice(companyId, userId, cobroId, invoiceId, -100)
      ).rejects.toThrow('El monto a aplicar debe ser mayor a 0')
    })

    it('throws 404 when cobro not found', async () => {
      mockDbEmpty() // cobro query returns empty

      await expect(
        service.linkCobroToInvoice(companyId, userId, cobroId, invoiceId, 5000)
      ).rejects.toThrow('Cobro no encontrado')
    })

    it('throws 404 when invoice not found', async () => {
      mockDbRows([validCobro]) // cobro found
      mockDbEmpty() // invoice query returns empty

      await expect(
        service.linkCobroToInvoice(companyId, userId, cobroId, invoiceId, 5000)
      ).rejects.toThrow('Factura no encontrada')
    })

    it('throws 400 when business_unit_id differs', async () => {
      mockDbRows([{ ...validCobro, business_unit_id: 'bu-1' }])
      mockDbRows([{ ...validInvoice, business_unit_id: 'bu-2' }])

      await expect(
        service.linkCobroToInvoice(companyId, userId, cobroId, invoiceId, 5000)
      ).rejects.toThrow('Cobro y factura deben ser de la misma razon social')
    })

    it('throws 400 when enterprise_id differs', async () => {
      mockDbRows([{ ...validCobro, enterprise_id: 'ent-1', business_unit_id: null }])
      mockDbRows([{ ...validInvoice, enterprise_id: 'ent-2', business_unit_id: null }])

      await expect(
        service.linkCobroToInvoice(companyId, userId, cobroId, invoiceId, 5000)
      ).rejects.toThrow('Cobro y factura deben ser del mismo cliente')
    })

    it('throws 400 when invoice is cancelled', async () => {
      mockDbRows([{ ...validCobro, business_unit_id: null }])
      mockDbRows([{ ...validInvoice, status: 'cancelled', business_unit_id: null }])

      await expect(
        service.linkCobroToInvoice(companyId, userId, cobroId, invoiceId, 5000)
      ).rejects.toThrow('No se puede vincular cobro a factura cancelada')
    })

    it('throws 409 when duplicate link exists', async () => {
      mockDbRows([{ ...validCobro, business_unit_id: null }])
      mockDbRows([{ ...validInvoice, business_unit_id: null }])
      mockDbRows([{ id: 'existing-app' }]) // duplicate found

      await expect(
        service.linkCobroToInvoice(companyId, userId, cobroId, invoiceId, 5000)
      ).rejects.toThrow('Este cobro ya esta vinculado a esta factura')
    })

    it('throws 400 when cobro unallocated balance insufficient', async () => {
      mockDbRows([{ ...validCobro, business_unit_id: null }])
      mockDbRows([{ ...validInvoice, business_unit_id: null }])
      mockDbEmpty() // no duplicate
      // Cobro balance: only 100 left
      mockDbRows([{ total: '10000', allocated: '9900' }])

      await expect(
        service.linkCobroToInvoice(companyId, userId, cobroId, invoiceId, 5000)
      ).rejects.toThrow('Solo quedan $100.00 sin asignar en este cobro')
    })

    it('throws 400 when invoice remaining balance insufficient', async () => {
      mockDbRows([{ ...validCobro, business_unit_id: null }])
      mockDbRows([{ ...validInvoice, business_unit_id: null }])
      mockDbEmpty() // no duplicate
      mockDbRows([{ total: '10000', allocated: '0' }]) // cobro balance OK
      mockDbRows([{ total: '10000', applied: '9900' }]) // invoice only 100 left

      await expect(
        service.linkCobroToInvoice(companyId, userId, cobroId, invoiceId, 5000)
      ).rejects.toThrow('Solo quedan $100.00 por cobrar en esta factura')
    })
  })

  describe('unlinkCobroFromInvoice', () => {
    it('happy path: unlinks and returns success', async () => {
      mockDbExecute.mockImplementation((...args: any[]) => {
        const tpl = args[0]
        const sqlStr = tpl?.strings ? tpl.strings.join('') : ''

        // Verify cobro belongs to company
        if (sqlStr.includes('FROM cobros WHERE id') && !sqlStr.includes('LEFT JOIN')) {
          return Promise.resolve({ rows: [{ id: cobroId }] })
        }
        // DELETE application
        if (sqlStr.includes('DELETE FROM cobro_invoice_applications')) {
          return Promise.resolve({ rows: [{ id: 'app-1' }] })
        }
        // Recalculate invoice payment_status
        if (sqlStr.includes('FROM invoices i') && sqlStr.includes('GROUP BY i.id')) {
          return Promise.resolve({ rows: [{ total: '10000', applied: '0' }] })
        }
        if (sqlStr.includes('UPDATE invoices SET payment_status')) {
          return Promise.resolve({ rows: [] })
        }
        // Get order_id from invoice
        if (sqlStr.includes('SELECT order_id FROM invoices')) {
          return Promise.resolve({ rows: [{ order_id: null }] })
        }
        // Cobro unallocated balance
        if (sqlStr.includes('FROM cobros c') && sqlStr.includes('LEFT JOIN cobro_invoice_applications')) {
          return Promise.resolve({ rows: [{ total: '10000', allocated: '0' }] })
        }
        // Cobro amount
        if (sqlStr.includes('SELECT amount FROM cobros')) {
          return Promise.resolve({ rows: [{ amount: '10000' }] })
        }
        // Update pending_status
        if (sqlStr.includes('UPDATE cobros SET pending_status')) {
          return Promise.resolve({ rows: [] })
        }
        return Promise.resolve({ rows: [] })
      })

      const result = await service.unlinkCobroFromInvoice(companyId, cobroId, invoiceId)
      expect(result).toEqual({ success: true })
    })
  })

  describe('getCobroUnallocatedBalance', () => {
    it('calculates correct unallocated balance', async () => {
      mockDbRows([{ total: '10000', allocated: '3500' }])

      const balance = await service.getCobroUnallocatedBalance(cobroId)
      expect(balance).toBe(6500)
    })

    it('returns 0 when cobro not found', async () => {
      mockDbEmpty()

      const balance = await service.getCobroUnallocatedBalance('nonexistent')
      expect(balance).toBe(0)
    })

    it('returns full amount when nothing allocated', async () => {
      mockDbRows([{ total: '5000', allocated: '0' }])

      const balance = await service.getCobroUnallocatedBalance(cobroId)
      expect(balance).toBe(5000)
    })
  })
})
