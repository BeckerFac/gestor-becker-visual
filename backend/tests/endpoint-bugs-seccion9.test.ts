/**
 * SECCION 9: Facturacion independiente
 * Verifica que:
 * 1. Invoices y remitos son independientes (Plan 12)
 * 2. IDOR fixes en invoices.createInvoice
 * 3. Cancelled filter (EN + ES)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockDbVoid, mockDbRows, mockDbEmpty, mockDbExecute, resetMocks } from './helpers/setup';

vi.mock('../src/config/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

async function makeInvoicesService() {
  const { InvoicesService } = await import('../src/modules/invoices/invoices.service');
  const service = new (InvoicesService as any)();
  (service as any).migrationsRun = true;
  return service;
}

async function makeRemitosService() {
  const { RemitosService } = await import('../src/modules/remitos/remitos.service');
  const service = new (RemitosService as any)();
  (service as any).tablesEnsured = true;
  return service;
}

// ═══════════════════════════════════════════════════════════════════
// BUG S9 #3: IDOR customer_id cross-company en createInvoice
// ═══════════════════════════════════════════════════════════════════

describe('Seccion 9 BUG #3: customer_id IDOR en createInvoice', () => {
  beforeEach(() => {
    resetMocks();
    // Router: nextNumber returns a number, ownership checks return empty, all else ok
    mockDbExecute.mockImplementation(async (query: any) => {
      const sqlText = JSON.stringify(query?.queryChunks || query?.strings || query || '');
      if (sqlText.includes('next_number')) return { rows: [{ next_number: '1' }] };
      // Everything else empty (including ownership checks = trigger IDOR rejection)
      return { rows: [] };
    });
  });

  it('rechaza customer_id de otra company', async () => {
    const service = await makeInvoicesService();
    await expect(service.createInvoice('comp-1', 'user-1', {
      fiscal_type: 'fiscal',
      invoice_type: 'B',
      customer_id: 'cust-of-other-company',
      // Wave 3D D11: items are now required.
      items: [{ product_name: 'X', unit_price: 100, quantity: 1, vat_rate: 21 }],
    })).rejects.toThrow(/no pertenece/i);
  });

  it('rechaza enterprise_id de otra company', async () => {
    const service = await makeInvoicesService();
    await expect(service.createInvoice('comp-1', 'user-1', {
      fiscal_type: 'fiscal',
      invoice_type: 'B',
      enterprise_id: 'ent-of-other-company',
      // Wave 3D D11: items are now required.
      items: [{ product_name: 'X', unit_price: 100, quantity: 1, vat_rate: 21 }],
    })).rejects.toThrow(/no pertenece|La empresa/i);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Independencia: crear remito NO requiere factura (Plan 12)
// ═══════════════════════════════════════════════════════════════════

describe('Seccion 9: remitos y facturas independientes', () => {
  beforeEach(() => resetMocks());

  it('crear remito sin factura funciona (Plan 12)', async () => {
    const { mockPoolQuery } = await import('./helpers/setup');
    const { pool } = await import('../src/config/db');
    const executed: Array<{ sql: string; params?: any[] }> = [];
    const mockClient = {
      query: vi.fn().mockImplementation(async (sql: string, params?: any[]) => {
        executed.push({ sql, params });
        if (sql === 'BEGIN' || sql === 'COMMIT') return { rows: [] };
        if (sql.includes('pg_advisory_xact_lock')) return { rows: [] };
        if (sql.includes('MAX(remito_number)')) return { rows: [{ next_number: 1 }] };
        return { rows: [] };
      }),
      release: vi.fn(),
    };
    mockPoolQuery.mockImplementation(async (sql: string) => {
      if (sql?.includes('FROM enterprises')) return { rows: [{ id: 'ent-1' }] };
      return { rows: [] };
    });
    (pool.connect as any).mockResolvedValue(mockClient);

    const service = await makeRemitosService();
    const result = await service.createRemito('comp-1', 'user-1', {
      enterprise_id: 'ent-1',
      items: [{ product_name: 'Item', quantity: 1 }],
    });
    expect(result.id).toBeDefined();
    // Verify NO invoice queries were executed
    const invoiceQueries = executed.filter(q => q.sql?.includes('invoice'));
    expect(invoiceQueries).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Anular remito NO toca facturas
// ═══════════════════════════════════════════════════════════════════

describe('Seccion 9: anular remito no afecta facturas', () => {
  beforeEach(() => resetMocks());

  it('anular remito no ejecuta queries de invoices', async () => {
    const { mockPoolQuery } = await import('./helpers/setup');
    const { pool } = await import('../src/config/db');
    const executed: Array<{ sql: string; params?: any[] }> = [];
    const mockClient = {
      query: vi.fn().mockImplementation(async (sql: string, params?: any[]) => {
        executed.push({ sql, params });
        if (sql === 'BEGIN' || sql === 'COMMIT') return { rows: [] };
        if (sql.includes('SELECT id, status FROM remitos') && sql.includes('FOR UPDATE')) {
          return { rows: [{ id: 'rem-1', status: 'pendiente' }] };
        }
        if (sql.includes('FROM remito_items')) {
          return { rows: [{ id: 'ri-1', order_item_id: 'oi-1', product_id: null, quantity: 2 }] };
        }
        return { rows: [] };
      }),
      release: vi.fn(),
    };
    mockPoolQuery.mockImplementation(async () => ({ rows: [] }));
    (pool.connect as any).mockResolvedValue(mockClient);

    const service = await makeRemitosService();
    await service.anularRemito('comp-1', 'rem-1', 'user-1');

    // Zero queries touching invoices
    const invoiceQueries = executed.filter(q => q.sql?.toLowerCase().includes('invoice'));
    expect(invoiceQueries).toHaveLength(0);
  });
});
