/**
 * SECCION 5: Remito desde factura
 * Tests endpoint-level de bugs reales encontrados.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockPoolQuery, resetMocks } from './helpers/setup';
import { pool } from '../src/config/db';

vi.mock('../src/config/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

async function makeService() {
  const { RemitosService } = await import('../src/modules/remitos/remitos.service');
  const service = new (RemitosService as any)();
  service.tablesEnsured = true;
  return service;
}

const VALID_UUID = '11111111-1111-1111-1111-111111111111';

// ═══════════════════════════════════════════════════════════════════
// BUG #1: 'cancelado' (ES) filtrado
// ═══════════════════════════════════════════════════════════════════

describe('Seccion 5 BUG #1: Factura cancelada ES filtrada', () => {
  beforeEach(() => resetMocks());

  it('rechaza factura con status cancelado (espanol)', async () => {
    mockPoolQuery.mockImplementation(async (sql: string) => {
      if (sql?.includes('SELECT id, status FROM invoices')) {
        return { rows: [{ id: VALID_UUID, status: 'cancelado' }] };
      }
      return { rows: [] };
    });
    const service = await makeService();
    await expect(service.getInvoiceItemsForRemito('comp-1', VALID_UUID))
      .rejects.toThrow(/cancelada/);
  });

  it('rechaza factura con status cancelled (ingles)', async () => {
    mockPoolQuery.mockImplementation(async (sql: string) => {
      if (sql?.includes('SELECT id, status FROM invoices')) {
        return { rows: [{ id: VALID_UUID, status: 'cancelled' }] };
      }
      return { rows: [] };
    });
    const service = await makeService();
    await expect(service.getInvoiceItemsForRemito('comp-1', VALID_UUID))
      .rejects.toThrow(/cancelada/);
  });
});

// ═══════════════════════════════════════════════════════════════════
// BUG #2: Draft/borrador rechazado
// ═══════════════════════════════════════════════════════════════════

describe('Seccion 5 BUG #2: Factura draft rechazada', () => {
  beforeEach(() => resetMocks());

  it('rechaza factura en draft', async () => {
    mockPoolQuery.mockImplementation(async (sql: string) => {
      if (sql?.includes('SELECT id, status FROM invoices')) {
        return { rows: [{ id: VALID_UUID, status: 'draft' }] };
      }
      return { rows: [] };
    });
    const service = await makeService();
    await expect(service.getInvoiceItemsForRemito('comp-1', VALID_UUID))
      .rejects.toThrow(/borrador|Autorizala/i);
  });

  it('rechaza factura en borrador (ES)', async () => {
    mockPoolQuery.mockImplementation(async (sql: string) => {
      if (sql?.includes('SELECT id, status FROM invoices')) {
        return { rows: [{ id: VALID_UUID, status: 'borrador' }] };
      }
      return { rows: [] };
    });
    const service = await makeService();
    await expect(service.getInvoiceItemsForRemito('comp-1', VALID_UUID))
      .rejects.toThrow(/borrador/);
  });
});

// ═══════════════════════════════════════════════════════════════════
// BUG #4: 404 si no existe/cross-company
// ═══════════════════════════════════════════════════════════════════

describe('Seccion 5 BUG #4: 404 si factura inexistente', () => {
  beforeEach(() => resetMocks());

  it('lanza 404 en vez de [] si la factura no existe', async () => {
    mockPoolQuery.mockImplementation(async () => ({ rows: [] }));
    const service = await makeService();
    await expect(service.getInvoiceItemsForRemito('comp-1', VALID_UUID))
      .rejects.toThrow(/no encontrada|no pertenece/i);
  });

  it('lanza 404 si la factura es de otra company', async () => {
    mockPoolQuery.mockImplementation(async (sql: string, params: any) => {
      // company_id filter returns empty for other company
      if (sql?.includes('FROM invoices') && params?.[1] === 'comp-A') {
        return { rows: [] };
      }
      return { rows: [] };
    });
    const service = await makeService();
    await expect(service.getInvoiceItemsForRemito('comp-A', VALID_UUID))
      .rejects.toThrow(/no encontrada/i);
  });
});

// ═══════════════════════════════════════════════════════════════════
// BUG #10: UUID format validation
// ═══════════════════════════════════════════════════════════════════

describe('Seccion 5 BUG #10: UUID invalido rechazado', () => {
  beforeEach(() => resetMocks());

  it('rechaza invoiceId no-UUID (path traversal attempt)', async () => {
    const service = await makeService();
    await expect(service.getInvoiceItemsForRemito('comp-1', '../../etc/passwd'))
      .rejects.toThrow(/Invoice ID invalido/);
  });

  it('rechaza invoiceId con SQL injection attempt', async () => {
    const service = await makeService();
    await expect(service.getInvoiceItemsForRemito('comp-1', "'; DROP TABLE invoices; --"))
      .rejects.toThrow(/Invoice ID invalido/);
  });

  it('rechaza invoiceId vacio', async () => {
    const service = await makeService();
    await expect(service.getInvoiceItemsForRemito('comp-1', ''))
      .rejects.toThrow(/Invoice ID invalido/);
  });
});

// ═══════════════════════════════════════════════════════════════════
// BUG #6: factura_ref length
// ═══════════════════════════════════════════════════════════════════

describe('Seccion 5 BUG #6: factura_ref length limit', () => {
  beforeEach(() => resetMocks());

  it('rechaza factura_ref > 100 chars', async () => {
    mockPoolQuery.mockImplementation(async () => ({ rows: [{ id: 'ent-1' }] }));
    const service = await makeService();
    await expect(service.createRemito('comp-1', 'user-1', {
      enterprise_id: 'ent-1',
      factura_ref: 'A'.repeat(200),
      items: [{ product_name: 'Item', quantity: 1 }],
    })).rejects.toThrow(/factura.*100/i);
  });

  it('acepta factura_ref valido', async () => {
    const mockClient = {
      query: vi.fn().mockImplementation(async (sql: string) => {
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

    const service = await makeService();
    const result = await service.createRemito('comp-1', 'user-1', {
      enterprise_id: 'ent-1',
      factura_ref: 'B-0001-00000123',
      items: [{ product_name: 'Item', quantity: 1 }],
    });
    expect(result.id).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════
// Happy path: factura autorizada retorna items
// ═══════════════════════════════════════════════════════════════════

describe('Seccion 5: Happy path', () => {
  beforeEach(() => resetMocks());

  it('retorna items de factura autorizada con qty_available > 0', async () => {
    mockPoolQuery.mockImplementation(async (sql: string) => {
      if (sql?.includes('SELECT id, status FROM invoices')) {
        return { rows: [{ id: VALID_UUID, status: 'authorized' }] };
      }
      if (sql?.includes('FROM invoice_items ii')) {
        return { rows: [
          { invoice_item_id: 'ii-1', qty_available: '5', source_ref: 'Manual' },
          { invoice_item_id: 'ii-2', qty_available: '0', source_ref: 'Manual' },
          { invoice_item_id: 'ii-3', qty_available: '3', source_ref: 'Pedido #0001' },
        ]};
      }
      return { rows: [] };
    });
    const service = await makeService();
    const items = await service.getInvoiceItemsForRemito('comp-1', VALID_UUID);
    expect(items).toHaveLength(2); // filters qty=0
    expect(items[0].invoice_item_id).toBe('ii-1');
    expect(items[1].invoice_item_id).toBe('ii-3');
  });
});
