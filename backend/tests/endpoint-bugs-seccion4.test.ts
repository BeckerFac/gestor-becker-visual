/**
 * SECCION 4: Multi-pedido + Enterprise switch
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

// Helper: build transactional client with custom handler
function buildClient(handler: (sql: string, params?: any[]) => any, executed?: Array<{sql: string; params?: any[]}>) {
  return {
    query: vi.fn().mockImplementation(async (sql: string, params?: any[]) => {
      executed?.push({ sql, params });
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
      if (sql.includes('pg_advisory_xact_lock')) return { rows: [] };
      if (sql.includes('MAX(remito_number)')) return { rows: [{ next_number: 1 }] };
      return handler(sql, params) ?? { rows: [] };
    }),
    release: vi.fn(),
  };
}

// ═══════════════════════════════════════════════════════════════════
// BUG S4 #1: Lock no filtra pedidos cancelados
// ═══════════════════════════════════════════════════════════════════

describe('Seccion 4 BUG #1: Pedido cancelado no puede remitir', () => {
  beforeEach(() => resetMocks());

  it('rechaza items de un pedido con status cancelado', async () => {
    const mockClient = buildClient((sql) => {
      if (sql.includes('FOR UPDATE OF oi') && sql.includes("NOT IN ('cancelado', 'cancelled')")) {
        return { rows: [] }; // cancelled order filtered out
      }
      return { rows: [] };
    });
    mockPoolQuery.mockImplementation(async (sql: string) => {
      if (sql?.includes('FROM enterprises')) return { rows: [{ id: 'ent-1' }] };
      return { rows: [] };
    });
    (pool.connect as any).mockResolvedValue(mockClient);

    const service = await makeService();
    await expect(service.createRemito('comp-1', 'user-1', {
      enterprise_id: 'ent-1',
      items: [{ product_name: 'Item', quantity: 5, order_item_id: 'oi-cancelled' }],
    })).rejects.toThrow(/cancelado|no encontrado|otra compania/i);
  });
});

// ═══════════════════════════════════════════════════════════════════
// BUG S4 #2: Enterprise NULL bypass
// ═══════════════════════════════════════════════════════════════════

describe('Seccion 4 BUG #2: Item con enterprise_id NULL rechazado', () => {
  beforeEach(() => resetMocks());

  it('rechaza si locked.enterprise_id es NULL (dirty data)', async () => {
    const mockClient = buildClient((sql) => {
      if (sql.includes('FOR UPDATE OF oi')) {
        return { rows: [{ id: 'oi-1', quantity: 10, qty_delivered: 0, enterprise_id: null, order_id: 'ord-1' }] };
      }
      return { rows: [] };
    });
    mockPoolQuery.mockImplementation(async (sql: string) => {
      if (sql?.includes('FROM enterprises')) return { rows: [{ id: 'ent-1' }] };
      return { rows: [] };
    });
    (pool.connect as any).mockResolvedValue(mockClient);

    const service = await makeService();
    await expect(service.createRemito('comp-1', 'user-1', {
      enterprise_id: 'ent-1',
      items: [{ product_name: 'Item', quantity: 3, order_item_id: 'oi-1' }],
    })).rejects.toThrow(/no tiene empresa asignada|Pedido invalido/);
  });
});

// ═══════════════════════════════════════════════════════════════════
// BUG S4 #3: IDOR en getAvailableByEnterprise
// ═══════════════════════════════════════════════════════════════════

describe('Seccion 4 BUG #3: IDOR cross-company en availability', () => {
  beforeEach(() => resetMocks());

  it('rechaza enterprise_id de otra company', async () => {
    mockPoolQuery.mockImplementation(async (sql: string) => {
      if (sql?.includes('SELECT id FROM enterprises WHERE id') && sql.includes('company_id')) {
        return { rows: [] }; // not found in this company
      }
      return { rows: [] };
    });

    const service = await makeService();
    await expect(
      service.getAvailableOrderItemsForRemitoByEnterprise('comp-A', 'ent-from-comp-B')
    ).rejects.toThrow(/no pertenece a tu compania|no encontrada/i);
  });

  it('retorna items si enterprise pertenece a company', async () => {
    mockPoolQuery.mockImplementation(async (sql: string) => {
      if (sql?.includes('SELECT id FROM enterprises WHERE id') && sql.includes('company_id')) {
        return { rows: [{ id: 'ent-1' }] };
      }
      if (sql?.includes('FROM order_items oi')) return { rows: [{ order_item_id: 'oi-1', qty_available: 5 }] };
      return { rows: [] };
    });

    const service = await makeService();
    const result = await service.getAvailableOrderItemsForRemitoByEnterprise('comp-1', 'ent-1');
    expect(result).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════════════════
// BUG S4 #4: Legacy order_id cross-enterprise
// ═══════════════════════════════════════════════════════════════════

describe('Seccion 4 BUG #4: Legacy order_id cross-enterprise rechazado', () => {
  beforeEach(() => resetMocks());

  it('rechaza data.order_id de otra empresa', async () => {
    const mockClient = buildClient((sql, params) => {
      if (sql.includes('INSERT INTO remitos')) return { rows: [] };
      if (sql.includes('INSERT INTO remito_items')) return { rows: [] };
      if (sql.includes('SELECT id, enterprise_id, status FROM orders')) {
        return { rows: [{ id: 'ord-other', enterprise_id: 'ent-OTHER', status: 'pendiente' }] };
      }
      return { rows: [] };
    });
    mockPoolQuery.mockImplementation(async (sql: string) => {
      if (sql?.includes('FROM enterprises')) return { rows: [{ id: 'ent-1' }] };
      return { rows: [] };
    });
    (pool.connect as any).mockResolvedValue(mockClient);

    const service = await makeService();
    await expect(service.createRemito('comp-1', 'user-1', {
      enterprise_id: 'ent-1',
      order_id: 'ord-other',
      items: [{ product_name: 'Manual', quantity: 1 }],
    })).rejects.toThrow(/otra empresa|pertenece/i);
  });

  it('rechaza data.order_id de pedido cancelado', async () => {
    const mockClient = buildClient((sql) => {
      if (sql.includes('INSERT INTO remitos')) return { rows: [] };
      if (sql.includes('INSERT INTO remito_items')) return { rows: [] };
      if (sql.includes('SELECT id, enterprise_id, status FROM orders')) {
        return { rows: [{ id: 'ord-x', enterprise_id: 'ent-1', status: 'cancelado' }] };
      }
      return { rows: [] };
    });
    mockPoolQuery.mockImplementation(async (sql: string) => {
      if (sql?.includes('FROM enterprises')) return { rows: [{ id: 'ent-1' }] };
      return { rows: [] };
    });
    (pool.connect as any).mockResolvedValue(mockClient);

    const service = await makeService();
    await expect(service.createRemito('comp-1', 'user-1', {
      enterprise_id: 'ent-1',
      order_id: 'ord-x',
      items: [{ product_name: 'Manual', quantity: 1 }],
    })).rejects.toThrow(/cancelado/);
  });
});

// ═══════════════════════════════════════════════════════════════════
// T4.1: Remito con items de 2 pedidos de la MISMA empresa
// ═══════════════════════════════════════════════════════════════════

describe('Seccion 4 T4.1: Multi-pedido misma empresa', () => {
  beforeEach(() => resetMocks());

  it('crea remito con items de 2 pedidos distintos de la misma empresa', async () => {
    const executed: Array<{sql: string; params?: any[]}> = [];
    const mockClient = buildClient((sql) => {
      if (sql.includes('FOR UPDATE OF oi')) {
        return { rows: [
          { id: 'oi-1', quantity: 10, qty_delivered: 0, enterprise_id: 'ent-1', order_id: 'ord-A' },
          { id: 'oi-2', quantity: 5, qty_delivered: 0, enterprise_id: 'ent-1', order_id: 'ord-B' },
        ]};
      }
      return { rows: [] };
    }, executed);
    mockPoolQuery.mockImplementation(async (sql: string) => {
      if (sql?.includes('FROM enterprises')) return { rows: [{ id: 'ent-1' }] };
      return { rows: [] };
    });
    (pool.connect as any).mockResolvedValue(mockClient);

    const service = await makeService();
    await service.createRemito('comp-1', 'user-1', {
      enterprise_id: 'ent-1',
      items: [
        { product_name: 'A', quantity: 3, order_item_id: 'oi-1' },
        { product_name: 'B', quantity: 2, order_item_id: 'oi-2' },
      ],
    });

    const remitoOrders = executed.filter(q => q.sql.includes('INSERT INTO remito_orders'));
    expect(remitoOrders).toHaveLength(2);
    const orderIds = remitoOrders.map(q => q.params?.[1]).sort();
    expect(orderIds).toEqual(['ord-A', 'ord-B']);
  });

  it('rechaza items de 2 pedidos de distintas empresas', async () => {
    const mockClient = buildClient((sql) => {
      if (sql.includes('FOR UPDATE OF oi')) {
        return { rows: [
          { id: 'oi-1', quantity: 10, qty_delivered: 0, enterprise_id: 'ent-1', order_id: 'ord-A' },
          { id: 'oi-2', quantity: 5, qty_delivered: 0, enterprise_id: 'ent-2', order_id: 'ord-B' },
        ]};
      }
      return { rows: [] };
    });
    mockPoolQuery.mockImplementation(async (sql: string) => {
      if (sql?.includes('FROM enterprises')) return { rows: [{ id: 'ent-1' }] };
      return { rows: [] };
    });
    (pool.connect as any).mockResolvedValue(mockClient);

    const service = await makeService();
    await expect(service.createRemito('comp-1', 'user-1', {
      enterprise_id: 'ent-1',
      items: [
        { product_name: 'A', quantity: 3, order_item_id: 'oi-1' },
        { product_name: 'B', quantity: 2, order_item_id: 'oi-2' },
      ],
    })).rejects.toThrow(/distintas empresas/);
  });
});

// ═══════════════════════════════════════════════════════════════════
// T4.4: Mixto (pedido + manual)
// ═══════════════════════════════════════════════════════════════════

describe('Seccion 4 T4.4: Remito mixto pedido + manual', () => {
  beforeEach(() => resetMocks());

  it('crea remito con item de pedido + item manual sin stock control', async () => {
    const executed: Array<{sql: string; params?: any[]}> = [];
    const mockClient = buildClient((sql) => {
      if (sql.includes('FOR UPDATE OF oi')) {
        return { rows: [{ id: 'oi-1', quantity: 10, qty_delivered: 0, enterprise_id: 'ent-1', order_id: 'ord-A' }] };
      }
      return { rows: [] };
    }, executed);
    mockPoolQuery.mockImplementation(async (sql: string) => {
      if (sql?.includes('FROM enterprises')) return { rows: [{ id: 'ent-1' }] };
      return { rows: [] };
    });
    (pool.connect as any).mockResolvedValue(mockClient);

    const service = await makeService();
    const result = await service.createRemito('comp-1', 'user-1', {
      enterprise_id: 'ent-1',
      items: [
        { product_name: 'De pedido', quantity: 2, order_item_id: 'oi-1' },
        { product_name: 'Manual extra', quantity: 1 },
      ],
    });
    expect(result.id).toBeDefined();

    const inserts = executed.filter(q => q.sql.includes('INSERT INTO remito_items'));
    expect(inserts).toHaveLength(2);
  });
});
