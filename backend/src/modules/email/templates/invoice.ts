// Invoice email template - sent when sharing an invoice with a customer

import { baseLayout, escapeHtml } from './base'

interface InvoiceEmailData {
  invoiceNumber: string
  invoiceType: string
  companyName: string
  cae?: string | null
  message?: string
}

export function invoiceEmailHtml(data: InvoiceEmailData): string {
  const caeBlock = data.cae
    ? `<div style="background-color:#f0fdf4;border:1px solid #bbf7d0;padding:16px;border-radius:6px;margin:20px 0;">
        <p style="margin:0 0 6px;font-size:14px;color:#166534;font-weight:600;">Autorizada por AFIP</p>
        <p style="margin:0;font-size:14px;color:#166534;">CAE: ${escapeHtml(data.cae)}</p>
      </div>`
    : ''

  const messageBlock = data.message
    ? `<div style="background-color:#fffbeb;border-left:4px solid #f59e0b;padding:14px 16px;margin:20px 0;border-radius:0 6px 6px 0;">
        <p style="margin:0;font-size:14px;color:#92400e;line-height:1.5;">${escapeHtml(data.message)}</p>
      </div>`
    : ''

  const body = `
    <h2 style="margin:0 0 16px;font-size:20px;font-weight:700;color:#1f2937;">
      Factura ${escapeHtml(data.invoiceType)}${escapeHtml(data.invoiceNumber)}
    </h2>
    <p style="margin:0 0 12px;font-size:15px;color:#374151;line-height:1.6;">
      Estimado cliente,
    </p>
    <p style="margin:0 0 12px;font-size:15px;color:#374151;line-height:1.6;">
      Le adjuntamos la factura por su compra en <strong>${escapeHtml(data.companyName)}</strong>.
    </p>
    ${caeBlock}
    ${messageBlock}
    <p style="margin:0 0 8px;font-size:15px;color:#374151;line-height:1.6;">
      Puede revisar los detalles de la factura en el archivo PDF adjunto.
    </p>
    <p style="margin:20px 0 0;font-size:15px;color:#374151;line-height:1.6;">
      Gracias por su compra.
    </p>
  `

  return baseLayout({
    preheader: `Factura ${escapeHtml(data.invoiceType)}${escapeHtml(data.invoiceNumber)} de ${escapeHtml(data.companyName)}`,
    body,
  })
}
