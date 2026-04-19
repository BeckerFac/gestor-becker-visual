import puppeteer from 'puppeteer'
import { db } from '../../config/db'
import { invoices, invoice_items, customers, products } from '../../db/schema'
import { eq, sql } from 'drizzle-orm'
import { ApiError } from '../../middlewares/errorHandler'
import { escapeHtml as sharedEscapeHtml } from '../../lib/html-escape'
import { generateQrPngDataUrl } from '../../lib/qr-afip'

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
  companyId?: string
  businessUnitId?: string
}

// Row returned by SELECT * from a tenant-scoped table. We assert company_id
// matches and, when provided, business_unit_id matches too.
export interface TenantRow {
  company_id?: string | null
  business_unit_id?: string | null
  [key: string]: any
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
        headless: true,
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
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

      // BU guard: verify row belongs to the caller's tenant (and BU if provided).
      if (input.companyId) {
        this.assertBelongsToTenant(invoice, input.companyId, input.businessUnitId, 'Factura')
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

      // Pre-compute AFIP QR as a local PNG data URL (no third-party HTTP).
      // invoice.qr_code already contains the AFIP-spec URL produced by
      // afip.service.ts -> generateQrData (RG AFIP 4291).
      let qrDataUrl = ''
      if (invoice.qr_code) {
        try {
          qrDataUrl = await generateQrPngDataUrl(invoice.qr_code)
        } catch (e) {
          console.error('[pdf.service] AFIP QR generation failed:', e)
          // Don't break PDF generation; emit without QR (incident logged).
        }
      }

      // Generate HTML — bifurcate between fiscal, legacy internal, and Luna (no_fiscal)
      // Sol/Luna: Luna comprobantes use a dedicated no-IVA template with a
      // "DOCUMENTO NO FISCAL - USO INTERNO" watermark. No CAE, no QR.
      let enterprise: any = null
      if (invoice.enterprise_id) {
        try {
          const entRes = await db.execute(sql`SELECT * FROM enterprises WHERE id = ${invoice.enterprise_id}`)
          enterprise = ((entRes as any).rows || [])[0] || null
        } catch {
          enterprise = null
        }
      }
      let html: string
      if (invoice.fiscal_type === 'no_fiscal') {
        html = this.generateLunaComprobanteHtml({ invoice, items, customer, enterprise, company: input })
      } else if (invoice.fiscal_type === 'interno') {
        html = this.generateInternalVoucherHtml({ invoice, items, customer, enterprise, company: input })
      } else {
        // Nor feedback item 4: pass enterprise so the receiver block can
        // fall back to enterprise.razon_social when a customer has no own
        // fiscal identity.
        html = this.generateInvoiceHtml({ invoice, items, customer, enterprise, company: input, qrDataUrl })
      }

      // Anulado watermark (soft-delete aware)
      if (this.isAnulado(invoice)) {
        const anulledByName = await this.resolveUserName(invoice.anulled_by)
        html = this.renderAnuladoWatermark(html, {
          anulled_at: invoice.anulled_at,
          anulled_by_name: anulledByName,
          anulled_reason: invoice.anulled_reason,
        })
      }

      // Convert to PDF using Puppeteer
      if (!this.browser) {
        throw new Error('Browser not initialized')
      }

      const page = await this.browser.newPage()
      await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 15000 })

      const pdf = await page.pdf({
        format: 'A4',
        margin: { top: '20px', right: '20px', bottom: '20px', left: '20px' },
        timeout: 15000,
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

  // Escape HTML to prevent XSS/injection in generated PDFs.
  // Delegates to the shared helper (src/lib/html-escape.ts) so all
  // PDF templates share a single, audited implementation.
  private escapeHtml(str: unknown): string {
    return sharedEscapeHtml(str)
  }

  /**
   * BU guard. Enforces tenant isolation on any row loaded from DB.
   * - companyId MUST match the row's company_id (IDOR defense).
   * - if businessUnitId provided, row's business_unit_id MUST match (scoped reads).
   * Throws 403 ApiError on any mismatch.
   */
  private assertBelongsToTenant(
    row: TenantRow | null | undefined,
    companyId: string,
    businessUnitId?: string | null,
    label: string = 'documento'
  ): void {
    if (!row) {
      throw new ApiError(404, `${label} no encontrado`)
    }
    if (!row.company_id || row.company_id !== companyId) {
      throw new ApiError(403, `Acceso denegado: ${label} de otra empresa`)
    }
    if (businessUnitId && row.business_unit_id && row.business_unit_id !== businessUnitId) {
      throw new ApiError(403, `Acceso denegado: ${label} de otra unidad de negocio`)
    }
  }

  /**
   * Fetch retenciones for a pago, respecting soft-delete.
   * Only returns rows with anulled_at IS NULL.
   * direction filter: 'practicada' for pagos (we withheld), 'sufrida' for cobros.
   */
  private async fetchPagoRetenciones(pagoId: string): Promise<any[]> {
    const r = await db.execute(sql`
      SELECT * FROM retenciones
      WHERE pago_id = ${pagoId}
        AND direction = 'practicada'
        AND anulled_at IS NULL
      ORDER BY created_at ASC
    `)
    return ((r as any).rows || [])
  }

  /**
   * Fetch payment_methods[] for a pago from the normalized side-table.
   * Returns array; if empty, caller should fall back to legacy single column.
   */
  private async fetchPagoPaymentMethods(pagoId: string): Promise<any[]> {
    try {
      const r = await db.execute(sql`
        SELECT ppm.*, b.bank_name as bank_name
        FROM pago_payment_methods ppm
        LEFT JOIN banks b ON ppm.bank_id = b.id
        WHERE ppm.pago_id = ${pagoId}
        ORDER BY ppm.created_at ASC NULLS LAST
      `)
      return ((r as any).rows || [])
    } catch {
      return []
    }
  }

  /**
   * Resolve a user id to a display name for the anulado footer.
   */
  private async resolveUserName(userId: string | null | undefined): Promise<string> {
    if (!userId) return '-'
    try {
      const r = await db.execute(sql`
        SELECT COALESCE(name, email, id::text) as display FROM users WHERE id = ${userId}
      `)
      const rows = (r as any).rows || []
      return rows[0]?.display || '-'
    } catch {
      return '-'
    }
  }

  /**
   * Detect if a row is anulado (soft-deleted / voided).
   */
  private isAnulado(row: any): boolean {
    if (!row) return false
    return Boolean(row.anulled_at) || row.status === 'anulado'
  }

  /**
   * Wrap generated HTML with a diagonal ANULADO watermark + footer with audit data.
   * meta.anulled_at / meta.anulled_by_name / meta.anulled_reason are expected.
   * Inputs are escaped before injection (XSS defense).
   */
  private renderAnuladoWatermark(
    innerHtml: string,
    meta: { anulled_at?: string | null; anulled_by_name?: string | null; anulled_reason?: string | null }
  ): string {
    const esc = this.escapeHtml.bind(this)
    const when = meta.anulled_at ? new Date(meta.anulled_at).toLocaleString('es-AR') : '-'
    const who = esc(meta.anulled_by_name || '-')
    const why = esc(meta.anulled_reason || '-')

    // Inject a fixed-position watermark and a footer into the existing document
    // by appending right before </body>. If </body> is missing, append at the end.
    const watermarkBlock = `
<style>
  .anulado-watermark {
    position: fixed; top: 0; left: 0; width: 100%; height: 100%;
    display: flex; align-items: center; justify-content: center;
    pointer-events: none; z-index: 9999;
  }
  .anulado-watermark span {
    font-family: Arial, sans-serif; font-size: 140px; font-weight: 900;
    color: rgba(220, 38, 38, 0.28); letter-spacing: 12px;
    transform: rotate(-30deg); border: 12px solid rgba(220, 38, 38, 0.28);
    padding: 20px 60px; text-transform: uppercase;
  }
  .anulado-footer {
    margin-top: 24px; padding: 12px 16px;
    border: 2px solid #dc2626; background: #fef2f2; color: #991b1b;
    font-family: Arial, sans-serif; font-size: 11px;
  }
  .anulado-footer strong { color: #7f1d1d; }
</style>
<div class="anulado-watermark" aria-hidden="true"><span>ANULADO</span></div>
<div class="anulado-footer">
  <div><strong>DOCUMENTO ANULADO</strong></div>
  <div>Fecha de anulacion: ${esc(when)}</div>
  <div>Anulado por: ${who}</div>
  <div>Motivo: ${why}</div>
</div>
`
    if (innerHtml.includes('</body>')) {
      return innerHtml.replace('</body>', `${watermarkBlock}</body>`)
    }
    return innerHtml + watermarkBlock
  }

  private generateInvoiceHtml(data: any): string {
    const { invoice, items, customer, enterprise, company, qrDataUrl } = data

    // Escape all user-controlled strings to prevent HTML injection in PDFs
    const esc = this.escapeHtml.bind(this)

    // Nor feedback item 4: resolve the receiver block with fallback cascade.
    // Priority: invoice snapshot > customer own identity > enterprise > legacy.
    // Every field is XSS-escaped via `esc` below.
    const receiverRazonSocial =
      invoice?.receiver_razon_social ||
      (customer?.cuit && customer?.razon_social ? customer.razon_social : null) ||
      enterprise?.razon_social ||
      enterprise?.name ||
      customer?.name ||
      'Consumidor Final'
    const receiverCuitRaw =
      invoice?.receiver_cuit ||
      (customer?.cuit && customer?.razon_social ? customer.cuit : null) ||
      enterprise?.cuit ||
      customer?.cuit ||
      ''
    const receiverTaxCondition =
      (customer?.cuit && customer?.razon_social ? customer?.tax_condition : null) ||
      enterprise?.tax_condition ||
      customer?.tax_condition ||
      'Consumidor Final'
    const receiverAddress =
      (customer?.cuit && customer?.razon_social ? (customer?.fiscal_address || customer?.address) : null) ||
      enterprise?.fiscal_address ||
      enterprise?.address ||
      customer?.address ||
      '-'

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
      ${company.companyPhone ? `<div class="info-row"><span class="info-label">Teléfono:</span> <span class="info-value">${esc(company.companyPhone)}</span></div>` : ''}
      ${company.companyEmail ? `<div class="info-row"><span class="info-label">Email:</span> <span class="info-value">${esc(company.companyEmail)}</span></div>` : ''}
    </div>
  </div>

  <!-- RECEPTOR -->
  <div class="receptor">
    <div style="display: flex; gap: 40px;">
      <div style="flex: 1;">
        <div class="info-row"><span class="info-label">Condición frente al IVA:</span> <span class="info-value">${esc(receiverTaxCondition)}</span></div>
        <div class="info-row"><span class="info-label">Nombre / Razón Social:</span> <span class="info-value" style="font-weight: bold;">${esc(receiverRazonSocial)}</span></div>
      </div>
      <div style="flex: 1;">
        ${receiverCuitRaw
          ? `<div class="info-row"><span class="info-label">CUIT:</span> <span class="info-value">${esc(this.formatCuit(receiverCuitRaw))}</span></div>`
          : `<div class="info-row"><span class="info-label">Documento:</span> <span class="info-value">-</span></div>`
        }
        <div class="info-row"><span class="info-label">Domicilio:</span> <span class="info-value">${esc(receiverAddress)}</span></div>
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
    ${qrDataUrl ? `
    <div>
      <img src="${qrDataUrl}" alt="QR AFIP" width="100" height="100" />
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
    const { invoice, items, customer, enterprise, company } = data
    const esc = this.escapeHtml.bind(this)
    const nroStr = String(invoice.invoice_number).padStart(6, '0')
    const invoiceDate = new Date(invoice.invoice_date).toLocaleDateString('es-AR')
    const companyCuit = this.formatCuit(company.companyCuit || '')
    const domicilio = [company.companyAddress, company.companyCity, company.companyProvince]
      .filter(Boolean).join(', ')
    // Nor feedback item 4: same fallback cascade as fiscal invoices.
    const receiverRazonSocial =
      invoice?.receiver_razon_social ||
      (customer?.cuit && customer?.razon_social ? customer.razon_social : null) ||
      enterprise?.razon_social ||
      enterprise?.name ||
      customer?.name ||
      'Sin especificar'
    const receiverCuitRaw =
      invoice?.receiver_cuit ||
      (customer?.cuit && customer?.razon_social ? customer.cuit : null) ||
      enterprise?.cuit ||
      customer?.cuit ||
      ''
    const receiverAddress =
      (customer?.cuit && customer?.razon_social ? (customer?.fiscal_address || customer?.address) : null) ||
      enterprise?.fiscal_address ||
      enterprise?.address ||
      customer?.address ||
      ''

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
        <div class="info-row"><span class="info-label">Nombre / Razon Social:</span> <span class="info-value" style="font-weight: bold;">${esc(receiverRazonSocial)}</span></div>
      </div>
      <div style="flex: 1;">
        ${receiverCuitRaw
          ? `<div class="info-row"><span class="info-label">CUIT:</span> <span class="info-value">${esc(this.formatCuit(receiverCuitRaw))}</span></div>`
          : ''
        }
        ${receiverAddress ? `<div class="info-row"><span class="info-label">Domicilio:</span> <span class="info-value">${esc(receiverAddress)}</span></div>` : ''}
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

  /**
   * Sol/Luna: Luna comprobante template. No CAE, no QR, no IVA breakdown.
   * Uses a diagonal "DOCUMENTO NO FISCAL - USO INTERNO" watermark and a
   * single "precio final" column — items are stored with vat_rate=0 and the
   * line total is unit_price * quantity.
   */
  private generateLunaComprobanteHtml(data: any): string {
    const { invoice, items, customer, enterprise, company } = data
    const esc = this.escapeHtml.bind(this)

    const nroStr = String(invoice.invoice_number).padStart(8, '0')
    const comprobanteNum = `LUN-${nroStr}`
    const invoiceDate = invoice.invoice_date ? new Date(invoice.invoice_date).toLocaleDateString('es-AR') : new Date().toLocaleDateString('es-AR')
    const companyCuit = this.formatCuit(company.companyCuit || '')
    const domicilio = [company.companyAddress, company.companyCity, company.companyProvince]
      .filter(Boolean).join(', ')

    // Client block: Nor feedback item 4 — prefer the invoice's snapshotted
    // receiver identity (customer-own RS or enterprise), fall back by cascade.
    const clientName =
      invoice?.receiver_razon_social ||
      (customer?.cuit && customer?.razon_social ? customer.razon_social : null) ||
      enterprise?.razon_social ||
      enterprise?.name ||
      customer?.name ||
      'Sin especificar'
    const clientCuit =
      invoice?.receiver_cuit ||
      (customer?.cuit && customer?.razon_social ? customer.cuit : null) ||
      enterprise?.cuit ||
      customer?.cuit ||
      ''
    const clientAddress =
      (customer?.cuit && customer?.razon_social ? (customer?.fiscal_address || customer?.address) : null) ||
      enterprise?.fiscal_address ||
      enterprise?.address ||
      customer?.address ||
      ''

    let grandTotal = 0
    const rows = (items || []).map((item: any, idx: number) => {
      const qty = parseFloat(item.quantity || '0')
      const price = parseFloat(item.unit_price || '0')
      const total = qty * price
      grandTotal += total
      return `
        <tr>
          <td class="center">${String(idx + 1).padStart(3, '0')}</td>
          <td>${esc(item.product_name || '-')}</td>
          <td class="center">${qty.toFixed(2)}</td>
          <td class="right">${price.toFixed(2)}</td>
          <td class="right">${total.toFixed(2)}</td>
        </tr>`
    }).join('')

    // Prefer stored invoice.total_amount when available (authoritative), else computed sum.
    const storedTotal = parseFloat(invoice.total_amount || '0')
    const displayTotal = storedTotal > 0 ? storedTotal : grandTotal

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Comprobante Luna ${comprobanteNum}</title>
  <style>
    @page { size: A4; margin: 10mm; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: Arial, Helvetica, sans-serif; color: #000; font-size: 11px; line-height: 1.4; position: relative; }
    .luna-watermark {
      position: fixed; top: 0; left: 0; width: 100%; height: 100%;
      display: flex; align-items: center; justify-content: center;
      pointer-events: none; z-index: 0;
    }
    .luna-watermark span {
      font-size: 60px; font-weight: bold; color: #b00020;
      opacity: 0.08; transform: rotate(-30deg); white-space: nowrap;
      letter-spacing: 4px;
    }
    .content { position: relative; z-index: 1; }
    .header-wrapper { border: 1.5px solid #000; display: flex; margin-bottom: 8px; }
    .header-left, .header-right { flex: 1; padding: 12px 16px; }
    .header-right { border-left: 1.5px solid #000; }
    .razonsocial { font-size: 16px; font-weight: bold; margin-bottom: 4px; }
    .header-label { font-size: 10px; color: #444; }
    .header-value { font-size: 11px; font-weight: 600; }
    .header-row { margin-bottom: 3px; }
    .comprobante-tipo { font-size: 14px; font-weight: bold; margin-bottom: 6px; color: #b00020; }
    .comprobante-nro { font-size: 18px; font-weight: bold; font-family: 'Courier New', monospace; margin-bottom: 8px; }
    .receptor { border: 1.5px solid #000; padding: 8px 16px; margin-bottom: 10px; }
    .info-row { display: flex; margin-bottom: 2px; }
    .info-label { font-size: 10px; color: #444; min-width: 120px; }
    .info-value { font-size: 11px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 0; }
    thead th { background: #e8e8e8; border: 1px solid #999; padding: 6px 8px; font-size: 10px; font-weight: bold; text-transform: uppercase; text-align: center; }
    thead th.left { text-align: left; }
    thead th.right { text-align: right; }
    tbody td { border: 1px solid #ccc; padding: 5px 8px; font-size: 11px; }
    tbody td.center { text-align: center; }
    tbody td.right { text-align: right; font-family: 'Courier New', monospace; }
    .totals-wrapper { border: 1.5px solid #000; border-top: none; margin-bottom: 12px; }
    .totals-row { display: flex; justify-content: flex-end; padding: 8px 16px; background: #f0f0f0; }
    .totals-label { font-size: 14px; font-weight: bold; min-width: 160px; text-align: right; padding-right: 20px; }
    .totals-amount { font-size: 14px; font-family: 'Courier New', monospace; font-weight: bold; min-width: 120px; text-align: right; }
    .luna-footer { border: 2px solid #b00020; padding: 12px; text-align: center; color: #b00020; font-weight: bold; font-size: 12px; margin-top: 10px; }
    .footer { text-align: center; font-size: 9px; color: #888; padding-top: 6px; border-top: 1px solid #ddd; margin-top: 8px; }
  </style>
</head>
<body>
  <div class="luna-watermark"><span>DOCUMENTO NO FISCAL - USO INTERNO</span></div>
  <div class="content">
    <div class="header-wrapper">
      <div class="header-left">
        <div class="razonsocial">${esc(company.companyName)}</div>
        ${domicilio ? `<div class="header-row"><span class="header-label">Domicilio:</span> ${esc(domicilio)}</div>` : ''}
        <div class="header-row"><span class="header-label">CUIT:</span> <span class="header-value">${esc(companyCuit)}</span></div>
      </div>
      <div class="header-right">
        <div class="comprobante-tipo">COMPROBANTE LUNA</div>
        <div class="comprobante-nro">N° ${comprobanteNum}</div>
        <div class="header-row"><span class="header-label">Fecha:</span> <span class="header-value">${invoiceDate}</span></div>
      </div>
    </div>

    <div class="receptor">
      <div class="info-row"><span class="info-label">Razon Social:</span> <span class="info-value" style="font-weight:bold;">${esc(clientName)}</span></div>
      ${clientCuit ? `<div class="info-row"><span class="info-label">CUIT:</span> <span class="info-value">${esc(this.formatCuit(clientCuit))}</span></div>` : ''}
      ${clientAddress ? `<div class="info-row"><span class="info-label">Domicilio:</span> <span class="info-value">${esc(clientAddress)}</span></div>` : ''}
    </div>

    <table>
      <thead>
        <tr>
          <th class="left" style="width:6%;">#</th>
          <th class="left" style="width:50%;">Producto</th>
          <th style="width:12%;">Cantidad</th>
          <th class="right" style="width:16%;">Precio Unitario</th>
          <th class="right" style="width:16%;">Total</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>

    <div class="totals-wrapper">
      <div class="totals-row">
        <span class="totals-label">Total: $</span>
        <span class="totals-amount">${displayTotal.toFixed(2)}</span>
      </div>
    </div>

    <div class="luna-footer">
      Comprobante Luna - Sin valor fiscal - Uso interno
    </div>

    <div class="footer">
      Generado el ${new Date().toLocaleDateString('es-AR')} - Circuito Luna (no fiscal)
    </div>
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
      await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 15000 })

      const pdf = await page.pdf({
        format: 'A4',
        margin: { top: '20px', right: '20px', bottom: '20px', left: '20px' },
        timeout: 15000,
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
    // CAT-6: Sol/Luna circuit banner.
    circuit?: 'fiscal' | 'no_fiscal';
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
    circuit?: 'fiscal' | 'no_fiscal';
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
    // CAT-6: Sol/Luna banner
    const circuitLabel = data.circuit === 'no_fiscal'
      ? 'Cuenta Corriente - Circuito Luna'
      : 'Cuenta Corriente - Circuito Sol';
    const circuitBanner = `<div style="margin: 0 0 12px 0; padding: 10px 14px; border-radius: 6px; font-weight: 600; font-size: 13px; ${data.circuit === 'no_fiscal' ? 'background: #1e1b4b; color: #e0e7ff;' : 'background: #fef3c7; color: #92400e;'}">${esc(circuitLabel)}</div>`;
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
  ${circuitBanner}
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
    <p style="margin: 0 0 4px 0;">Generado por GoBecker - ${todayStr} ${timeStr}</p>
    <p style="margin: 0;">Este documento es un resumen del periodo seleccionado. El balance final refleja el total historico.</p>
  </div>
</div>
</body>
</html>`;
  }

  async generateReceiptPdf(cobroId: string, companyId: string, businessUnitId?: string): Promise<Buffer> {
    try {
      await this.initialize()

      // 1. Query cobro data with enterprise and company info
      const cobroResult = await db.execute(sql`
        SELECT c.*, e.name as enterprise_name, e.cuit as enterprise_cuit, e.address as enterprise_address,
          e.tax_condition as enterprise_tax_condition,
          comp.name as company_name, comp.cuit as company_cuit, comp.address as company_address
        FROM cobros c
        LEFT JOIN enterprises e ON c.enterprise_id = e.id
        LEFT JOIN companies comp ON c.company_id = comp.id
        WHERE c.id = ${cobroId}
      `)
      const cobro = ((cobroResult as any).rows || [])[0]
      // BU guard (also enforces companyId match -> IDOR defense)
      this.assertBelongsToTenant(cobro, companyId, businessUnitId, 'Cobro')

      // 2. Query payment methods
      const pmResult = await db.execute(sql`
        SELECT rpm.*, b.bank_name as bank_name
        FROM receipt_payment_methods rpm
        LEFT JOIN banks b ON rpm.bank_id = b.id
        WHERE rpm.cobro_id = ${cobroId}
      `)
      const paymentMethods = (pmResult as any).rows || []

      // 3. Query retenciones sufridas (soft-delete aware)
      const retResult = await db.execute(sql`
        SELECT * FROM retenciones
        WHERE cobro_id = ${cobroId}
          AND direction = 'sufrida'
          AND anulled_at IS NULL
        ORDER BY created_at ASC
      `)
      const retenciones = (retResult as any).rows || []

      // 4. Query linked invoices
      const invResult = await db.execute(sql`
        SELECT cia.amount_applied, i.invoice_number, i.invoice_type::text, i.total_amount,
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
      let html = this.generateReceiptHtml({ cobro, paymentMethods, retenciones, linkedInvoices })

      // Anulado watermark
      if (this.isAnulado(cobro)) {
        const anulledByName = await this.resolveUserName(cobro.anulled_by)
        html = this.renderAnuladoWatermark(html, {
          anulled_at: cobro.anulled_at,
          anulled_by_name: anulledByName,
          anulled_reason: cobro.anulled_reason,
        })
      }

      // 6. Render PDF with Puppeteer
      if (!this.browser) {
        throw new Error('Browser not initialized')
      }

      const page = await this.browser.newPage()
      await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 15000 })

      const pdf = await page.pdf({
        format: 'A4',
        margin: { top: '20px', right: '20px', bottom: '20px', left: '20px' },
        timeout: 15000,
      })

      await page.close()

      return pdf
    } catch (error) {
      if (error instanceof ApiError) throw error
      console.error('generateReceiptPdf ERROR:', (error as Error).message, (error as Error).stack?.split('\n')[1])
      throw new ApiError(500, `Receipt PDF generation failed: ${(error as Error).message}`)
    }
  }

  private numberToWords(amount: number): string {
    const units = ['', 'un', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve']
    const teens = ['diez', 'once', 'doce', 'trece', 'catorce', 'quince', 'dieciseis', 'diecisiete', 'dieciocho', 'diecinueve']
    const tens = ['', 'diez', 'veinte', 'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa']
    const hundreds = ['', 'ciento', 'doscientos', 'trescientos', 'cuatrocientos', 'quinientos', 'seiscientos', 'setecientos', 'ochocientos', 'novecientos']

    const convertGroup = (n: number): string => {
      if (n === 0) return ''
      if (n === 100) return 'cien'
      if (n < 10) return units[n]
      if (n < 20) return teens[n - 10]
      if (n < 30) {
        if (n === 20) return 'veinte'
        return 'veinti' + units[n % 10]
      }
      if (n < 100) {
        const t = Math.floor(n / 10)
        const u = n % 10
        return u === 0 ? tens[t] : tens[t] + ' y ' + units[u]
      }
      const h = Math.floor(n / 100)
      const rest = n % 100
      return rest === 0 && h === 1 ? 'cien' : hundreds[h] + (rest > 0 ? ' ' + convertGroup(rest) : '')
    }

    if (amount === 0) return 'cero pesos con 00/100'

    const intPart = Math.floor(Math.abs(amount))
    const decPart = Math.round((Math.abs(amount) - intPart) * 100)

    const millions = Math.floor(intPart / 1000000)
    const thousands = Math.floor((intPart % 1000000) / 1000)
    const remainder = intPart % 1000

    const parts: string[] = []

    if (millions > 0) {
      parts.push(millions === 1 ? 'un millon' : convertGroup(millions) + ' millones')
    }
    if (thousands > 0) {
      parts.push(thousands === 1 ? 'mil' : convertGroup(thousands) + ' mil')
    }
    if (remainder > 0 || parts.length === 0) {
      parts.push(convertGroup(remainder))
    }

    const intWords = parts.join(' ').replace(/\s+/g, ' ').trim()
    const centStr = String(decPart).padStart(2, '0')

    const capitalized = intWords.charAt(0).toUpperCase() + intWords.slice(1)
    return `${capitalized} pesos con ${centStr}/100`
  }

  private formatMoneyAR(n: number): string {
    const parts = Math.abs(n).toFixed(2).split('.')
    const intPart = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.')
    return `${n < 0 ? '-' : ''}${intPart},${parts[1]}`
  }

  private generateReceiptHtml(data: {
    cobro: any
    paymentMethods: any[]
    retenciones: any[]
    linkedInvoices: any[]
  }): string {
    const { cobro, paymentMethods, retenciones, linkedInvoices } = data
    const esc = this.escapeHtml.bind(this)
    const fmtMoney = this.formatMoneyAR.bind(this)

    const receiptNumber = String(cobro.receipt_number || cobro.id?.slice(-8) || '0').padStart(8, '0')
    const receiptDate = new Date(cobro.payment_date || cobro.created_at).toLocaleDateString('es-AR')

    const companyCuit = this.formatCuit(cobro.company_cuit || '')
    const enterpriseCuit = this.formatCuit(cobro.enterprise_cuit || '')

    const totalRecibo = parseFloat(cobro.total_amount || '0')
    const totalInLetters = this.numberToWords(totalRecibo)

    // Payment method labels
    const methodLabels: Record<string, string> = {
      'cash': 'Efectivo',
      'check': 'Cheque',
      'transfer': 'Transferencia',
      'credit_card': 'Tarjeta de Credito',
      'debit_card': 'Tarjeta de Debito',
      'echeq': 'E-Cheq',
      'mercado_pago': 'Mercado Pago',
      'other': 'Otro',
    }

    const now = new Date()
    const generatedDate = now.toLocaleDateString('es-AR')

    // Build payment methods lines
    const pmLines = paymentMethods.map((pm: any) => {
      const label = methodLabels[pm.method] || 'Otro'
      const bankPart = pm.bank_name ? ` — ${esc(pm.bank_name)}` : ''
      const refValue = pm.reference || pm.check_number || ''
      const refPart = refValue ? ` — Ref: ${esc(refValue)}` : ''
      const desc = `${esc(label)}${bankPart}${refPart}`
      const amount = `$ ${fmtMoney(parseFloat(pm.amount || '0'))}`
      return `      <tr>
        <td style="padding: 6px 0; font-size: 13px; color: #111;">${desc}</td>
        <td style="padding: 6px 0; font-size: 13px; color: #111; text-align: right; font-weight: 600; white-space: nowrap;">${amount}</td>
      </tr>`
    }).join('\n')

    // Build retenciones lines
    const retLines = retenciones.map((r: any) => {
      const tipo = esc(r.type || r.retention_type || '-')
      const jurisdiccion = r.jurisdiction ? ` ${esc(r.jurisdiction)}` : ''
      const cert = r.certificate_number ? ` — Cert: ${esc(r.certificate_number)}` : ''
      const desc = `${tipo}${jurisdiccion}${cert}`
      const amount = `$ ${fmtMoney(parseFloat(r.amount || '0'))}`
      return `      <tr>
        <td style="padding: 6px 0; font-size: 13px; color: #111;">${desc}</td>
        <td style="padding: 6px 0; font-size: 13px; color: #111; text-align: right; font-weight: 600; white-space: nowrap;">${amount}</td>
      </tr>`
    }).join('\n')

    // Build linked invoices rows
    const invRows = linkedInvoices.map((inv: any) => {
      const saldo = parseFloat(inv.saldo_pendiente || '0')
      return `      <tr>
        <td style="padding: 6px 0; font-size: 13px; color: #111; font-weight: 600;">${esc(inv.invoice_type || '')} ${esc(String(inv.invoice_number || ''))}</td>
        <td style="padding: 6px 0; font-size: 13px; color: #333; text-align: right; white-space: nowrap;">$${fmtMoney(parseFloat(inv.total_amount || '0'))}</td>
        <td style="padding: 6px 0; font-size: 13px; color: #333; text-align: right; white-space: nowrap;">$${fmtMoney(parseFloat(inv.amount_applied || '0'))}</td>
        <td style="padding: 6px 0; font-size: 13px; color: #333; text-align: right; white-space: nowrap;">$${fmtMoney(saldo)}</td>
      </tr>`
    }).join('\n')

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Recibo X ${receiptNumber}</title>
</head>
<body style="margin: 0; padding: 0; background: #fff; font-family: system-ui, -apple-system, sans-serif; font-size: 13px; line-height: 1.6; color: #111;">
<div style="max-width: 700px; margin: 0 auto; padding: 32px 28px;">

  <!-- HEADER -->
  <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px;">
    <div>
      <div style="font-size: 16px; font-weight: 700; color: #111;">${esc(cobro.company_name)}</div>
      <div style="font-size: 12px; color: #333; margin-top: 2px;">CUIT: ${esc(companyCuit)}${cobro.company_address ? ' | ' + esc(cobro.company_address) : ''}</div>
      <div style="font-size: 12px; color: #555;">${esc(cobro.company_tax_condition || 'Responsable Inscripto')}</div>
    </div>
    <div style="text-align: right;">
      <div style="font-size: 22px; font-weight: 800; color: #111; letter-spacing: 1px;">RECIBO X</div>
      <div style="font-size: 15px; font-weight: 600; color: #111; margin-top: 2px;">N${String.fromCharCode(176)} ${receiptNumber}</div>
      <div style="font-size: 12px; color: #333; margin-top: 2px;">Fecha: ${receiptDate}</div>
    </div>
  </div>

  <!-- SEPARATOR -->
  <div style="border-bottom: 2px solid #333; margin: 16px 0;"></div>

  <!-- RECEPTOR -->
  <div style="margin-bottom: 4px;">
    <div style="font-size: 11px; color: #555; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 4px;">Recibimos de:</div>
    <div style="font-size: 18px; font-weight: 700; color: #111;">${esc(cobro.enterprise_name || '-')}</div>
    <div style="font-size: 12px; color: #333; margin-top: 4px;">CUIT: ${esc(enterpriseCuit || '-')}${cobro.enterprise_address ? ' | ' + esc(cobro.enterprise_address) : ''}${cobro.enterprise_tax_condition ? ' | ' + esc(cobro.enterprise_tax_condition) : ''}</div>
  </div>

  <!-- AMOUNT -->
  <div style="margin: 20px 0;">
    <div style="font-size: 12px; color: #555; margin-bottom: 4px;">La suma de pesos: ${esc(totalInLetters)}</div>
    <div style="text-align: right; font-size: 28px; font-weight: 800; color: #047857;">$ ${fmtMoney(totalRecibo)}</div>
  </div>

  <!-- SEPARATOR -->
  <div style="border-bottom: 2px solid #333; margin: 16px 0;"></div>

  <!-- FORMAS DE PAGO -->
  ${paymentMethods.length > 0 ? `
  <div style="margin-bottom: 20px;">
    <div style="font-size: 11px; color: #555; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px;">Formas de pago:</div>
    <table style="width: 100%; border-collapse: collapse;">
${pmLines}
    </table>
  </div>
  ` : ''}

  <!-- RETENCIONES -->
  ${retenciones.length > 0 ? `
  <div style="margin-bottom: 20px;">
    <div style="font-size: 11px; color: #555; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px;">Retenciones sufridas:</div>
    <table style="width: 100%; border-collapse: collapse;">
${retLines}
    </table>
  </div>
  ` : ''}

  <!-- FACTURAS CANCELADAS -->
  ${linkedInvoices.length > 0 ? `
  <div style="margin-bottom: 20px;">
    <div style="font-size: 11px; color: #555; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px;">Comprobantes cancelados:</div>
    <table style="width: 100%; border-collapse: collapse;">
      <thead>
        <tr style="border-bottom: 1px solid #e5e5e5;">
          <th style="padding: 6px 0; font-size: 11px; color: #555; text-align: left; font-weight: 600;">Comprobante</th>
          <th style="padding: 6px 0; font-size: 11px; color: #555; text-align: right; font-weight: 600;">Total</th>
          <th style="padding: 6px 0; font-size: 11px; color: #555; text-align: right; font-weight: 600;">Aplicado</th>
          <th style="padding: 6px 0; font-size: 11px; color: #555; text-align: right; font-weight: 600;">Pendiente</th>
        </tr>
      </thead>
      <tbody>
${invRows}
      </tbody>
    </table>
  </div>
  ` : ''}

  <!-- SEPARATOR -->
  <div style="border-bottom: 2px solid #333; margin: 16px 0;"></div>

  <!-- TOTAL -->
  <div style="text-align: right; margin-bottom: 24px;">
    <span style="font-size: 14px; font-weight: 700; color: #111; margin-right: 16px;">TOTAL RECIBO:</span>
    <span style="font-size: 22px; font-weight: 800; color: #047857;">$ ${fmtMoney(totalRecibo)}</span>
  </div>

  ${(cobro.notes || cobro.observations) ? `
  <!-- OBSERVATIONS -->
  <div style="margin-bottom: 20px; font-size: 12px; color: #333;">
    <span style="font-weight: 600;">Obs:</span> ${esc(cobro.notes || cobro.observations || '')}
  </div>
  ` : ''}

  <!-- FOOTER -->
  <div style="border-top: 1px solid #e5e5e5; padding-top: 12px; font-size: 11px; color: #555; text-align: center;">
    Documento no fiscal | Generado el ${generatedDate}
  </div>

</div>
</body>
</html>`
  }

  async generatePaymentPdf(pagoId: string, companyId: string, businessUnitId?: string): Promise<Buffer> {
    try {
      await this.initialize()

      // 1. Query pago data with enterprise and company info
      const pagoResult = await db.execute(sql`
        SELECT p.*, e.name as enterprise_name, e.cuit as enterprise_cuit, e.address as enterprise_address,
          e.tax_condition as enterprise_tax_condition,
          comp.name as company_name, comp.cuit as company_cuit, comp.address as company_address,
          b.bank_name
        FROM pagos p
        LEFT JOIN enterprises e ON p.enterprise_id = e.id
        LEFT JOIN companies comp ON p.company_id = comp.id
        LEFT JOIN banks b ON p.bank_id = b.id
        WHERE p.id = ${pagoId}
      `)
      const pago = ((pagoResult as any).rows || [])[0]
      // BU guard (also enforces companyId -> IDOR defense)
      this.assertBelongsToTenant(pago, companyId, businessUnitId, 'Pago')

      // 2. Multi-method payment_methods[] (JSONB side table) with legacy fallback
      let paymentMethods = await this.fetchPagoPaymentMethods(pagoId)
      if (paymentMethods.length === 0 && pago.payment_method) {
        paymentMethods = [{
          method: pago.payment_method,
          amount: pago.amount,
          bank_name: pago.bank_name,
          reference: pago.reference,
        }]
      }

      // 3. Retenciones practicadas (soft-delete aware, via helper)
      const retenciones = await this.fetchPagoRetenciones(pagoId)

      // 4. Query linked purchase invoices
      const invResult = await db.execute(sql`
        SELECT pia.amount_applied, pi.invoice_number, pi.invoice_type::text, pi.total_amount,
          CAST(pi.total_amount AS decimal) - COALESCE(
            (SELECT SUM(CAST(pia2.amount_applied AS decimal))
             FROM pago_invoice_applications pia2
             WHERE pia2.purchase_invoice_id = pi.id), 0
          ) as saldo_pendiente
        FROM pago_invoice_applications pia
        JOIN purchase_invoices pi ON pia.purchase_invoice_id = pi.id
        WHERE pia.pago_id = ${pagoId}
      `)
      const linkedInvoices = (invResult as any).rows || []

      // 5. Generate HTML
      let html = this.generatePaymentHtml({ pago, paymentMethods, retenciones, linkedInvoices })

      // Anulado watermark
      if (this.isAnulado(pago)) {
        const anulledByName = await this.resolveUserName(pago.anulled_by)
        html = this.renderAnuladoWatermark(html, {
          anulled_at: pago.anulled_at,
          anulled_by_name: anulledByName,
          anulled_reason: pago.anulled_reason,
        })
      }

      // 5. Render PDF with Puppeteer
      if (!this.browser) {
        throw new Error('Browser not initialized')
      }

      const page = await this.browser.newPage()
      await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 15000 })

      const pdf = await page.pdf({
        format: 'A4',
        margin: { top: '20px', right: '20px', bottom: '20px', left: '20px' },
        timeout: 15000,
      })

      await page.close()

      return pdf
    } catch (error) {
      if (error instanceof ApiError) throw error
      console.error('generatePaymentPdf ERROR:', (error as Error).message, (error as Error).stack?.split('\n')[1])
      throw new ApiError(500, `Payment PDF generation failed: ${(error as Error).message}`)
    }
  }

  private generatePaymentHtml(data: {
    pago: any
    paymentMethods?: any[]
    retenciones: any[]
    linkedInvoices: any[]
  }): string {
    const { pago, retenciones, linkedInvoices } = data
    const paymentMethods: any[] = Array.isArray(data.paymentMethods) ? data.paymentMethods : []
    const esc = this.escapeHtml.bind(this)

    const paymentNumber = String(pago.id?.slice(-8) || '0').padStart(8, '0')
    const paymentDate = new Date(pago.payment_date || pago.created_at).toLocaleDateString('es-AR')

    const companyCuit = this.formatCuit(pago.company_cuit || '')
    const enterpriseCuit = this.formatCuit(pago.enterprise_cuit || '')

    // Totals: bruto - retenciones practicadas = neto a pagar
    const totalRetenciones = retenciones.reduce(
      (sum: number, r: any) => sum + parseFloat(r.amount || '0'), 0
    )
    const bruto = parseFloat(pago.total_amount || pago.amount || '0')
    const netoAPagar = bruto - totalRetenciones

    const methodLabels: Record<string, string> = {
      'efectivo': 'Efectivo',
      'transferencia': 'Transferencia',
      'cheque': 'Cheque',
      'echeq': 'E-Cheq',
      'mercado_pago': 'Mercado Pago',
      'tarjeta': 'Tarjeta',
      'cash': 'Efectivo',
      'transfer': 'Transferencia',
      'check': 'Cheque',
    }

    // Multi-method rows (fallback to single legacy method if paymentMethods is empty)
    const effectiveMethods = paymentMethods.length > 0
      ? paymentMethods
      : [{
          method: pago.payment_method,
          amount: pago.amount,
          bank_name: pago.bank_name,
          reference: pago.reference,
        }]

    const methodsRows = effectiveMethods.map((pm: any) => {
      const methodLabel = methodLabels[pm.method] || pm.method || '-'
      const amount = parseFloat(pm.amount || '0')
      // Detail: bank + check# / reference (never raw interpolation of DB strings)
      const detailParts: string[] = []
      if (pm.bank_name) detailParts.push(esc(pm.bank_name))
      if (pm.check_number) detailParts.push('Cheque #' + esc(pm.check_number))
      if (pm.reference) detailParts.push('Ref: ' + esc(pm.reference))
      const detail = detailParts.length > 0 ? detailParts.join(' / ') : '-'
      return `        <tr>
          <td>${esc(methodLabel)}</td>
          <td class="right">$ ${amount.toFixed(2)}</td>
          <td>${detail}</td>
        </tr>`
    }).join('\n')

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Orden de Pago ${paymentNumber}</title>
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
      <div class="header-title">ORDEN DE PAGO</div>
    </div>
    <div class="header-right">
      <div class="header-letter">X</div>
      <div class="header-number">N° ${paymentNumber}</div>
      <div class="header-date">Fecha: ${paymentDate}</div>
    </div>
  </div>

  <!-- EMISOR -->
  <div class="section">
    <div class="section-title">Datos del Emisor</div>
    <div class="data-grid">
      <div class="data-col">
        <div class="data-row"><span class="data-label">Razon Social:</span> <span class="data-value">${esc(pago.company_name)}</span></div>
        <div class="data-row"><span class="data-label">CUIT:</span> <span class="data-value">${esc(companyCuit)}</span></div>
      </div>
      <div class="data-col">
        <div class="data-row"><span class="data-label">Domicilio:</span> <span class="data-value">${esc(pago.company_address || '-')}</span></div>
        <div class="data-row"><span class="data-label">Cond. IVA:</span> <span class="data-value">${esc(pago.company_tax_condition || 'Responsable Inscripto')}</span></div>
      </div>
    </div>
  </div>

  <!-- PROVEEDOR -->
  <div class="section">
    <div class="section-title">Datos del Proveedor</div>
    <div class="data-grid">
      <div class="data-col">
        <div class="data-row"><span class="data-label">Razon Social:</span> <span class="data-value">${esc(pago.enterprise_name || '-')}</span></div>
        <div class="data-row"><span class="data-label">CUIT:</span> <span class="data-value">${esc(enterpriseCuit || '-')}</span></div>
      </div>
      <div class="data-col">
        <div class="data-row"><span class="data-label">Domicilio:</span> <span class="data-value">${esc(pago.enterprise_address || '-')}</span></div>
        <div class="data-row"><span class="data-label">Cond. IVA:</span> <span class="data-value">${esc(pago.enterprise_tax_condition || '-')}</span></div>
      </div>
    </div>
  </div>

  <!-- FORMAS DE PAGO (multi-method) -->
  <div class="section" style="padding: 0;">
    <div class="section-title" style="padding: 10px 16px 4px;">Formas de Pago</div>
    <table>
      <thead>
        <tr>
          <th class="left" style="width: 30%;">Metodo</th>
          <th class="right" style="width: 25%;">Monto</th>
          <th class="left" style="width: 45%;">Detalle</th>
        </tr>
      </thead>
      <tbody>
${methodsRows}
      </tbody>
    </table>
  </div>

  <!-- RETENCIONES PRACTICADAS -->
  ${retenciones.length > 0 ? `
  <div class="section" style="padding: 0;">
    <div class="section-title" style="padding: 10px 16px 4px;">Retenciones Practicadas</div>
    <table>
      <thead>
        <tr>
          <th class="left" style="width: 12%;">Tipo</th>
          <th class="left" style="width: 14%;">Regimen</th>
          <th class="left" style="width: 14%;">Jurisdiccion</th>
          <th class="left" style="width: 14%;">N° Cert.</th>
          <th class="right" style="width: 16%;">Base AFIP</th>
          <th style="width: 10%;">Tasa</th>
          <th class="right" style="width: 20%;">Importe</th>
        </tr>
      </thead>
      <tbody>
        ${retenciones.map((r: any) => `
        <tr>
          <td>${esc((r.type || '').toString().toUpperCase())}</td>
          <td>${esc(r.regime || '-')}</td>
          <td>${esc(r.jurisdiction || '-')}</td>
          <td>${esc(r.certificate_number || '-')}</td>
          <td class="right">$ ${parseFloat(r.base_amount || '0').toFixed(2)}</td>
          <td class="center">${r.rate ? parseFloat(r.rate).toFixed(1) + '%' : '-'}</td>
          <td class="right">$ ${parseFloat(r.amount || '0').toFixed(2)}</td>
        </tr>`).join('')}
      </tbody>
    </table>
  </div>
  ` : ''}

  <!-- FACTURAS DE COMPRA CANCELADAS -->
  ${linkedInvoices.length > 0 ? `
  <div class="section" style="padding: 0;">
    <div class="section-title" style="padding: 10px 16px 4px;">Facturas de Compra Canceladas</div>
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

  <!-- TOTALES: Bruto - Retenciones = Neto a Pagar -->
  <div class="totals-box">
    <div class="totals-row">
      <span class="totals-label">Importe Bruto:</span>
      <span class="totals-amount">$ ${bruto.toFixed(2)}</span>
    </div>
    ${retenciones.length > 0 ? `
    <div class="totals-row">
      <span class="totals-label">(-) Retenciones practicadas:</span>
      <span class="totals-amount">$ ${totalRetenciones.toFixed(2)}</span>
    </div>
    ` : ''}
    <div class="totals-row grand">
      <span class="totals-label">NETO A PAGAR:</span>
      <span class="totals-amount">$ ${netoAPagar.toFixed(2)}</span>
    </div>
  </div>

  <!-- OBSERVACIONES -->
  ${pago.notes ? `
  <div class="observations">
    <div class="obs-title">Observaciones</div>
    ${esc(pago.notes)}
  </div>
  ` : ''}

  <div class="footer">
    Orden de pago generada el ${new Date().toLocaleDateString('es-AR')} - Documento no fiscal
  </div>

</body>
</html>`
  }

  /**
   * Cheque PDF — supports both directions ('recibido' | 'emitido').
   * Renders direction, issuer_type, drawer, drawer_cuit, due_date and the
   * full transition history (cheque_transitions table).
   * BU guard: enforces company_id and optional business_unit_id.
   */
  async generateChequePdf(chequeId: string, companyId: string, businessUnitId?: string): Promise<Buffer> {
    try {
      await this.initialize()

      const r = await db.execute(sql`SELECT * FROM cheques WHERE id = ${chequeId}`)
      const cheque = ((r as any).rows || [])[0]
      this.assertBelongsToTenant(cheque, companyId, businessUnitId, 'Cheque')

      // Transition history (optional table — fallback to empty on error)
      let transitions: any[] = []
      try {
        const tr = await db.execute(sql`
          SELECT * FROM cheque_transitions
          WHERE cheque_id = ${chequeId}
          ORDER BY created_at ASC
        `)
        transitions = (tr as any).rows || []
      } catch {
        transitions = []
      }

      let html = this.generateChequeHtml({ cheque, transitions })

      if (this.isAnulado(cheque)) {
        const anulledByName = await this.resolveUserName(cheque.anulled_by)
        html = this.renderAnuladoWatermark(html, {
          anulled_at: cheque.anulled_at,
          anulled_by_name: anulledByName,
          anulled_reason: cheque.anulled_reason,
        })
      }

      if (!this.browser) throw new Error('Browser not initialized')
      const page = await this.browser.newPage()
      await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 15000 })
      const pdf = await page.pdf({
        format: 'A4',
        margin: { top: '20px', right: '20px', bottom: '20px', left: '20px' },
        timeout: 15000,
      })
      await page.close()
      return pdf
    } catch (error) {
      if (error instanceof ApiError) throw error
      throw new ApiError(500, `Cheque PDF generation failed: ${(error as Error).message}`)
    }
  }

  private generateChequeHtml(data: { cheque: any; transitions: any[] }): string {
    const { cheque, transitions } = data
    const esc = this.escapeHtml.bind(this)

    const issueDate = cheque.issue_date ? new Date(cheque.issue_date).toLocaleDateString('es-AR') : '-'
    const dueDate = cheque.due_date ? new Date(cheque.due_date).toLocaleDateString('es-AR') : '-'
    const amount = parseFloat(cheque.amount || '0').toFixed(2)
    const direction = cheque.direction === 'emitido' ? 'EMITIDO' : 'RECIBIDO'
    const issuerType = cheque.issuer_type === 'propio' ? 'Propio' : 'Tercero'

    const transitionRows = transitions.map((t: any) => {
      const when = t.created_at ? new Date(t.created_at).toLocaleString('es-AR') : '-'
      return `<tr>
        <td>${esc(when)}</td>
        <td>${esc(t.from_status || '-')}</td>
        <td>${esc(t.to_status || '-')}</td>
        <td>${esc(t.reason || '-')}</td>
      </tr>`
    }).join('')

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Cheque ${esc(cheque.number || '')}</title>
  <style>
    @page { size: A4; margin: 12mm; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: Arial, Helvetica, sans-serif; color: #111; font-size: 12px; }
    .header { background: #1a1a2e; color: #fff; padding: 16px 20px; display: flex; justify-content: space-between; align-items: center; }
    .header h1 { font-size: 22px; letter-spacing: 2px; }
    .badge { background: #fff; color: #1a1a2e; padding: 4px 12px; font-weight: bold; border-radius: 4px; }
    .section { border: 1px solid #ccc; padding: 12px 16px; margin: 10px 0; }
    .row { display: flex; margin-bottom: 4px; }
    .label { min-width: 160px; color: #666; font-size: 11px; }
    .value { font-weight: 600; }
    table { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 11px; }
    th, td { border: 1px solid #ddd; padding: 6px 8px; text-align: left; }
    th { background: #f0f0f0; font-size: 10px; text-transform: uppercase; }
    .amount { font-size: 24px; font-weight: bold; color: #047857; text-align: right; padding: 12px 16px; border: 2px solid #047857; }
  </style>
</head>
<body>
  <div class="header">
    <h1>CHEQUE ${direction}</h1>
    <div class="badge">N&deg; ${esc(cheque.number || '-')}</div>
  </div>

  <div class="section">
    <div class="row"><span class="label">Direccion:</span><span class="value">${esc(direction)}</span></div>
    <div class="row"><span class="label">Tipo emisor:</span><span class="value">${esc(issuerType)}</span></div>
    <div class="row"><span class="label">Banco:</span><span class="value">${esc(cheque.bank || '-')}</span></div>
    <div class="row"><span class="label">Librador:</span><span class="value">${esc(cheque.drawer || '-')}</span></div>
    <div class="row"><span class="label">CUIT librador:</span><span class="value">${esc(cheque.drawer_cuit || '-')}</span></div>
    <div class="row"><span class="label">Fecha emision:</span><span class="value">${esc(issueDate)}</span></div>
    <div class="row"><span class="label">Fecha vencimiento:</span><span class="value">${esc(dueDate)}</span></div>
    <div class="row"><span class="label">Estado actual:</span><span class="value">${esc(cheque.status || '-')}</span></div>
  </div>

  <div class="amount">$ ${amount}</div>

  ${transitions.length > 0 ? `
  <div class="section">
    <div style="font-weight: bold; margin-bottom: 6px;">Historial de transiciones</div>
    <table>
      <thead>
        <tr>
          <th>Fecha</th>
          <th>De</th>
          <th>A</th>
          <th>Motivo</th>
        </tr>
      </thead>
      <tbody>
        ${transitionRows}
      </tbody>
    </table>
  </div>
  ` : ''}

  <div style="margin-top: 16px; font-size: 10px; color: #888; text-align: center;">
    Documento no fiscal - Generado el ${new Date().toLocaleDateString('es-AR')}
  </div>
</body>
</html>`
  }

  /**
   * Generate a PDF for an order ("pedido"). Mirrors the invoice PDF layout
   * but uses order-level fields and the customer enterprise's fiscal data.
   *
   * BU guard: enforces company_id and optional business_unit_id via
   * assertBelongsToTenant. Anulado watermark applied if the order is voided.
   */
  async generateOrderPdf(orderId: string, companyId: string, businessUnitId?: string): Promise<Buffer> {
    try {
      await this.initialize()

      // 1) Order row (raw SQL — orders has columns added at runtime by ensureMigrations)
      const orderResult = await db.execute(sql`SELECT * FROM orders WHERE id = ${orderId}`)
      const order = ((orderResult as any).rows || [])[0]
      this.assertBelongsToTenant(order, companyId, businessUnitId, 'Pedido')

      // 2) Items
      const itemsResult = await db.execute(sql`
        SELECT oi.*, p.sku
        FROM order_items oi
        LEFT JOIN products p ON oi.product_id = p.id
        WHERE oi.order_id = ${orderId}
        ORDER BY oi.created_at ASC
      `)
      const items = ((itemsResult as any).rows || [])

      // 3) Emitter (company)
      const companyResult = await db.execute(sql`SELECT * FROM companies WHERE id = ${companyId}`)
      const company = ((companyResult as any).rows || [])[0]
      if (!company) {
        throw new ApiError(404, 'Empresa no encontrada')
      }

      // 4) Customer enterprise (fiscal data). Try direct enterprise_id first;
      // fall back to customer.enterprise_id (some orders only have customer_id).
      let enterprise: any = null
      if (order.enterprise_id) {
        const eR = await db.execute(sql`SELECT * FROM enterprises WHERE id = ${order.enterprise_id} AND company_id = ${companyId}`)
        enterprise = ((eR as any).rows || [])[0] || null
      }
      let customer: any = null
      if (order.customer_id) {
        const cR = await db.execute(sql`SELECT * FROM customers WHERE id = ${order.customer_id} AND company_id = ${companyId}`)
        customer = ((cR as any).rows || [])[0] || null
        if (!enterprise && customer?.enterprise_id) {
          const eR = await db.execute(sql`SELECT * FROM enterprises WHERE id = ${customer.enterprise_id} AND company_id = ${companyId}`)
          enterprise = ((eR as any).rows || [])[0] || null
        }
      }

      let html = this.generateOrderHtml({ order, items, company, enterprise, customer })

      if (this.isAnulado(order)) {
        const anulledByName = await this.resolveUserName(order.anulled_by)
        html = this.renderAnuladoWatermark(html, {
          anulled_at: order.anulled_at,
          anulled_by_name: anulledByName,
          anulled_reason: order.anulled_reason,
        })
      }

      if (!this.browser) throw new Error('Browser not initialized')
      const page = await this.browser.newPage()
      await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 15000 })
      const pdf = await page.pdf({
        format: 'A4',
        margin: { top: '20px', right: '20px', bottom: '20px', left: '20px' },
        timeout: 15000,
      })
      await page.close()
      return pdf
    } catch (error) {
      if (error instanceof ApiError) throw error
      throw new ApiError(500, `Order PDF generation failed: ${(error as Error).message}`)
    }
  }

  /**
   * Build HTML for the order PDF. Visual style mirrors generateInvoiceHtml
   * (same fonts, header bar, info-bar, receptor box, items table, totals)
   * but adapted for order-specific fields.
   */
  private generateOrderHtml(data: { order: any; items: any[]; company: any; enterprise: any; customer: any }): string {
    const { order, items, company, enterprise, customer } = data
    const esc = this.escapeHtml.bind(this)
    const fmt = (n: number) => n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    // Sol/Luna: Luna orders render without IVA column / IVA breakdown.
    const isLuna = order?.fiscal_type === 'no_fiscal'

    // ---- Emisora (company) ----
    const companyName = company?.name || ''
    const companyCuit = this.formatCuit(company?.cuit || '')
    const companyDomicilio = [company?.address, company?.city, company?.province].filter(Boolean).join(', ')
    const companyPhone = company?.phone || ''
    const companyEmail = company?.email || ''
    const companyLogo = company?.logo_url || ''

    // ---- Cliente (enterprise) ----
    const cliRazon = enterprise?.razon_social || enterprise?.name || customer?.name || '-'
    const cliCuit = enterprise?.cuit || customer?.cuit || ''
    const cliCuitFmt = cliCuit ? this.formatCuit(cliCuit) : '-'
    const cliCondIva = enterprise?.tax_condition || customer?.tax_condition || '-'
    const cliFiscal = [enterprise?.fiscal_address, enterprise?.fiscal_city, enterprise?.fiscal_province, enterprise?.fiscal_postal_code]
      .filter(Boolean).join(', ') || '-'
    // Shipping = enterprise commercial address (address/city/province) — distinct from fiscal.
    const cliEntrega = [enterprise?.address, enterprise?.city, enterprise?.province, enterprise?.postal_code]
      .filter(Boolean).join(', ') || cliFiscal
    const cliContacto = [customer?.name, customer?.email, customer?.phone].filter(Boolean).join(' · ') || '-'

    // ---- Pedido ----
    const orderNumberStr = String(order.order_number || 0).padStart(8, '0')
    const todayStr = new Date().toLocaleDateString('es-AR')
    const createdStr = order.created_at ? new Date(order.created_at).toLocaleDateString('es-AR') : todayStr
    const deliveryStr = order.estimated_delivery ? new Date(order.estimated_delivery).toLocaleDateString('es-AR') : '-'
    const priorityStr = order.priority || 'normal'

    // ---- Items + totals ----
    const discountPercent = parseFloat(order.discount_percent || '0') || 0
    let subtotalNeto = 0
    const ivaByRate = new Map<number, number>()
    const itemRows = items.map((it: any, idx: number) => {
      const qty = parseFloat(it.quantity || '0') || 0
      const price = parseFloat(it.unit_price || '0') || 0
      const vatRate = isLuna ? 0 : (parseFloat(it.vat_rate || '0') || 0)
      const lineSubtotal = qty * price
      const lineIva = lineSubtotal * (vatRate / 100)
      const lineTotal = lineSubtotal + lineIva
      subtotalNeto += lineSubtotal
      ivaByRate.set(vatRate, (ivaByRate.get(vatRate) || 0) + lineIva)
      if (isLuna) {
        return `
        <tr>
          <td class="center">${String(idx + 1).padStart(3, '0')}</td>
          <td>${esc(it.product_name || '-')}</td>
          <td class="center">${qty.toFixed(2)}</td>
          <td class="right">${fmt(price)}</td>
          <td class="right">${fmt(lineSubtotal)}</td>
        </tr>`
      }
      return `
        <tr>
          <td class="center">${String(idx + 1).padStart(3, '0')}</td>
          <td>${esc(it.product_name || '-')}</td>
          <td class="center">${qty.toFixed(2)}</td>
          <td class="right">${fmt(price)}</td>
          <td class="right">${vatRate.toFixed(2)}</td>
          <td class="right">${fmt(lineSubtotal)}</td>
          <td class="right">${fmt(lineTotal)}</td>
        </tr>`
    }).join('')

    const discountAmount = subtotalNeto * (discountPercent / 100)
    const netoConDescuento = subtotalNeto - discountAmount
    const discountMultiplier = subtotalNeto > 0 ? (netoConDescuento / subtotalNeto) : 1
    let totalIvaConDescuento = 0
    const ivaBreakdownRows: string[] = []
    Array.from(ivaByRate.entries()).sort((a, b) => a[0] - b[0]).forEach(([rate, amt]) => {
      const adjusted = amt * discountMultiplier
      totalIvaConDescuento += adjusted
      ivaBreakdownRows.push(`
        <div class="totals-row">
          <span class="totals-label">IVA ${rate.toFixed(2)}%:</span>
          <span class="totals-amount">$ ${fmt(adjusted)}</span>
        </div>`)
    })
    const totalFinal = netoConDescuento + totalIvaConDescuento

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Pedido ${orderNumberStr}</title>
  <style>
    @page { size: A4; margin: 10mm; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: Arial, Helvetica, sans-serif; color: #000; font-size: 11px; line-height: 1.4; }
    .header-wrapper { border: 1.5px solid #000; display: flex; margin-bottom: 8px; position: relative; }
    .header-left, .header-right { flex: 1; padding: 12px 16px; }
    .letter-box {
      position: absolute; top: -1px; left: 50%; transform: translateX(-50%);
      width: 72px; background: #fff; border: 1.5px solid #000;
      text-align: center; padding: 4px 0 2px;
    }
    .letter-box .letter { font-size: 22px; font-weight: bold; line-height: 1; }
    .letter-box .cod { font-size: 8px; color: #555; }
    .header-divider { position: absolute; top: 0; bottom: 0; left: 50%; width: 0; border-left: 1.5px solid #000; }
    .razonsocial { font-size: 16px; font-weight: bold; margin-bottom: 4px; }
    .header-label { font-size: 10px; color: #444; }
    .header-value { font-size: 11px; font-weight: 600; }
    .header-row { margin-bottom: 3px; }
    .comprobante-tipo { font-size: 13px; font-weight: bold; margin-bottom: 6px; }
    .comprobante-nro { font-size: 16px; font-weight: bold; font-family: 'Courier New', monospace; margin-bottom: 8px; }
    .info-bar { border: 1.5px solid #000; border-top: none; display: flex; margin-bottom: 10px; }
    .info-bar-left, .info-bar-right { flex: 1; padding: 6px 16px; }
    .info-bar-left { border-right: 1.5px solid #000; }
    .info-row { display: flex; margin-bottom: 2px; }
    .info-label { font-size: 10px; color: #444; min-width: 140px; }
    .info-value { font-size: 11px; }
    .receptor { border: 1.5px solid #000; padding: 8px 16px; margin-bottom: 10px; }
    .receptor-title { font-size: 10px; font-weight: bold; color: #444; text-transform: uppercase; margin-bottom: 4px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 0; }
    thead th { background: #e8e8e8; border: 1px solid #999; padding: 6px 8px; font-size: 10px; font-weight: bold; text-transform: uppercase; text-align: center; }
    thead th.left { text-align: left; }
    thead th.right { text-align: right; }
    tbody td { border: 1px solid #ccc; padding: 5px 8px; font-size: 11px; }
    tbody td.center { text-align: center; }
    tbody td.right { text-align: right; font-family: 'Courier New', monospace; }
    .totals-wrapper { border: 1.5px solid #000; border-top: none; margin-bottom: 12px; }
    .totals-row { display: flex; justify-content: flex-end; padding: 4px 16px; border-bottom: 1px solid #ddd; }
    .totals-row:last-child { border-bottom: none; }
    .totals-label { font-size: 11px; min-width: 200px; text-align: right; padding-right: 20px; }
    .totals-amount { font-size: 11px; font-family: 'Courier New', monospace; font-weight: bold; min-width: 120px; text-align: right; }
    .totals-row.grand { background: #f0f0f0; padding: 8px 16px; }
    .totals-row.grand .totals-label, .totals-row.grand .totals-amount { font-size: 14px; font-weight: bold; }
    .notes { margin-top: 12px; padding: 10px 14px; border: 1px dashed #888; font-size: 11px; color: #333; }
    .footer { margin-top: 14px; text-align: center; font-size: 9px; color: #888; padding-top: 6px; border-top: 1px solid #ddd; }
    .logo { max-height: 48px; max-width: 160px; }
  </style>
</head>
<body>

  <div class="header-wrapper">
    <div class="header-divider"></div>
    <div class="letter-box">
      <div class="letter">PED</div>
      <div class="cod">PEDIDO</div>
    </div>

    <div class="header-left">
      ${companyLogo ? `<img class="logo" src="${esc(companyLogo)}" alt="logo" />` : ''}
      <div class="razonsocial">${esc(companyName)}</div>
      ${companyDomicilio ? `<div class="header-row"><span class="header-label">Domicilio Comercial:</span> ${esc(companyDomicilio)}</div>` : ''}
      <div class="header-row"><span class="header-label">CUIT:</span> <span class="header-value">${esc(companyCuit)}</span></div>
      ${companyPhone ? `<div class="header-row"><span class="header-label">Teléfono:</span> ${esc(companyPhone)}</div>` : ''}
      ${companyEmail ? `<div class="header-row"><span class="header-label">Email:</span> ${esc(companyEmail)}</div>` : ''}
    </div>

    <div class="header-right" style="padding-left: 50px;">
      <div class="comprobante-tipo">PEDIDO DE VENTA</div>
      <div class="comprobante-nro">N° ${orderNumberStr}</div>
      <div class="header-row"><span class="header-label">Fecha de Emisión:</span> <span class="header-value">${esc(createdStr)}</span></div>
      <div class="header-row"><span class="header-label">Entrega Estimada:</span> <span class="header-value">${esc(deliveryStr)}</span></div>
      <div class="header-row"><span class="header-label">Prioridad:</span> <span class="header-value">${esc(priorityStr)}</span></div>
    </div>
  </div>

  <div class="info-bar">
    <div class="info-bar-left">
      <div class="info-row"><span class="info-label">Título:</span> <span class="info-value">${esc(order.title || '-')}</span></div>
      <div class="info-row"><span class="info-label">Estado:</span> <span class="info-value">${esc(order.status || '-')}</span></div>
    </div>
    <div class="info-bar-right">
      <div class="info-row"><span class="info-label">Tipo:</span> <span class="info-value">${esc(order.product_type || '-')}</span></div>
      <div class="info-row"><span class="info-label">Método de Pago:</span> <span class="info-value">${esc(order.payment_method || '-')}</span></div>
    </div>
  </div>

  <div class="receptor">
    <div class="receptor-title">Cliente</div>
    <div style="display: flex; gap: 40px;">
      <div style="flex: 1;">
        <div class="info-row"><span class="info-label">Razón Social:</span> <span class="info-value" style="font-weight: bold;">${esc(cliRazon)}</span></div>
        <div class="info-row"><span class="info-label">CUIT:</span> <span class="info-value">${esc(cliCuitFmt)}</span></div>
        <div class="info-row"><span class="info-label">Condición IVA:</span> <span class="info-value">${esc(cliCondIva)}</span></div>
        <div class="info-row"><span class="info-label">Contacto:</span> <span class="info-value">${esc(cliContacto)}</span></div>
      </div>
      <div style="flex: 1;">
        <div class="info-row"><span class="info-label">Domicilio Fiscal:</span> <span class="info-value">${esc(cliFiscal)}</span></div>
        <div class="info-row"><span class="info-label">Dirección de Entrega:</span> <span class="info-value">${esc(cliEntrega)}</span></div>
      </div>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th class="left" style="width:6%;">#</th>
        <th class="left" style="width:${isLuna ? '50%' : '38%'};">Producto / Servicio</th>
        <th style="width:10%;">Cantidad</th>
        <th class="right" style="width:16%;">P. Unitario</th>
        ${isLuna ? '' : '<th class="right" style="width:8%;">% IVA</th>'}
        <th class="right" style="width:${isLuna ? '18%' : '14%'};">${isLuna ? 'Total' : 'Subtotal'}</th>
        ${isLuna ? '' : '<th class="right" style="width:14%;">Total c/IVA</th>'}
      </tr>
    </thead>
    <tbody>
      ${itemRows || `<tr><td colspan="${isLuna ? 5 : 7}" class="center" style="padding: 12px; color: #888;">Sin items</td></tr>`}
    </tbody>
  </table>

  <div class="totals-wrapper">
    ${isLuna ? '' : `
    <div class="totals-row">
      <span class="totals-label">Subtotal Neto:</span>
      <span class="totals-amount">$ ${fmt(subtotalNeto)}</span>
    </div>`}
    ${discountPercent > 0 ? `
    <div class="totals-row">
      <span class="totals-label">Descuento ${discountPercent.toFixed(2)}%:</span>
      <span class="totals-amount">- $ ${fmt(discountAmount)}</span>
    </div>
    <div class="totals-row">
      <span class="totals-label">Neto con Descuento:</span>
      <span class="totals-amount">$ ${fmt(netoConDescuento)}</span>
    </div>
    ` : ''}
    ${isLuna ? '' : ivaBreakdownRows.join('')}
    <div class="totals-row grand">
      <span class="totals-label">Total: $</span>
      <span class="totals-amount">${fmt(totalFinal)}</span>
    </div>
  </div>

  ${order.notes ? `
  <div class="notes">
    <strong>Notas:</strong><br/>
    ${esc(order.notes)}
  </div>
  ` : ''}

  <div class="footer">
    Documento no fiscal - Pedido generado el ${esc(todayStr)}
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
