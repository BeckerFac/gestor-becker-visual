import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mockDbRows, mockDbEmpty, resetMocks } from './helpers/setup'

// Stub puppeteer (same pattern as pdf-service.test.ts)
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
  return { default: { launch: vi.fn().mockResolvedValue(browser) } }
})

vi.mock('../src/lib/qr-afip', () => ({
  generateQrPngDataUrl: vi.fn().mockResolvedValue('data:image/png;base64,STUB'),
}))

import { PdfService } from '../src/modules/pdf/pdf.service'

describe('PdfService - generateOrderPdf', () => {
  let service: PdfService

  beforeEach(() => {
    resetMocks()
    service = new PdfService()
  })

  // Capture last HTML rendered to setContent so we can assert on its content.
  async function captureHtml(fn: () => Promise<Buffer>): Promise<string> {
    let captured = ''
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

  // Helper: queue a "happy path" set of mockDbRows for a typical order render.
  // Order returns DB sequence: order, items, company, [enterprise direct OR customer + enterprise].
  function queueOrder(opts: {
    order: any
    items: any[]
    company: any
    enterprise?: any | null
    customer?: any | null
    enterpriseDirect?: boolean
  }) {
    const {
      order, items, company,
      enterprise = null, customer = null, enterpriseDirect = true,
    } = opts
    mockDbRows([order])           // SELECT * FROM orders WHERE id=?
    mockDbRows(items)             // order_items
    mockDbRows([company])         // companies
    if (order.enterprise_id && enterpriseDirect) {
      mockDbRows(enterprise ? [enterprise] : [])
    }
    if (order.customer_id) {
      mockDbRows(customer ? [customer] : [])
      // If no direct enterprise was hit (or it was empty) AND customer has enterprise_id → second enterprise lookup
      if ((!order.enterprise_id || !enterpriseDirect || !enterprise) && customer?.enterprise_id) {
        mockDbRows(enterprise ? [enterprise] : [])
      }
    }
  }

  it('renders order PDF with company, enterprise, items and totals', async () => {
    const order = {
      id: 'ord-1', company_id: 'company-1', business_unit_id: null,
      enterprise_id: 'ent-1', customer_id: 'cus-1',
      order_number: 42, title: 'Pedido test', status: 'pendiente',
      product_type: 'producto', priority: 'alta', notes: 'Entregar manana',
      discount_percent: '10',
      created_at: '2026-04-10T10:00:00Z', estimated_delivery: '2026-04-20',
      anulled_at: null,
    }
    const items = [
      { id: 'i1', product_name: 'Cartel grande', quantity: '2', unit_price: '1000', vat_rate: '21' },
      { id: 'i2', product_name: 'Banner pequeno', quantity: '1', unit_price: '500', vat_rate: '10.5' },
    ]
    const company = {
      id: 'company-1', name: 'Mi Empresa SA', cuit: '30123456789',
      address: 'Calle 123', city: 'CABA', province: 'BA', phone: '11-1111', email: 'me@e.com',
      logo_url: null,
    }
    const enterprise = {
      id: 'ent-1', company_id: 'company-1',
      razon_social: 'Cliente Test SRL', name: 'Cliente Test',
      cuit: '30999888777', tax_condition: 'IVA Responsable Inscripto',
      fiscal_address: 'Av Fiscal 1', fiscal_city: 'Cordoba', fiscal_province: 'CBA', fiscal_postal_code: '5000',
      address: 'Av Entrega 9', city: 'Rosario', province: 'SF', postal_code: '2000',
    }
    const customer = { id: 'cus-1', name: 'Juan Perez', email: 'jp@e.com', phone: '11-2222', enterprise_id: 'ent-1' }

    queueOrder({ order, items, company, enterprise, customer })

    const html = await captureHtml(() => service.generateOrderPdf('ord-1', 'company-1'))

    // Company fiscal data
    expect(html).toContain('Mi Empresa SA')
    expect(html).toContain('30-12345678-9')
    expect(html).toContain('Calle 123')
    expect(html).toContain('me@e.com')

    // Customer (enterprise) fiscal + shipping
    expect(html).toContain('Cliente Test SRL')
    expect(html).toContain('30-99988877-7')
    expect(html).toContain('IVA Responsable Inscripto')
    expect(html).toContain('Av Fiscal 1')
    expect(html).toContain('Av Entrega 9')

    // Order metadata
    expect(html).toContain('00000042')
    expect(html).toContain('Pedido test')
    expect(html).toContain('alta')
    expect(html).toContain('Entregar manana')

    // Items: subtotals
    expect(html).toContain('Cartel grande')
    expect(html).toContain('Banner pequeno')
    // 2 * 1000 = 2000 subtotal neto del item 1
    expect(html).toContain('2.000,00')
    // 1 * 500 = 500
    expect(html).toContain('500,00')

    // Totals: subtotal neto = 2000 + 500 = 2500
    expect(html).toContain('Subtotal Neto')
    expect(html).toContain('2.500,00')
    // Discount 10% = 250
    expect(html).toContain('Descuento 10.00%')
    // IVA 21 sobre 2000 con descuento = 2000*0.21*0.9 = 378.00
    expect(html).toContain('IVA 21.00%')
    // IVA 10.5 sobre 500 con descuento = 500*0.105*0.9 = 47.25
    expect(html).toContain('IVA 10.50%')
  })

  it('blocks cross-tenant access (BU guard 403)', async () => {
    const order = {
      id: 'ord-2', company_id: 'OTHER-COMPANY', business_unit_id: null,
      enterprise_id: null, customer_id: null,
      order_number: 1, title: 't', discount_percent: '0',
      created_at: '2026-04-10', anulled_at: null,
    }
    mockDbRows([order]) // SELECT * FROM orders

    await expect(service.generateOrderPdf('ord-2', 'company-1')).rejects.toMatchObject({
      statusCode: 403,
    })
  })

  it('throws 404 when order does not exist', async () => {
    mockDbEmpty()
    await expect(service.generateOrderPdf('missing', 'company-1')).rejects.toMatchObject({
      statusCode: 404,
    })
  })

  it('escapes HTML in user-controlled strings (XSS defense)', async () => {
    const order = {
      id: 'ord-3', company_id: 'company-1', business_unit_id: null,
      enterprise_id: null, customer_id: null,
      order_number: 7, title: '<script>alert(1)</script>', notes: '<img src=x onerror=alert(1)>',
      discount_percent: '0', created_at: '2026-04-10', anulled_at: null,
    }
    mockDbRows([order])
    mockDbEmpty() // items
    mockDbRows([{ id: 'company-1', name: 'C', cuit: '30000000007' }])

    const html = await captureHtml(() => service.generateOrderPdf('ord-3', 'company-1'))

    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;')
    // The <img> tag must be escaped so the browser cannot execute onerror.
    expect(html).not.toContain('<img src=x onerror=alert(1)>')
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
  })

  it('handles order with no items and no discount', async () => {
    const order = {
      id: 'ord-4', company_id: 'company-1', business_unit_id: null,
      enterprise_id: null, customer_id: null,
      order_number: 100, title: 'Vacio', discount_percent: '0',
      created_at: '2026-04-10', anulled_at: null,
    }
    mockDbRows([order])
    mockDbEmpty()
    mockDbRows([{ id: 'company-1', name: 'Empresa', cuit: '30000000000' }])

    const html = await captureHtml(() => service.generateOrderPdf('ord-4', 'company-1'))
    expect(html).toContain('Sin items')
    expect(html).toContain('Subtotal Neto')
    expect(html).not.toContain('Descuento')
  })
})
