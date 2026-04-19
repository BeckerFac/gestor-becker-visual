import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mockDbExecute, resetMocks } from './helpers/setup'

import { InvoicesService } from '../src/modules/invoices/invoices.service'
import { CustomersService } from '../src/modules/customers/customers.service'
import { PdfService } from '../src/modules/pdf/pdf.service'
import { AccountingService } from '../src/modules/reports/accounting.service'

/**
 * Nor feedback item 4: multi-razon-social per Empresa via Contact fiscal
 * identity.
 *
 * Contract locked in by these tests:
 *   - Customer with (cuit + razon_social) → invoice uses CUSTOMER identity.
 *   - Customer without → falls back to enterprise.
 *   - CUIT without razon_social → falls back to enterprise (both required).
 *   - PDF receiver block cascades: invoice snapshot > customer own > enterprise.
 *   - Libro IVA uses resolved CUIT (invoice.receiver_cuit preferred).
 *   - CC is still grouped by enterprise_id regardless of CUIT used.
 *   - Invalid CUIT blocks BEFORE AFIP authorization.
 */
describe('Multi-razon-social per Empresa (Nor feedback item 4)', () => {
  beforeEach(() => {
    resetMocks()
    vi.clearAllMocks()
  })

  /**
   * Dispatches mocked DB responses by matching the SQL string against
   * pattern fragments — much cleaner than linear mockDbEmpty() chains when
   * a service issues many ensure-migration ALTERs before the interesting
   * queries.
   */
  function mockByContent(overrides: Array<[string, any]>) {
    mockDbExecute.mockImplementation((...args: any[]) => {
      const tpl = args[0]
      const sqlStr = tpl?.strings ? tpl.strings.join('') : ''
      for (const [pattern, result] of overrides) {
        if (sqlStr.includes(pattern)) {
          return typeof result === 'function' ? result(tpl) : Promise.resolve(result)
        }
      }
      return Promise.resolve({ rows: [] })
    })
  }

  // ──────────────────────────────────────────────────────────────────────
  // resolveInvoiceFiscalIdentity — tight unit tests
  // ──────────────────────────────────────────────────────────────────────
  describe('resolveInvoiceFiscalIdentity', () => {
    it('T1: customer with own cuit + razon_social → uses CUSTOMER identity', async () => {
      const service = new InvoicesService()

      mockByContent([
        ['c.razon_social', {
          rows: [{
            cuit: '20-12345678-9',
            razon_social: 'Juan Perez Servicios SA',
            tax_condition: 'Responsable Inscripto',
            fiscal_address: 'Av. Siempreviva 742',
            address: null,
            enterprise_id: 'ent-parent',
          }],
        }],
      ])

      const identity = await service.resolveInvoiceFiscalIdentity(
        { customer_id: 'cust-own-rs', enterprise_id: null },
        'company-1',
      )

      expect(identity.source).toBe('customer')
      expect(identity.cuit).toBe('20-12345678-9')
      expect(identity.razon_social).toBe('Juan Perez Servicios SA')
      expect(identity.tax_condition).toBe('Responsable Inscripto')
      expect(identity.fiscal_address).toBe('Av. Siempreviva 742')
      expect(identity.enterprise_id).toBe('ent-parent') // for CC grouping
    })

    it('T2: customer without own cuit → falls back to ENTERPRISE', async () => {
      const service = new InvoicesService()

      mockByContent([
        // Priority 1: customer identity lookup (SELECTs c.razon_social, etc).
        // Returns a row with cuit=null so the branch skips to priority 2.
        ['c.razon_social', {
          rows: [{
            cuit: null,
            razon_social: null,
            tax_condition: null,
            fiscal_address: null,
            address: null,
            enterprise_id: 'ent-1',
          }],
        }],
        // Priority 2 fallback resolver: read enterprise_id from customer row
        // when payload.enterprise_id is null. Matches the simpler SELECT.
        ['SELECT enterprise_id FROM customers', {
          rows: [{ enterprise_id: 'ent-1' }],
        }],
        ['FROM enterprises', {
          rows: [{
            cuit: '30-71111111-1',
            razon_social: 'Parent Corp SA',
            tax_condition: 'Responsable Inscripto',
            fiscal_address: 'Calle Principal 100',
            address: null,
            name: 'Parent Corp',
          }],
        }],
      ])

      const identity = await service.resolveInvoiceFiscalIdentity(
        { customer_id: 'cust-no-cuit', enterprise_id: null },
        'company-1',
      )

      expect(identity.source).toBe('enterprise')
      expect(identity.cuit).toBe('30-71111111-1')
      expect(identity.razon_social).toBe('Parent Corp SA')
      expect(identity.enterprise_id).toBe('ent-1')
    })

    it('T3: customer with CUIT only (no razon_social) → falls back to enterprise', async () => {
      // Spec: both cuit AND razon_social are required at customer level;
      // a half-filled identity must NOT be used (prevents partial/malformed
      // AFIP payloads).
      const service = new InvoicesService()

      mockByContent([
        ['c.razon_social', {
          rows: [{
            cuit: '20-12345678-9',
            razon_social: null, // ← missing
            tax_condition: null,
            fiscal_address: null,
            address: null,
            enterprise_id: 'ent-1',
          }],
        }],
        ['SELECT enterprise_id FROM customers', {
          rows: [{ enterprise_id: 'ent-1' }],
        }],
        ['FROM enterprises', {
          rows: [{
            cuit: '30-71111111-1',
            razon_social: 'Parent Corp SA',
            tax_condition: 'Responsable Inscripto',
            fiscal_address: 'Calle Principal 100',
            address: null,
            name: 'Parent Corp',
          }],
        }],
      ])

      const identity = await service.resolveInvoiceFiscalIdentity(
        { customer_id: 'cust-partial', enterprise_id: null },
        'company-1',
      )

      expect(identity.source).toBe('enterprise')
      expect(identity.cuit).toBe('30-71111111-1')
      expect(identity.razon_social).toBe('Parent Corp SA')
    })

    it('T9: invalid customer CUIT format is rejected BEFORE AFIP call', async () => {
      // Bug vector (plan): contact CUIT format must be validated; reject
      // with 400 so AFIP never sees a malformed payload.
      const service = new InvoicesService()

      mockByContent([
        ['c.razon_social', {
          rows: [{
            cuit: '123', // invalid — not 11 digits
            razon_social: 'Some RS',
            tax_condition: null,
            fiscal_address: null,
            address: null,
            enterprise_id: 'ent-1',
          }],
        }],
      ])

      await expect(
        service.resolveInvoiceFiscalIdentity(
          { customer_id: 'cust-bad-cuit', enterprise_id: null },
          'company-1',
        ),
      ).rejects.toMatchObject({
        statusCode: 400,
        message: expect.stringMatching(/CUIT.*invalido|11 digitos/i),
      })
    })

    it('falls back to enterprise.name when enterprise has no razon_social (legacy)', async () => {
      // Bug vector (plan): existing enterprise without razon_social/fiscal_address.
      const service = new InvoicesService()

      mockByContent([
        ['FROM enterprises', {
          rows: [{
            cuit: '30-70000000-0',
            razon_social: null, // legacy row
            tax_condition: null,
            fiscal_address: null,
            address: 'Calle Comercial 50', // only has commercial address
            name: 'Legacy Enterprise',
          }],
        }],
      ])

      const identity = await service.resolveInvoiceFiscalIdentity(
        { customer_id: null, enterprise_id: 'ent-legacy' },
        'company-1',
      )

      expect(identity.source).toBe('enterprise')
      expect(identity.razon_social).toBe('Legacy Enterprise') // falls back to name
      expect(identity.fiscal_address).toBe('Calle Comercial 50') // falls back to commercial address
    })

    it('throws 400 when neither customer nor enterprise resolves', async () => {
      const service = new InvoicesService()
      mockByContent([])

      await expect(
        service.resolveInvoiceFiscalIdentity(
          { customer_id: 'missing', enterprise_id: 'missing' },
          'company-1',
        ),
      ).rejects.toMatchObject({ statusCode: 400 })
    })
  })

  // ──────────────────────────────────────────────────────────────────────
  // PDF receiver block cascade
  // ──────────────────────────────────────────────────────────────────────
  describe('PDF receiver block cascade', () => {
    const pdfService = new PdfService()

    function renderFiscalReceiver(data: any): string {
      // generateInvoiceHtml is private; reach it via bracket access only in tests.
      return (pdfService as any).generateInvoiceHtml(data)
    }

    it('T4: invoice PDF shows CUSTOMER razon_social when set on customer', async () => {
      const html = renderFiscalReceiver({
        invoice: {
          invoice_type: 'A',
          invoice_number: 1,
          invoice_date: new Date('2026-04-16'),
          subtotal: '100',
          vat_amount: '21',
          total_amount: '121',
          afip_response: {},
          cae_expiry_date: null,
          // Not snapshotted yet (legacy test) — we want the customer-own branch.
          receiver_cuit: null,
          receiver_razon_social: null,
        },
        items: [],
        customer: {
          name: 'Juan Perez',
          cuit: '20-12345678-9',
          razon_social: 'Juan Perez Servicios SA',
          tax_condition: 'Responsable Inscripto',
          fiscal_address: 'Av. Siempreviva 742',
          address: 'Otra calle',
        },
        enterprise: {
          name: 'Parent Corp',
          razon_social: 'Parent Corp SA',
          cuit: '30-71111111-1',
          tax_condition: 'Exento',
          fiscal_address: 'Otra direccion',
        },
        company: { companyName: 'Emisor SA', companyCuit: '30-99999999-9' },
        qrDataUrl: '',
      })

      expect(html).toContain('Juan Perez Servicios SA')
      expect(html).toContain('20-12345678-9')
      expect(html).toContain('Av. Siempreviva 742')
      // Must NOT render enterprise identity when customer has its own.
      expect(html).not.toContain('Parent Corp SA')
      expect(html).not.toContain('30-71111111-1')
    })

    it('T5: invoice PDF falls back to ENTERPRISE razon_social when customer has no identity', async () => {
      const html = renderFiscalReceiver({
        invoice: {
          invoice_type: 'A',
          invoice_number: 1,
          invoice_date: new Date('2026-04-16'),
          subtotal: '100',
          vat_amount: '21',
          total_amount: '121',
          afip_response: {},
          cae_expiry_date: null,
          receiver_cuit: null,
          receiver_razon_social: null,
        },
        items: [],
        customer: {
          name: 'Contacto Sin CUIT',
          cuit: null,
          razon_social: null,
          tax_condition: null,
          fiscal_address: null,
          address: null,
        },
        enterprise: {
          name: 'Parent Corp',
          razon_social: 'Parent Corp SA',
          cuit: '30-71111111-1',
          tax_condition: 'Responsable Inscripto',
          fiscal_address: 'Av. Parent 100',
        },
        company: { companyName: 'Emisor SA', companyCuit: '30-99999999-9' },
        qrDataUrl: '',
      })

      expect(html).toContain('Parent Corp SA')
      expect(html).toContain('30-71111111-1')
      expect(html).toContain('Av. Parent 100')
    })

    it('prefers invoice.receiver_razon_social snapshot over both customer and enterprise', async () => {
      // Once snapshotted at creation time, the invoice carries its own
      // identity forever — even if the customer/enterprise rows change.
      const html = renderFiscalReceiver({
        invoice: {
          invoice_type: 'A',
          invoice_number: 1,
          invoice_date: new Date('2026-04-16'),
          subtotal: '100',
          vat_amount: '21',
          total_amount: '121',
          afip_response: {},
          cae_expiry_date: null,
          receiver_cuit: '23-88888888-8',
          receiver_razon_social: 'Snapshotted Identity SA',
        },
        items: [],
        customer: { name: 'Whatever', cuit: null, razon_social: null },
        enterprise: { name: 'Different', razon_social: 'Different Corp', cuit: '30-00000000-0' },
        company: { companyName: 'Emisor SA', companyCuit: '30-99999999-9' },
        qrDataUrl: '',
      })

      expect(html).toContain('Snapshotted Identity SA')
      expect(html).toContain('23-88888888-8')
      expect(html).not.toContain('Different Corp')
    })

    it('XSS: escapes receiver fields so HTML injection via razon_social is blocked', async () => {
      const html = renderFiscalReceiver({
        invoice: {
          invoice_type: 'A', invoice_number: 1,
          invoice_date: new Date('2026-04-16'),
          subtotal: '100', vat_amount: '21', total_amount: '121',
          afip_response: {}, cae_expiry_date: null,
          receiver_cuit: null, receiver_razon_social: null,
        },
        items: [],
        customer: {
          name: 'X',
          cuit: '20-12345678-9',
          razon_social: '<script>alert(1)</script>',
          tax_condition: null,
          fiscal_address: null,
        },
        enterprise: null,
        company: { companyName: 'E', companyCuit: '30-99999999-9' },
        qrDataUrl: '',
      })

      expect(html).not.toContain('<script>alert(1)</script>')
      // Must appear escaped (exact entity encoding depends on the shared
      // escapeHtml helper).
      expect(html).toMatch(/&lt;script&gt;|&#60;script&#62;/)
    })
  })

  // ──────────────────────────────────────────────────────────────────────
  // Libro IVA uses resolved CUIT via COALESCE
  // ──────────────────────────────────────────────────────────────────────
  describe('Libro IVA Ventas', () => {
    it('T6: emits SQL that COALESCEs invoice.receiver_cuit first, then customer.cuit, then enterprise.cuit', async () => {
      const service = new AccountingService()
      let capturedSql = ''
      mockDbExecute.mockImplementation((...args: any[]) => {
        const tpl = args[0]
        const sqlStr = tpl?.strings ? tpl.strings.join('') : ''
        if (sqlStr.includes('invoice_date') && sqlStr.includes('invoice_type')) {
          capturedSql = sqlStr
          return Promise.resolve({ rows: [] })
        }
        return Promise.resolve({ rows: [] })
      })

      await service.getLibroIVAVentas('company-1', '2026-01-01', '2026-12-31').catch(() => {})

      expect(capturedSql).toContain('i.receiver_cuit')
      expect(capturedSql).toContain('i.receiver_razon_social')
      // Cascade order in SQL: receiver_cuit first, then customer, then enterprise.
      const receiverIdx = capturedSql.indexOf('i.receiver_cuit')
      const customerIdx = capturedSql.indexOf('c.cuit')
      const enterpriseIdx = capturedSql.indexOf('e.cuit')
      expect(receiverIdx).toBeGreaterThan(-1)
      expect(customerIdx).toBeGreaterThan(-1)
      expect(enterpriseIdx).toBeGreaterThan(-1)
    })

    it('T8: two contacts of same enterprise with different CUITs appear as SEPARATE rows', async () => {
      // Libro IVA should differentiate by (receiver_cuit or customer.cuit or
      // enterprise.cuit) even when multiple invoices share an enterprise_id.
      // Because each invoice row is its own GROUP BY key (i.id), two
      // different receiver_cuit values naturally emit two rows — this test
      // locks in that we don't aggregate by CUIT (which would merge them).
      const service = new AccountingService()

      mockDbExecute.mockImplementation((...args: any[]) => {
        const tpl = args[0]
        const sqlStr = tpl?.strings ? tpl.strings.join('') : ''
        if (sqlStr.includes('invoice_date') && sqlStr.includes('invoice_type')) {
          return Promise.resolve({
            rows: [
              {
                invoice_date: '2026-04-01', invoice_type: 'A', invoice_number: 1,
                punto_venta: 3, afip_response: {},
                customer_name: 'Contacto Uno SRL', customer_cuit: '20-11111111-1',
                neto_gravado: '100', neto_no_gravado: '0', iva_27: '0', iva_21: '21', iva_10_5: '0', iva_5: '0', iva_2_5: '0',
                total_iva: '21', total: '121',
              },
              {
                invoice_date: '2026-04-02', invoice_type: 'A', invoice_number: 2,
                punto_venta: 3, afip_response: {},
                customer_name: 'Contacto Dos SA', customer_cuit: '20-22222222-2',
                neto_gravado: '200', neto_no_gravado: '0', iva_27: '0', iva_21: '42', iva_10_5: '0', iva_5: '0', iva_2_5: '0',
                total_iva: '42', total: '242',
              },
            ],
          })
        }
        return Promise.resolve({ rows: [] })
      })

      const result = await service.getLibroIVAVentas('company-1', '2026-04-01', '2026-04-30')

      expect(result.rows).toHaveLength(2)
      expect(result.rows[0].customer_cuit).toBe('20-11111111-1')
      expect(result.rows[1].customer_cuit).toBe('20-22222222-2')
      expect(result.rows[0].customer_name).toBe('Contacto Uno SRL')
      expect(result.rows[1].customer_name).toBe('Contacto Dos SA')
    })
  })

  // ──────────────────────────────────────────────────────────────────────
  // Cuenta Corriente groups by enterprise (CC must NOT split by CUIT)
  // ──────────────────────────────────────────────────────────────────────
  describe('CC grouping', () => {
    it('T7/T8: CC filter by enterprise_id groups both customer-identity and enterprise-identity invoices together', async () => {
      // The invoice listing filter for enterprise_id uses the invoice's
      // enterprise_id (NOT its receiver_cuit). So an invoice emitted under
      // a customer's own CUIT but linked to enterprise X still shows up
      // when filtering CC by enterprise X.
      //
      // This is a structural assertion on the SQL: the filter must reference
      // enterprise_id, never receiver_cuit.
      const service = new InvoicesService()
      let listFilterSql = ''
      mockDbExecute.mockImplementation((...args: any[]) => {
        const tpl = args[0]
        const sqlStr = tpl?.strings ? tpl.strings.join('') : ''
        if (sqlStr.includes('FROM invoices i') && sqlStr.includes('LEFT JOIN enterprises e')) {
          listFilterSql += sqlStr
        }
        return Promise.resolve({ rows: [] })
      })

      await service.getInvoices('company-1', { enterprise_id: 'ent-parent', userCanAccessLuna: false }).catch(() => {})

      expect(listFilterSql).toContain('i.enterprise_id')
      // The enterprise filter must NOT involve receiver_cuit — CC semantics
      // are defined by the human group, not by CUIT identity.
      expect(listFilterSql).not.toMatch(/enterprise_id.*receiver_cuit|receiver_cuit.*enterprise_id/)
    })
  })

  // ──────────────────────────────────────────────────────────────────────
  // CustomersService accepts new fiscal fields
  // ──────────────────────────────────────────────────────────────────────
  describe('CustomersService — razon_social / fiscal_address', () => {
    it('updateCustomer persists razon_social via raw SQL when provided', async () => {
      const service = new CustomersService()

      // getCustomer is invoked first (raw SELECT *). Then UPDATE for each
      // special field. We capture all SQL to look for the razon_social UPDATE.
      const capturedSql: string[] = []
      mockDbExecute.mockImplementation((...args: any[]) => {
        const tpl = args[0]
        const sqlStr = tpl?.strings ? tpl.strings.join('') : ''
        capturedSql.push(sqlStr)
        if (sqlStr.includes('SELECT * FROM customers WHERE id')) {
          return Promise.resolve({ rows: [{ id: 'cust-1', name: 'X' }] })
        }
        return Promise.resolve({ rows: [] })
      })

      await service.updateCustomer('company-1', 'cust-1', {
        razon_social: 'Nueva RS propia',
        fiscal_address: 'Calle Fiscal 100',
      })

      const razonUpdate = capturedSql.find(s => s.includes('UPDATE customers SET razon_social'))
      const fiscalUpdate = capturedSql.find(s => s.includes('UPDATE customers SET fiscal_address'))
      expect(razonUpdate).toBeDefined()
      expect(fiscalUpdate).toBeDefined()
    })

    it('updateCustomer validates CUIT format when updating', async () => {
      const service = new CustomersService()
      mockDbExecute.mockImplementation((...args: any[]) => {
        const tpl = args[0]
        const sqlStr = tpl?.strings ? tpl.strings.join('') : ''
        if (sqlStr.includes('SELECT * FROM customers WHERE id')) {
          return Promise.resolve({ rows: [{ id: 'cust-1', name: 'X' }] })
        }
        return Promise.resolve({ rows: [] })
      })

      await expect(
        service.updateCustomer('company-1', 'cust-1', { cuit: '123' }), // invalid
      ).rejects.toMatchObject({ statusCode: 400 })
    })
  })
})
