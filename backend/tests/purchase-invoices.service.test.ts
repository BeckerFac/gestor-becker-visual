import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  mockDbExecute,
  mockPoolQuery,
  mockClientQuery,
  resetMocks,
} from './helpers/setup'

import { PurchaseInvoicesService } from '../src/modules/purchase-invoices/purchase-invoices.service'

/**
 * Tests for the 8 critical bug fixes in purchase-invoices.service.ts:
 *
 * C1 Duplicate detection          C5 Soft cancel + reversal
 * C2 Fiscal immutability          C6 purchase_item_id column
 * C3 IDOR on purchase_id          C7 NC of purchase + balance
 * C4 Validations                  C8 Transactional create
 */
describe('PurchaseInvoicesService - critical bug fixes', () => {
  let service: PurchaseInvoicesService
  const companyId = 'company-1'
  const userId = 'user-1'
  const enterpriseId = 'ent-1'
  const businessUnitId = 'bu-1'

  beforeEach(() => {
    resetMocks()
    service = new PurchaseInvoicesService()
  })

  // Mock accounting dynamic import so it never touches DB.
  vi.mock('../src/modules/accounting/accounting-entries.service', () => ({
    accountingEntriesService: {
      createEntryForPurchaseInvoice: vi.fn().mockResolvedValue(undefined),
      createReverseEntry: vi.fn().mockResolvedValue(undefined),
    },
  }))

  // ---------- Helpers ----------
  function baseData(overrides: Partial<any> = {}) {
    return {
      business_unit_id: businessUnitId,
      enterprise_id: enterpriseId,
      invoice_type: 'A',
      punto_venta: '0001',
      invoice_number: '12345678',
      invoice_date: '2024-01-10',
      subtotal: 100,
      vat_amount: 21,
      other_taxes: 0,
      total_amount: 121,
      ...overrides,
    }
  }

  /**
   * Install a queue of responses for mockClientQuery driven by SQL content.
   * We match by first keyword + table to stay robust to whitespace changes.
   */
  function clientQueueHappyPath(opts: {
    buExists?: boolean
    entExists?: boolean
    entCuit?: string
    purchaseRow?: { id: string; enterprise_id: string } | null
    duplicateRow?: { id: string } | null
    originalRow?: { id: string; enterprise_id: string; total_amount: string } | null
  } = {}) {
    const {
      buExists = true,
      entExists = true,
      entCuit = '30712345670', // checksum-OK-ish; validator is relaxed
      purchaseRow = null,
      duplicateRow = null,
      originalRow = null,
    } = opts

    mockClientQuery.mockImplementation(async (textOrTpl: any, _params?: any[]) => {
      const text = typeof textOrTpl === 'string' ? textOrTpl : (textOrTpl?.strings?.join('') || '')
      const t = text.replace(/\s+/g, ' ').trim()

      if (/^BEGIN$|^COMMIT$|^ROLLBACK$/.test(t)) return { rows: [] }

      if (/FROM business_units/i.test(t)) {
        return { rows: buExists ? [{ id: businessUnitId }] : [] }
      }
      if (/FROM enterprises/i.test(t)) {
        return { rows: entExists ? [{ id: enterpriseId, cuit: entCuit }] : [] }
      }
      if (/FROM purchases WHERE id/i.test(t)) {
        return { rows: purchaseRow ? [purchaseRow] : [] }
      }
      if (/FOR UPDATE/i.test(t)) {
        return { rows: [{ id: 'pi-1', status: 'active', enterprise_id: enterpriseId }] }
      }
      if (/FROM purchase_invoices WHERE id = \$1/i.test(t)) {
        // Original-invoice lookup for NC
        return { rows: originalRow ? [originalRow] : [] }
      }
      if (/FROM purchase_invoices .*invoice_number/i.test(t)) {
        // duplicate detection query
        return { rows: duplicateRow ? [duplicateRow] : [] }
      }
      if (/^INSERT INTO purchase_invoices/i.test(t)) return { rows: [] }
      if (/^INSERT INTO purchase_invoice_items/i.test(t)) return { rows: [] }
      if (/^UPDATE purchase_invoices/i.test(t)) return { rows: [] }
      return { rows: [] }
    })
  }

  // ---------- C1: Duplicate detection ----------
  it('C1: duplicate invoice rejected with 409 including existing_id', async () => {
    clientQueueHappyPath({
      duplicateRow: { id: 'existing-pi-id' },
    })
    // getPurchaseInvoice (on success path) uses db.execute — won't be reached here.

    await expect(
      service.createPurchaseInvoice(companyId, userId, baseData()),
    ).rejects.toMatchObject({
      statusCode: 409,
      message: expect.stringContaining('ya fue cargada'),
      details: { existing_id: 'existing-pi-id' },
    })
  })

  // ---------- C2: Fiscal immutability on update ----------
  it('C2: cannot change total_amount when pagos applied → 409', async () => {
    // getPurchaseInvoice returns an active invoice with total 121
    mockDbExecute.mockResolvedValueOnce({
      rows: [{
        id: 'pi-1', company_id: companyId, status: 'active',
        total_amount: '121', invoice_type: 'A', invoice_number: '12345678',
        punto_venta: '0001', invoice_date: '2024-01-10',
      }],
    })
    // pagoCheck query returns has_pagos = true
    mockPoolQuery.mockResolvedValueOnce({ rows: [{ has_pagos: true }] })

    await expect(
      service.updatePurchaseInvoice(companyId, 'pi-1', { total_amount: 999 }),
    ).rejects.toMatchObject({
      statusCode: 409,
      message: expect.stringContaining('bloqueados'),
    })
  })

  it('C2: can still change notes when pagos applied', async () => {
    mockDbExecute.mockResolvedValueOnce({
      rows: [{
        id: 'pi-1', company_id: companyId, status: 'active',
        total_amount: '121', invoice_type: 'A', invoice_number: '12345678',
        punto_venta: '0001', invoice_date: '2024-01-10',
      }],
    })
    mockPoolQuery.mockResolvedValueOnce({ rows: [{ has_pagos: true }] })
    mockPoolQuery.mockResolvedValueOnce({ rows: [] }) // UPDATE
    // Final getPurchaseInvoice
    mockDbExecute.mockResolvedValueOnce({
      rows: [{ id: 'pi-1', notes: 'actualizado' }],
    })

    const result = await service.updatePurchaseInvoice(companyId, 'pi-1', { notes: 'actualizado' })
    expect(result).toMatchObject({ id: 'pi-1' })
  })

  // ---------- C3: IDOR on purchase_id ----------
  it('C3: attaching purchase of another supplier → 400', async () => {
    clientQueueHappyPath({
      purchaseRow: { id: 'purch-1', enterprise_id: 'OTHER-ENT' },
    })

    await expect(
      service.createPurchaseInvoice(companyId, userId, baseData({ purchase_id: 'purch-1' })),
    ).rejects.toMatchObject({
      statusCode: 400,
      message: expect.stringContaining('otro proveedor'),
    })
  })

  // ---------- C4: Validations ----------
  it('C4: invalid invoice_number format → 400', async () => {
    await expect(
      service.createPurchaseInvoice(companyId, userId, baseData({ invoice_number: 'abc-xyz' })),
    ).rejects.toMatchObject({ statusCode: 400, message: expect.stringContaining('numero de factura') })
  })

  it('C4: invoice_date in future → 400', async () => {
    const future = new Date()
    future.setDate(future.getDate() + 30)
    const futureStr = future.toISOString().slice(0, 10)
    await expect(
      service.createPurchaseInvoice(companyId, userId, baseData({ invoice_date: futureStr })),
    ).rejects.toMatchObject({ statusCode: 400, message: expect.stringContaining('futura') })
  })

  it('C4: incoherent totals (subtotal+iva != total) → 400', async () => {
    await expect(
      service.createPurchaseInvoice(
        companyId, userId,
        baseData({ subtotal: 100, vat_amount: 21, other_taxes: 0, total_amount: 200 }),
      ),
    ).rejects.toMatchObject({ statusCode: 400, message: expect.stringContaining('incoherentes') })
  })

  it('C4: CAE not 14 digits → 400', async () => {
    await expect(
      service.createPurchaseInvoice(companyId, userId, baseData({ cae: '12345' })),
    ).rejects.toMatchObject({ statusCode: 400, message: expect.stringContaining('CAE') })
  })

  it('C4: invalid CUIT on supplier → 400', async () => {
    clientQueueHappyPath({ entCuit: '123' }) // bad length
    await expect(
      service.createPurchaseInvoice(companyId, userId, baseData()),
    ).rejects.toMatchObject({ statusCode: 400, message: expect.stringContaining('CUIT') })
  })

  // ---------- C5: Soft-cancel with reversal ----------
  it('C5: cancelPurchaseInvoice requires reason', async () => {
    await expect(
      service.cancelPurchaseInvoice(companyId, 'pi-1', userId, ''),
    ).rejects.toMatchObject({ statusCode: 400, message: expect.stringContaining('Motivo') })
  })

  it('C5: cancelPurchaseInvoice flips status to cancelled and calls reverse entry', async () => {
    clientQueueHappyPath()
    const { accountingEntriesService } = await import('../src/modules/accounting/accounting-entries.service')

    const result = await service.cancelPurchaseInvoice(companyId, 'pi-1', userId, 'Error de carga')
    expect(result).toEqual({ cancelled: true, id: 'pi-1' })
    expect(accountingEntriesService.createReverseEntry).toHaveBeenCalledWith(
      companyId, 'purchase_invoice', 'pi-1',
    )
  })

  it('C5: deletePurchaseInvoice rejected for active invoices', async () => {
    // has_pagos = false
    mockDbExecute.mockResolvedValueOnce({ rows: [{ has_pagos: false }] })
    // getPurchaseInvoice inside delete
    mockDbExecute.mockResolvedValueOnce({
      rows: [{ id: 'pi-1', status: 'active' }],
    })
    await expect(
      service.deletePurchaseInvoice(companyId, 'pi-1'),
    ).rejects.toMatchObject({ statusCode: 409, message: expect.stringContaining('draft') })
  })

  // ---------- C6: purchase_item_id column exists (referenced by service) ----------
  it('C6: getAvailablePurchaseItemsForInvoicing executes without schema error', async () => {
    mockDbExecute.mockResolvedValueOnce({
      rows: [{
        purchase_id: 'p-1', purchase_item_id: 'pi-item-1',
        product_name: 'Widget', quantity: '10', qty_invoiced: '3', qty_remaining: '7',
      }],
    })
    const rows = await service.getAvailablePurchaseItemsForInvoicing(companyId, { enterprise_id: enterpriseId })
    expect(rows.length).toBe(1)
    expect(rows[0].purchase_item_id).toBe('pi-item-1')
    // Verify SQL references purchase_item_id
    const callSql = (mockDbExecute.mock.calls[0][0] as any)?.strings?.join('') || ''
    expect(callSql).toContain('purchase_item_id')
  })

  // ---------- C7: NC of purchase ----------
  it('C7: NC_A without related_invoice_id → 400', async () => {
    await expect(
      service.createPurchaseInvoice(companyId, userId, baseData({ invoice_type: 'NC_A' })),
    ).rejects.toMatchObject({ statusCode: 400, message: expect.stringContaining('Nota de credito') })
  })

  it('C7: NC_A with valid related_invoice_id reaches INSERT', async () => {
    clientQueueHappyPath({
      originalRow: { id: 'orig-1', enterprise_id: enterpriseId, total_amount: '121' },
    })
    // Final getPurchaseInvoice post-commit
    mockDbExecute.mockResolvedValueOnce({ rows: [{ id: 'new-nc', invoice_type: 'NC_A' }] })

    const result = await service.createPurchaseInvoice(
      companyId, userId,
      baseData({
        invoice_type: 'NC_A',
        related_invoice_id: 'orig-1',
        invoice_number: '87654321',
      }),
    )
    expect(result).toMatchObject({ invoice_type: 'NC_A' })
    // Verify an INSERT happened on client
    const insertCalls = mockClientQuery.mock.calls.filter(c => /INSERT INTO purchase_invoices/.test(String(c[0])))
    expect(insertCalls.length).toBeGreaterThan(0)
  })

  it('C7: getPaymentBalance subtracts NCs from total', async () => {
    // getPurchaseInvoice
    mockDbExecute.mockResolvedValueOnce({ rows: [{ id: 'pi-1', total_amount: '1000' }] })
    // applied
    mockDbExecute.mockResolvedValueOnce({ rows: [{ total_applied: '200' }] })
    // nc
    mockDbExecute.mockResolvedValueOnce({ rows: [{ total_nc: '300' }] })

    const r = await service.getPaymentBalance(companyId, 'pi-1')
    expect(r.total_amount).toBe(1000)
    expect(r.total_nc).toBe(300)
    expect(r.effective_total).toBe(700)
    expect(r.total_applied).toBe(200)
    expect(r.remaining).toBe(500)
    expect(r.payment_status).toBe('parcial')
  })

  // ---------- C8: Transactional create ----------
  it('C8: createPurchaseInvoice uses BEGIN/COMMIT via pool.connect', async () => {
    clientQueueHappyPath()
    mockDbExecute.mockResolvedValueOnce({ rows: [{ id: 'new-pi' }] })

    await service.createPurchaseInvoice(
      companyId, userId,
      baseData({ items: [{ product_name: 'x', quantity: 1, unit_price: 100 }] }),
    )
    const calls = mockClientQuery.mock.calls.map(c => String(c[0]).trim())
    expect(calls).toContain('BEGIN')
    expect(calls).toContain('COMMIT')
    // Items INSERT happened inside transaction
    expect(calls.some(c => /INSERT INTO purchase_invoice_items/.test(c))).toBe(true)
  })

  it('C8: rollback called on item insert failure', async () => {
    clientQueueHappyPath()
    // Override: make item insert throw
    let calls = 0
    mockClientQuery.mockImplementation(async (textOrTpl: any) => {
      const text = typeof textOrTpl === 'string' ? textOrTpl : ''
      calls++
      if (/^BEGIN$|^COMMIT$|^ROLLBACK$/.test(text.trim())) return { rows: [] }
      if (/FROM business_units/.test(text)) return { rows: [{ id: businessUnitId }] }
      if (/FROM enterprises/.test(text)) return { rows: [{ id: enterpriseId, cuit: '30712345670' }] }
      if (/FROM purchase_invoices .*invoice_number/.test(text)) return { rows: [] }
      if (/INSERT INTO purchase_invoices/.test(text)) return { rows: [] }
      if (/INSERT INTO purchase_invoice_items/.test(text)) throw new Error('simulated failure')
      return { rows: [] }
    })

    await expect(
      service.createPurchaseInvoice(
        companyId, userId,
        baseData({ items: [{ product_name: 'x', quantity: 1, unit_price: 100 }] }),
      ),
    ).rejects.toThrow('simulated failure')
    const executedSql = mockClientQuery.mock.calls.map(c => String(c[0]).trim())
    expect(executedSql).toContain('ROLLBACK')
    expect(calls).toBeGreaterThan(0)
  })
})
