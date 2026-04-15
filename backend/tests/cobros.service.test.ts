import { describe, it, expect, beforeEach } from 'vitest'
import { mockDbExecute, resetMocks } from './helpers/setup'

import { CobrosService } from '../src/modules/cobros/cobros.service'

/**
 * Tests for the 3 critical bug fixes in cobros.service.ts:
 *
 * Bug A: cheques INSERT used nonexistent columns (cheque_number, bank_name, etc).
 *        Fix mirrors receipts.service.ts using real schema (number, bank, drawer, ...).
 *
 * Bug B: createCobro with invoice_items[] missed validations (tenant, status, NC,
 *        balance) and lacked SELECT FOR UPDATE -> race condition + IDOR.
 *
 * Bug C: recalculateInvoicePaymentStatus ignored retenciones sufridas, leaving
 *        invoices stuck as "parcial" when cobro+retencion fully covered them.
 */
describe('CobrosService - critical bug fixes', () => {
  let service: CobrosService
  const companyId = 'company-1'
  const userId = 'user-1'
  const enterpriseId = 'ent-1'
  const businessUnitId = 'bu-1'

  beforeEach(() => {
    resetMocks()
    service = new CobrosService()
    // Pretend tables already ensured to skip DDL noise.
    ;(service as any).tablesEnsured = true
  })

  // Helper: extract SQL string from a mockDbExecute call argument.
  function sqlOf(call: any): string {
    const tpl = call?.[0]
    return tpl?.strings ? tpl.strings.join('') : ''
  }

  // -------- Bug A: cheques INSERT uses correct schema --------
  describe('Bug A - cheques INSERT columns', () => {
    it('inserts cheques using number/bank/drawer/cheque_type, not legacy column names', async () => {
      // Configure mocks for createCobro happy path with one cheque payment method.
      mockDbExecute.mockImplementation((...args: any[]) => {
        const s = sqlOf(args)
        // Default business unit auto-assign lookup
        if (s.includes('FROM business_units')) return Promise.resolve({ rows: [{ id: businessUnitId }] })
        // Bank validation — none here (cheque has no bank_id, just bank string)
        if (s.includes('FROM banks WHERE id')) return Promise.resolve({ rows: [{ id: 'b' }] })
        // Receipt number sequence
        if (s.includes('MAX(receipt_number)')) return Promise.resolve({ rows: [{ next_number: 1 }] })
        // Final SELECT after insert
        if (s.includes('FROM cobros c') && s.includes('LEFT JOIN enterprises')) {
          return Promise.resolve({ rows: [{ id: 'cobro-x' }] })
        }
        // BEGIN, COMMIT, INSERT statements: just resolve empty
        return Promise.resolve({ rows: [] })
      })

      await service.createCobro(companyId, userId, {
        enterprise_id: enterpriseId,
        business_unit_id: businessUnitId,
        currency: 'ARS',
        payment_methods: [
          {
            method: 'cheque',
            amount: 5000,
            cheque_data: {
              number: '12345',
              bank: 'Galicia',
              drawer: 'Juan Perez',
              drawer_cuit: '20-12345678-9',
              cheque_type: 'propio',
              issue_date: '2026-04-01',
              due_date: '2026-05-01',
            },
          },
        ],
      })

      // Find the cheques INSERT call
      const calls = mockDbExecute.mock.calls
      const chequeInsert = calls.find((c: any) => sqlOf(c).includes('INSERT INTO cheques'))
      expect(chequeInsert, 'cheques INSERT must have been called').toBeTruthy()
      const sqlStr = sqlOf(chequeInsert)
      // Must contain real column names
      expect(sqlStr).toContain('number')
      expect(sqlStr).toContain('bank')
      expect(sqlStr).toContain('drawer')
      expect(sqlStr).toContain('cheque_type')
      expect(sqlStr).toContain('due_date')
      expect(sqlStr).toContain('cobro_id')
      // Must NOT contain legacy/broken column names
      expect(sqlStr).not.toContain('cheque_number')
      expect(sqlStr).not.toContain('bank_name')
      expect(sqlStr).not.toContain('issuer_name')
      expect(sqlStr).not.toContain('issuer_cuit')
      // tipo without the cheque_ prefix — ensure not used (was the broken column)
      expect(sqlStr).not.toMatch(/,\s*tipo[,)\s]/)
    })
  })

  // -------- Bug B: validations on invoice_items + FOR UPDATE --------
  describe('Bug B - invoice validations and FOR UPDATE', () => {
    function setupMocks(invoiceRow: any) {
      mockDbExecute.mockImplementation((...args: any[]) => {
        const s = sqlOf(args)
        if (s.includes('FROM business_units')) return Promise.resolve({ rows: [{ id: businessUnitId }] })
        if (s.includes('FROM banks WHERE id')) return Promise.resolve({ rows: [{ id: 'b' }] })
        if (s.includes('MAX(receipt_number)')) return Promise.resolve({ rows: [{ next_number: 1 }] })
        // Pre-tx legacy direct invoice_id check (data.invoice_id path)
        if (s.includes('FROM invoices WHERE id') && s.includes('payment_status') && !s.includes('FOR UPDATE')) {
          return Promise.resolve({ rows: [] })
        }
        // The new FOR UPDATE inside-tx invoice lock
        if (s.includes('FROM invoices') && s.includes('FOR UPDATE')) {
          return Promise.resolve({ rows: invoiceRow ? [invoiceRow] : [] })
        }
        // Balance subquery (uses retenciones_total)
        if (s.includes('retenciones_total') || (s.includes('applied_cash') && s.includes('SELECT'))) {
          return Promise.resolve({
            rows: [{ total: invoiceRow?.total_amount || '0', applied_cash: '0', retenciones_total: '0' }],
          })
        }
        if (s.includes('FROM cobros c') && s.includes('LEFT JOIN enterprises')) {
          return Promise.resolve({ rows: [{ id: 'cobro-x' }] })
        }
        return Promise.resolve({ rows: [] })
      })
    }

    const baseData = {
      enterprise_id: enterpriseId,
      business_unit_id: businessUnitId,
      currency: 'ARS',
      payment_methods: [{ method: 'efectivo', amount: 1000 }],
      invoice_items: [{ invoice_id: 'inv-1', amount: 1000 }],
    }

    it('rejects invoice belonging to a different enterprise', async () => {
      setupMocks({
        id: 'inv-1',
        enterprise_id: 'ent-OTHER',
        business_unit_id: businessUnitId,
        status: 'active',
        payment_status: 'pendiente',
        invoice_type: 'A',
        invoice_number: '0001-00000001',
        total_amount: '1000',
      })
      await expect(service.createCobro(companyId, userId, baseData)).rejects.toThrow(/otro cliente/i)
    })

    it('rejects cancelled invoice', async () => {
      setupMocks({
        id: 'inv-1',
        enterprise_id: enterpriseId,
        business_unit_id: businessUnitId,
        status: 'cancelled',
        payment_status: 'pendiente',
        invoice_type: 'A',
        invoice_number: '0001-00000001',
        total_amount: '1000',
      })
      await expect(service.createCobro(companyId, userId, baseData)).rejects.toThrow(/cancelada/i)
    })

    it('rejects credit note (NC_A)', async () => {
      setupMocks({
        id: 'inv-1',
        enterprise_id: enterpriseId,
        business_unit_id: businessUnitId,
        status: 'active',
        payment_status: 'pendiente',
        invoice_type: 'NC_A',
        invoice_number: '0001-00000001',
        total_amount: '1000',
      })
      await expect(service.createCobro(companyId, userId, baseData)).rejects.toThrow(/Notas de Credito/i)
    })

    it('uses SELECT FOR UPDATE to lock invoice rows in transaction', async () => {
      setupMocks({
        id: 'inv-1',
        enterprise_id: enterpriseId,
        business_unit_id: businessUnitId,
        status: 'active',
        payment_status: 'pendiente',
        invoice_type: 'A',
        invoice_number: '0001-00000001',
        total_amount: '5000',
      })
      await service.createCobro(companyId, userId, baseData)
      const calls = mockDbExecute.mock.calls
      const lockCall = calls.find((c: any) => {
        const s = sqlOf(c)
        return s.includes('FROM invoices') && s.includes('FOR UPDATE')
      })
      expect(lockCall, 'must lock invoice with FOR UPDATE').toBeTruthy()
    })

    it('rejects bank_id that does not belong to the company (IDOR)', async () => {
      mockDbExecute.mockImplementation((...args: any[]) => {
        const s = sqlOf(args)
        if (s.includes('FROM business_units')) return Promise.resolve({ rows: [{ id: businessUnitId }] })
        if (s.includes('FROM banks WHERE id')) return Promise.resolve({ rows: [] }) // not found
        return Promise.resolve({ rows: [] })
      })
      await expect(
        service.createCobro(companyId, userId, {
          enterprise_id: enterpriseId,
          business_unit_id: businessUnitId,
          currency: 'ARS',
          bank_id: 'foreign-bank',
          payment_methods: [{ method: 'transferencia', amount: 1000, bank_id: 'foreign-bank' }],
        })
      ).rejects.toThrow(/no pertenece/i)
    })
  })

  // -------- Bug C: recalculateInvoicePaymentStatus uses retenciones --------
  describe('Bug C - recalculate considers retenciones sufridas', () => {
    it('marks invoice pagado when applied_cash + retenciones >= total', async () => {
      // Capture the UPDATE statement to verify the chosen status
      let chosenStatus: string | null = null

      mockDbExecute.mockImplementation((...args: any[]) => {
        const tpl = args[0]
        const s = sqlOf(args)
        if (s.includes('FROM invoices i') && s.includes('retenciones_total')) {
          return Promise.resolve({
            rows: [{ total: '121000', applied_cash: '100000', retenciones_total: '21000' }],
          })
        }
        if (s.includes('UPDATE invoices SET payment_status')) {
          chosenStatus = tpl?.values?.[0] ?? null
          return Promise.resolve({ rows: [] })
        }
        return Promise.resolve({ rows: [] })
      })

      // Call private method directly (cast)
      await (service as any).recalculateInvoicePaymentStatus('inv-1')
      expect(chosenStatus).toBe('pagado')
    })

    it('marks invoice parcial when applied < total (no retenciones)', async () => {
      let chosenStatus: string | null = null
      mockDbExecute.mockImplementation((...args: any[]) => {
        const tpl = args[0]
        const s = sqlOf(args)
        if (s.includes('FROM invoices i') && s.includes('retenciones_total')) {
          return Promise.resolve({
            rows: [{ total: '100000', applied_cash: '40000', retenciones_total: '0' }],
          })
        }
        if (s.includes('UPDATE invoices SET payment_status')) {
          chosenStatus = tpl?.values?.[0] ?? null
          return Promise.resolve({ rows: [] })
        }
        return Promise.resolve({ rows: [] })
      })
      await (service as any).recalculateInvoicePaymentStatus('inv-1')
      expect(chosenStatus).toBe('parcial')
    })

    it('uses 0.01 epsilon tolerance for float rounding', async () => {
      let chosenStatus: string | null = null
      mockDbExecute.mockImplementation((...args: any[]) => {
        const tpl = args[0]
        const s = sqlOf(args)
        if (s.includes('FROM invoices i') && s.includes('retenciones_total')) {
          return Promise.resolve({
            // 99.995 is within 0.01 of 100 — should still be pagado
            rows: [{ total: '100', applied_cash: '99.995', retenciones_total: '0' }],
          })
        }
        if (s.includes('UPDATE invoices SET payment_status')) {
          chosenStatus = tpl?.values?.[0] ?? null
          return Promise.resolve({ rows: [] })
        }
        return Promise.resolve({ rows: [] })
      })
      await (service as any).recalculateInvoicePaymentStatus('inv-1')
      expect(chosenStatus).toBe('pagado')
    })
  })
})
