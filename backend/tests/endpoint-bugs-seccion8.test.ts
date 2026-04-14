/**
 * SECCION 8: Anular remito
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

function buildAnularClient(
  rows: { remito?: any[]; items?: any[]; movement?: any[] },
  executed?: Array<{ sql: string; params?: any[] }>
) {
  return {
    query: vi.fn().mockImplementation(async (sql: string, params?: any[]) => {
      executed?.push({ sql, params });
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
      if (sql.includes('SELECT id, status FROM remitos') && sql.includes('FOR UPDATE')) {
        return { rows: rows.remito || [{ id: 'rem-1', status: 'pendiente' }] };
      }
      if (sql.includes('SELECT id, order_item_id, product_id, quantity FROM remito_items')) {
        return { rows: rows.items || [] };
      }
      if (sql.includes('SELECT warehouse_id FROM stock_movements')) {
        return { rows: rows.movement || [] };
      }
      return { rows: [] };
    }),
    release: vi.fn(),
  };
}

// ═══════════════════════════════════════════════════════════════════
// BUG #1: FOR UPDATE previene double-anular
// ═══════════════════════════════════════════════════════════════════

describe('Seccion 8 BUG #1: FOR UPDATE lock en SELECT remito', () => {
  beforeEach(() => resetMocks());

  it('usa FOR UPDATE al consultar el remito a anular', async () => {
    const executed: Array<{ sql: string; params?: any[] }> = [];
    const mockClient = buildAnularClient({ items: [] }, executed);
    (pool.connect as any).mockResolvedValue(mockClient);

    const service = await makeService();
    await service.anularRemito('comp-1', 'rem-1', 'user-1');

    const selectQuery = executed.find(q =>
      q.sql.includes('SELECT id, status FROM remitos') && q.sql.includes('FOR UPDATE')
    );
    expect(selectQuery).toBeDefined();
  });

  it('rechaza remito ya anulado', async () => {
    const mockClient = buildAnularClient({
      remito: [{ id: 'rem-1', status: 'anulado' }],
    });
    (pool.connect as any).mockResolvedValue(mockClient);

    const service = await makeService();
    await expect(service.anularRemito('comp-1', 'rem-1', 'user-1'))
      .rejects.toThrow(/ya esta anulado/);
  });

  it('lanza 404 si remito no pertenece a la compania', async () => {
    const mockClient = buildAnularClient({ remito: [] });
    (pool.connect as any).mockResolvedValue(mockClient);

    const service = await makeService();
    await expect(service.anularRemito('comp-A', 'rem-1', 'user-1'))
      .rejects.toThrow(/not found/i);
  });
});

// ═══════════════════════════════════════════════════════════════════
// BUG #3: Marca anulado ANTES del recalculate
// ═══════════════════════════════════════════════════════════════════

describe('Seccion 8 BUG #3: orden de operaciones anulado-then-recalculate', () => {
  beforeEach(() => resetMocks());

  it('marca como anulado ANTES del recalculate', async () => {
    const executed: Array<{ sql: string; params?: any[] }> = [];
    const mockClient = buildAnularClient({
      items: [{ id: 'ri-1', order_item_id: 'oi-1', product_id: null, quantity: 3 }],
    }, executed);
    (pool.connect as any).mockResolvedValue(mockClient);

    const service = await makeService();
    await service.anularRemito('comp-1', 'rem-1', 'user-1');

    const markAnuladoIdx = executed.findIndex(q =>
      q.sql.includes('UPDATE remitos SET') && q.sql.includes('anulado')
    );
    const recalcIdx = executed.findIndex(q =>
      q.sql.includes('UPDATE order_items SET qty_delivered = (')
    );
    expect(markAnuladoIdx).toBeGreaterThan(-1);
    expect(recalcIdx).toBeGreaterThan(-1);
    expect(markAnuladoIdx).toBeLessThan(recalcIdx);
  });
});

// ═══════════════════════════════════════════════════════════════════
// BUG #4: Recalculate excluye remitos anulados
// ═══════════════════════════════════════════════════════════════════

describe('Seccion 8 BUG #4: Recalculate excluye anulados', () => {
  beforeEach(() => resetMocks());

  it('la query de recalculate usa r.status != anulado', async () => {
    const executed: Array<{ sql: string; params?: any[] }> = [];
    const mockClient = buildAnularClient({
      items: [{ id: 'ri-1', order_item_id: 'oi-1', product_id: null, quantity: 3 }],
    }, executed);
    (pool.connect as any).mockResolvedValue(mockClient);

    const service = await makeService();
    await service.anularRemito('comp-1', 'rem-1', 'user-1');

    const recalc = executed.find(q =>
      q.sql.includes('UPDATE order_items SET qty_delivered = (')
    );
    expect(recalc).toBeDefined();
    expect(recalc!.sql).toContain('r.status != \'anulado\'');
  });
});

// ═══════════════════════════════════════════════════════════════════
// BUG #5: stock_movement filtra movement_type='sale'
// ═══════════════════════════════════════════════════════════════════

describe('Seccion 8 BUG #5: stock_movement lookup filtra salida', () => {
  beforeEach(() => resetMocks());

  it('usa movement_type=salida al buscar warehouse original', async () => {
    const executed: Array<{ sql: string; params?: any[] }> = [];
    const mockClient = buildAnularClient({
      items: [{ id: 'ri-1', order_item_id: null, product_id: 'prod-1', quantity: 5 }],
      movement: [{ warehouse_id: 'wh-1' }],
    }, executed);
    (pool.connect as any).mockResolvedValue(mockClient);

    const service = await makeService();
    await service.anularRemito('comp-1', 'rem-1', 'user-1');

    const movLookup = executed.find(q => q.sql.includes('FROM stock_movements'));
    expect(movLookup).toBeDefined();
    expect(movLookup!.sql).toContain("movement_type::text = 'sale'");
  });
});

// ═══════════════════════════════════════════════════════════════════
// BUG #7: rechaza userId invalido
// ═══════════════════════════════════════════════════════════════════

describe('Seccion 8 BUG #7: rechaza userId system/vacio', () => {
  beforeEach(() => resetMocks());

  it('rechaza userId vacio', async () => {
    const service = await makeService();
    await expect(service.anularRemito('comp-1', 'rem-1', ''))
      .rejects.toThrow(/userId valido/);
  });

  it('rechaza userId = "system"', async () => {
    const service = await makeService();
    await expect(service.anularRemito('comp-1', 'rem-1', 'system'))
      .rejects.toThrow(/userId valido/);
  });

  it('deleteRemito legacy requiere userId', async () => {
    const service = await makeService();
    await expect(service.deleteRemito('comp-1', 'rem-1'))
      .rejects.toThrow(/userId requerido/);
  });
});

// ═══════════════════════════════════════════════════════════════════
// BUG #9: Items con BOTH order_item_id y product_id devuelven stock
// ═══════════════════════════════════════════════════════════════════

describe('Seccion 8 BUG #9: items mixtos devuelven stock', () => {
  beforeEach(() => resetMocks());

  it('item con order_item_id Y product_id tambien devuelve stock', async () => {
    const executed: Array<{ sql: string; params?: any[] }> = [];
    const mockClient = buildAnularClient({
      items: [{ id: 'ri-1', order_item_id: 'oi-1', product_id: 'prod-1', quantity: 5 }],
      movement: [{ warehouse_id: 'wh-1' }],
    }, executed);
    (pool.connect as any).mockResolvedValue(mockClient);

    const service = await makeService();
    await service.anularRemito('comp-1', 'rem-1', 'user-1');

    // Should have revert qty_delivered
    const revert = executed.find(q => q.sql.includes('GREATEST') && q.sql.includes('qty_delivered'));
    expect(revert).toBeDefined();
    // AND should have stock entrada movement
    const stockEntrada = executed.find(q =>
      q.sql.includes('INSERT INTO stock_movements') && q.sql.includes("'return_customer'")
    );
    expect(stockEntrada).toBeDefined();
  });
});
