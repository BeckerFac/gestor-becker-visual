import { describe, it, expect, beforeEach } from 'vitest'
import { mockDbExecute, resetMocks } from './helpers/setup'

import { PagosService } from '../src/modules/pagos/pagos.service'

describe('PagosService - FLOW 46 fixes', () => {
  let service: PagosService

  beforeEach(() => {
    resetMocks()
    service = new PagosService()
  })

  const companyId = 'company-1'
  const userId = 'user-1'
  const enterpriseId = 'ent-1'
  const buId = 'bu-1'
  const bankId = 'bank-1'
  const piId = 'pi-1'

  // Helper: extract SQL string from drizzle template
  function sqlText(args: any[]): string {
    const tpl = args[0]
    return tpl?.strings ? tpl.strings.join(' ') : ''
  }

  // Helper: shared dispatch table for createPago happy paths.
  function setupHappyDispatch(opts: {
    piTotal?: string
    piApplied?: string
    piRetenciones?: string
    piStatus?: string
    piEnterpriseId?: string
    piBusinessUnitId?: string
  } = {}) {
    const piTotal = opts.piTotal ?? '10000'
    const piApplied = opts.piApplied ?? '0'
    const piRetenciones = opts.piRetenciones ?? '0'
    const piStatus = opts.piStatus ?? 'active'
    const piEnt = opts.piEnterpriseId ?? enterpriseId
    const piBu = opts.piBusinessUnitId ?? buId

    mockDbExecute.mockImplementation((...args: any[]) => {
      const s = sqlText(args)

      // ensureTables migrations
      if (s.includes('CREATE TABLE IF NOT EXISTS pagos')) return Promise.resolve({ rows: [] })
      if (s.includes('CREATE TABLE IF NOT EXISTS pago_payment_methods')) return Promise.resolve({ rows: [] })
      if (s.includes('ALTER TABLE')) return Promise.resolve({ rows: [] })

      // default business_unit lookup
      if (s.includes('FROM business_units WHERE company_id')) {
        return Promise.resolve({ rows: [{ id: buId }] })
      }
      // enterprise validation
      if (s.includes('FROM enterprises WHERE id')) {
        return Promise.resolve({ rows: [{ id: enterpriseId }] })
      }
      // bank validation
      if (s.includes('FROM banks WHERE id')) {
        return Promise.resolve({ rows: [{ id: bankId }] })
      }
      // purchase_invoice ownership/status check (no balance subqueries)
      if (
        s.includes('FROM purchase_invoices') &&
        s.includes('WHERE id =') &&
        !s.includes('SELECT SUM')
      ) {
        return Promise.resolve({
          rows: [{
            id: piId,
            company_id: companyId,
            enterprise_id: piEnt,
            business_unit_id: piBu,
            status: piStatus,
            total_amount: piTotal,
          }],
        })
      }
      // purchase_invoice balance check (with retenciones subquery)
      if (s.includes('FROM purchase_invoices pi WHERE pi.id') && s.includes('retenciones_total')) {
        return Promise.resolve({
          rows: [{ total: piTotal, applied: piApplied, retenciones_total: piRetenciones }],
        })
      }
      // BEGIN/COMMIT/ROLLBACK
      if (s.trim() === 'BEGIN' || s.trim() === 'COMMIT' || s.trim() === 'ROLLBACK') {
        return Promise.resolve({ rows: [] })
      }

      // INSERTs
      if (s.includes('INSERT INTO pagos')) return Promise.resolve({ rows: [] })
      if (s.includes('INSERT INTO pago_payment_methods')) return Promise.resolve({ rows: [] })
      if (s.includes('INSERT INTO cheques')) return Promise.resolve({ rows: [] })
      if (s.includes('INSERT INTO retenciones')) return Promise.resolve({ rows: [] })
      if (s.includes('INSERT INTO pago_invoice_applications')) return Promise.resolve({ rows: [] })

      // recalc reads
      if (s.includes('FROM purchase_invoices pi') && s.includes('applied_cash')) {
        return Promise.resolve({
          rows: [{ total: piTotal, applied_cash: piApplied, retenciones_total: piRetenciones }],
        })
      }
      if (s.includes('UPDATE purchase_invoices SET payment_status')) {
        return Promise.resolve({ rows: [] })
      }
      if (s.includes('SELECT purchase_id FROM purchase_invoices')) {
        return Promise.resolve({ rows: [{ purchase_id: null }] })
      }

      // Auto-retentions read & accounting reads
      if (s.includes('SELECT COALESCE(SUM') && s.includes('retenciones')) {
        return Promise.resolve({ rows: [{ total_ret: '0' }] })
      }
      if (s.includes('SELECT type, CAST(amount AS decimal)') && s.includes('FROM retenciones')) {
        return Promise.resolve({ rows: [] })
      }

      // Final SELECT to return created pago
      if (s.includes('FROM pagos p') && s.includes('WHERE p.id =')) {
        return Promise.resolve({ rows: [{ id: 'new-pago', amount: '10000' }] })
      }

      return Promise.resolve({ rows: [] })
    })
  }

  describe('Bug A: payment_methods array processing', () => {
    it('inserts 2 cheques with direction=emitido when payment_methods has 2 cheques', async () => {
      setupHappyDispatch()

      const chequeInserts: any[] = []
      const pmInserts: any[] = []
      const originalImpl = mockDbExecute.getMockImplementation()!
      mockDbExecute.mockImplementation((...args: any[]) => {
        const s = sqlText(args)
        if (s.includes('INSERT INTO cheques')) {
          chequeInserts.push(args[0])
        }
        if (s.includes('INSERT INTO pago_payment_methods')) {
          pmInserts.push(args[0])
        }
        return originalImpl(...args)
      })

      await service.createPago(companyId, userId, {
        enterprise_id: enterpriseId,
        business_unit_id: buId,
        payment_methods: [
          {
            method: 'cheque',
            amount: 5000,
            cheque_data: {
              number: '00001', bank: 'Galicia', drawer: 'Acme SA',
              issue_date: '2026-01-01', due_date: '2026-02-01', cheque_type: 'propio',
            },
          },
          {
            method: 'cheque',
            amount: 5000,
            cheque_data: {
              number: '00002', bank: 'Santander', drawer: 'Acme SA',
              issue_date: '2026-01-01', due_date: '2026-02-15', cheque_type: 'propio',
            },
          },
        ],
      })

      expect(chequeInserts.length).toBe(2)
      expect(pmInserts.length).toBe(2)
      // Verify direction=emitido is in the SQL template
      const chequeSql = chequeInserts[0].strings.join(' ')
      expect(chequeSql).toContain("'emitido'")
    })

    it('throws 400 when cheque payment method has incomplete cheque_data', async () => {
      setupHappyDispatch()

      await expect(
        service.createPago(companyId, userId, {
          enterprise_id: enterpriseId,
          payment_methods: [
            {
              method: 'cheque',
              amount: 5000,
              cheque_data: { number: '00001' /* missing bank/drawer */ },
            },
          ],
        })
      ).rejects.toThrow(/Cheque incompleto/)
    })

    it('throws 400 when transferencia in payment_methods lacks bank_id', async () => {
      setupHappyDispatch()

      await expect(
        service.createPago(companyId, userId, {
          enterprise_id: enterpriseId,
          payment_methods: [
            { method: 'transferencia', amount: 1000 /* no bank_id */ },
          ],
        })
      ).rejects.toThrow(/Transferencia requiere bank_id/)
    })
  })

  describe('Bug B: IDOR + integrity validations', () => {
    it('throws 400 when bank_id does not belong to user company', async () => {
      mockDbExecute.mockImplementation((...args: any[]) => {
        const s = sqlText(args)
        if (s.includes('CREATE TABLE') || s.includes('ALTER TABLE')) return Promise.resolve({ rows: [] })
        if (s.includes('FROM business_units')) return Promise.resolve({ rows: [{ id: buId }] })
        if (s.includes('FROM enterprises WHERE id')) return Promise.resolve({ rows: [{ id: enterpriseId }] })
        if (s.includes('FROM banks WHERE id')) return Promise.resolve({ rows: [] }) // not found
        return Promise.resolve({ rows: [] })
      })

      await expect(
        service.createPago(companyId, userId, {
          enterprise_id: enterpriseId,
          payment_method: 'transferencia',
          bank_id: 'bank-from-other-company',
          amount: 1000,
        })
      ).rejects.toThrow(/Banco invalido/)
    })

    it('throws 400 when paying a cancelled purchase invoice', async () => {
      setupHappyDispatch({ piStatus: 'cancelled' })

      await expect(
        service.createPago(companyId, userId, {
          enterprise_id: enterpriseId,
          business_unit_id: buId,
          payment_method: 'efectivo',
          amount: 5000,
          purchase_invoice_items: [{ purchase_invoice_id: piId, amount: 5000 }],
        })
      ).rejects.toThrow(/cancelada/)
    })

    it('throws 400 on over-payment (exceeds remaining balance)', async () => {
      // PI total 10000, already 8000 applied -> remaining 2000. We try to apply 5000.
      setupHappyDispatch({ piTotal: '10000', piApplied: '8000' })

      await expect(
        service.createPago(companyId, userId, {
          enterprise_id: enterpriseId,
          business_unit_id: buId,
          payment_method: 'efectivo',
          amount: 5000,
          purchase_invoice_items: [{ purchase_invoice_id: piId, amount: 5000 }],
        })
      ).rejects.toThrow(/excede el saldo pendiente/)
    })

    it('throws 400 when enterprise_id does not belong to user company', async () => {
      mockDbExecute.mockImplementation((...args: any[]) => {
        const s = sqlText(args)
        if (s.includes('CREATE TABLE') || s.includes('ALTER TABLE')) return Promise.resolve({ rows: [] })
        if (s.includes('FROM business_units')) return Promise.resolve({ rows: [{ id: buId }] })
        if (s.includes('FROM enterprises WHERE id')) return Promise.resolve({ rows: [] }) // not found
        return Promise.resolve({ rows: [] })
      })

      await expect(
        service.createPago(companyId, userId, {
          enterprise_id: 'enterprise-from-other-company',
          payment_method: 'efectivo',
          amount: 1000,
        })
      ).rejects.toThrow(/Empresa proveedora invalida/)
    })
  })

  describe('Bug C: recalculatePurchaseInvoiceStatus includes retenciones practicadas', () => {
    it('marks purchase invoice as pagado when cash + retencion practicada cover total', async () => {
      // PI 121k, applied_cash 100k, retencion practicada 21k -> applied = 121k -> pagado
      let updateStatus: string | null = null
      mockDbExecute.mockImplementation((...args: any[]) => {
        const s = sqlText(args)
        if (s.includes('FROM purchase_invoices pi') && s.includes('applied_cash')) {
          return Promise.resolve({
            rows: [{ total: '121000', applied_cash: '100000', retenciones_total: '21000' }],
          })
        }
        if (s.includes('UPDATE purchase_invoices SET payment_status')) {
          // Capture the status from the template values
          updateStatus = args[0].values?.[0] ?? null
          return Promise.resolve({ rows: [] })
        }
        return Promise.resolve({ rows: [] })
      })

      // Call private via cast
      await (service as any).recalculatePurchaseInvoiceStatus(piId)

      expect(updateStatus).toBe('pagado')
    })

    it('marks purchase invoice as parcial when partial cash and no retenciones', async () => {
      let updateStatus: string | null = null
      mockDbExecute.mockImplementation((...args: any[]) => {
        const s = sqlText(args)
        if (s.includes('FROM purchase_invoices pi') && s.includes('applied_cash')) {
          return Promise.resolve({
            rows: [{ total: '10000', applied_cash: '5000', retenciones_total: '0' }],
          })
        }
        if (s.includes('UPDATE purchase_invoices SET payment_status')) {
          updateStatus = args[0].values?.[0] ?? null
          return Promise.resolve({ rows: [] })
        }
        return Promise.resolve({ rows: [] })
      })

      await (service as any).recalculatePurchaseInvoiceStatus(piId)
      expect(updateStatus).toBe('parcial')
    })
  })
})
