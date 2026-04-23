import { describe, it, expect, beforeEach } from 'vitest'
import { mockDbExecute, mockPoolQuery, resetMocks } from './helpers/setup'
import { InvoicesService } from '../src/modules/invoices/invoices.service'

// Rules (Apr 2026 update):
// 1) Drafts without CAE → deletable.
// 2) Manually-imported invoices (source='manual_import') → deletable even with CAE,
//    as long as no cobro is applied. CAE was typed by user, not AFIP.
// 3) Real AFIP-authorized invoices → blocked; use NC.

describe('InvoicesService.deleteDraftInvoice — Apr 2026 rules', () => {
  let service: InvoicesService
  const companyId = 'company-1'
  const invoiceId = 'inv-1'

  beforeEach(() => {
    resetMocks()
    service = new InvoicesService()
  })

  const stubInvoice = (row: any) => {
    mockDbExecute.mockImplementation((tpl: any) => {
      const s = tpl?.strings ? tpl.strings.join('') : ''
      if (s.includes('SELECT id, status, order_id, cae, source FROM invoices')) {
        return Promise.resolve({ rows: [row] })
      }
      if (s.includes('SELECT COUNT(*) as cnt FROM invoices')) {
        return Promise.resolve({ rows: [{ cnt: '0' }] })
      }
      return Promise.resolve({ rows: [] })
    })
  }

  it('allows deleting a draft invoice without CAE', async () => {
    stubInvoice({ id: invoiceId, status: 'draft', order_id: null, cae: null, source: null })
    mockPoolQuery.mockResolvedValue({ rows: [] })

    const res = await service.deleteDraftInvoice(companyId, invoiceId, 'u1')
    expect(res).toEqual({ deleted: true })
  })

  it('rejects deleting a draft with a CAE typed in (legacy data)', async () => {
    stubInvoice({ id: invoiceId, status: 'draft', order_id: null, cae: '999', source: null })

    await expect(service.deleteDraftInvoice(companyId, invoiceId, 'u1'))
      .rejects.toThrow(/CAE asignado/i)
  })

  it('rejects deleting a real AFIP-authorized invoice (not manual_import)', async () => {
    stubInvoice({ id: invoiceId, status: 'authorized', order_id: null, cae: '123', source: null })

    await expect(service.deleteDraftInvoice(companyId, invoiceId, 'u1'))
      .rejects.toThrow(/borrador.*nota de credito/i)
  })

  it('allows deleting a manually-imported invoice even with CAE', async () => {
    stubInvoice({ id: invoiceId, status: 'authorized', order_id: null, cae: '123', source: 'manual_import' })
    mockPoolQuery.mockResolvedValue({ rows: [] })

    const res = await service.deleteDraftInvoice(companyId, invoiceId, 'u1')
    expect(res).toEqual({ deleted: true })
  })

  it('blocks deleting a manually-imported invoice with cobro applications', async () => {
    stubInvoice({ id: invoiceId, status: 'authorized', order_id: null, cae: '123', source: 'manual_import' })
    mockPoolQuery.mockImplementation((sqlStr: string) => {
      if (sqlStr.includes('cobro_invoice_applications')) {
        return Promise.resolve({ rows: [{ invoice_id: invoiceId }] })
      }
      return Promise.resolve({ rows: [] })
    })

    await expect(service.deleteDraftInvoice(companyId, invoiceId, 'u1'))
      .rejects.toThrow(/cobros aplicados/i)
  })
})
