import puppeteer from 'puppeteer'
import { db } from '../../config/db'
import { invoices, invoice_items, customers, products } from '../../db/schema'
import { eq, sql } from 'drizzle-orm'
import { ApiError } from '../../middlewares/errorHandler'

const INVOICE_TYPE_MAP: Record<string, number> = {
  'A': 1, 'B': 6, 'C': 11,
}

export interface InvoicePdfInput {
  invoiceId: string
  companyName: string
  companyCuit: string
  companyAddress?: string
  companyCity?: string
  companyProvince?: string
  companyPhone?: string
  companyEmail?: string
}

export class PdfService {
  private browser: any = null

  async initialize() {
    // Recover from disconnected/crashed browser
    if (this.browser) {
      try {
        // Test if browser is still connected
        await this.browser.version()
      } catch {
        console.warn('Browser disconnected, relaunching...')
        this.browser = null
      }
    }
    if (!this.browser) {
      this.browser = await puppeteer.launch({
        headless: 'new',
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--disable-extensions',
          '--disable-background-networking',
          '--no-first-run',
          // Prevent the browser from making any network requests (SSRF protection)
          '--disable-web-security=false',
        ],
      })
    }
  }

  async generateInvoicePdf(input: InvoicePdfInput): Promise<Buffer> {
    try {
      await this.initialize()

      // Get invoice data via raw SQL to include fiscal_type (migration column)
      const invResult = await db.execute(sql`SELECT * FROM invoices WHERE id = ${input.invoiceId}`)
      const invoice = ((invResult as any).rows || [])[0]

      if (!invoice) {
        throw new ApiError(404, 'Invoice not found')
      }

      // Get invoice items
      const items = await db.query.invoice_items.findMany({
        where: eq(invoice_items.invoice_id, input.invoiceId),
      })

      // Get customer data
      const customer = invoice.customer_id
        ? await db.query.customers.findFirst({
            where: eq(customers.id, invoice.customer_id),
          })
        : null

      // Generate HTML — bifurcate between fiscal and internal voucher
      const html = invoice.fiscal_type === 'interno'
        ? this.generateInternalVoucherHtml({ invoice, items, customer, company: input })
        : this.generateInvoiceHtml({ invoice, items, customer, company: input })

      // Convert to PDF using Puppeteer
      if (!this.browser) {
        throw new Error('Browser not initialized')
      }

      const page = await this.browser.newPage()
      await page.setContent(html, { waitUntil: 'networkidle0' })

      const pdf = await page.pdf({
        format: 'A4',
        margin: { top: '20px', right: '20px', bottom: '20px', left: '20px' },
      })

      await page.close()

      return pdf
    } catch (error) {
      if (error instanceof ApiError) throw error
      throw new ApiError(500, 'PDF generation failed')
    }
  }

  private formatCuit(cuit: string): string {
    const clean = cuit.replace(/-/g, '')
    if (clean.length === 11) return `${clean.slice(0,2)}-${clean.slice(2,10)}-${clean.slice(10)}`
    return cuit
  }

  // Escape HTML to prevent XSS/injection in generated PDFs
  private escapeHtml(str: string | null | undefined): string {
    if (!str) return ''
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
  }

  private generateInvoiceHtml(data: any): string {
    const { invoice, items, customer, company } = data

    // Escape all user-controlled strings to prevent HTML injection in PDFs
    const esc = this.escapeHtml.bind(this)

    // Extract punto de venta from AFIP response
    const puntoVenta = invoice.afip_response?.FeCabResp?.PtoVta || ''
    const ptoVtaStr = puntoVenta ? String(puntoVenta).padStart(5, '0') : ''
    const nroStr = String(invoice.invoice_number).padStart(8, '0')
    const comprobanteNum = ptoVtaStr ? `${ptoVtaStr}-${nroStr}` : nroStr

    // CAE expiry date
    const caeExpiry = invoice.cae_expiry_date
      ? new Date(invoice.cae_expiry_date).toLocaleDateString('es-AR')
      : ''

    const invoiceDate = new Date(invoice.invoice_date).toLocaleDateString('es-AR')

    // CUIT formateado
    const companyCuit = this.formatCuit(company.companyCuit || '')

    // Domicilio completo
    const domicilio = [company.companyAddress, company.companyCity, company.companyProvince]
      .filter(Boolean).join(', ')

    // Invoice type letter: fallback to 'NF' for non-fiscal invoices
    const invoiceTypeLetter = invoice.invoice_type || 'NF'

    // Condición IVA según tipo de factura
    const condicionIvaEmisor: Record<string, string> = {
      'A': 'IVA Responsable Inscripto',
      'B': 'IVA Responsable Inscripto',
      'C': 'Responsable Monotributo',
    }

    const isFacturaC = invoice.invoice_type === 'C'
    const cbteTipo = INVOICE_TYPE_MAP[invoice.invoice_type] || 11

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Factura ${invoiceTypeLetter} ${comprobanteNum}</title>
  <style>
    @page { size: A4; margin: 10mm; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: Arial, Helvetica, sans-serif; color: #000; font-size: 11px; line-height: 1.4; }

    /* ===== HEADER ===== */
    .header-wrapper {
      border: 1.5px solid #000; display: flex; margin-bottom: 8px; position: relative;
    }
    .header-left, .header-right { flex: 1; padding: 12px 16px; }
    .header-left { border-right: none; }
    .header-right { border-left: none; }

    /* Letra centrada */
    .letter-box {
      position: absolute; top: -1px; left: 50%; transform: translateX(-50%);
      width: 56px; background: #fff; border: 1.5px solid #000;
      text-align: center; padding: 4px 0 2px;
    }
    .letter-box .letter { font-size: 36px; font-weight: bold; line-height: 1; }
    .letter-box .cod { font-size: 8px; color: #555; }

    /* Separador vertical */
    .header-divider {
      position: absolute; top: 0; bottom: 0; left: 50%; width: 0;
      border-left: 1.5px solid #000;
    }

    .razonsocial { font-size: 16px; font-weight: bold; margin-bottom: 4px; }
    .header-label { font-size: 10px; color: #444; }
    .header-value { font-size: 11px; font-weight: 600; }
    .header-row { margin-bottom: 3px; }

    .comprobante-tipo { font-size: 13px; font-weight: bold; margin-bottom: 6px; }
    .comprobante-nro {
      font-size: 16px; font-weight: bold; font-family: 'Courier New', monospace;
      margin-bottom: 8px;
    }

    /* ===== INFO BAR (debajo del header) ===== */
    .info-bar {
      border: 1.5px solid #000; border-top: none;
      display: flex; margin-bottom: 10px;
    }
    .info-bar-left, .info-bar-right {
      flex: 1; padding: 6px 16px;
    }
    .info-bar-left { border-right: 1.5px solid #000; }
    .info-row { display: flex; margin-bottom: 2px; }
    .info-label { font-size: 10px; color: #444; min-width: 120px; }
    .info-value { font-size: 11px; }

    /* ===== RECEPTOR ===== */
    .receptor {
      border: 1.5px solid #000; padding: 8px 16px; margin-bottom: 10px;
    }
    .receptor-title { font-size: 10px; font-weight: bold; color: #444; text-transform: uppercase; margin-bottom: 4px; }

    /* ===== ITEMS TABLE ===== */
    table { width: 100%; border-collapse: collapse; margin-bottom: 0; }
    thead th {
      background: #e8e8e8; border: 1px solid #999; padding: 6px 8px;
      font-size: 10px; font-weight: bold; text-transform: uppercase; text-align: center;
    }
    thead th.left { text-align: left; }
    thead th.right { text-align: right; }
    tbody td {
      border: 1px solid #ccc; padding: 5px 8px; font-size: 11px;
    }
    tbody td.center { text-align: center; }
    tbody td.right { text-align: right; font-family: 'Courier New', monospace; }

    /* ===== TOTALS ===== */
    .totals-wrapper {
      border: 1.5px solid #000; border-top: none; margin-bottom: 12px;
    }
    .totals-row {
      display: flex; justify-content: flex-end; padding: 4px 16px;
      border-bottom: 1px solid #ddd;
    }
    .totals-row:last-child { border-bottom: none; }
    .totals-label { font-size: 11px; min-width: 160px; text-align: right; padding-right: 20px; }
    .totals-amount { font-size: 11px; font-family: 'Courier New', monospace; font-weight: bold; min-width: 100px; text-align: right; }
    .totals-row.grand {
      background: #f0f0f0; padding: 8px 16px;
    }
    .totals-row.grand .totals-label,
    .totals-row.grand .totals-amount { font-size: 14px; font-weight: bold; }

    /* ===== CAE + QR ===== */
    .cae-bar {
      border: 1.5px solid #000; display: flex; justify-content: space-between;
      align-items: center; padding: 10px 16px; margin-bottom: 8px;
    }
    .cae-text .cae-label { font-size: 10px; color: #444; font-weight: bold; }
    .cae-text .cae-number { font-size: 16px; font-family: 'Courier New', monospace; font-weight: bold; }
    .cae-text .cae-exp { font-size: 10px; color: #444; margin-top: 2px; }

    /* ===== FOOTER ===== */
    .footer {
      text-align: center; font-size: 9px; color: #888; padding-top: 6px;
      border-top: 1px solid #ddd;
    }
  </style>
</head>
<body>

  <!-- HEADER: Emisor izq | Letra | Comprobante der -->
  <div class="header-wrapper">
    <div class="header-divider"></div>
    <div class="letter-box">
      <div class="letter">${invoiceTypeLetter}</div>
      <div class="cod">COD. ${String(cbteTipo).padStart(2, '0')}</div>
    </div>

    <div class="header-left">
      <div class="razonsocial">${esc(company.companyName)}</div>
      ${domicilio ? `<div class="header-row"><span class="header-label">Domicilio Comercial:</span> ${esc(domicilio)}</div>` : ''}
      <div class="header-row"><span class="header-label">Condición frente al IVA:</span> <span class="header-value">${condicionIvaEmisor[invoiceTypeLetter] || 'Monotributo'}</span></div>
    </div>

    <div class="header-right" style="padding-left: 50px;">
      <div class="comprobante-tipo">FACTURA</div>
      <div class="comprobante-nro">Punto de Venta: ${ptoVtaStr} &nbsp; Comp. Nro: ${nroStr}</div>
      <div class="header-row"><span class="header-label">Fecha de Emisión:</span> <span class="header-value">${invoiceDate}</span></div>
      <div class="header-row"><span class="header-label">CUIT:</span> <span class="header-value">${esc(companyCuit)}</span></div>
    </div>
  </div>

  <!-- INFO BAR: datos fiscales adicionales -->
  <div class="info-bar">
    <div class="info-bar-left">
      <div class="info-row"><span class="info-label">Período Desde:</span> <span class="info-value">${invoiceDate}</span></div>
      <div class="info-row"><span class="info-label">Período Hasta:</span> <span class="info-value">${invoiceDate}</span></div>
      <div class="info-row"><span class="info-label">Fecha de Vto. para el pago:</span> <span class="info-value">${invoiceDate}</span></div>
    </div>
    <div class="info-bar-right">
      ${company.companyPhone ? `<div class="info-row"><span class="info-label">Teléfono:</span> <span class="info-value">${company.companyPhone}</span></div>` : ''}
      ${company.companyEmail ? `<div class="info-row"><span class="info-label">Email:</span> <span class="info-value">${company.companyEmail}</span></div>` : ''}
    </div>
  </div>

  <!-- RECEPTOR -->
  <div class="receptor">
    <div style="display: flex; gap: 40px;">
      <div style="flex: 1;">
        <div class="info-row"><span class="info-label">Condición frente al IVA:</span> <span class="info-value">${esc(customer?.tax_condition || 'Consumidor Final')}</span></div>
        <div class="info-row"><span class="info-label">Nombre / Razón Social:</span> <span class="info-value" style="font-weight: bold;">${esc(customer?.name || 'Consumidor Final')}</span></div>
      </div>
      <div style="flex: 1;">
        ${customer?.cuit
          ? `<div class="info-row"><span class="info-label">CUIT:</span> <span class="info-value">${esc(this.formatCuit(customer.cuit))}</span></div>`
          : `<div class="info-row"><span class="info-label">Documento:</span> <span class="info-value">-</span></div>`
        }
        <div class="info-row"><span class="info-label">Domicilio:</span> <span class="info-value">${esc(customer?.address || '-')}</span></div>
      </div>
    </div>
  </div>

  <!-- ITEMS TABLE -->
  <table>
    <thead>
      <tr>
        <th class="left" style="width:8%;">Código</th>
        <th class="left" style="width:${isFacturaC ? '52' : '40'}%;">Producto / Servicio</th>
        <th style="width:8%;">Cantidad</th>
        <th style="width:8%;">U. Medida</th>
        <th class="right" style="width:12%;">Precio Unit.</th>
        ${!isFacturaC ? '<th class="right" style="width:8%;">% IVA</th>' : ''}
        ${!isFacturaC ? '<th class="right" style="width:10%;">Subtotal</th>' : ''}
        <th class="right" style="width:${isFacturaC ? '14' : '10'}%;">Importe</th>
      </tr>
    </thead>
    <tbody>
      ${items.map((item: any, idx: number) => {
        const qty = parseFloat(item.quantity)
        const price = parseFloat(item.unit_price)
        const vatRate = parseFloat(item.vat_rate || '0')
        const subtotalItem = qty * price
        const ivaAmount = isFacturaC ? 0 : subtotalItem * (vatRate / 100)
        return `
        <tr>
          <td class="center">${String(idx + 1).padStart(3, '0')}</td>
          <td>${esc(item.product_name || '-')}</td>
          <td class="center">${qty.toFixed(2)}</td>
          <td class="center">unidades</td>
          <td class="right">${price.toFixed(2)}</td>
          ${!isFacturaC ? `<td class="right">${vatRate.toFixed(2)}</td>` : ''}
          ${!isFacturaC ? `<td class="right">${subtotalItem.toFixed(2)}</td>` : ''}
          <td class="right">${(subtotalItem + ivaAmount).toFixed(2)}</td>
        </tr>`
      }).join('')}
    </tbody>
  </table>

  <!-- TOTALS -->
  <div class="totals-wrapper">
    ${!isFacturaC ? `
    <div class="totals-row">
      <span class="totals-label">Importe Neto Gravado:</span>
      <span class="totals-amount">$ ${parseFloat(invoice.subtotal).toFixed(2)}</span>
    </div>
    <div class="totals-row">
      <span class="totals-label">IVA 21%:</span>
      <span class="totals-amount">$ ${parseFloat(invoice.vat_amount).toFixed(2)}</span>
    </div>
    ` : ''}
    <div class="totals-row grand">
      <span class="totals-label">Importe Total: $</span>
      <span class="totals-amount">${parseFloat(invoice.total_amount).toFixed(2)}</span>
    </div>
  </div>

  <!-- CAE + QR -->
  ${invoice.cae ? `
  <div class="cae-bar">
    <div class="cae-text">
      <div class="cae-label">CAE N°:</div>
      <div class="cae-number">${invoice.cae}</div>
      <div class="cae-exp">Fecha de Vto. de CAE: ${caeExpiry}</div>
    </div>
    ${invoice.qr_code ? `
    <div>
      <img src="https://api.qrserver.com/v1/create-qr-code/?size=100x100&data=${encodeURIComponent(invoice.qr_code)}"
           alt="QR AFIP" width="100" height="100" />
    </div>
    ` : ''}
  </div>
  ` : `
  <div style="border: 2px dashed #c00; padding: 12px; text-align: center; color: #c00; font-weight: bold; font-size: 13px;">
    COMPROBANTE NO VÁLIDO COMO FACTURA - BORRADOR SIN AUTORIZAR
  </div>
  `}

  <div class="footer">
    ${invoice.cae ? 'Comprobante autorizado - Ley N° 24.760 / R.G. AFIP N° 4291' : ''}
  </div>

</body>
</html>`
  }

  private generateInternalVoucherHtml(data: any): string {
    const { invoice, items, customer, company } = data
    const esc = this.escapeHtml.bind(this)
    const nroStr = String(invoice.invoice_number).padStart(6, '0')
    const invoiceDate = new Date(invoice.invoice_date).toLocaleDateString('es-AR')
    const companyCuit = this.formatCuit(company.companyCuit || '')
    const domicilio = [company.companyAddress, company.companyCity, company.companyProvince]
      .filter(Boolean).join(', ')

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Comprobante Interno CI-${nroStr}</title>
  <style>
    @page { size: A4; margin: 10mm; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: Arial, Helvetica, sans-serif; color: #000; font-size: 11px; line-height: 1.4; }
    .warning-banner {
      background: #8b0000; color: white; text-align: center; padding: 10px;
      font-weight: bold; font-size: 13px; letter-spacing: 2px; margin-bottom: 10px;
    }
    .header-wrapper {
      border: 1.5px solid #000; display: flex; margin-bottom: 8px;
    }
    .header-left, .header-right { flex: 1; padding: 12px 16px; }
    .header-right { border-left: 1.5px solid #000; }
    .razonsocial { font-size: 16px; font-weight: bold; margin-bottom: 4px; }
    .header-label { font-size: 10px; color: #444; }
    .header-value { font-size: 11px; font-weight: 600; }
    .header-row { margin-bottom: 3px; }
    .comprobante-tipo { font-size: 14px; font-weight: bold; margin-bottom: 6px; color: #8b0000; }
    .comprobante-nro {
      font-size: 18px; font-weight: bold; font-family: 'Courier New', monospace; margin-bottom: 8px;
    }
    .receptor { border: 1.5px solid #000; padding: 8px 16px; margin-bottom: 10px; }
    .info-row { display: flex; margin-bottom: 2px; }
    .info-label { font-size: 10px; color: #444; min-width: 120px; }
    .info-value { font-size: 11px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 0; }
    thead th {
      background: #e8e8e8; border: 1px solid #999; padding: 6px 8px;
      font-size: 10px; font-weight: bold; text-transform: uppercase; text-align: center;
    }
    thead th.left { text-align: left; }
    thead th.right { text-align: right; }
    tbody td { border: 1px solid #ccc; padding: 5px 8px; font-size: 11px; }
    tbody td.center { text-align: center; }
    tbody td.right { text-align: right; font-family: 'Courier New', monospace; }
    .totals-wrapper { border: 1.5px solid #000; border-top: none; margin-bottom: 12px; }
    .totals-row { display: flex; justify-content: flex-end; padding: 4px 16px; border-bottom: 1px solid #ddd; }
    .totals-row:last-child { border-bottom: none; }
    .totals-label { font-size: 11px; min-width: 160px; text-align: right; padding-right: 20px; }
    .totals-amount { font-size: 11px; font-family: 'Courier New', monospace; font-weight: bold; min-width: 100px; text-align: right; }
    .totals-row.grand { background: #f0f0f0; padding: 8px 16px; }
    .totals-row.grand .totals-label, .totals-row.grand .totals-amount { font-size: 14px; font-weight: bold; }
    .internal-footer {
      border: 2px solid #8b0000; padding: 12px; text-align: center;
      color: #8b0000; font-weight: bold; font-size: 12px; margin-top: 10px;
    }
    .footer { text-align: center; font-size: 9px; color: #888; padding-top: 6px; border-top: 1px solid #ddd; margin-top: 8px; }
  </style>
</head>
<body>

  <div class="warning-banner">COMPROBANTE INTERNO - SIN VALOR FISCAL - NO EMITIDO EN AFIP</div>

  <div class="header-wrapper">
    <div class="header-left">
      <div class="razonsocial">${esc(company.companyName)}</div>
      ${domicilio ? `<div class="header-row"><span class="header-label">Domicilio Comercial:</span> ${esc(domicilio)}</div>` : ''}
      <div class="header-row"><span class="header-label">CUIT:</span> <span class="header-value">${esc(companyCuit)}</span></div>
    </div>
    <div class="header-right">
      <div class="comprobante-tipo">COMPROBANTE INTERNO</div>
      <div class="comprobante-nro">CI-${nroStr}</div>
      <div class="header-row"><span class="header-label">Fecha de Emision:</span> <span class="header-value">${invoiceDate}</span></div>
    </div>
  </div>

  <div class="receptor">
    <div style="display: flex; gap: 40px;">
      <div style="flex: 1;">
        <div class="info-row"><span class="info-label">Nombre / Razon Social:</span> <span class="info-value" style="font-weight: bold;">${esc(customer?.name || 'Sin especificar')}</span></div>
      </div>
      <div style="flex: 1;">
        ${customer?.cuit
          ? `<div class="info-row"><span class="info-label">CUIT:</span> <span class="info-value">${esc(this.formatCuit(customer.cuit))}</span></div>`
          : ''
        }
        ${customer?.address ? `<div class="info-row"><span class="info-label">Domicilio:</span> <span class="info-value">${esc(customer.address)}</span></div>` : ''}
      </div>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th class="left" style="width:8%;">Cod.</th>
        <th class="left" style="width:46%;">Producto / Servicio</th>
        <th style="width:10%;">Cantidad</th>
        <th class="right" style="width:15%;">Precio Unit.</th>
        <th class="right" style="width:15%;">Importe</th>
      </tr>
    </thead>
    <tbody>
      ${items.map((item: any, idx: number) => {
        const qty = parseFloat(item.quantity)
        const price = parseFloat(item.unit_price)
        const total = qty * price
        return `
        <tr>
          <td class="center">${String(idx + 1).padStart(3, '0')}</td>
          <td>${esc(item.product_name || '-')}</td>
          <td class="center">${qty.toFixed(2)}</td>
          <td class="right">${price.toFixed(2)}</td>
          <td class="right">${total.toFixed(2)}</td>
        </tr>`
      }).join('')}
    </tbody>
  </table>

  <div class="totals-wrapper">
    <div class="totals-row grand">
      <span class="totals-label">Importe Total: $</span>
      <span class="totals-amount">${parseFloat(invoice.total_amount).toFixed(2)}</span>
    </div>
  </div>

  <div class="internal-footer">
    COMPROBANTE INTERNO N° CI-${nroStr} - DOCUMENTO SIN VALOR FISCAL
  </div>

  <div class="footer">
    Generado el ${new Date().toLocaleDateString('es-AR')} - Uso interno exclusivo
  </div>

</body>
</html>`
  }

  async generateCatalogPdf(products: any[], companyName: string): Promise<Buffer> {
    try {
      await this.initialize()

      const html = this.generateCatalogHtml(products, companyName)

      if (!this.browser) {
        throw new Error('Browser not initialized')
      }

      const page = await this.browser.newPage()
      await page.setContent(html, { waitUntil: 'networkidle0' })

      const pdf = await page.pdf({
        format: 'A4',
        margin: { top: '20px', right: '20px', bottom: '20px', left: '20px' },
      })

      await page.close()

      return pdf
    } catch (error) {
      throw new ApiError(500, 'Catalog PDF generation failed')
    }
  }

  private generateCatalogHtml(products: any[], companyName: string): string {
    const esc = this.escapeHtml.bind(this)
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>Catálogo - ${esc(companyName)}</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 0; padding: 20px; background: #f5f5f5; }
          h1 { text-align: center; color: #333; border-bottom: 3px solid #0066cc; padding-bottom: 20px; }
          .products-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 20px; }
          .product-card {
            background: white; padding: 15px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);
          }
          .product-name { font-weight: bold; font-size: 16px; color: #333; margin-bottom: 10px; }
          .product-sku { color: #999; font-size: 12px; margin-bottom: 10px; }
          .product-price { font-size: 20px; font-weight: bold; color: #0066cc; }
          .footer { margin-top: 40px; text-align: center; color: #666; font-size: 12px; border-top: 1px solid #ddd; padding-top: 20px; }
        </style>
      </head>
      <body>
        <h1>${esc(companyName)}</h1>
        <h2 style="text-align: center; color: #666;">Catálogo de Productos</h2>

        <div class="products-grid">
          ${products
            .map(
              (p: any) => `
            <div class="product-card">
              <div class="product-name">${esc(p.name)}</div>
              <div class="product-sku">SKU: ${esc(p.sku)}</div>
              <div class="product-price">$${esc(p.final_price || 'Consultar')}</div>
            </div>
          `
            )
            .join('')}
        </div>

        <div class="footer">
          <p>Catálogo vigente desde ${new Date().toLocaleDateString('es-AR')}</p>
          <p>Para más información, contacte con nosotros</p>
        </div>
      </body>
      </html>
    `
  }

  async generateCuentaCorrientePdf(data: {
    company: { name: string; cuit: string };
    enterprise: { name: string; cuit: string | null };
    dateFrom: string;
    dateTo: string;
    movimientos: Array<{
      fecha: string;
      tipo: string;
      descripcion: string;
      debe: number;
      haber: number;
      saldo: number;
      isPagar?: boolean;
    }>;
    totalBalance: number;
    totalMovimientos: number;
  }): Promise<Buffer> {
    let page: any = null;
    try {
      await this.initialize();

      const html = this.generateCuentaCorrienteHtml(data);

      if (!this.browser) {
        throw new Error('Browser not initialized after initialize()');
      }

      page = await this.browser.newPage();
      await page.setContent(html, { waitUntil: 'networkidle0', timeout: 15000 });

      const pdf = await page.pdf({
        format: 'A4',
        margin: { top: '20px', right: '20px', bottom: '20px', left: '20px' },
        timeout: 15000,
      });

      return pdf;
    } catch (error: any) {
      console.error('generateCuentaCorrientePdf error:', error?.message, error?.stack);
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, `Cuenta corriente PDF generation failed: ${(error?.message || 'unknown').slice(0, 200)}`);
    } finally {
      if (page) {
        try { await page.close(); } catch { /* ignore close errors */ }
      }
    }
  }

  private generateCuentaCorrienteHtml(data: {
    company: { name: string; cuit: string };
    enterprise: { name: string; cuit: string | null };
    dateFrom: string;
    dateTo: string;
    movimientos: Array<{
      fecha: string;
      tipo: string;
      descripcion: string;
      debe: number;
      haber: number;
      saldo: number;
      isPagar?: boolean;
    }>;
    totalBalance: number;
    totalMovimientos: number;
  }): string {
    const esc = this.escapeHtml.bind(this);
    const now = new Date();
    const todayStr = now.toLocaleDateString('es-AR');
    const timeStr = now.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });

    const formatDateStr = (d: string | null | undefined) => {
      if (!d) return '-';
      try {
        const date = new Date(d);
        if (isNaN(date.getTime())) return String(d);
        return date.toLocaleDateString('es-AR');
      } catch {
        return String(d);
      }
    };

    const formatMoney = (n: number | null | undefined) => {
      const val = typeof n === 'number' && !isNaN(n) ? n : 0;
      return val.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    };

    const tipoLabels: Record<string, string> = {
      factura: 'Factura',
      venta: 'Venta',
      cobro: 'Cobro',
      ajuste: 'Ajuste',
      compra: 'Compra',
      pago: 'Pago',
    };

    const tipoColors: Record<string, string> = {
      factura: 'background: #dbeafe; color: #1d4ed8;',
      venta: 'background: #dbeafe; color: #1d4ed8;',
      cobro: 'background: #dcfce7; color: #15803d;',
      ajuste: 'background: #fef3c7; color: #92400e;',
      compra: 'background: #ffedd5; color: #c2410c;',
      pago: 'background: #fee2e2; color: #dc2626;',
    };

    const companyCuit = this.formatCuit(data.company.cuit || '');
    const enterpriseCuit = data.enterprise.cuit ? this.formatCuit(data.enterprise.cuit) : 'No registrado';
    const balanceColor = data.totalBalance >= 0 ? '#2E7D32' : '#c62828';
    const truncatedNote = data.totalMovimientos > 500
      ? `<p style="font-size: 11px; color: #e65100; margin-top: 10px;">Nota: Se muestran los 500 movimientos mas recientes de ${data.totalMovimientos} totales en el periodo.</p>`
      : '';

    const rowsHtml = data.movimientos.length > 0
      ? data.movimientos.map((m, idx) => {
          const bgColor = idx % 2 === 0 ? '#fff' : '#fafafa';
          const tipoStyle = tipoColors[m.tipo] || 'background: #f3f4f6; color: #374151;';
          const saldoColor = m.saldo >= 0 ? '#15803d' : '#dc2626';
          // For display: ventas/cobros show as Facturado/Cobrado, compras/pagos as Comprado/Pagado
          const facturado = !m.isPagar && m.debe > 0 ? formatMoney(m.debe) : (m.isPagar && m.debe > 0 ? formatMoney(m.debe) : '');
          const cobrado = !m.isPagar && m.haber > 0 ? formatMoney(m.haber) : (m.isPagar && m.haber > 0 ? formatMoney(m.haber) : '');

          return `<tr style="background: ${bgColor};">
            <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb;">${formatDateStr(m.fecha)}</td>
            <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb;">
              <span style="padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: 500; ${tipoStyle}">${esc(tipoLabels[m.tipo] || m.tipo)}</span>
            </td>
            <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb; color: #374151;">${esc(m.descripcion)}</td>
            <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb; text-align: right; color: #15803d;">${facturado ? '$ ' + facturado : ''}</td>
            <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb; text-align: right; color: #dc2626;">${cobrado ? '$ ' + cobrado : ''}</td>
            <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb; text-align: right; font-weight: 600; color: ${saldoColor};">$ ${formatMoney(m.saldo)}</td>
          </tr>`;
        }).join('')
      : `<tr><td colspan="6" style="padding: 30px; text-align: center; color: #9ca3af; font-style: italic;">Sin movimientos en el periodo seleccionado</td></tr>`;

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Estado de Cuenta - ${esc(data.enterprise.name)}</title>
</head>
<body>
<div style="font-family: Inter, Arial, sans-serif; padding: 40px; color: #111;">

  <!-- Header -->
  <div style="display: flex; justify-content: space-between; border-bottom: 2px solid #333; padding-bottom: 20px;">
    <div>
      <h1 style="margin: 0 0 4px 0; font-size: 24px;">${esc(data.company.name)}</h1>
      <p style="margin: 0; color: #555; font-size: 13px;">CUIT: ${esc(companyCuit)}</p>
    </div>
    <div style="text-align: right;">
      <h2 style="margin: 0 0 4px 0; font-size: 20px; color: #333;">Estado de Cuenta</h2>
      <p style="margin: 0; color: #555; font-size: 13px;">Periodo: ${formatDateStr(data.dateFrom)} al ${formatDateStr(data.dateTo)}</p>
      <p style="margin: 0; color: #555; font-size: 13px;">Fecha emision: ${todayStr}</p>
    </div>
  </div>

  <!-- Enterprise info -->
  <div style="margin: 20px 0; padding: 15px; background: #f5f5f5; border-radius: 8px;">
    <h3 style="margin: 0 0 4px 0; font-size: 16px;">${esc(data.enterprise.name)}</h3>
    <p style="margin: 0; color: #555; font-size: 13px;">CUIT: ${esc(enterpriseCuit)}</p>
  </div>

  ${truncatedNote}

  <!-- Transactions table -->
  <table style="width: 100%; border-collapse: collapse; margin: 20px 0; font-size: 12px;">
    <thead>
      <tr style="background: #333; color: white;">
        <th style="padding: 10px 12px; text-align: left; font-weight: 600;">Fecha</th>
        <th style="padding: 10px 12px; text-align: left; font-weight: 600;">Tipo</th>
        <th style="padding: 10px 12px; text-align: left; font-weight: 600;">Descripcion</th>
        <th style="padding: 10px 12px; text-align: right; font-weight: 600;">Facturado</th>
        <th style="padding: 10px 12px; text-align: right; font-weight: 600;">Cobrado</th>
        <th style="padding: 10px 12px; text-align: right; font-weight: 600;">Saldo</th>
      </tr>
    </thead>
    <tbody>
      ${rowsHtml}
    </tbody>
  </table>

  <!-- Balance box -->
  <div style="margin-top: 30px; padding: 20px; background: ${data.totalBalance >= 0 ? '#e8f5e9' : '#ffebee'}; border: 2px solid ${data.totalBalance >= 0 ? '#4CAF50' : '#e53935'}; border-radius: 8px; text-align: right;">
    <p style="font-size: 14px; color: #666; margin: 0 0 8px 0;">Balance total historico (todas las transacciones)</p>
    <p style="font-size: 28px; font-weight: bold; color: ${balanceColor}; margin: 0;">$ ${formatMoney(data.totalBalance)}</p>
  </div>

  <!-- Footer -->
  <div style="margin-top: 40px; padding-top: 20px; border-top: 1px solid #ddd; font-size: 12px; color: #999;">
    <p style="margin: 0 0 4px 0;">Generado por GESTIA - ${todayStr} ${timeStr}</p>
    <p style="margin: 0;">Este documento es un resumen del periodo seleccionado. El balance final refleja el total historico.</p>
  </div>
</div>
</body>
</html>`;
  }

  async generateReceiptPdf(cobroId: string, companyId: string): Promise<Buffer> {
    try {
      await this.initialize()

      // 1. Query cobro data with enterprise and company info
      const cobroResult = await db.execute(sql`
        SELECT c.*, e.name as enterprise_name, e.cuit as enterprise_cuit, e.address as enterprise_address,
          e.tax_condition as enterprise_tax_condition,
          comp.name as company_name, comp.cuit as company_cuit, comp.address as company_address,
          comp.tax_condition as company_tax_condition
        FROM cobros c
        LEFT JOIN enterprises e ON c.enterprise_id = e.id
        LEFT JOIN companies comp ON c.company_id = comp.id
        WHERE c.id = ${cobroId} AND c.company_id = ${companyId}
      `)
      const cobro = ((cobroResult as any).rows || [])[0]
      if (!cobro) {
        throw new ApiError(404, 'Cobro not found')
      }

      // 2. Query payment methods
      const pmResult = await db.execute(sql`
        SELECT rpm.*, b.bank_name as bank_name
        FROM receipt_payment_methods rpm
        LEFT JOIN banks b ON rpm.bank_id = b.id
        WHERE rpm.cobro_id = ${cobroId}
      `)
      const paymentMethods = (pmResult as any).rows || []

      // 3. Query retenciones
      const retResult = await db.execute(sql`
        SELECT * FROM retenciones WHERE cobro_id = ${cobroId}
      `)
      const retenciones = (retResult as any).rows || []

      // 4. Query linked invoices
      const invResult = await db.execute(sql`
        SELECT cia.amount_applied, i.invoice_number, i.invoice_type, i.total_amount,
          CAST(i.total_amount AS decimal) - COALESCE(
            (SELECT SUM(CAST(cia2.amount_applied AS decimal))
             FROM cobro_invoice_applications cia2
             WHERE cia2.invoice_id = i.id), 0
          ) as saldo_pendiente
        FROM cobro_invoice_applications cia
        JOIN invoices i ON cia.invoice_id = i.id
        WHERE cia.cobro_id = ${cobroId}
      `)
      const linkedInvoices = (invResult as any).rows || []

      // 5. Generate HTML
      const html = this.generateReceiptHtml({ cobro, paymentMethods, retenciones, linkedInvoices })

      // 6. Render PDF with Puppeteer
      if (!this.browser) {
        throw new Error('Browser not initialized')
      }

      const page = await this.browser.newPage()
      await page.setContent(html, { waitUntil: 'networkidle0' })

      const pdf = await page.pdf({
        format: 'A4',
        margin: { top: '20px', right: '20px', bottom: '20px', left: '20px' },
      })

      await page.close()

      return pdf
    } catch (error) {
      if (error instanceof ApiError) throw error
      throw new ApiError(500, 'Receipt PDF generation failed')
    }
  }

  private generateReceiptHtml(data: {
    cobro: any
    paymentMethods: any[]
    retenciones: any[]
    linkedInvoices: any[]
  }): string {
    const { cobro, paymentMethods, retenciones, linkedInvoices } = data
    const esc = this.escapeHtml.bind(this)

    const receiptNumber = String(cobro.receipt_number || cobro.id?.slice(-8) || '0').padStart(8, '0')
    const receiptDate = new Date(cobro.payment_date || cobro.created_at).toLocaleDateString('es-AR')

    const companyCuit = this.formatCuit(cobro.company_cuit || '')
    const enterpriseCuit = this.formatCuit(cobro.enterprise_cuit || '')

    // Totals
    const totalPaymentMethods = paymentMethods.reduce(
      (sum: number, pm: any) => sum + parseFloat(pm.amount || '0'), 0
    )
    const totalRetenciones = retenciones.reduce(
      (sum: number, r: any) => sum + parseFloat(r.amount || '0'), 0
    )
    const totalRecibo = parseFloat(cobro.total_amount || '0')

    // Payment method label mapping
    const methodLabels: Record<string, string> = {
      'cash': 'Efectivo',
      'check': 'Cheque',
      'transfer': 'Transferencia',
      'credit_card': 'Tarjeta de Credito',
      'debit_card': 'Tarjeta de Debito',
      'echeq': 'E-Cheq',
      'other': 'Otro',
    }

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Recibo X ${receiptNumber}</title>
  <style>
    @page { size: A4; margin: 10mm; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: Arial, Helvetica, sans-serif; color: #222; font-size: 11px; line-height: 1.4; }

    .header {
      background: #1a1a2e; color: #fff; padding: 16px 20px;
      display: flex; justify-content: space-between; align-items: center;
      margin-bottom: 0;
    }
    .header-title { font-size: 22px; font-weight: bold; letter-spacing: 3px; }
    .header-right { text-align: right; }
    .header-letter {
      display: inline-block; background: #fff; color: #1a1a2e;
      font-size: 28px; font-weight: bold; width: 40px; height: 40px;
      line-height: 40px; text-align: center; border-radius: 4px; margin-bottom: 4px;
    }
    .header-number {
      font-size: 16px; font-family: 'Courier New', monospace; font-weight: bold;
    }
    .header-date { font-size: 12px; margin-top: 4px; }

    .section { border: 1px solid #ccc; padding: 10px 16px; margin-bottom: 8px; }
    .section-title {
      font-size: 10px; font-weight: bold; color: #1a1a2e;
      text-transform: uppercase; letter-spacing: 1px; margin-bottom: 6px;
      border-bottom: 1px solid #eee; padding-bottom: 4px;
    }
    .data-grid { display: flex; gap: 30px; }
    .data-col { flex: 1; }
    .data-row { display: flex; margin-bottom: 2px; }
    .data-label { font-size: 10px; color: #666; min-width: 110px; }
    .data-value { font-size: 11px; font-weight: 600; }

    table { width: 100%; border-collapse: collapse; margin-bottom: 0; }
    thead th {
      background: #f0f0f0; border: 1px solid #ccc; padding: 6px 8px;
      font-size: 10px; font-weight: bold; text-transform: uppercase; text-align: center;
    }
    thead th.left { text-align: left; }
    thead th.right { text-align: right; }
    tbody td { border: 1px solid #ddd; padding: 5px 8px; font-size: 11px; }
    tbody td.center { text-align: center; }
    tbody td.right { text-align: right; font-family: 'Courier New', monospace; }

    .totals-box {
      border: 2px solid #1a1a2e; margin-top: 12px; margin-bottom: 12px;
    }
    .totals-row {
      display: flex; justify-content: flex-end; padding: 5px 16px;
      border-bottom: 1px solid #eee;
    }
    .totals-row:last-child { border-bottom: none; }
    .totals-label { font-size: 11px; min-width: 200px; text-align: right; padding-right: 20px; }
    .totals-amount {
      font-size: 11px; font-family: 'Courier New', monospace;
      font-weight: bold; min-width: 120px; text-align: right;
    }
    .totals-row.grand {
      background: #1a1a2e; color: #fff; padding: 10px 16px;
    }
    .totals-row.grand .totals-label,
    .totals-row.grand .totals-amount { font-size: 14px; font-weight: bold; }

    .observations {
      border: 1px solid #ccc; padding: 10px 16px; margin-bottom: 8px;
      min-height: 40px;
    }
    .obs-title { font-size: 10px; font-weight: bold; color: #666; margin-bottom: 4px; }

    .footer {
      text-align: center; font-size: 9px; color: #999; padding-top: 8px;
      border-top: 1px solid #ddd; margin-top: 16px;
    }
  </style>
</head>
<body>

  <!-- HEADER -->
  <div class="header">
    <div>
      <div class="header-title">RECIBO</div>
    </div>
    <div class="header-right">
      <div class="header-letter">X</div>
      <div class="header-number">N° ${receiptNumber}</div>
      <div class="header-date">Fecha: ${receiptDate}</div>
    </div>
  </div>

  <!-- EMISOR -->
  <div class="section">
    <div class="section-title">Datos del Emisor</div>
    <div class="data-grid">
      <div class="data-col">
        <div class="data-row"><span class="data-label">Razon Social:</span> <span class="data-value">${esc(cobro.company_name)}</span></div>
        <div class="data-row"><span class="data-label">CUIT:</span> <span class="data-value">${esc(companyCuit)}</span></div>
      </div>
      <div class="data-col">
        <div class="data-row"><span class="data-label">Domicilio:</span> <span class="data-value">${esc(cobro.company_address || '-')}</span></div>
        <div class="data-row"><span class="data-label">Cond. IVA:</span> <span class="data-value">${esc(cobro.company_tax_condition || '-')}</span></div>
      </div>
    </div>
  </div>

  <!-- RECEPTOR -->
  <div class="section">
    <div class="section-title">Datos del Receptor</div>
    <div class="data-grid">
      <div class="data-col">
        <div class="data-row"><span class="data-label">Razon Social:</span> <span class="data-value">${esc(cobro.enterprise_name || '-')}</span></div>
        <div class="data-row"><span class="data-label">CUIT:</span> <span class="data-value">${esc(enterpriseCuit || '-')}</span></div>
      </div>
      <div class="data-col">
        <div class="data-row"><span class="data-label">Domicilio:</span> <span class="data-value">${esc(cobro.enterprise_address || '-')}</span></div>
        <div class="data-row"><span class="data-label">Cond. IVA:</span> <span class="data-value">${esc(cobro.enterprise_tax_condition || '-')}</span></div>
      </div>
    </div>
  </div>

  <!-- FORMAS DE PAGO -->
  ${paymentMethods.length > 0 ? `
  <div class="section" style="padding: 0;">
    <div class="section-title" style="padding: 10px 16px 4px;">Formas de Pago</div>
    <table>
      <thead>
        <tr>
          <th class="left" style="width: 25%;">Metodo</th>
          <th class="left" style="width: 25%;">Banco</th>
          <th class="left" style="width: 30%;">Referencia</th>
          <th class="right" style="width: 20%;">Monto</th>
        </tr>
      </thead>
      <tbody>
        ${paymentMethods.map((pm: any) => `
        <tr>
          <td>${esc(methodLabels[pm.method] || pm.method || '-')}</td>
          <td>${esc(pm.bank_name || '-')}</td>
          <td>${esc(pm.reference || pm.check_number || '-')}</td>
          <td class="right">$ ${parseFloat(pm.amount || '0').toFixed(2)}</td>
        </tr>`).join('')}
      </tbody>
    </table>
  </div>
  ` : ''}

  <!-- RETENCIONES -->
  ${retenciones.length > 0 ? `
  <div class="section" style="padding: 0;">
    <div class="section-title" style="padding: 10px 16px 4px;">Retenciones</div>
    <table>
      <thead>
        <tr>
          <th class="left" style="width: 20%;">Tipo</th>
          <th class="left" style="width: 20%;">Jurisdiccion</th>
          <th class="left" style="width: 20%;">N° Cert.</th>
          <th style="width: 20%;">Fecha</th>
          <th class="right" style="width: 20%;">Importe</th>
        </tr>
      </thead>
      <tbody>
        ${retenciones.map((r: any) => `
        <tr>
          <td>${esc(r.type || r.retention_type || '-')}</td>
          <td>${esc(r.jurisdiction || '-')}</td>
          <td>${esc(r.certificate_number || '-')}</td>
          <td class="center">${r.date ? new Date(r.date).toLocaleDateString('es-AR') : '-'}</td>
          <td class="right">$ ${parseFloat(r.amount || '0').toFixed(2)}</td>
        </tr>`).join('')}
      </tbody>
    </table>
  </div>
  ` : ''}

  <!-- COMPROBANTES CANCELADOS -->
  ${linkedInvoices.length > 0 ? `
  <div class="section" style="padding: 0;">
    <div class="section-title" style="padding: 10px 16px 4px;">Comprobantes Cancelados</div>
    <table>
      <thead>
        <tr>
          <th class="left" style="width: 30%;">Factura</th>
          <th class="right" style="width: 23%;">Total</th>
          <th class="right" style="width: 23%;">Aplicado</th>
          <th class="right" style="width: 24%;">Saldo</th>
        </tr>
      </thead>
      <tbody>
        ${linkedInvoices.map((inv: any) => `
        <tr>
          <td>${esc(inv.invoice_type || '')} ${esc(String(inv.invoice_number || ''))}</td>
          <td class="right">$ ${parseFloat(inv.total_amount || '0').toFixed(2)}</td>
          <td class="right">$ ${parseFloat(inv.amount_applied || '0').toFixed(2)}</td>
          <td class="right">$ ${parseFloat(inv.saldo_pendiente || '0').toFixed(2)}</td>
        </tr>`).join('')}
      </tbody>
    </table>
  </div>
  ` : ''}

  <!-- TOTALES -->
  <div class="totals-box">
    ${paymentMethods.length > 0 ? `
    <div class="totals-row">
      <span class="totals-label">Total Formas de Pago:</span>
      <span class="totals-amount">$ ${totalPaymentMethods.toFixed(2)}</span>
    </div>
    ` : ''}
    ${retenciones.length > 0 ? `
    <div class="totals-row">
      <span class="totals-label">Total Retenciones:</span>
      <span class="totals-amount">$ ${totalRetenciones.toFixed(2)}</span>
    </div>
    ` : ''}
    <div class="totals-row grand">
      <span class="totals-label">TOTAL RECIBO:</span>
      <span class="totals-amount">$ ${totalRecibo.toFixed(2)}</span>
    </div>
  </div>

  <!-- OBSERVACIONES -->
  <div class="observations">
    <div class="obs-title">Observaciones</div>
    ${esc(cobro.notes || cobro.observations || '')}
  </div>

  <div class="footer">
    Recibo generado el ${new Date().toLocaleDateString('es-AR')} - Documento no fiscal
  </div>

</body>
</html>`
  }

  async close() {
    if (this.browser) {
      await this.browser.close()
      this.browser = null
    }
  }
}

export const pdfService = new PdfService()
