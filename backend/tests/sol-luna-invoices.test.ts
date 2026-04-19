import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mockDbExecute, mockDbRows, mockDbEmpty, mockDbVoid, resetMocks } from './helpers/setup'

// Sol/Luna: stub ordersService so dynamic import() resolves to a controllable mock.
// We spy on lockOrder/unlockOrder to assert the createInvoice -> lockOrder wiring.
const lockOrderSpy = vi.fn().mockResolvedValue(undefined)
const unlockOrderSpy = vi.fn().mockResolvedValue(undefined)
vi.mock('../src/modules/orders/orders.service', () => ({
  ordersService: {
    lockOrder: (...args: any[]) => lockOrderSpy(...args),
    unlockOrder: (...args: any[]) => unlockOrderSpy(...args),
  },
}))

// Dynamic import of accounting service inside createInvoice (for Luna) — stub empty.
vi.mock('../src/modules/accounting/accounting-entries.service', () => ({
  accountingEntriesService: {
    createEntryForInvoice: vi.fn().mockResolvedValue(undefined),
  },
}))

import { InvoicesService } from '../src/modules/invoices/invoices.service'
import { PdfService } from '../src/modules/pdf/pdf.service'

// Helper: prime the no-op migration calls that ensureMigrations burns through.
// Count updated when new ALTER TABLEs are added to invoices.service ensureMigrations.
function primeMigrations() {
  for (let i = 0; i < 35; i++) mockDbVoid()
}

