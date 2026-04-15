import { describe, it, expect } from 'vitest'
import {
  buildAfipQrUrl,
  generateQrPngDataUrl,
  generateAfipQrDataUrl,
  type QrAfipPayload,
} from '../src/lib/qr-afip'

const SAMPLE_PAYLOAD: QrAfipPayload = {
  ver: 1,
  fecha: '2026-04-13',
  cuit: 30715789012,
  ptoVta: 1,
  tipoCmp: 1,
  nroCmp: 1234,
  importe: 12100.5,
  moneda: 'PES',
  ctz: 1,
  tipoDocRec: 80,
  nroDocRec: 20123456789,
  tipoCodAut: 'E',
  codAut: 71234567890123,
}

describe('buildAfipQrUrl', () => {
  it('produces an AFIP-spec URL with base64-encoded JSON payload', () => {
    const url = buildAfipQrUrl(SAMPLE_PAYLOAD)

    expect(url.startsWith('https://www.afip.gob.ar/fe/qr/?p=')).toBe(true)

    const b64 = url.replace('https://www.afip.gob.ar/fe/qr/?p=', '')
    const decoded = Buffer.from(b64, 'base64').toString('utf8')
    const parsed = JSON.parse(decoded)

    expect(parsed).toEqual(SAMPLE_PAYLOAD)
  })

  it('JSON-encodes all required AFIP fields', () => {
    const url = buildAfipQrUrl(SAMPLE_PAYLOAD)
    const decoded = Buffer.from(
      url.replace('https://www.afip.gob.ar/fe/qr/?p=', ''),
      'base64'
    ).toString('utf8')

    const requiredFields = [
      'ver', 'fecha', 'cuit', 'ptoVta', 'tipoCmp', 'nroCmp',
      'importe', 'moneda', 'ctz', 'tipoDocRec', 'nroDocRec',
      'tipoCodAut', 'codAut',
    ]
    const parsed = JSON.parse(decoded)
    for (const f of requiredFields) {
      expect(parsed).toHaveProperty(f)
    }
  })
})

describe('generateQrPngDataUrl', () => {
  it('returns a data URL for a PNG image', async () => {
    const dataUrl = await generateQrPngDataUrl('https://example.com/test')
    expect(dataUrl.startsWith('data:image/png;base64,')).toBe(true)
  })

  it('decoded payload is a valid PNG (magic bytes 89 50 4E 47)', async () => {
    const dataUrl = await generateQrPngDataUrl('https://example.com/test')
    const b64 = dataUrl.replace('data:image/png;base64,', '')
    const buf = Buffer.from(b64, 'base64')

    expect(buf[0]).toBe(0x89)
    expect(buf[1]).toBe(0x50)
    expect(buf[2]).toBe(0x4e)
    expect(buf[3]).toBe(0x47)
  })

  it('does NOT make any HTTP call (purely local)', async () => {
    // Smoke test: function must resolve without network. If qrcode tried to
    // fetch anything, this would either hang or fail in offline CI.
    const dataUrl = await generateQrPngDataUrl('any content')
    expect(dataUrl.length).toBeGreaterThan(100)
  })
})

describe('generateAfipQrDataUrl', () => {
  it('produces a PNG data URL from an AFIP payload', async () => {
    const dataUrl = await generateAfipQrDataUrl(SAMPLE_PAYLOAD)
    expect(dataUrl.startsWith('data:image/png;base64,')).toBe(true)

    const buf = Buffer.from(
      dataUrl.replace('data:image/png;base64,', ''),
      'base64'
    )
    expect(buf[0]).toBe(0x89)
    expect(buf[1]).toBe(0x50)
    expect(buf[2]).toBe(0x4e)
    expect(buf[3]).toBe(0x47)
  })
})
