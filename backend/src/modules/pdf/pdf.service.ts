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
    if (!this.browser) {
      this.browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
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
      throw new ApiError(500, `PDF generation failed: ${(error as any).message}`)
    }
  }

  private formatCuit(cuit: string): string {
    const clean = cuit.replace(/-/g, '')
    if (clean.length === 11) return `${clean.slice(0,2)}-${clean.slice(2,10)}-${clean.slice(10)}`
    return cuit
  }

  private generateInvoiceHtml(data: any): string {
    const { invoice, items, customer, company } = data

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
  <title>Factura ${invoice.invoice_type} ${comprobanteNum}</title>
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
      <div class="letter">${invoice.invoice_type}</div>
      <div class="cod">COD. ${String(cbteTipo).padStart(2, '0')}</div>
    </div>

    <div class="header-left">
      <div class="razonsocial">${company.companyName}</div>
      ${domicilio ? `<div class="header-row"><span class="header-label">Domicilio Comercial:</span> ${domicilio}</div>` : ''}
      <div class="header-row"><span class="header-label">Condición frente al IVA:</span> <span class="header-value">${condicionIvaEmisor[invoice.invoice_type] || 'Monotributo'}</span></div>
    </div>

    <div class="header-right" style="padding-left: 50px;">
      <div class="comprobante-tipo">FACTURA</div>
      <div class="comprobante-nro">Punto de Venta: ${ptoVtaStr} &nbsp; Comp. Nro: ${nroStr}</div>
      <div class="header-row"><span class="header-label">Fecha de Emisión:</span> <span class="header-value">${invoiceDate}</span></div>
      <div class="header-row"><span class="header-label">CUIT:</span> <span class="header-value">${companyCuit}</span></div>
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
        <div class="info-row"><span class="info-label">Condición frente al IVA:</span> <span class="info-value">${customer?.tax_condition || 'Consumidor Final'}</span></div>
        <div class="info-row"><span class="info-label">Nombre / Razón Social:</span> <span class="info-value" style="font-weight: bold;">${customer?.name || 'Consumidor Final'}</span></div>
      </div>
      <div style="flex: 1;">
        ${customer?.cuit
          ? `<div class="info-row"><span class="info-label">CUIT:</span> <span class="info-value">${this.formatCuit(customer.cuit)}</span></div>`
          : `<div class="info-row"><span class="info-label">Documento:</span> <span class="info-value">-</span></div>`
        }
        <div class="info-row"><span class="info-label">Domicilio:</span> <span class="info-value">${customer?.address || '-'}</span></div>
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
          <td>${item.product_name || '-'}</td>
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
      <div class="razonsocial">${company.companyName}</div>
      ${domicilio ? `<div class="header-row"><span class="header-label">Domicilio Comercial:</span> ${domicilio}</div>` : ''}
      <div class="header-row"><span class="header-label">CUIT:</span> <span class="header-value">${companyCuit}</span></div>
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
        <div class="info-row"><span class="info-label">Nombre / Razon Social:</span> <span class="info-value" style="font-weight: bold;">${customer?.name || 'Sin especificar'}</span></div>
      </div>
      <div style="flex: 1;">
        ${customer?.cuit
          ? `<div class="info-row"><span class="info-label">CUIT:</span> <span class="info-value">${this.formatCuit(customer.cuit)}</span></div>`
          : ''
        }
        ${customer?.address ? `<div class="info-row"><span class="info-label">Domicilio:</span> <span class="info-value">${customer.address}</span></div>` : ''}
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
          <td>${item.product_name || '-'}</td>
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
      throw new ApiError(500, `Catalog PDF generation failed: ${(error as any).message}`)
    }
  }

  private generateCatalogHtml(products: any[], companyName: string): string {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>Catálogo - ${companyName}</title>
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
        <h1>${companyName}</h1>
        <h2 style="text-align: center; color: #666;">Catálogo de Productos</h2>

        <div class="products-grid">
          ${products
            .map(
              (p: any) => `
            <div class="product-card">
              <div class="product-name">${p.name}</div>
              <div class="product-sku">SKU: ${p.sku}</div>
              <div class="product-price">$${p.final_price || 'Consultar'}</div>
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

  async close() {
    if (this.browser) {
      await this.browser.close()
      this.browser = null
    }
  }
}

export const pdfService = new PdfService()
