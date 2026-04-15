import QRCode from 'qrcode'

/**
 * AFIP QR generator (RG AFIP 4291).
 *
 * Renders QR codes locally with the `qrcode` npm package. NO external HTTP
 * calls — fiscal data (CUIT, CAE, totals) never leaves the server.
 *
 * The QR content follows the AFIP spec:
 *   https://www.afip.gob.ar/fe/qr/?p=<base64(JSON)>
 *
 * where the JSON has the exact field set defined by RG 4291.
 */

/**
 * AFIP QR JSON payload, per RG 4291.
 */
export interface QrAfipPayload {
  ver: number // spec version, always 1
  fecha: string // 'YYYY-MM-DD'
  cuit: number // CUIT emisor, as integer (no dashes)
  ptoVta: number
  tipoCmp: number // AFIP comprobante type code (1=A, 6=B, 11=C, 3=NC_A, ...)
  nroCmp: number
  importe: number // total
  moneda: string // 'PES', 'DOL', etc.
  ctz: number // exchange rate (1 for PES)
  tipoDocRec: number // 80=CUIT, 96=DNI, 99=Consumidor Final
  nroDocRec: number
  tipoCodAut: 'E' | 'A' // 'E' = CAE
  codAut: number // 14-digit CAE
}

/**
 * Build the AFIP-spec QR URL from a payload. The payload is JSON-encoded
 * and then base64-encoded (standard base64, matching the existing
 * afip.service.ts `generateQrData` output).
 */
export function buildAfipQrUrl(payload: QrAfipPayload): string {
  const json = JSON.stringify(payload)
  const b64 = Buffer.from(json, 'utf8').toString('base64')
  return `https://www.afip.gob.ar/fe/qr/?p=${b64}`
}

/**
 * Render a QR PNG (as a data URL) locally for any string content.
 * Used by the PDF service to embed a QR image inline in the rendered HTML
 * without making any third-party HTTP request.
 */
export async function generateQrPngDataUrl(content: string): Promise<string> {
  return await QRCode.toDataURL(content, {
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 200,
  })
}

/**
 * Convenience helper: build the AFIP URL from a payload and render it as a
 * PNG data URL in one step. Equivalent to:
 *   generateQrPngDataUrl(buildAfipQrUrl(payload))
 */
export async function generateAfipQrDataUrl(payload: QrAfipPayload): Promise<string> {
  return await generateQrPngDataUrl(buildAfipQrUrl(payload))
}
