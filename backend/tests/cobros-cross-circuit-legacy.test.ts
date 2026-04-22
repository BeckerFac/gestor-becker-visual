/**
 * Cross-circuit validation on the legacy `invoice_id` path.
 *
 * Bug: `POST /api/cobros` with legacy single-invoice `invoice_id` bypassed
 * the Sol/Luna circuit check. A Sol cobro pointing to a Luna invoice was
 * accepted, corrupting the current account (payment vanishes from Luna,
 * invoice stays unpaid).
 *
 * Fix: `validateInvoiceCircuit` helper applies the same fiscal_type rule
 * to BOTH legacy `invoice_id` and `invoice_items[]`.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mockDbExecute, mockPoolQuery, resetMocks } from './helpers/setup'

vi.mock('../src/modules/orders/orders.service', () => {
  return {
    ordersService: {
      lockOrder: vi.fn().mockResolvedValue(undefined),
      unlockOrder: vi.fn().mockResolvedValue(undefined),
    },
    OrdersService: class {},
  }
})

import { CobrosService } from '../src/modules/cobros/cobros.service'

describe('CobrosService cross-circuit validation (legacy invoice_id path)', () => {
  let svc: CobrosService

  beforeEach(() => {
    resetMocks()
    svc = new CobrosService()
    ;(svc as any).tablesEnsured = true
  })

  /**
   * Prime mocks for createCobro with a single legacy invoice_id.
   *
   * - `invoiceFiscalType`: what the circuit-check pool.query returns
   *   for the given invoice id ('fiscal' | 'no_fiscal').
   * - `invoiceExists`: whether the legacy pre-create payment_status check
   *   returns a row (false -> skip, we only care about the circuit guard).
   */
  function primeLegacyCobro(opts: {
    invoiceId: string
    invoiceFiscalType: 'fiscal' | 'no_fiscal'
    cobroFinalRow?: any
  }) {
    mockPoolQuery.mockImplementation((sqlStr: any, _params?: any[]) => {
      if (
        typeof sqlStr === 'string' &&
        sqlStr.includes('FROM invoices') &&
        sqlStr.includes('fiscal_type') &&
        sqlStr.includes('ANY(')
      ) {
        return Promise.resolve({
          rows: [{ id: opts.invoiceId, fiscal_type: opts.invoiceFiscalType }],
        })
      }
      return Promise.resolve({ rows: [] })
    })
    mockDbExecute.mockImplementation((...args: any[]) => {
      const tpl = args[0]
      const s = tpl?.strings ? tpl.strings.join('') : ''
      if (s.includes('FROM banks WHERE id')) return Promise.resolve({ rows: [{ id: 'bank-1' }] })
      if (s.includes('FROM business_units')) return Promise.resolve({ rows: [{ id: 'bu-1' }] })
      // Legacy invoice_id pre-check (payment_status). Mark as pending so it
      // doesn't short-circuit with "already paid".
      if (s.includes('FROM invoices WHERE id') && s.includes('payment_status')) {
        return Promise.resolve({
          rows: [{ invoice_number: 1, invoice_type: 'A', payment_status: 'pendiente' }],
        })
      }
      if (s.includes('COALESCE(MAX(receipt_number)')) {
        return Promise.resolve({ rows: [{ next_number: '1' }] })
      }
      if (s.includes('FROM cobros c') && s.includes('LEFT JOIN enterprises e')) {
        return Promise.resolve({
          rows: [opts.cobroFinalRow || { id: 'cob-1', fiscal_type: 'fiscal' }],
        })
      }
      return Promise.resolve({ rows: [] })
    })
  }

  const legacyPayload = (extra: any = {}) => ({
    enterprise_id: null,
    amount: 1000,
    payment_method: 'transferencia',
    bank_id: 'bank-1',
    payment_methods: [{ method: 'transferencia', amount: 1000, bank_id: 'bank-1' }],
    payment_date: '2026-04-14',
    invoice_id: 'inv-legacy-1',
    // NOTE: no invoice_items[] — this is the legacy path.
    ...extra,
  })

  it('T1: Sol cobro + legacy invoice_id pointing to Luna invoice → 400', async () => {
    primeLegacyCobro({ invoiceId: 'inv-legacy-1', invoiceFiscalType: 'no_fiscal' })
    await expect(
      svc.createCobro(
        'company-1',
        'user-1',
        legacyPayload({ fiscal_type: 'fiscal' }),
        { userCanAccessLuna: true },
      ),
    ).rejects.toMatchObject({
      statusCode: 400,
      message: expect.stringMatching(/otro circuito/i),
    })
  })

  it('T2: Luna cobro + legacy invoice_id pointing to Sol invoice → 400', async () => {
    primeLegacyCobro({ invoiceId: 'inv-legacy-1', invoiceFiscalType: 'fiscal' })
    await expect(
      svc.createCobro(
        'company-1',
        'user-1',
        legacyPayload({ fiscal_type: 'no_fiscal' }),
        { userCanAccessLuna: true },
      ),
    ).rejects.toMatchObject({
      statusCode: 400,
      message: expect.stringMatching(/otro circuito/i),
    })
  })

  it('T3: Sol cobro + legacy invoice_id pointing to Sol invoice → 201 (success)', async () => {
    primeLegacyCobro({
      invoiceId: 'inv-legacy-1',
      invoiceFiscalType: 'fiscal',
      cobroFinalRow: { id: 'cob-1', fiscal_type: 'fiscal' },
    })
    const out = await svc.createCobro(
      'company-1',
      'user-1',
      legacyPayload({ fiscal_type: 'fiscal' }),
      { userCanAccessLuna: false },
    )
    expect(out).toBeDefined()
    expect(out.id).toBe('cob-1')
  })

  it('T4: Sol cobro + invoice_items[] with mixed circuits → 400 (regression)', async () => {
    // Two invoices: one Sol, one Luna. Even though the cobro is Sol,
    // the Luna invoice in the array must trigger the circuit error.
    mockPoolQuery.mockImplementation((sqlStr: any, _params?: any[]) => {
      if (
        typeof sqlStr === 'string' &&
        sqlStr.includes('FROM invoices') &&
        sqlStr.includes('fiscal_type') &&
        sqlStr.includes('ANY(')
      ) {
        return Promise.resolve({
          rows: [
            { id: 'inv-1', fiscal_type: 'fiscal' },
            { id: 'inv-2', fiscal_type: 'no_fiscal' },
          ],
        })
      }
      return Promise.resolve({ rows: [] })
    })
    mockDbExecute.mockImplementation((...args: any[]) => {
      const tpl = args[0]
      const s = tpl?.strings ? tpl.strings.join('') : ''
      if (s.includes('FROM banks WHERE id')) return Promise.resolve({ rows: [{ id: 'bank-1' }] })
      if (s.includes('FROM business_units')) return Promise.resolve({ rows: [{ id: 'bu-1' }] })
      if (s.includes('FROM invoices WHERE id') && s.includes('payment_status')) {
        return Promise.resolve({ rows: [] })
      }
      return Promise.resolve({ rows: [] })
    })

    await expect(
      svc.createCobro(
        'company-1',
        'user-1',
        {
          enterprise_id: null,
          amount: 1000,
          payment_method: 'transferencia',
          bank_id: 'bank-1',
          payment_methods: [{ method: 'transferencia', amount: 1000, bank_id: 'bank-1' }],
          payment_date: '2026-04-14',
          fiscal_type: 'fiscal',
          invoice_items: [
            { invoice_id: 'inv-1', amount: 500 },
            { invoice_id: 'inv-2', amount: 500 },
          ],
        },
        { userCanAccessLuna: true },
      ),
    ).rejects.toMatchObject({
      statusCode: 400,
      message: expect.stringMatching(/otro circuito/i),
    })
  })
})
