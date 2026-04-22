import { describe, it, expect, beforeEach } from 'vitest'
import { mockDbExecute, mockClientQuery, resetMocks } from './helpers/setup'

import { PagosService } from '../src/modules/pagos/pagos.service'

describe('PagosService - FLOW 46 + bug-pack C1..C5 fixes', () => {
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

  function sqlText(args: any[]): string {
    const tpl = args[0]
    return tpl?.strings ? tpl.strings.join(' ') : ''
  }

  // Default dispatch for db.execute (pre-tx reads + final read-back).
  function setupDbExecute(opts: {
    piStatus?: string
    piEnterpriseId?: string
    piBusinessUnitId?: string
    enterpriseFound?: boolean
    bankFound?: boolean
  } = {}) {
    const piEnt = opts.piEnterpriseId ?? enterpriseId
    const enterpriseFound = opts.enterpriseFound ?? true
    const bankFound = opts.bankFound ?? true

    mockDbExecute.mockImplementation((...args: any[]) => {
      const s = sqlText(args)
      if (s.includes('CREATE TABLE') || s.includes('ALTER TABLE') || s.includes('CREATE INDEX')) {
        return Promise.resolve({ rows: [] })
      }
      if (s.includes('FROM business_units WHERE company_id')) {
        return Promise.resolve({ rows: [{ id: buId }] })
      }
      if (s.includes('FROM enterprises WHERE id')) {
        return Promise.resolve({ rows: enterpriseFound ? [{ id: enterpriseId }] : [] })
      }
      if (s.includes('FROM banks WHERE id')) {
        return Promise.resolve({ rows: bankFound ? [{ id: bankId }] : [] })
      }
      if (s.includes('FROM pagos p') && s.includes('WHERE p.id =')) {
        return Promise.resolve({ rows: [{ id: 'new-pago', amount: '10000' }] })
      }
      return Promise.resolve({ rows: [] })
    })
  }

  // Default dispatch for pool.connect client (BEGIN/FOR UPDATE/INSERTs/COMMIT).
  function setupClientQuery(opts: {
    piTotal?: string
    piApplied?: string
    piRetenciones?: string
    piStatus?: string
    piEnterpriseId?: string
    piBusinessUnitId?: string
    lockedPago?: any
    chequesOnPago?: any[]
    endorsedCheques?: any[]
    linkedInvoicesOnAnular?: any[]
  } = {}) {
    const piTotal = opts.piTotal ?? '10000'
    const piApplied = opts.piApplied ?? '0'
    const piRetenciones = opts.piRetenciones ?? '0'
    const piStatus = opts.piStatus ?? 'active'
    const piEnt = opts.piEnterpriseId ?? enterpriseId
    const piBu = opts.piBusinessUnitId ?? buId

    mockClientQuery.mockImplementation((...args: any[]) => {
      const q = (args[0] || '').toString()

      if (q === 'BEGIN' || q === 'COMMIT' || q === 'ROLLBACK') {
        return Promise.resolve({ rows: [] })
      }
      // Lock on purchase_invoices (createPago)
      if (/FROM purchase_invoices[\s\S]*FOR UPDATE/.test(q)) {
        return Promise.resolve({
          rows: [{
            id: piId, company_id: companyId,
            enterprise_id: piEnt, business_unit_id: piBu,
            status: piStatus, total: piTotal,
          }],
        })
      }
      // Balance read for locked PI
      if (q.includes('pago_invoice_applications') && q.includes('retenciones_total') && q.includes('SELECT')) {
        return Promise.resolve({
          rows: [{ applied: piApplied, retenciones_total: piRetenciones }],
        })
      }
      // Lock on pagos (anularPago)
      if (/FROM pagos[\s\S]*FOR UPDATE/.test(q)) {
        return Promise.resolve({ rows: opts.lockedPago ? [opts.lockedPago] : [] })
      }
      // Cheques linked via pago_id (anularPago)
      if (q.includes('FROM cheques WHERE pago_id')) {
        return Promise.resolve({ rows: opts.chequesOnPago || [] })
      }
      if (q.includes('endorsed_pago_id =')) {
        return Promise.resolve({ rows: opts.endorsedCheques || [] })
      }
      if (q.includes('DISTINCT purchase_invoice_id FROM pago_invoice_applications')) {
        return Promise.resolve({ rows: opts.linkedInvoicesOnAnular || [] })
      }
      // Recalc queries inside tx
      if (q.includes('CAST(pi.total_amount AS decimal)') && q.includes('applied_cash')) {
        return Promise.resolve({
          rows: [{ total: piTotal, applied_cash: piApplied, retenciones_total: piRetenciones }],
        })
      }
      if (q.includes('SELECT purchase_id FROM purchase_invoices')) {
        return Promise.resolve({ rows: [{ purchase_id: null }] })
      }
      // All INSERT/UPDATE statements
      return Promise.resolve({ rows: [], rowCount: 1 })
    })
  }

  describe('Bug A: payment_methods array processing (regression)', () => {
    it('inserts 2 cheques with direction=emitido when payment_methods has 2 cheques', async () => {
      setupDbExecute()
      setupClientQuery()

      const chequeInserts: string[] = []
      const origImpl = mockClientQuery.getMockImplementation()!
      mockClientQuery.mockImplementation((...args: any[]) => {
        const q = (args[0] || '').toString()
        if (q.includes('INSERT INTO cheques')) chequeInserts.push(q)
        return origImpl(...args)
      })

      await service.createPago(companyId, userId, {
        enterprise_id: enterpriseId,
        business_unit_id: buId,
        payment_methods: [
          {
            method: 'cheque', amount: 5000,
            cheque_data: {
              number: '00001', bank: 'Galicia', drawer: 'Acme SA',
              issue_date: '2026-01-01', due_date: '2026-02-01', cheque_type: 'propio',
            },
          },
          {
            method: 'cheque', amount: 5000,
            cheque_data: {
              number: '00002', bank: 'Santander', drawer: 'Acme SA',
              issue_date: '2026-01-01', due_date: '2026-02-15', cheque_type: 'propio',
            },
          },
        ],
      })

      expect(chequeInserts.length).toBe(2)
      expect(chequeInserts[0]).toContain("'emitido'")
    })

    it('throws 400 when cheque payment method has incomplete cheque_data', async () => {
      setupDbExecute()
      setupClientQuery()

      await expect(
        service.createPago(companyId, userId, {
          enterprise_id: enterpriseId,
          payment_methods: [
            { method: 'cheque', amount: 5000, cheque_data: { number: '00001' } },
          ],
        })
      ).rejects.toThrow(/Cheque incompleto/)
    })

    it('throws 400 when transferencia in payment_methods lacks bank_id', async () => {
      setupDbExecute()
      setupClientQuery()

      await expect(
        service.createPago(companyId, userId, {
          enterprise_id: enterpriseId,
          payment_methods: [{ method: 'transferencia', amount: 1000 }],
        })
      ).rejects.toThrow(/Transferencia requiere bank_id/)
    })

    // H18: frontend sends 'cheque_emitido' for own cheques. Backend previously
    // only matched 'cheque', so cheque_emitido rows were silently dropped and
    // multi-method combos (transferencia + cheque_emitido) could 500. This
    // test pins: multi-method POST creates 1 cheque + 2 pago_payment_methods.
    it('multi-method (transferencia + cheque_emitido) creates exactly 1 cheque row + 2 pago_payment_methods', async () => {
      setupDbExecute()
      setupClientQuery()

      const chequeInserts: string[] = []
      const pmInserts: string[] = []
      const origImpl = mockClientQuery.getMockImplementation()!
      mockClientQuery.mockImplementation((...args: any[]) => {
        const q = (args[0] || '').toString()
        if (q.includes('INSERT INTO cheques')) chequeInserts.push(q)
        if (q.includes('INSERT INTO pago_payment_methods')) pmInserts.push(q)
        return origImpl(...args)
      })

      await service.createPago(companyId, userId, {
        enterprise_id: enterpriseId,
        business_unit_id: buId,
        payment_methods: [
          { method: 'transferencia', amount: 3000, bank_id: bankId, reference: 'TRF-1' },
          {
            method: 'cheque_emitido', amount: 2000,
            cheque_data: {
              number: '00077', bank: 'Galicia', drawer: 'Acme SA',
              issue_date: '2026-04-01', due_date: '2026-05-01', cheque_type: 'propio',
            },
          },
        ],
      })

      expect(pmInserts.length).toBe(2)
      expect(chequeInserts.length).toBe(1)
      expect(chequeInserts[0]).toContain("'emitido'")
    })

    it('cheque_emitido with missing cheque_data fails validation (400, not 500)', async () => {
      setupDbExecute()
      setupClientQuery()

      await expect(
        service.createPago(companyId, userId, {
          enterprise_id: enterpriseId,
          payment_methods: [
            { method: 'cheque_emitido', amount: 1000, cheque_data: { number: '1' } },
          ],
        })
      ).rejects.toThrow(/Cheque incompleto/)
    })
  })

  describe('Bug B: IDOR + integrity validations', () => {
    it('throws 400 when bank_id does not belong to user company', async () => {
      setupDbExecute({ bankFound: false })
      setupClientQuery()

      await expect(
        service.createPago(companyId, userId, {
          enterprise_id: enterpriseId,
          payment_method: 'transferencia',
          bank_id: 'bank-from-other-company',
          amount: 1000,
        })
      ).rejects.toThrow(/Banco invalido/)
    })

    it('throws 400 when paying a cancelled purchase invoice (validated inside tx)', async () => {
      setupDbExecute()
      setupClientQuery({ piStatus: 'cancelled' })

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

    it('throws 400 on over-payment (exceeds remaining balance, in-tx)', async () => {
      setupDbExecute()
      setupClientQuery({ piTotal: '10000', piApplied: '8000' })

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
      setupDbExecute({ enterpriseFound: false })
      setupClientQuery()

      await expect(
        service.createPago(companyId, userId, {
          enterprise_id: 'enterprise-from-other-company',
          payment_method: 'efectivo',
          amount: 1000,
        })
      ).rejects.toThrow(/Empresa proveedora invalida/)
    })
  })

  describe('Bug C2: validations run inside transaction (TOCTOU)', () => {
    it('locks purchase_invoice with FOR UPDATE inside BEGIN/COMMIT', async () => {
      setupDbExecute()
      setupClientQuery()

      const queriesInOrder: string[] = []
      const origImpl = mockClientQuery.getMockImplementation()!
      mockClientQuery.mockImplementation((...args: any[]) => {
        queriesInOrder.push((args[0] || '').toString())
        return origImpl(...args)
      })

      await service.createPago(companyId, userId, {
        enterprise_id: enterpriseId,
        business_unit_id: buId,
        payment_method: 'efectivo',
        amount: 5000,
        purchase_invoice_items: [{ purchase_invoice_id: piId, amount: 5000 }],
      })

      const beginIdx = queriesInOrder.findIndex(q => q === 'BEGIN')
      const lockIdx = queriesInOrder.findIndex(q => /FOR UPDATE/.test(q))
      const commitIdx = queriesInOrder.findIndex(q => q === 'COMMIT')
      expect(beginIdx).toBeGreaterThanOrEqual(0)
      expect(lockIdx).toBeGreaterThan(beginIdx)
      expect(commitIdx).toBeGreaterThan(lockIdx)
    })
  })

  describe('Bug C3: retenciones INSERTed with purchase_invoice_id', () => {
    it('sets purchase_invoice_id on explicit retencion when a single invoice is paid', async () => {
      setupDbExecute()
      setupClientQuery({ piTotal: '121000' })

      const retencionInserts: Array<{ q: string; params: any[] }> = []
      const origImpl = mockClientQuery.getMockImplementation()!
      mockClientQuery.mockImplementation((...args: any[]) => {
        const q = (args[0] || '').toString()
        if (q.includes('INSERT INTO retenciones')) {
          retencionInserts.push({ q, params: args[1] })
        }
        return origImpl(...args)
      })

      await service.createPago(companyId, userId, {
        enterprise_id: enterpriseId,
        business_unit_id: buId,
        payment_method: 'transferencia',
        bank_id: bankId,
        amount: 100000,
        purchase_invoice_items: [{ purchase_invoice_id: piId, amount: 100000 }],
        retenciones: [
          { type: 'ganancias', base_amount: 100000, rate: 21, amount: 21000 },
        ],
      })

      expect(retencionInserts.length).toBe(1)
      // Params positions: see service — purchase_invoice_id is at index 6 (0-based)
      // [id, companyId, type, regime, enterprise_id, pago_id, purchase_invoice_id, ...]
      const params = retencionInserts[0].params
      expect(params[6]).toBe(piId)
    })

    it('throws 400 when multiple invoices are paid and retencion has no explicit purchase_invoice_id', async () => {
      setupDbExecute()
      setupClientQuery()

      await expect(
        service.createPago(companyId, userId, {
          enterprise_id: enterpriseId,
          business_unit_id: buId,
          payment_method: 'efectivo',
          amount: 10000,
          purchase_invoice_items: [
            { purchase_invoice_id: 'pi-A', amount: 5000 },
            { purchase_invoice_id: 'pi-B', amount: 5000 },
          ],
          retenciones: [
            { type: 'ganancias', base_amount: 10000, rate: 2, amount: 200 },
          ],
        })
      ).rejects.toThrow(/purchase_invoice_id/)
    })
  })

  describe('Bug C5: explicit retenciones are validated', () => {
    it('throws 400 when rate > 100', async () => {
      setupDbExecute()
      setupClientQuery()

      await expect(
        service.createPago(companyId, userId, {
          enterprise_id: enterpriseId,
          business_unit_id: buId,
          payment_method: 'efectivo',
          amount: 5000,
          retenciones: [
            { type: 'ganancias', base_amount: 5000, rate: 150, amount: 7500 },
          ],
        })
      ).rejects.toThrow(/Alicuota/)
    })

    it('throws 400 when IIBB retencion is missing jurisdiction', async () => {
      setupDbExecute()
      setupClientQuery()

      await expect(
        service.createPago(companyId, userId, {
          enterprise_id: enterpriseId,
          business_unit_id: buId,
          payment_method: 'efectivo',
          amount: 5000,
          retenciones: [
            { type: 'iibb', base_amount: 5000, rate: 3, amount: 150 },
          ],
        })
      ).rejects.toThrow(/jurisdiccion/i)
    })

    it('throws 400 when amount does not match base*rate within tolerance', async () => {
      setupDbExecute()
      setupClientQuery()

      await expect(
        service.createPago(companyId, userId, {
          enterprise_id: enterpriseId,
          business_unit_id: buId,
          payment_method: 'efectivo',
          amount: 5000,
          retenciones: [
            // base 5000 * 2% = 100. Sending 999 is way off.
            { type: 'ganancias', base_amount: 5000, rate: 2, amount: 999 },
          ],
        })
      ).rejects.toThrow(/inconsistente/)
    })
  })

  describe('Bug C1: anularPago (soft-delete parity with cobros)', () => {
    it('throws 400 when reason is shorter than 5 chars', async () => {
      setupDbExecute()
      setupClientQuery()
      await expect(
        service.anularPago(companyId, 'pago-x', userId, 'oops')
      ).rejects.toThrow(/Motivo/)
    })

    it('throws 404 when pago not found', async () => {
      setupDbExecute()
      setupClientQuery({ lockedPago: undefined })

      await expect(
        service.anularPago(companyId, 'pago-missing', userId, 'cobro duplicado')
      ).rejects.toThrow(/no encontrado/)
    })

    it('throws 409 when pago already anulado (idempotency guard)', async () => {
      setupDbExecute()
      setupClientQuery({
        lockedPago: { id: 'pago-x', company_id: companyId, status: 'anulado', payment_method: 'efectivo' },
      })

      await expect(
        service.anularPago(companyId, 'pago-x', userId, 'duplicate anular')
      ).rejects.toThrow(/ya esta anulado/)
    })

    it('marks emitido cheques as anulado and reverts endorsed cheques to a_cobrar', async () => {
      setupDbExecute()
      setupClientQuery({
        lockedPago: { id: 'pago-x', company_id: companyId, status: 'activo', payment_method: 'mixto' },
        chequesOnPago: [{ id: 'ch-1', direction: 'emitido', status: 'emitido' }],
        endorsedCheques: [{ id: 'ch-2' }],
        linkedInvoicesOnAnular: [{ purchase_invoice_id: piId }],
      })

      const updates: string[] = []
      const origImpl = mockClientQuery.getMockImplementation()!
      mockClientQuery.mockImplementation((...args: any[]) => {
        const q = (args[0] || '').toString()
        if (q.includes('UPDATE cheques')) updates.push(q)
        if (q.includes("status='anulado'") || q.includes("status = 'anulado'")) updates.push(q)
        return origImpl(...args)
      })

      const res = await service.anularPago(companyId, 'pago-x', userId, 'motivo valido')
      expect(res.status).toBe('anulado')
      // Must have updated the emitido cheque to 'anulado'
      expect(updates.some(q => q.includes("status='anulado'"))).toBe(true)
      // Must have reverted an endorsed cheque to 'a_cobrar'
      expect(updates.some(q => q.includes("status='a_cobrar'"))).toBe(true)
    })

    it('wraps everything in BEGIN/COMMIT and recalculates affected invoices', async () => {
      setupDbExecute()
      setupClientQuery({
        lockedPago: { id: 'pago-x', company_id: companyId, status: 'activo', payment_method: 'efectivo' },
        chequesOnPago: [],
        endorsedCheques: [],
        linkedInvoicesOnAnular: [{ purchase_invoice_id: piId }],
      })

      const queries: string[] = []
      const origImpl = mockClientQuery.getMockImplementation()!
      mockClientQuery.mockImplementation((...args: any[]) => {
        queries.push((args[0] || '').toString())
        return origImpl(...args)
      })

      await service.anularPago(companyId, 'pago-x', userId, 'baja por error')

      const beginIdx = queries.findIndex(q => q === 'BEGIN')
      const recalcIdx = queries.findIndex(q => q.includes('UPDATE purchase_invoices SET payment_status'))
      const commitIdx = queries.findIndex(q => q === 'COMMIT')
      expect(beginIdx).toBeGreaterThanOrEqual(0)
      expect(recalcIdx).toBeGreaterThan(beginIdx)
      expect(commitIdx).toBeGreaterThan(recalcIdx)
    })
  })
})
