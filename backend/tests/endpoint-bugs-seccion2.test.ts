/**
 * SECCION 2 — Bugs en createRemito + getAvailableOrderItemsForRemito
 * Tests que verifican bugs arreglados
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockPoolQuery, resetMocks } from './helpers/setup';
import { pool } from '../src/config/db';

vi.mock('../src/config/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

function makeMockClient(responses: Record<string, any> = {}) {
  return {
    query: vi.fn().mockImplementation(async (sql: string, params?: any[]) => {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
      if (sql.includes('MAX(remito_number)')) return { rows: [{ next_number: 1 }] };
      for (const key of Object.keys(responses)) {
        if (sql.includes(key)) return responses[key];
      }
      return { rows: [] };
    }),
    release: vi.fn(),
  };
}

// ═══════════════════════════════════════════════════════════════════
// BUG #1 FIX: Validacion acumulativa por order_item_id
// ═══════════════════════════════════════════════════════════════════

describe('BUG #1 FIX: Validacion acumulativa de qty por order_item_id', () => {
  beforeEach(() => resetMocks());

  it('rechaza 2 items con mismo order_item_id si el total excede available', async () => {
    const mockClient = makeMockClient({
      // order_item: quantity=10, delivered=7, available=3
      'FOR UPDATE OF oi': { rows: [{ id: 'oi-1', quantity: 10, qty_delivered: 7, enterprise_id: 'ent-1', order_id: 'ord-1' }] },
    });
    mockPoolQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT id FROM enterprises')) return { rows: [{ id: 'ent-1' }] };
      return { rows: [] };
    });
    (pool.connect as any).mockResolvedValue(mockClient);

    const { RemitosService } = await import('../src/modules/remitos/remitos.service');
    const service = new (RemitosService as any)();
    service.tablesEnsured = true;

    // 2 items con el mismo order_item_id: 2 + 2 = 4 > 3 disponible
    await expect(service.createRemito('comp-1', 'user-1', {
      enterprise_id: 'ent-1',
      items: [
        { product_name: 'Pintura', quantity: 2, order_item_id: 'oi-1' },
        { product_name: 'Pintura', quantity: 2, order_item_id: 'oi-1' },
      ],
    })).rejects.toThrow(/total.*excede|acumulado|Disponible/i);
  });

  it('acepta items distintos con order_item_id diferentes', async () => {
    const mockClient = makeMockClient({
      'FOR UPDATE OF oi': {
        rows: [
          { id: 'oi-1', quantity: 10, qty_delivered: 0, enterprise_id: 'ent-1', order_id: 'ord-1' },
          { id: 'oi-2', quantity: 5, qty_delivered: 0, enterprise_id: 'ent-1', order_id: 'ord-1' },
        ],
      },
    });
    // Enterprise validation happens via pool.query (before transaction)
    mockPoolQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT id FROM enterprises')) return { rows: [{ id: 'ent-1' }] };
      return { rows: [] };
    });
    (pool.connect as any).mockResolvedValue(mockClient);

    const { RemitosService } = await import('../src/modules/remitos/remitos.service');
    const service = new (RemitosService as any)();
    service.tablesEnsured = true;

    const result = await service.createRemito('comp-1', 'user-1', {
      enterprise_id: 'ent-1',
      items: [
        { product_name: 'Pintura', quantity: 3, order_item_id: 'oi-1' },
        { product_name: 'Cemento', quantity: 2, order_item_id: 'oi-2' },
      ],
    });
    expect(result.id).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════
// BUG #5 FIX: qty negativa rechazada
// ═══════════════════════════════════════════════════════════════════

describe('BUG #5 FIX: qty negativa rechazada', () => {
  beforeEach(() => resetMocks());

  it('rechaza qty negativa', async () => {
    const mockClient = makeMockClient({});
    mockPoolQuery.mockImplementation(async () => ({ rows: [] }));
    (pool.connect as any).mockResolvedValue(mockClient);

    const { RemitosService } = await import('../src/modules/remitos/remitos.service');
    const service = new (RemitosService as any)();
    service.tablesEnsured = true;

    await expect(service.createRemito('comp-1', 'user-1', {
      enterprise_id: 'ent-1',
      items: [{ product_name: 'Pintura', quantity: -5, order_item_id: 'oi-1' }],
    })).rejects.toThrow(/Cantidad invalida|quantity.*invalid|positiva/i);
  });
});

// ═══════════════════════════════════════════════════════════════════
// BUG #6 FIX: qty = 0 rechazada
// ═══════════════════════════════════════════════════════════════════

describe('BUG #6 FIX: qty = 0 rechazada', () => {
  beforeEach(() => resetMocks());

  it('rechaza qty = 0 en vez de convertir a 1', async () => {
    const mockClient = makeMockClient({});
    mockPoolQuery.mockImplementation(async () => ({ rows: [] }));
    (pool.connect as any).mockResolvedValue(mockClient);

    const { RemitosService } = await import('../src/modules/remitos/remitos.service');
    const service = new (RemitosService as any)();
    service.tablesEnsured = true;

    await expect(service.createRemito('comp-1', 'user-1', {
      enterprise_id: 'ent-1',
      items: [{ product_name: 'Pintura', quantity: 0, order_item_id: 'oi-1' }],
    })).rejects.toThrow(/Cantidad invalida|quantity.*invalid|positiva/i);
  });
});

// ═══════════════════════════════════════════════════════════════════
// BUG #7 FIX: Fecha invalida rechazada con 400
// ═══════════════════════════════════════════════════════════════════

describe('BUG #7 FIX: Fecha invalida rechazada', () => {
  beforeEach(() => resetMocks());

  it('rechaza fecha con formato invalido', async () => {
    const mockClient = makeMockClient({});
    mockPoolQuery.mockImplementation(async () => ({ rows: [] }));
    (pool.connect as any).mockResolvedValue(mockClient);

    const { RemitosService } = await import('../src/modules/remitos/remitos.service');
    const service = new (RemitosService as any)();
    service.tablesEnsured = true;

    await expect(service.createRemito('comp-1', 'user-1', {
      enterprise_id: 'ent-1',
      date: 'not-a-date',
      items: [{ product_name: 'Pintura', quantity: 1 }],
    })).rejects.toThrow(/Fecha invalida|date.*invalid/i);
  });
});

// ═══════════════════════════════════════════════════════════════════
// BUG #9 FIX: Campos de texto limite de longitud
// ═══════════════════════════════════════════════════════════════════

describe('BUG #9 FIX: Limite de longitud en campos de texto', () => {
  beforeEach(() => resetMocks());

  it('rechaza delivery_address > 500 chars', async () => {
    const mockClient = makeMockClient({});
    mockPoolQuery.mockImplementation(async () => ({ rows: [] }));
    (pool.connect as any).mockResolvedValue(mockClient);

    const { RemitosService } = await import('../src/modules/remitos/remitos.service');
    const service = new (RemitosService as any)();
    service.tablesEnsured = true;

    await expect(service.createRemito('comp-1', 'user-1', {
      enterprise_id: 'ent-1',
      delivery_address: 'x'.repeat(600),
      items: [{ product_name: 'Pintura', quantity: 1 }],
    })).rejects.toThrow(/direccion.*500|length|longitud/i);
  });

  it('rechaza notes > 2000 chars', async () => {
    const mockClient = makeMockClient({});
    mockPoolQuery.mockImplementation(async () => ({ rows: [] }));
    (pool.connect as any).mockResolvedValue(mockClient);

    const { RemitosService } = await import('../src/modules/remitos/remitos.service');
    const service = new (RemitosService as any)();
    service.tablesEnsured = true;

    await expect(service.createRemito('comp-1', 'user-1', {
      enterprise_id: 'ent-1',
      notes: 'x'.repeat(2500),
      items: [{ product_name: 'Pintura', quantity: 1 }],
    })).rejects.toThrow(/notas.*2000|length|longitud/i);
  });
});

// ═══════════════════════════════════════════════════════════════════
// BUG #4 FIX: sin enterprise_id, se deriva del primer order_item y se valida
// ═══════════════════════════════════════════════════════════════════

describe('BUG #4 FIX: enterprise derivado y validado cuando no se pasa', () => {
  beforeEach(() => resetMocks());

  it('deriva enterprise_id del primer order_item si no se pasa', async () => {
    const mockClient = makeMockClient({
      'FOR UPDATE OF oi': {
        rows: [
          { id: 'oi-1', quantity: 10, qty_delivered: 0, enterprise_id: 'ent-derived', order_id: 'ord-1' },
        ],
      },
    });
    mockPoolQuery.mockImplementation(async () => ({ rows: [] }));
    (pool.connect as any).mockResolvedValue(mockClient);

    const { RemitosService } = await import('../src/modules/remitos/remitos.service');
    const service = new (RemitosService as any)();
    service.tablesEnsured = true;

    // NO pasa enterprise_id
    const result = await service.createRemito('comp-1', 'user-1', {
      items: [{ product_name: 'Pintura', quantity: 3, order_item_id: 'oi-1' }],
    });
    expect(result.id).toBeDefined();
  });

  it('rechaza cuando sin enterprise_id hay items de DISTINTAS empresas', async () => {
    const mockClient = makeMockClient({
      'FOR UPDATE OF oi': {
        rows: [
          { id: 'oi-1', quantity: 10, qty_delivered: 0, enterprise_id: 'ent-A', order_id: 'ord-1' },
          { id: 'oi-2', quantity: 5, qty_delivered: 0, enterprise_id: 'ent-B', order_id: 'ord-2' },
        ],
      },
    });
    mockPoolQuery.mockImplementation(async () => ({ rows: [] }));
    (pool.connect as any).mockResolvedValue(mockClient);

    const { RemitosService } = await import('../src/modules/remitos/remitos.service');
    const service = new (RemitosService as any)();
    service.tablesEnsured = true;

    await expect(service.createRemito('comp-1', 'user-1', {
      // sin enterprise_id
      items: [
        { product_name: 'Pintura', quantity: 3, order_item_id: 'oi-1' },
        { product_name: 'Cemento', quantity: 2, order_item_id: 'oi-2' },
      ],
    })).rejects.toThrow(/distintas empresas|multiple enterprises|pertenece a otra/i);
  });
});
