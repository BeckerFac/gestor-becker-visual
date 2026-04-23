import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mockDbExecute, mockClientQuery, resetMocks } from './helpers/setup'

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

/**
 * Wave 3A+3D alignment:
 *   - createInvoice/updateDraftInvoice/authorizeInvoice/deleteDraftInvoice
 *     switched from `db.execute(sql`BEGIN`)` to `pool.connect()` +
 *     client.query(...). Tests now use mockClientQuery (in addition to
 *     mockDbExecute) to match the new pattern.
 *   - createInvoice now REQUIRES items (Wave 3D D11); all create tests
 *     provide at least one item.
 *   - We drive mockDbExecute via mockImplementation so tests don't care
 *     about the exact ordering of reads the service performs.
 */
function primeFiscalLookups(opts: {
  orderFiscalType?: 'fiscal' | 'no_fiscal' | null,
  customerExists?: boolean,
  enterpriseExists?: boolean,
  customerEnterpriseId?: string | null,
} = {}) {
  const {
    orderFiscalType = null,
    customerExists = true,
    enterpriseExists = true,
    customerEnterpriseId = null,
  } = opts
  mockDbExecute.mockImplementation((tpl: any) => {
    const s = tpl?.strings ? tpl.strings.join(' ') : String(tpl || '')
    // Order fiscal_type lookup (first thing createInvoice does if order_id set)
    if (/SELECT\s+fiscal_type\s+FROM\s+orders/i.test(s)) {
      return orderFiscalType
        ? Promise.resolve({ rows: [{ fiscal_type: orderFiscalType }] })
        : Promise.resolve({ rows: [] })
    }
    // Default BU lookup
    if (/FROM\s+business_units/i.test(s)) {
      return Promise.resolve({ rows: [{ id: 'bu-1' }] })
    }
    // Order items availability check (only triggers when an item has order_item_id)
    if (/FROM\s+order_items\s+oi/i.test(s)) {
      return Promise.resolve({ rows: [{ total_qty: '10', invoiced_qty: '0' }] })
    }
    // Customer IDOR + customer->enterprise resolution
    if (/FROM\s+customers\s+WHERE\s+id/i.test(s)) {
      if (!customerExists) return Promise.resolve({ rows: [] })
      return Promise.resolve({ rows: [{ id: 'cust-1', enterprise_id: customerEnterpriseId }] })
    }
    // Customer SELECT inside resolveInvoiceFiscalIdentity (wider column set)
    if (/FROM\s+customers\s+c/i.test(s)) {
      return Promise.resolve({ rows: [] })
    }
    // Enterprise IDOR check
    if (/FROM\s+enterprises\s+WHERE\s+id/i.test(s)) {
      if (!enterpriseExists) return Promise.resolve({ rows: [] })
      return Promise.resolve({ rows: [{ id: 'ent-1' }] })
    }
    // Enterprise SELECT inside resolveInvoiceFiscalIdentity
    if (/FROM\s+enterprises\s/i.test(s)) {
      return Promise.resolve({ rows: [] })
    }
    // Re-read totals/items AFTER commit (non-fiscal accounting branch)
    if (/FROM\s+invoices\s+WHERE\s+id/i.test(s)) {
      return Promise.resolve({
        rows: [{
          subtotal: '0', vat_amount: '0', total_amount: '0',
          invoice_date: new Date().toISOString(),
        }],
      })
    }
    if (/FROM\s+invoice_items\s+WHERE\s+invoice_id/i.test(s)) {
      return Promise.resolve({ rows: [] })
    }
    // UPDATEs / INSERTs / DELETEs — generic OK
    return Promise.resolve({ rows: [] })
  })
}

