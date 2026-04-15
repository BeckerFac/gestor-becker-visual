import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mockDbExecute, mockDbRows, mockDbEmpty, resetMocks } from './helpers/setup'

// Mock puppeteer BEFORE importing PdfService so the import doesn't spawn Chromium.
vi.mock('puppeteer', () => {
  const fakePdf = Buffer.from('PDF-DATA')
  const page = {
    setContent: vi.fn().mockResolvedValue(undefined),
    pdf: vi.fn().mockResolvedValue(fakePdf),
    close: vi.fn().mockResolvedValue(undefined),
  }
  const browser = {
    version: vi.fn().mockResolvedValue('HeadlessChrome/999'),
    newPage: vi.fn().mockResolvedValue(page),
    close: vi.fn().mockResolvedValue(undefined),
  }
  return {
    default: {
      launch: vi.fn().mockResolvedValue(browser),
    },
  }
})

// Avoid calling real QR generator (it uses network-free qrcode lib but we stub anyway).
vi.mock('../src/lib/qr-afip', () => ({
  generateQrPngDataUrl: vi.fn().mockResolvedValue('data:image/png;base64,STUB'),
}))

import { PdfService } from '../src/modules/pdf/pdf.service'

describe('PdfService', () => {
  let service: PdfService

  beforeEach(() => {
    resetMocks()
    service = new PdfService()
  })

  // Helper: capture the last generated HTML by spying on page.setContent.
  async function captureHtml(fn: () => Promise<Buffer>): Promise<string> {
    let captured = ''
    // Patch newPage after initialize so we control setContent per-test.
    await (service as any).initialize()
    const realBrowser = (service as any).browser
    const fakePage = {
      setContent: vi.fn(async (html: string) => { captured = html }),
      pdf: vi.fn(async () => Buffer.from('PDF')),
      close: vi.fn(async () => {}),
    }
    realBrowser.newPage = vi.fn(async () => fakePage)
    await fn()
    return captured
  }

  describe('generatePaymentPdf - multi-method', () => {
    it('renders all payment_methods[] rows with bank and reference detail', async () => {
      // pago lookup
      mockDbRows([{
        id: 'pago-1',
        company_id: 'company-1',
        business_unit_id: null,
        enterprise_name: 'Proveedor SA',
        enterprise_cuit: '30123456789',
        company_name: 'Mi Empresa',
        company_cuit: '30987654321',
        amount: '10000',
        total_amount: '10000',
        payment_date: '2026-04-10',
        status: 'activo',
        anulled_at: null,
      }])
      // payment_methods side-table (two rows)
      mockDbRows([
        { method: 'transferencia', amount: '7000', bank_name: 'Banco Nacion', reference: 'OP-123' },
        { method: 'cheque', amount: '3000', bank_name: 'Banco Galicia', check_number: '0099887' },
      ])
      // retenciones practicadas (empty)
      mockDbEmpty()
      // linked invoices (empty)
      mockDbEmpty()

      const html = await captureHtml(() => service.generatePaymentPdf('pago-1', 'company-1'))
      expect(html).toContain('Transferencia')
      expect(html).toContain('Banco Nacion')
      expect(html).toContain('OP-123')
      expect(html).toContain('Cheque')
      expect(html).toContain('Banco Galicia')
      expect(html).toContain('Cheque #0099887')
      expect(html).toContain('$ 7000.00')
      expect(html).toContain('$ 3000.00')
    })

    it('falls back to legacy single payment_method when array is empty', async () => {
      mockDbRows([{
        id: 'pago-2', company_id: 'company-1', business_unit_id: null,
        enterprise_name: 'X', company_name: 'Y',
        enterprise_cuit: '30111111112', company_cuit: '30111111113',
        amount: '5000', total_amount: '5000',
        payment_date: '2026-04-10', status: 'activo', anulled_at: null,
        payment_method: 'efectivo', bank_name: null, reference: 'caja',
      }])
      mockDbEmpty() // empty payment_methods side table
      mockDbEmpty() // retenciones
      mockDbEmpty() // linked invoices

      const html = await captureHtml(() => service.generatePaymentPdf('pago-2', 'company-1'))
      expect(html).toContain('Efectivo')
      expect(html).toContain('$ 5000.00')
    })
  })

  describe('generatePaymentPdf - retenciones y Neto a Pagar', () => {
    it('shows bruto - retenciones = neto a pagar', async () => {
      mockDbRows([{
        id: 'pago-3', company_id: 'company-1', business_unit_id: null,
        enterprise_name: 'X', company_name: 'Y',
        enterprise_cuit: '30111111114', company_cuit: '30111111115',
        amount: '100000', total_amount: '100000',
        payment_date: '2026-04-10', status: 'activo', anulled_at: null,
      }])
      mockDbRows([{ method: 'transferencia', amount: '100000' }]) // pm
      mockDbRows([{ // retenciones
        type: 'ganancias',
        regime: 'RG830',
        jurisdiction: 'Nacional',
        certificate_number: 'CERT-001',
        base_amount: '100000',
        rate: '6.0',
        amount: '6000',
      }])
      mockDbEmpty()

      const html = await captureHtml(() => service.generatePaymentPdf('pago-3', 'company-1'))
      expect(html).toContain('Importe Bruto')
      expect(html).toContain('$ 100000.00')
      expect(html).toContain('$ 6000.00')
      expect(html).toContain('NETO A PAGAR')
      expect(html).toContain('$ 94000.00')
      // base_amount (AFIP) column is rendered
      expect(html).toContain('Base AFIP')
    })
  })

  describe('Anulado watermark', () => {
    it('wraps pago HTML with ANULADO watermark + audit footer', async () => {
      mockDbRows([{
        id: 'pago-4', company_id: 'company-1', business_unit_id: null,
        enterprise_name: 'X', company_name: 'Y',
        enterprise_cuit: '30111111116', company_cuit: '30111111117',
        amount: '100', total_amount: '100',
        payment_date: '2026-04-10',
        status: 'anulado',
        anulled_at: '2026-04-12T10:00:00Z',
        anulled_by: 'user-99',
        anulled_reason: 'Error de carga',
      }])
      mockDbEmpty() // pm
      mockDbEmpty() // retenciones
      mockDbEmpty() // invoices
      mockDbRows([{ display: 'Facundo Becker' }]) // resolveUserName

      const html = await captureHtml(() => service.generatePaymentPdf('pago-4', 'company-1'))
      expect(html).toContain('anulado-watermark')
      expect(html).toContain('ANULADO')
      expect(html).toContain('DOCUMENTO ANULADO')
      expect(html).toContain('Facundo Becker')
      expect(html).toContain('Error de carga')
    })
  })

  describe('BU guard', () => {
    it('throws 403 when row belongs to a different company', async () => {
      mockDbRows([{
        id: 'pago-5',
        company_id: 'OTHER-company',
        business_unit_id: null,
        amount: '10', total_amount: '10',
        payment_date: '2026-04-10', status: 'activo',
      }])

      await expect(
        service.generatePaymentPdf('pago-5', 'company-1')
      ).rejects.toMatchObject({ statusCode: 403 })
    })

    it('throws 403 when business_unit_id mismatches', async () => {
      mockDbRows([{
        id: 'pago-6',
        company_id: 'company-1',
        business_unit_id: 'bu-A',
        amount: '10', total_amount: '10',
        payment_date: '2026-04-10', status: 'activo',
      }])

      await expect(
        service.generatePaymentPdf('pago-6', 'company-1', 'bu-B')
      ).rejects.toMatchObject({ statusCode: 403 })
    })

    it('throws 404 when row not found', async () => {
      mockDbEmpty()
      await expect(
        service.generatePaymentPdf('pago-404', 'company-1')
      ).rejects.toMatchObject({ statusCode: 404 })
    })
  })

  describe('XSS escape', () => {
    it('escapes script payloads in pago notes and enterprise name', async () => {
      mockDbRows([{
        id: 'pago-7', company_id: 'company-1', business_unit_id: null,
        enterprise_name: '<script>alert(1)</script>',
        enterprise_cuit: '30111111118', company_cuit: '30111111119',
        company_name: 'Mi Empresa',
        amount: '1', total_amount: '1',
        payment_date: '2026-04-10', status: 'activo', anulled_at: null,
        notes: '<img src=x onerror="alert(2)">',
      }])
      mockDbEmpty()
      mockDbEmpty()
      mockDbEmpty()

      const html = await captureHtml(() => service.generatePaymentPdf('pago-7', 'company-1'))
      expect(html).not.toContain('<script>alert(1)</script>')
      expect(html).toContain('&lt;script&gt;')
      expect(html).not.toContain('<img src=x onerror="alert(2)">')
      expect(html).toContain('&lt;img')
    })
  })

  describe('generateChequePdf - cheque emitido', () => {
    it('renders direction, issuer_type, drawer, drawer_cuit, due_date', async () => {
      mockDbRows([{
        id: 'cheque-1',
        company_id: 'company-1',
        business_unit_id: null,
        number: '12345678',
        bank: 'Banco Nacion',
        drawer: 'Mi Empresa SA',
        drawer_cuit: '30-98765432-1',
        direction: 'emitido',
        issuer_type: 'propio',
        issue_date: '2026-01-15',
        due_date: '2026-04-15',
        amount: '50000',
        status: 'emitido',
      }])
      mockDbRows([
        { created_at: '2026-01-15T10:00:00Z', from_status: null, to_status: 'emitido', reason: 'Creado' },
        { created_at: '2026-02-10T10:00:00Z', from_status: 'emitido', to_status: 'entregado', reason: 'Entregado a proveedor' },
      ])

      const html = await captureHtml(() => service.generateChequePdf('cheque-1', 'company-1'))
      expect(html).toContain('CHEQUE EMITIDO')
      expect(html).toContain('Propio')
      expect(html).toContain('Mi Empresa SA')
      expect(html).toContain('30-98765432-1')
      expect(html).toContain('12345678')
      expect(html).toContain('Historial de transiciones')
      expect(html).toContain('Entregado a proveedor')
    })

    it('throws 403 on cheque of another tenant', async () => {
      mockDbRows([{
        id: 'cheque-2',
        company_id: 'OTHER',
        business_unit_id: null,
        number: '1', bank: 'X', drawer: 'Y',
        direction: 'emitido', issuer_type: 'propio',
        issue_date: '2026-01-01', due_date: '2026-04-01',
        amount: '1', status: 'emitido',
      }])
      await expect(
        service.generateChequePdf('cheque-2', 'company-1')
      ).rejects.toMatchObject({ statusCode: 403 })
    })
  })
})
