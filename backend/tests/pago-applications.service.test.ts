import { describe, it, expect, beforeEach } from 'vitest'
import { mockDbExecute, mockDbRows, mockDbEmpty, mockDbVoid, resetMocks } from './helpers/setup'

import { PagoApplicationsService } from '../src/modules/pago-applications/pago-applications.service'

describe('PagoApplicationsService', () => {
  let service: PagoApplicationsService

  beforeEach(() => {
    resetMocks()
    service = new PagoApplicationsService()
  })

  const companyId = 'company-1'
  const userId = 'user-1'
  const pagoId = 'pago-1'
  const purchaseInvoiceId = 'pi-1'

  const validPago = {
    id: pagoId,
    company_id: companyId,
    enterprise_id: 'ent-1',
    business_unit_id: 'bu-1',
    amount: '10000',
    pending_status: 'pending_invoice',
  }

  const validPurchaseInvoice = {
    id: purchaseInvoiceId,
    company_id: companyId,
    enterprise_id: 'ent-1',
    business_unit_id: 'bu-1',
    total_amount: '10000',
    status: 'active',
  }

  // Helper: set up all mocks for a successful linkPagoToPurchaseInvoice
  function setupLinkHappyPath() {
    mockDbExecute.mockImplementation((...args: any[]) => {
      const tpl = args[0]
      const sqlStr = tpl?.strings ? tpl.strings.join('') : ''

      // 1. Get pago
      if (sqlStr.includes('FROM pagos WHERE id')) {
        return Promise.resolve({ rows: [validPago] })
      }
      // 2. Get purchase invoice
      if (sqlStr.includes('FROM purchase_invoices WHERE id')) {
        return Promise.resolve({ rows: [validPurchaseInvoice] })
      }
      // 3. Check duplicate
      if (sqlStr.includes('FROM pago_invoice_applications') && sqlStr.includes('WHERE pago_id')) {
        return Promise.resolve({ rows: [] })
      }
      // 4. Pago unallocated balance
      if (sqlStr.includes('FROM pagos p') && sqlStr.includes('LEFT JOIN pago_invoice_applications') && sqlStr.includes('pago_cash')) {
        return Promise.resolve({ rows: [{ pago_cash: '10000', allocated: '0' }] })
      }
      // 5. Purchase invoice remaining balance (now has retenciones subqueries)
      if (sqlStr.includes('FROM purchase_invoices pi') && sqlStr.includes('retenciones_total') && sqlStr.includes('applied_cash')) {
        return Promise.resolve({ rows: [{ total: '10000', applied_cash: '0', retenciones_total: '0', retenciones_via_pago: '0' }] })
      }
      // 6. INSERT application
      if (sqlStr.includes('INSERT INTO pago_invoice_applications')) {
        return Promise.resolve({ rows: [] })
      }
      // 8. UPDATE purchase_invoices SET payment_status
      if (sqlStr.includes('UPDATE purchase_invoices SET payment_status')) {
        return Promise.resolve({ rows: [] })
      }
      // 9. Cascade: get purchase_id
      if (sqlStr.includes('SELECT purchase_id FROM purchase_invoices')) {
        return Promise.resolve({ rows: [{ purchase_id: null }] })
      }
      // 10. UPDATE pagos SET pending_status
      if (sqlStr.includes('UPDATE pagos SET pending_status')) {
        return Promise.resolve({ rows: [] })
      }
      // 11. Return created application
      if (sqlStr.includes('FROM pago_invoice_applications pia') && sqlStr.includes('JOIN purchase_invoices pi')) {
        return Promise.resolve({
          rows: [{
            id: 'app-1',
            pago_id: pagoId,
            purchase_invoice_id: purchaseInvoiceId,
            amount_applied: '5000',
            invoice_number: 'FC-C001',
            invoice_type: 'A',
            pi_total: '10000',
            pi_payment_status: 'parcial',
          }],
        })
      }
      return Promise.resolve({ rows: [] })
    })
  }

  describe('linkPagoToPurchaseInvoice', () => {
    it('happy path: links pago to purchase invoice and returns application', async () => {
      setupLinkHappyPath()

      const result = await service.linkPagoToPurchaseInvoice(companyId, userId, pagoId, purchaseInvoiceId, 5000)

      expect(result).toBeDefined()
      expect(result.pago_id).toBe(pagoId)
      expect(result.purchase_invoice_id).toBe(purchaseInvoiceId)
      expect(result.amount_applied).toBe('5000')
    })

    it('throws 400 when amount <= 0', async () => {
      await expect(
        service.linkPagoToPurchaseInvoice(companyId, userId, pagoId, purchaseInvoiceId, 0)
      ).rejects.toThrow('El monto a aplicar debe ser mayor a 0')

      await expect(
        service.linkPagoToPurchaseInvoice(companyId, userId, pagoId, purchaseInvoiceId, -50)
      ).rejects.toThrow('El monto a aplicar debe ser mayor a 0')
    })

    it('throws 404 when pago not found', async () => {
      mockDbEmpty()

      await expect(
        service.linkPagoToPurchaseInvoice(companyId, userId, pagoId, purchaseInvoiceId, 5000)
      ).rejects.toThrow('Pago no encontrado')
    })

    it('throws 404 when purchase invoice not found', async () => {
      mockDbRows([validPago])
      mockDbEmpty()

      await expect(
        service.linkPagoToPurchaseInvoice(companyId, userId, pagoId, purchaseInvoiceId, 5000)
      ).rejects.toThrow('Factura de compra no encontrada')
    })

    it('throws 400 when business_unit_id differs', async () => {
      mockDbRows([{ ...validPago, business_unit_id: 'bu-1' }])
      mockDbRows([{ ...validPurchaseInvoice, business_unit_id: 'bu-2' }])

      await expect(
        service.linkPagoToPurchaseInvoice(companyId, userId, pagoId, purchaseInvoiceId, 5000)
      ).rejects.toThrow('Pago y factura de compra deben ser de la misma razon social')
    })

    it('throws 409 when duplicate link exists', async () => {
      mockDbRows([{ ...validPago, business_unit_id: null }])
      mockDbRows([{ ...validPurchaseInvoice, business_unit_id: null }])
      // Skip enterprise validation (same enterprise_id)
      // Check duplicate: found
      mockDbRows([{ id: 'existing-app' }])

      await expect(
        service.linkPagoToPurchaseInvoice(companyId, userId, pagoId, purchaseInvoiceId, 5000)
      ).rejects.toThrow('Este pago ya esta vinculado a esta factura de compra')
    })

    it('throws 400 when pago unallocated balance insufficient', async () => {
      mockDbRows([{ ...validPago, business_unit_id: null }])
      mockDbRows([{ ...validPurchaseInvoice, business_unit_id: null }])
      mockDbEmpty() // no duplicate
      // Pago balance: only 200 left
      mockDbRows([{ pago_cash: '10000', allocated: '9800' }])

      await expect(
        service.linkPagoToPurchaseInvoice(companyId, userId, pagoId, purchaseInvoiceId, 5000)
      ).rejects.toThrow('Solo quedan $200.00 sin asignar en este pago')
    })

    it('throws 400 when purchase invoice remaining balance insufficient', async () => {
      mockDbRows([{ ...validPago, business_unit_id: null }])
      mockDbRows([{ ...validPurchaseInvoice, business_unit_id: null }])
      mockDbEmpty() // no duplicate
      mockDbRows([{ pago_cash: '10000', allocated: '0' }]) // pago balance OK
      mockDbRows([{ total: '10000', applied_cash: '9500', retenciones_total: '0', retenciones_via_pago: '0' }]) // PI only 500 left

      await expect(
        service.linkPagoToPurchaseInvoice(companyId, userId, pagoId, purchaseInvoiceId, 5000)
      ).rejects.toThrow('Solo quedan $500.00 por pagar en esta factura de compra')
    })
  })

  describe('unlinkPagoFromPurchaseInvoice', () => {
    it('happy path: unlinks and returns success', async () => {
      mockDbExecute.mockImplementation((...args: any[]) => {
        const tpl = args[0]
        const sqlStr = tpl?.strings ? tpl.strings.join('') : ''

        // Verify pago belongs to company
        if (sqlStr.includes('FROM pagos WHERE id') && !sqlStr.includes('LEFT JOIN')) {
          return Promise.resolve({ rows: [{ id: pagoId }] })
        }
        // DELETE application
        if (sqlStr.includes('DELETE FROM pago_invoice_applications')) {
          return Promise.resolve({ rows: [{ id: 'app-1' }] })
        }
        // Recalculate PI payment_status (new shape with retenciones subqueries)
        if (sqlStr.includes('FROM purchase_invoices pi') && sqlStr.includes('retenciones_total')) {
          return Promise.resolve({ rows: [{ total: '10000', applied_cash: '0', retenciones_total: '0', retenciones_via_pago: '0' }] })
        }
        if (sqlStr.includes('UPDATE purchase_invoices SET payment_status')) {
          return Promise.resolve({ rows: [] })
        }
        // Cascade: get purchase_id
        if (sqlStr.includes('SELECT purchase_id FROM purchase_invoices')) {
          return Promise.resolve({ rows: [{ purchase_id: null }] })
        }
        // Pago unallocated balance (new shape: pago_cash)
        if (sqlStr.includes('FROM pagos p') && sqlStr.includes('LEFT JOIN pago_invoice_applications') && sqlStr.includes('pago_cash')) {
          return Promise.resolve({ rows: [{ pago_cash: '10000', allocated: '0' }] })
        }
        // Pago amount
        if (sqlStr.includes('SELECT amount FROM pagos')) {
          return Promise.resolve({ rows: [{ amount: '10000' }] })
        }
        // Update pending_status
        if (sqlStr.includes('UPDATE pagos SET pending_status')) {
          return Promise.resolve({ rows: [] })
        }
        return Promise.resolve({ rows: [] })
      })

      const result = await service.unlinkPagoFromPurchaseInvoice(companyId, pagoId, purchaseInvoiceId)
      expect(result).toEqual({ success: true })
    })
  })

  // ===== FIX: retenciones practicadas + epsilon + anulado =====
  describe('recalculatePurchaseInvoicePaymentStatus (retenciones + epsilon)', () => {
    /**
     * Helper: route the two "UPDATE purchase_invoices SET payment_status" +
     * the recalc SELECT, returning the custom row, and capture the status written.
     */
    function setupRecalcCapture(recalcRow: any) {
      const captured: { status?: string } = {}
      mockDbExecute.mockImplementation((...args: any[]) => {
        const tpl = args[0]
        const sqlStr = tpl?.strings ? tpl.strings.join('') : ''
        const values: any[] = tpl?.values || []

        if (sqlStr.includes('FROM purchase_invoices pi') && sqlStr.includes('retenciones_total')) {
          return Promise.resolve({ rows: [recalcRow] })
        }
        if (sqlStr.includes('UPDATE purchase_invoices SET payment_status')) {
          // First interpolation is the status string
          captured.status = values[0]
          return Promise.resolve({ rows: [] })
        }
        return Promise.resolve({ rows: [] })
      })
      return captured
    }

    it('PI 100k + pago 100k cash → pagado', async () => {
      const captured = setupRecalcCapture({
        total: '100000',
        applied_cash: '100000',
        retenciones_total: '0',
        retenciones_via_pago: '0',
      })
      await service.recalculatePurchaseInvoicePaymentStatus(purchaseInvoiceId)
      expect(captured.status).toBe('pagado')
    })

    it('PI 121k + 100k cash + 21k retencion practicada (purchase_invoice_id set) → pagado', async () => {
      const captured = setupRecalcCapture({
        total: '121000',
        applied_cash: '100000',
        retenciones_total: '21000',
        retenciones_via_pago: '0',
      })
      await service.recalculatePurchaseInvoicePaymentStatus(purchaseInvoiceId)
      expect(captured.status).toBe('pagado')
    })

    it('PI 121k + 100k cash + 21k retencion via pago_id (no purchase_invoice_id) → pagado', async () => {
      const captured = setupRecalcCapture({
        total: '121000',
        applied_cash: '100000',
        retenciones_total: '0',
        retenciones_via_pago: '21000',
      })
      await service.recalculatePurchaseInvoicePaymentStatus(purchaseInvoiceId)
      expect(captured.status).toBe('pagado')
    })

    it('epsilon edge: 99999.995 vs 100000 → pagado', async () => {
      const captured = setupRecalcCapture({
        total: '100000',
        applied_cash: '99999.995',
        retenciones_total: '0',
        retenciones_via_pago: '0',
      })
      await service.recalculatePurchaseInvoicePaymentStatus(purchaseInvoiceId)
      expect(captured.status).toBe('pagado')
    })

    it('partial payment → parcial', async () => {
      const captured = setupRecalcCapture({
        total: '100000',
        applied_cash: '50000',
        retenciones_total: '0',
        retenciones_via_pago: '0',
      })
      await service.recalculatePurchaseInvoicePaymentStatus(purchaseInvoiceId)
      expect(captured.status).toBe('parcial')
    })

    it('no payment → pendiente', async () => {
      const captured = setupRecalcCapture({
        total: '100000',
        applied_cash: '0',
        retenciones_total: '0',
        retenciones_via_pago: '0',
      })
      await service.recalculatePurchaseInvoicePaymentStatus(purchaseInvoiceId)
      expect(captured.status).toBe('pendiente')
    })

    /**
     * SQL-level filter test: verify the emitted SQL filters anulado pagos.
     * Since the mock returns pre-aggregated values, we assert the SQL text contains
     * the anulado filter so the query engine excludes them in production.
     */
    it('SQL excludes anulado pagos from applied_cash and retenciones', async () => {
      let capturedSql = ''
      mockDbExecute.mockImplementation((...args: any[]) => {
        const tpl = args[0]
        const sqlStr = tpl?.strings ? tpl.strings.join('') : ''
        if (sqlStr.includes('FROM purchase_invoices pi') && sqlStr.includes('retenciones_total')) {
          capturedSql = sqlStr
          return Promise.resolve({ rows: [{ total: '100000', applied_cash: '0', retenciones_total: '0', retenciones_via_pago: '0' }] })
        }
        return Promise.resolve({ rows: [] })
      })
      await service.recalculatePurchaseInvoicePaymentStatus(purchaseInvoiceId)
      // 3 occurrences: one per pago alias (p, p2, p3)
      const anuladoCount = (capturedSql.match(/!= 'anulado'/g) || []).length
      expect(anuladoCount).toBeGreaterThanOrEqual(3)
      expect(capturedSql).toContain("r.direction = 'practicada'")
      expect(capturedSql).toContain("r2.purchase_invoice_id IS NULL")
    })
  })

  describe('getPagoUnallocatedBalance (excludes retencion portion)', () => {
    it('uses pagos.amount (raw cash), not total_amount', async () => {
      let capturedSql = ''
      mockDbExecute.mockImplementation((...args: any[]) => {
        const tpl = args[0]
        const sqlStr = tpl?.strings ? tpl.strings.join('') : ''
        capturedSql = sqlStr
        return Promise.resolve({ rows: [{ pago_cash: '100000', allocated: '30000' }] })
      })
      const balance = await service.getPagoUnallocatedBalance(pagoId)
      expect(balance).toBe(70000)
      // Must NOT use total_amount (which includes retenciones)
      expect(capturedSql).not.toContain('p.total_amount')
      expect(capturedSql).toContain('p.amount')
    })
  })

  describe('linkPagoToPurchaseInvoice anulado guards', () => {
    it('throws 409 when pago is anulado', async () => {
      mockDbRows([{ ...validPago, status: 'anulado' }])

      await expect(
        service.linkPagoToPurchaseInvoice(companyId, userId, pagoId, purchaseInvoiceId, 5000)
      ).rejects.toThrow('No se puede vincular un pago anulado')
    })

    it('throws 409 when purchase invoice is anulada', async () => {
      mockDbRows([{ ...validPago, status: 'active' }])
      mockDbRows([{ ...validPurchaseInvoice, status: 'anulada' }])

      await expect(
        service.linkPagoToPurchaseInvoice(companyId, userId, pagoId, purchaseInvoiceId, 5000)
      ).rejects.toThrow('No se puede vincular pago a factura de compra anulada')
    })
  })
})