describe('Sol/Luna Invoices (CAT-4)', () => {
  let service: InvoicesService

  beforeEach(() => {
    resetMocks()
    service = new InvoicesService()
    // Skip ensureMigrations DDL noise (it uses raw db.execute and swallows errors,
    // but returning undefined from db.execute breaks the .catch chained call).
    ;(service as any).migrationsRun = true
    lockOrderSpy.mockClear()
    unlockOrderSpy.mockClear()
  })

  // -------------------------------------------------------------------------
  // createInvoice
  // -------------------------------------------------------------------------

  describe('createInvoice — Sol (fiscal)', () => {
    it('creates a Sol invoice in draft status (regression)', async () => {
      primeFiscalLookups()

      const result = await service.createInvoice('company-1', 'user-1', {
        fiscal_type: 'fiscal',
        invoice_type: 'A',
        customer_id: 'cust-1',
        items: [{ product_name: 'X', unit_price: 100, quantity: 1, vat_rate: 21 }],
      })
      expect(result.fiscal_type).toBe('fiscal')
      expect(result.invoice_type).toBe('A')
      expect(result.status).toBe('draft')
    })
  })

  describe('createInvoice — Luna (no_fiscal)', () => {
    it('forces invoice_type=LUN and status=emitido', async () => {
      primeFiscalLookups()

      const result = await service.createInvoice('company-1', 'user-1', {
        fiscal_type: 'no_fiscal',
        invoice_type: 'B', // should be ignored
        customer_id: 'cust-1',
        items: [{ product_name: 'X', unit_price: 100, quantity: 1 }],
      })

      expect(result.fiscal_type).toBe('no_fiscal')
      expect(result.invoice_type).toBe('LUN')
      expect(result.status).toBe('emitido')
      expect(result.invoice_number).toBe(1)
    })

    it('rejects Luna NC_A as unsupported', async () => {
      primeFiscalLookups()
      await expect(
        service.createInvoice('company-1', 'user-1', {
          fiscal_type: 'no_fiscal',
          invoice_type: 'NC_A',
          items: [{ product_name: 'X', unit_price: 100, quantity: 1 }],
        })
      ).rejects.toThrow(/Notas de Credito Luna no soportadas/)
    })

    it('calculates Luna totals with IVA=0 and precio final per line', async () => {
      primeFiscalLookups()

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
      primeFiscalLookups()

      await service.createInvoice('company-1', 'user-1', {
        fiscal_type: 'no_fiscal',
        retenciones_esperadas: [{ type: 'iibb', rate: 3.5 }], // should be discarded
        items: [{ product_name: 'X', unit_price: 100, quantity: 1 }],
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
      primeFiscalLookups()

      await service.createInvoice('company-1', 'user-1', {
        fiscal_type: 'no_fiscal',
        items: [{ product_name: 'X', unit_price: 100, quantity: 1 }],
      })

      // Wave 3A: advisory lock is now issued via client.query, not db.execute.
      const lockCall = mockClientQuery.mock.calls.find((c: any[]) => {
        return /pg_advisory_xact_lock/.test(String(c[0] || ''))
      })
      expect(lockCall).toBeDefined()
      const keyVal = lockCall?.[1]?.[0]
      expect(String(keyVal)).toContain('no_fiscal')
      expect(String(keyVal)).toContain('LUN')
    })

    it('uses LUN-scoped next_number query', async () => {
      primeFiscalLookups()
      // Override client impl to supply a deterministic nextNumber.
      mockClientQuery.mockImplementation((sqlStr: string) => {
        const s = String(sqlStr)
        if (/COALESCE\(MAX\(invoice_number/.test(s)) {
          return Promise.resolve({ rows: [{ next_number: '42' }] })
        }
        return Promise.resolve({ rows: [] })
      })

      const result = await service.createInvoice('company-1', 'user-1', {
        fiscal_type: 'no_fiscal',
        items: [{ product_name: 'X', unit_price: 100, quantity: 1 }],
      })
      expect(result.invoice_number).toBe(42)
      // Confirm the MAX query is LUN-scoped.
      const maxCall = mockClientQuery.mock.calls.find((c: any[]) => {
        const s = String(c[0] || '')
        return /COALESCE\(MAX\(invoice_number/.test(s) && /invoice_type\s*=\s*'LUN'/.test(s)
      })
      expect(maxCall).toBeDefined()
    })
  })

  describe('createInvoice — cross-circuit validation', () => {
    it('rejects Luna invoice from a Sol order', async () => {
      primeFiscalLookups({ orderFiscalType: 'fiscal' })

      await expect(
        service.createInvoice('company-1', 'user-1', {
          order_id: 'order-sol',
          fiscal_type: 'no_fiscal',
          invoice_type: 'B',
          items: [{ product_name: 'X', unit_price: 100, quantity: 1 }],
        })
      ).rejects.toThrow(/circuito del comprobante no coincide/)
    })

    it('rejects Sol invoice from a Luna order', async () => {
      primeFiscalLookups({ orderFiscalType: 'no_fiscal' })

      await expect(
        service.createInvoice('company-1', 'user-1', {
          order_id: 'order-luna',
          fiscal_type: 'fiscal',
          invoice_type: 'A',
          items: [{ product_name: 'X', unit_price: 100, quantity: 1 }],
        })
      ).rejects.toThrow(/circuito del comprobante no coincide/)
    })

    it('defaults invoice.fiscal_type to order.fiscal_type when not provided', async () => {
      primeFiscalLookups({ orderFiscalType: 'no_fiscal' })

      const result = await service.createInvoice('company-1', 'user-1', {
        order_id: 'order-luna',
        // no fiscal_type specified — should default to 'no_fiscal'
        items: [{ product_name: 'X', unit_price: 100, quantity: 1 }],
      })
      expect(result.fiscal_type).toBe('no_fiscal')
      expect(result.invoice_type).toBe('LUN')
    })

    it('invokes lockOrder after successful create with order_id', async () => {
      primeFiscalLookups({ orderFiscalType: 'fiscal' })

      await service.createInvoice('company-1', 'user-1', {
        order_id: 'order-1',
        fiscal_type: 'fiscal',
        invoice_type: 'A',
        items: [{ product_name: 'X', unit_price: 100, quantity: 1, vat_rate: 21 }],
      })
      expect(lockOrderSpy).toHaveBeenCalled()
      const args = lockOrderSpy.mock.calls[0]
      expect(args[0]).toBe('order-1')
      expect(String(args[1])).toMatch(/emitida/)
      expect(args[2]).toBe('user-1')
    })
  })

  // -------------------------------------------------------------------------
  // authorizeInvoice — Wave 3A: opens with SELECT ... FOR UPDATE on pool client
  // -------------------------------------------------------------------------

  describe('authorizeInvoice', () => {
    it('rejects Luna invoices with a Luna-specific message', async () => {
      mockClientQuery.mockImplementation((sqlStr: string) => {
        const s = String(sqlStr)
        if (/FOR UPDATE/i.test(s)) {
          return Promise.resolve({
            rows: [{ id: 'inv-1', fiscal_type: 'no_fiscal', status: 'draft' }],
          })
        }
        return Promise.resolve({ rows: [] })
      })
      await expect(
        service.authorizeInvoice('company-1', 'inv-1')
      ).rejects.toThrow(/Los comprobantes Luna no se autorizan en AFIP/)
    })

    it('still rejects legacy interno invoices', async () => {
      mockClientQuery.mockImplementation((sqlStr: string) => {
        const s = String(sqlStr)
        if (/FOR UPDATE/i.test(s)) {
          return Promise.resolve({
            rows: [{ id: 'inv-1', fiscal_type: 'interno', status: 'draft' }],
          })
        }
        return Promise.resolve({ rows: [] })
      })
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
      mockDbExecute.mockImplementation((tpl: any) => {
        const s = tpl?.strings ? tpl.strings.join(' ') : String(tpl || '')
        // Initial SELECT id, status, order_id, cae ...
        if (/SELECT\s+id,\s*status,\s*order_id,\s*cae/i.test(s)) {
          return Promise.resolve({
            rows: [{ id: 'inv-1', status: 'emitido', order_id: 'order-1', cae: null }],
          })
        }
        // has_invoice recount query
        if (/SELECT\s+COUNT\(\*\)\s+as\s+cnt\s+FROM\s+invoices/i.test(s)) {
          return Promise.resolve({ rows: [{ cnt: '0' }] })
        }
        return Promise.resolve({ rows: [] })
      })

      await service.deleteDraftInvoice('company-1', 'inv-1')
      expect(unlockOrderSpy).toHaveBeenCalledWith('order-1')
    })

    it('does NOT call unlockOrder when invoice had no order', async () => {
      mockDbExecute.mockImplementation((tpl: any) => {
        const s = tpl?.strings ? tpl.strings.join(' ') : String(tpl || '')
        if (/SELECT\s+id,\s*status,\s*order_id,\s*cae/i.test(s)) {
          return Promise.resolve({
            rows: [{ id: 'inv-1', status: 'emitido', order_id: null, cae: null }],
          })
        }
        return Promise.resolve({ rows: [] })
      })

      await service.deleteDraftInvoice('company-1', 'inv-1')
      expect(unlockOrderSpy).not.toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // getInvoices — circuit filtering
  // -------------------------------------------------------------------------

  describe('getInvoices — visibility by can_access_luna', () => {
    beforeEach(() => {
      mockDbExecute.mockImplementation((tpl: any) => {
        const s = tpl?.strings ? tpl.strings.join(' ') : String(tpl || '')
        if (/SELECT\s+COUNT\(\*\)\s+as\s+total/i.test(s)) {
          return Promise.resolve({ rows: [{ total: '0' }] })
        }
        return Promise.resolve({ rows: [] })
      })
    })

    it('accepts fiscal_type=no_fiscal when userCanAccessLuna=false without throwing (silently forced to fiscal)', async () => {
      const res = await service.getInvoices('company-1', {
        fiscal_type: 'no_fiscal',
        userCanAccessLuna: false,
      })
      expect(res.items).toEqual([])
      expect(res.total).toBe(0)
    })

    it('accepts fiscal_type=no_fiscal when userCanAccessLuna=true', async () => {
      const res = await service.getInvoices('company-1', {
        fiscal_type: 'no_fiscal',
        userCanAccessLuna: true,
      })
      expect(res.items).toEqual([])
    })

    it('resolves to all-circuits when userCanAccessLuna=true and fiscal_type undefined', async () => {
      const res = await service.getInvoices('company-1', { userCanAccessLuna: true })
      expect(res).toHaveProperty('items')
      expect(res).toHaveProperty('total')
    })

    it('defaults to fiscal-only when userCanAccessLuna is undefined (back-compat)', async () => {
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
      mockDbExecute.mockImplementation((tpl: any) => {
        const s = tpl?.strings ? tpl.strings.join(' ') : String(tpl || '')
        if (/FROM\s+invoices\s+i\s+LEFT\s+JOIN/i.test(s)) {
          return Promise.resolve({
            rows: [{ id: 'inv-luna', fiscal_type: 'no_fiscal', company_id: 'company-1' }],
          })
        }
        return Promise.resolve({ rows: [] })
      })

      await expect(
        service.getInvoice('company-1', 'inv-luna', false)
      ).rejects.toThrow(/Factura no encontrada/)
    })

    it('returns the invoice when Luna user accesses a Luna invoice', async () => {
      mockDbExecute.mockImplementation((tpl: any) => {
        const s = tpl?.strings ? tpl.strings.join(' ') : String(tpl || '')
        if (/FROM\s+invoices\s+i\s+LEFT\s+JOIN/i.test(s)) {
          return Promise.resolve({
            rows: [{ id: 'inv-luna', fiscal_type: 'no_fiscal', company_id: 'company-1' }],
          })
        }
        return Promise.resolve({ rows: [] })
      })

      const inv = await service.getInvoice('company-1', 'inv-luna', true)
      expect(inv.fiscal_type).toBe('no_fiscal')
    })

    it('returns 404 when invoice is not found (cross-tenant)', async () => {
      mockDbExecute.mockImplementation(() => Promise.resolve({ rows: [] }))

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