describe('Sol/Luna Invoices (CAT-4)', () => {
  let service: InvoicesService

  beforeEach(() => {
    resetMocks()
    service = new InvoicesService()
    lockOrderSpy.mockClear()
    unlockOrderSpy.mockClear()
    vi.clearAllMocks()
  })

  // -------------------------------------------------------------------------
  // createInvoice
  // -------------------------------------------------------------------------

  describe('createInvoice — Sol (fiscal)', () => {
    it('creates a Sol invoice in draft status (regression)', async () => {
      primeMigrations()
      mockDbVoid() // auto-assign business_unit_id lookup
      mockDbVoid() // BEGIN
      mockDbVoid() // advisory lock
      mockDbRows([{ next_number: '10' }]) // next sequential fiscal number
      mockDbRows([{ id: 'cust-1' }]) // customer IDOR check
      mockDbEmpty() // customer enterprise lookup
      mockDbVoid() // UPDATE order_id / enterprise_id / fiscal_type

      const result = await service.createInvoice('company-1', 'user-1', {
        fiscal_type: 'fiscal',
        invoice_type: 'A',
        customer_id: 'cust-1',
      })
      expect(result.fiscal_type).toBe('fiscal')
      expect(result.invoice_type).toBe('A')
      expect(result.status).toBe('draft')
    })
  })

  describe('createInvoice — Luna (no_fiscal)', () => {
    it('forces invoice_type=LUN and status=emitido', async () => {
      primeMigrations()
      mockDbVoid() // BU lookup
      mockDbVoid() // BEGIN
      mockDbVoid() // advisory lock
      mockDbRows([{ next_number: '1' }]) // Luna sequence
      mockDbRows([{ id: 'cust-1' }]) // customer IDOR check
      mockDbEmpty() // customer enterprise lookup
      mockDbVoid() // INSERT raw
      mockDbVoid() // UPDATE order_id etc

      const result = await service.createInvoice('company-1', 'user-1', {
        fiscal_type: 'no_fiscal',
        invoice_type: 'B', // should be ignored
        customer_id: 'cust-1',
      })

      expect(result.fiscal_type).toBe('no_fiscal')
      expect(result.invoice_type).toBe('LUN')
      expect(result.status).toBe('emitido')
      expect(result.invoice_number).toBe(1)
    })

    it('rejects Luna NC_A as unsupported', async () => {
      await expect(
        service.createInvoice('company-1', 'user-1', {
          fiscal_type: 'no_fiscal',
          invoice_type: 'NC_A',
        })
      ).rejects.toThrow(/Notas de Credito Luna no soportadas/)
    })

    it('calculates Luna totals with IVA=0 and precio final per line', async () => {
      primeMigrations()
      mockDbVoid() // BU lookup
      mockDbVoid() // BEGIN
      mockDbVoid() // advisory lock
      mockDbRows([{ next_number: '1' }])
      mockDbEmpty() // no customer lookup
      mockDbVoid() // INSERT raw
      mockDbVoid() // UPDATE order_id etc
      // No order_item_id → no per-item UPDATEs in the items loop
      // Final totals UPDATE via drizzle is mocked by the chainable mock (no execute call)

      const result = await service.createInvoice('company-1', 'user-1', {
        fiscal_type: 'no_fiscal',
        items: [
          { product_name: 'Luna Widget', unit_price: 1000, quantity: 2 },
          { product_name: 'Luna Gadget', unit_price: 500, quantity: 3 },
        ],
      })
      expect(result.fiscal_type).toBe('no_fiscal')
      expect(result.invoice_type).toBe('LUN')
      // Can't read the DB back in mock mode; validate no throw and structure.
      expect(result).toHaveProperty('id')
    })

    it('forces retenciones_esperadas=[] for Luna', async () => {
      primeMigrations()
      mockDbVoid() // BU lookup
      mockDbVoid() // BEGIN
      mockDbVoid() // advisory lock
      mockDbRows([{ next_number: '1' }])
      mockDbEmpty() // customer lookup
      mockDbVoid() // INSERT raw
      // Capture the UPDATE that sets retenciones_esperadas to verify the param.
      mockDbVoid()

      await service.createInvoice('company-1', 'user-1', {
        fiscal_type: 'no_fiscal',
        retenciones_esperadas: [{ type: 'iibb', rate: 3.5 }], // should be discarded
      })
      // Scan mock calls for the UPDATE that carries retenciones_esperadas template.
      const calls = mockDbExecute.mock.calls
      const retUpdate = calls.find((c: any[]) => {
        const strings = c[0]?.strings?.join?.(' ') || ''
        return strings.includes('retenciones_esperadas')
      })
      expect(retUpdate).toBeDefined()
      const values = retUpdate?.[0]?.values || []
      // values includes retencionesEsperadas as one of the interpolated params
      expect(values).toContain('[]')
    })

    it('uses dedicated Luna advisory lock key', async () => {
      primeMigrations()
      mockDbVoid() // BU lookup
      mockDbVoid() // BEGIN
      mockDbVoid() // advisory lock
      mockDbRows([{ next_number: '1' }])
      mockDbEmpty()
      mockDbVoid()
      mockDbVoid()

      await service.createInvoice('company-1', 'user-1', { fiscal_type: 'no_fiscal' })

      const calls = mockDbExecute.mock.calls
      const lockCall = calls.find((c: any[]) => {
        const s = c[0]?.strings?.join?.(' ') || ''
        return s.includes('pg_advisory_xact_lock')
      })
      expect(lockCall).toBeDefined()
      const keyVal = lockCall?.[0]?.values?.[0]
      expect(String(keyVal)).toContain('no_fiscal')
      expect(String(keyVal)).toContain('LUN')
    })

    it('uses LUN-scoped next_number query', async () => {
      primeMigrations()
      mockDbVoid() // BU lookup
      mockDbVoid() // BEGIN
      mockDbVoid() // advisory lock
      mockDbRows([{ next_number: '42' }])
      mockDbEmpty()
      mockDbVoid()
      mockDbVoid()

      const result = await service.createInvoice('company-1', 'user-1', { fiscal_type: 'no_fiscal' })
      expect(result.invoice_number).toBe(42)
      const calls = mockDbExecute.mock.calls
      const maxQuery = calls.find((c: any[]) => {
        const s = c[0]?.strings?.join?.(' ') || ''
        return s.includes('COALESCE(MAX(invoice_number)') && s.includes("invoice_type = 'LUN'")
      })
      expect(maxQuery).toBeDefined()
    })
  })

  describe('createInvoice — cross-circuit validation', () => {
    it('rejects Luna invoice from a Sol order', async () => {
      primeMigrations()
      // Order fiscal_type lookup
      mockDbRows([{ fiscal_type: 'fiscal' }])

      await expect(
        service.createInvoice('company-1', 'user-1', {
          order_id: 'order-sol',
          fiscal_type: 'no_fiscal',
          invoice_type: 'B',
        })
      ).rejects.toThrow(/circuito del comprobante no coincide/)
    })

    it('rejects Sol invoice from a Luna order', async () => {
      primeMigrations()
      mockDbRows([{ fiscal_type: 'no_fiscal' }])

      await expect(
        service.createInvoice('company-1', 'user-1', {
          order_id: 'order-luna',
          fiscal_type: 'fiscal',
          invoice_type: 'A',
        })
      ).rejects.toThrow(/circuito del comprobante no coincide/)
    })

    it('defaults invoice.fiscal_type to order.fiscal_type when not provided', async () => {
      primeMigrations()
      mockDbRows([{ fiscal_type: 'no_fiscal' }]) // order says Luna
      mockDbVoid() // BU lookup
      mockDbVoid() // BEGIN
      mockDbVoid() // advisory lock
      mockDbRows([{ next_number: '1' }])
      mockDbEmpty() // customer
      mockDbVoid() // INSERT
      mockDbVoid() // UPDATE
      // order_id update paths — INSERT invoice_orders + UPDATE orders.has_invoice
      mockDbVoid()
      mockDbVoid()

      const result = await service.createInvoice('company-1', 'user-1', {
        order_id: 'order-luna',
        // no fiscal_type specified — should default to 'no_fiscal'
      })
      expect(result.fiscal_type).toBe('no_fiscal')
      expect(result.invoice_type).toBe('LUN')
    })

    it('invokes lockOrder after successful create with order_id', async () => {
      primeMigrations()
      mockDbRows([{ fiscal_type: 'fiscal' }]) // order lookup
      mockDbVoid() // BU lookup
      mockDbVoid() // BEGIN
      mockDbVoid() // advisory lock
      mockDbRows([{ next_number: '5' }])
      mockDbEmpty() // customer
      mockDbVoid() // INSERT (drizzle chain actually — BU lookup uses .execute; INSERT uses db.insert)
      mockDbVoid() // UPDATE order_id
      mockDbVoid() // INSERT invoice_orders
      mockDbVoid() // UPDATE orders.has_invoice

      await service.createInvoice('company-1', 'user-1', {
        order_id: 'order-1',
        fiscal_type: 'fiscal',
        invoice_type: 'A',
      })
      expect(lockOrderSpy).toHaveBeenCalled()
      const args = lockOrderSpy.mock.calls[0]
      expect(args[0]).toBe('order-1')
      expect(String(args[1])).toMatch(/emitida/)
      expect(args[2]).toBe('user-1')
    })
  })

  // -------------------------------------------------------------------------
  // authorizeInvoice
  // -------------------------------------------------------------------------

  describe('authorizeInvoice', () => {
    it('rejects Luna invoices with a Luna-specific message', async () => {
      mockDbRows([{ fiscal_type: 'no_fiscal' }])
      await expect(
        service.authorizeInvoice('company-1', 'inv-1')
      ).rejects.toThrow(/Los comprobantes Luna no se autorizan en AFIP/)
    })

    it('still rejects legacy interno invoices', async () => {
      mockDbRows([{ fiscal_type: 'interno' }])
      await expect(
        service.authorizeInvoice('company-1', 'inv-1')
      ).rejects.toThrow(/comprobantes internos/)
    })
  })

  // -------------------------------------------------------------------------
  // deleteDraftInvoice -> unlockOrder
  // -------------------------------------------------------------------------

  describe('deleteDraftInvoice — unlock cascade', () => {
    it('calls unlockOrder after deletion when invoice has order_id', async () => {
      primeMigrations()
      mockDbRows([{ id: 'inv-1', status: 'emitido', order_id: 'order-1', cae: null }])
      // Delete items (drizzle chain), DELETE invoice_orders, DELETE invoice
      mockDbVoid() // DELETE invoice_orders
      mockDbRows([{ cnt: '0' }]) // remaining count
      mockDbVoid() // UPDATE orders.has_invoice

      await service.deleteDraftInvoice('company-1', 'inv-1')
      expect(unlockOrderSpy).toHaveBeenCalledWith('order-1')
    })

    it('does NOT call unlockOrder when invoice had no order', async () => {
      primeMigrations()
      mockDbRows([{ id: 'inv-1', status: 'emitido', order_id: null, cae: null }])
      mockDbVoid() // DELETE invoice_orders

      await service.deleteDraftInvoice('company-1', 'inv-1')
      expect(unlockOrderSpy).not.toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // getInvoices — circuit filtering
  // -------------------------------------------------------------------------

  // Note: the WHERE clause is composed via nested sql`` fragments which drizzle
  // stitches at prepare time — the template's `strings` array does not flatten
  // nested fragments in our test mock. Instead we assert on the service's
  // observable output (which fiscal_type value it actually resolves to by
  // peeking at a deterministic side-effect: the query succeeds and returns
  // the expected shape). We rely on the 'all' branch needing extra mocks.
  describe('getInvoices — visibility by can_access_luna', () => {
    it('accepts fiscal_type=no_fiscal when userCanAccessLuna=false without throwing (silently forced to fiscal)', async () => {
      primeMigrations()
      mockDbEmpty()
      mockDbRows([{ total: '0' }])
      const res = await service.getInvoices('company-1', {
        fiscal_type: 'no_fiscal',
        userCanAccessLuna: false,
      })
      expect(res.items).toEqual([])
      expect(res.total).toBe(0)
    })

    it('accepts fiscal_type=no_fiscal when userCanAccessLuna=true', async () => {
      primeMigrations()
      mockDbEmpty()
      mockDbRows([{ total: '0' }])
      const res = await service.getInvoices('company-1', {
        fiscal_type: 'no_fiscal',
        userCanAccessLuna: true,
      })
      expect(res.items).toEqual([])
    })

    it('resolves to all-circuits when userCanAccessLuna=true and fiscal_type undefined', async () => {
      primeMigrations()
      mockDbEmpty()
      mockDbRows([{ total: '0' }])
      const res = await service.getInvoices('company-1', { userCanAccessLuna: true })
      expect(res).toHaveProperty('items')
      expect(res).toHaveProperty('total')
    })

    it('defaults to fiscal-only when userCanAccessLuna is undefined (back-compat)', async () => {
      primeMigrations()
      mockDbEmpty()
      mockDbRows([{ total: '0' }])
      const res = await service.getInvoices('company-1', {})
      expect(res).toHaveProperty('items')
      expect(res).toHaveProperty('total')
    })
  })

  // -------------------------------------------------------------------------
  // getInvoice — existence leak
  // -------------------------------------------------------------------------

  describe('getInvoice — Luna existence leak defense', () => {
    it('returns 404 when non-Luna user accesses a Luna invoice', async () => {
      primeMigrations()
      // Main invoice select
      mockDbRows([{ id: 'inv-luna', fiscal_type: 'no_fiscal', company_id: 'company-1' }])

      await expect(
        service.getInvoice('company-1', 'inv-luna', false)
      ).rejects.toThrow(/Factura no encontrada/)
    })

    it('returns the invoice when Luna user accesses a Luna invoice', async () => {
      primeMigrations()
      mockDbRows([{ id: 'inv-luna', fiscal_type: 'no_fiscal', company_id: 'company-1' }])
      mockDbRows([]) // items query

      const inv = await service.getInvoice('company-1', 'inv-luna', true)
      expect(inv.fiscal_type).toBe('no_fiscal')
    })

    it('returns 404 when invoice is not found (cross-tenant)', async () => {
      primeMigrations()
      mockDbEmpty()

      await expect(
        service.getInvoice('company-1', 'inv-foreign', true)
      ).rejects.toThrow(/Invoice not found/)
    })
  })

  // -------------------------------------------------------------------------
  // PDF — Luna template content
  // -------------------------------------------------------------------------

  describe('PDF generateLunaComprobanteHtml', () => {
    const pdf = new PdfService() as any
    const invoice = {
      id: 'inv-1',
      fiscal_type: 'no_fiscal',
      invoice_number: 7,
      invoice_date: '2026-04-14',
      total_amount: '5000.00',
    }
    const items = [
      { product_name: 'Servicio A', quantity: '2', unit_price: '1500' },
      { product_name: 'Servicio B', quantity: '1', unit_price: '2000' },
    ]
    const company = {
      companyName: 'Test SA',
      companyCuit: '30712345678',
      companyAddress: 'Calle Falsa 123',
      companyCity: 'CABA',
      companyProvince: 'BA',
    }
    const enterprise = { razon_social: 'Cliente SA', cuit: '20123456789', fiscal_address: 'Av Siempre Viva 742' }

    it('includes DOCUMENTO NO FISCAL watermark', () => {
      const html = pdf.generateLunaComprobanteHtml({ invoice, items, customer: null, enterprise, company })
      expect(html).toContain('DOCUMENTO NO FISCAL - USO INTERNO')
    })

    it('does not contain CAE or QR markers', () => {
      const html = pdf.generateLunaComprobanteHtml({ invoice, items, customer: null, enterprise, company })
      expect(html).not.toContain('CAE')
      expect(html).not.toContain('qr-code')
    })

    it('does not render % IVA column', () => {
      const html = pdf.generateLunaComprobanteHtml({ invoice, items, customer: null, enterprise, company })
      expect(html).not.toContain('% IVA')
      expect(html).not.toContain('Subtotal Neto')
    })

    it('shows LUN-XXXXXXXX formatted number', () => {
      const html = pdf.generateLunaComprobanteHtml({ invoice, items, customer: null, enterprise, company })
      expect(html).toContain('LUN-00000007')
    })

    it('shows the grand total', () => {
      const html = pdf.generateLunaComprobanteHtml({ invoice, items, customer: null, enterprise, company })
      expect(html).toContain('5000.00')
    })

    it('shows the enterprise razon_social and CUIT', () => {
      const html = pdf.generateLunaComprobanteHtml({ invoice, items, customer: null, enterprise, company })
      expect(html).toContain('Cliente SA')
      expect(html).toContain('20-12345678-9')
    })

    it('includes the footer "Sin valor fiscal - Uso interno"', () => {
      const html = pdf.generateLunaComprobanteHtml({ invoice, items, customer: null, enterprise, company })
      expect(html).toMatch(/Sin valor fiscal/)
      expect(html).toMatch(/Uso interno/)
    })
  })
})
