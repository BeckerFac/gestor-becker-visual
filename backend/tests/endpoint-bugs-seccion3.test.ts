/**
 * SECCION 3 — Items manuales + stock control
 * 12 bugs encontrados, testeados y arreglados
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockPoolQuery, resetMocks } from './helpers/setup';
import { pool } from '../src/config/db';

vi.mock('../src/config/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

function enterpriseOkPoolQuery() {
  return async (sql: string) => {
    if (sql?.includes('SELECT id FROM enterprises')) return { rows: [{ id: 'ent-1' }] };
    return { rows: [] };
  };
}

// ═══════════════════════════════════════════════════════════════════
// BUG #1 FIX: Lock stock row FOR UPDATE
// ═══════════════════════════════════════════════════════════════════

describe('Seccion 3 BUG #1: Stock lock FOR UPDATE', () => {
  beforeEach(() => resetMocks());

  it('hace SELECT FOR UPDATE en stock antes de descontar', async () => {
    const queries: string[] = [];
    const mockClient = {
      query: vi.fn().mockImplementation(async (sql: string) => {
        queries.push(sql);
        if (sql === 'BEGIN' || sql === 'COMMIT') return { rows: [] };
        if (sql.includes('MAX(remito_number)')) return { rows: [{ next_number: 1 }] };
        if (sql.includes('SELECT id, controls_stock FROM products')) return { rows: [{ id: 'prod-1', controls_stock: true }] };
        if (sql.includes('FROM warehouses')) return { rows: [{ id: 'wh-1' }] };
        if (sql.includes('FROM stock WHERE product_id') && sql.includes('FOR UPDATE')) {
          return { rows: [{ quantity: 100 }] };
        }
        return { rows: [] };
      }),
      release: vi.fn(),
    };
    mockPoolQuery.mockImplementation(enterpriseOkPoolQuery());
    (pool.connect as any).mockResolvedValue(mockClient);

    const { RemitosService } = await import('../src/modules/remitos/remitos.service');
    const service = new (RemitosService as any)();
    service.tablesEnsured = true;

    await service.createRemito('comp-1', 'user-1', {
      enterprise_id: 'ent-1',
      items: [{ product_name: 'Pintura', quantity: 5, product_id: 'prod-1' }],
    });

    const lockStock = queries.find(q => q.includes('FROM stock WHERE product_id') && q.includes('FOR UPDATE'));
    expect(lockStock).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════
// BUG #2 FIX: Stock negativo rechazado
// ═══════════════════════════════════════════════════════════════════

describe('Seccion 3 BUG #2: Previene stock negativo', () => {
  beforeEach(() => resetMocks());

  it('rechaza si stock actual < qty solicitada', async () => {
    const mockClient = {
      query: vi.fn().mockImplementation(async (sql: string) => {
        if (sql === 'BEGIN' || sql === 'ROLLBACK') return { rows: [] };
        if (sql.includes('MAX(remito_number)')) return { rows: [{ next_number: 1 }] };
        if (sql.includes('SELECT id, controls_stock FROM products')) return { rows: [{ id: 'prod-1', controls_stock: true }] };
        if (sql.includes('FROM warehouses')) return { rows: [{ id: 'wh-1' }] };
        // Stock actual = 3, pero pido 10
        if (sql.includes('FROM stock WHERE product_id') && sql.includes('FOR UPDATE')) {
          return { rows: [{ quantity: 3 }] };
        }
        return { rows: [] };
      }),
      release: vi.fn(),
    };
    mockPoolQuery.mockImplementation(enterpriseOkPoolQuery());
    (pool.connect as any).mockResolvedValue(mockClient);

    const { RemitosService } = await import('../src/modules/remitos/remitos.service');
    const service = new (RemitosService as any)();
    service.tablesEnsured = true;

    await expect(service.createRemito('comp-1', 'user-1', {
      enterprise_id: 'ent-1',
      items: [{ product_name: 'Pintura', quantity: 10, product_id: 'prod-1' }],
    })).rejects.toThrow(/Stock insuficiente/);
  });
});

// ═══════════════════════════════════════════════════════════════════
// BUG #3+#9 FIX: anularRemito devuelve stock al warehouse ORIGINAL
// ═══════════════════════════════════════════════════════════════════

describe('Seccion 3 BUG #3: anularRemito usa warehouse original', () => {
  beforeEach(() => resetMocks());

  it('consulta warehouse_id del stock_movement original, no el default actual', async () => {
    const queries: Array<{ sql: string; params?: any[] }> = [];
    const mockClient = {
      query: vi.fn().mockImplementation(async (sql: string, params?: any[]) => {
        queries.push({ sql, params });
        if (sql === 'BEGIN' || sql === 'COMMIT') return { rows: [] };
        if (sql.includes('SELECT id, status FROM remitos')) return { rows: [{ id: 'rem-1', status: 'pendiente' }] };
        if (sql.includes('SELECT id, order_item_id, product_id, quantity FROM remito_items')) {
          return { rows: [{ id: 'ri-1', order_item_id: null, product_id: 'prod-1', quantity: 5 }] };
        }
        // Stock movement original tenia warehouse_id = 'wh-ORIGINAL'
        if (sql.includes('SELECT warehouse_id FROM stock_movements')) {
          return { rows: [{ warehouse_id: 'wh-ORIGINAL' }] };
        }
        return { rows: [] };
      }),
      release: vi.fn(),
    };
    mockPoolQuery.mockImplementation(async () => ({ rows: [] }));
    (pool.connect as any).mockResolvedValue(mockClient);

    const { RemitosService } = await import('../src/modules/remitos/remitos.service');
    const service = new (RemitosService as any)();
    service.tablesEnsured = true;

    await service.anularRemito('comp-1', 'rem-1', 'user-1');

    // Verifica que se hizo SELECT warehouse_id FROM stock_movements
    const warehouseQuery = queries.find(q => q.sql.includes('SELECT warehouse_id FROM stock_movements'));
    expect(warehouseQuery).toBeDefined();

    // Verifica que el INSERT entrada usa wh-ORIGINAL (no wh-1 default)
    const insertMov = queries.find(q => q.sql.includes("'return_customer'") && q.params?.includes('wh-ORIGINAL'));
    expect(insertMov).toBeDefined();

    // Verifica que el UPDATE stock usa wh-ORIGINAL
    const updateStock = queries.find(q =>
      q.sql.includes('UPDATE stock SET quantity = COALESCE(quantity, 0) + $1') &&
      q.params?.includes('wh-ORIGINAL')
    );
    expect(updateStock).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════
// BUG #4 FIX: Si no existe row de stock, INSERT en lugar de UPDATE silencioso
// ═══════════════════════════════════════════════════════════════════

describe('Seccion 3 BUG #4: Stock row inexistente', () => {
  beforeEach(() => resetMocks());

  it('rechaza si qty > 0 y no hay stock (stock insuficiente)', async () => {
    const mockClient = {
      query: vi.fn().mockImplementation(async (sql: string) => {
        if (sql === 'BEGIN' || sql === 'ROLLBACK') return { rows: [] };
        if (sql.includes('MAX(remito_number)')) return { rows: [{ next_number: 1 }] };
        if (sql.includes('SELECT id, controls_stock FROM products')) return { rows: [{ id: 'prod-1', controls_stock: true }] };
        if (sql.includes('FROM warehouses')) return { rows: [{ id: 'wh-1' }] };
        // No hay row en stock
        if (sql.includes('FROM stock WHERE product_id') && sql.includes('FOR UPDATE')) {
          return { rows: [] };
        }
        return { rows: [] };
      }),
      release: vi.fn(),
    };
    mockPoolQuery.mockImplementation(enterpriseOkPoolQuery());
    (pool.connect as any).mockResolvedValue(mockClient);

    const { RemitosService } = await import('../src/modules/remitos/remitos.service');
    const service = new (RemitosService as any)();
    service.tablesEnsured = true;

    // qty=5 contra stock=0 (no row) → rechaza
    await expect(service.createRemito('comp-1', 'user-1', {
      enterprise_id: 'ent-1',
      items: [{ product_name: 'Pintura', quantity: 5, product_id: 'prod-1' }],
    })).rejects.toThrow(/Stock insuficiente/);
  });
});

// ═══════════════════════════════════════════════════════════════════
// BUG #5 FIX: Validar que producto EXISTE
// ═══════════════════════════════════════════════════════════════════

describe('Seccion 3 BUG #5: Producto inexistente rechazado', () => {
  beforeEach(() => resetMocks());

  it('rechaza si product_id no existe en la company', async () => {
    const mockClient = {
      query: vi.fn().mockImplementation(async (sql: string) => {
        if (sql === 'BEGIN' || sql === 'ROLLBACK') return { rows: [] };
        if (sql.includes('MAX(remito_number)')) return { rows: [{ next_number: 1 }] };
        // Producto NO existe
        if (sql.includes('SELECT id, controls_stock FROM products')) return { rows: [] };
        return { rows: [] };
      }),
      release: vi.fn(),
    };
    mockPoolQuery.mockImplementation(enterpriseOkPoolQuery());
    (pool.connect as any).mockResolvedValue(mockClient);

    const { RemitosService } = await import('../src/modules/remitos/remitos.service');
    const service = new (RemitosService as any)();
    service.tablesEnsured = true;

    await expect(service.createRemito('comp-1', 'user-1', {
      enterprise_id: 'ent-1',
      items: [{ product_name: 'Fake', quantity: 1, product_id: 'prod-FAKE' }],
    })).rejects.toThrow(/no existe|no pertenece/);
  });
});

// ═══════════════════════════════════════════════════════════════════
// BUG #6 FIX: product_name length limit
// ═══════════════════════════════════════════════════════════════════

describe('Seccion 3 BUG #6: product_name > 255 rechazado', () => {
  beforeEach(() => resetMocks());

  it('rechaza product_name > 255 chars', async () => {
    mockPoolQuery.mockImplementation(enterpriseOkPoolQuery());
    const { RemitosService } = await import('../src/modules/remitos/remitos.service');
    const service = new (RemitosService as any)();
    service.tablesEnsured = true;

    await expect(service.createRemito('comp-1', 'user-1', {
      enterprise_id: 'ent-1',
      items: [{ product_name: 'x'.repeat(300), quantity: 1 }],
    })).rejects.toThrow(/255/);
  });
});

// ═══════════════════════════════════════════════════════════════════
// BUG #7 FIX: controls_stock case sensitivity
// ═══════════════════════════════════════════════════════════════════

describe('Seccion 3 BUG #7: controls_stock boolean/string', () => {
  beforeEach(() => resetMocks());

  it('acepta controls_stock = true (boolean)', async () => {
    const mockClient = {
      query: vi.fn().mockImplementation(async (sql: string) => {
        if (sql === 'BEGIN' || sql === 'COMMIT') return { rows: [] };
        if (sql.includes('MAX(remito_number)')) return { rows: [{ next_number: 1 }] };
        if (sql.includes('SELECT id, controls_stock FROM products')) return { rows: [{ id: 'prod-1', controls_stock: true }] };
        if (sql.includes('FROM warehouses')) return { rows: [{ id: 'wh-1' }] };
        if (sql.includes('FROM stock WHERE product_id')) return { rows: [{ quantity: 100 }] };
        return { rows: [] };
      }),
      release: vi.fn(),
    };
    mockPoolQuery.mockImplementation(enterpriseOkPoolQuery());
    (pool.connect as any).mockResolvedValue(mockClient);

    const { RemitosService } = await import('../src/modules/remitos/remitos.service');
    const service = new (RemitosService as any)();
    service.tablesEnsured = true;

    const result = await service.createRemito('comp-1', 'user-1', {
      enterprise_id: 'ent-1',
      items: [{ product_name: 'P', quantity: 1, product_id: 'prod-1' }],
    });
    expect(result.id).toBeDefined();
  });

  it('acepta controls_stock = "t" (PG string)', async () => {
    const mockClient = {
      query: vi.fn().mockImplementation(async (sql: string) => {
        if (sql === 'BEGIN' || sql === 'COMMIT') return { rows: [] };
        if (sql.includes('MAX(remito_number)')) return { rows: [{ next_number: 1 }] };
        if (sql.includes('SELECT id, controls_stock FROM products')) return { rows: [{ id: 'prod-1', controls_stock: 't' }] };
        if (sql.includes('FROM warehouses')) return { rows: [{ id: 'wh-1' }] };
        if (sql.includes('FROM stock WHERE product_id')) return { rows: [{ quantity: 100 }] };
        return { rows: [] };
      }),
      release: vi.fn(),
    };
    mockPoolQuery.mockImplementation(enterpriseOkPoolQuery());
    (pool.connect as any).mockResolvedValue(mockClient);

    const { RemitosService } = await import('../src/modules/remitos/remitos.service');
    const service = new (RemitosService as any)();
    service.tablesEnsured = true;

    const result = await service.createRemito('comp-1', 'user-1', {
      enterprise_id: 'ent-1',
      items: [{ product_name: 'P', quantity: 1, product_id: 'prod-1' }],
    });
    expect(result.id).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════
// BUG #11 FIX: status 'cancelled' (ingles) tambien filtrado
// ═══════════════════════════════════════════════════════════════════

describe('Seccion 3 BUG #11: status cancelled ingles', () => {
  beforeEach(() => resetMocks());

  it('getAvailableOrderItemsForRemito filtra status cancelled (ingles)', async () => {
    let capturedSql = '';
    mockPoolQuery.mockImplementation(async (sql: string) => {
      capturedSql = sql;
      return { rows: [] };
    });

    const { RemitosService } = await import('../src/modules/remitos/remitos.service');
    const service = new (RemitosService as any)();
    service.tablesEnsured = true;

    await service.getAvailableOrderItemsForRemito('comp-1', 'ord-1');

    // Verifica que el query filtra 'cancelled' (ingles) ademas de 'cancelado'
    expect(capturedSql).toMatch(/cancelado.*cancelled|cancelled.*cancelado/);
  });
});

// ═══════════════════════════════════════════════════════════════════
// BUG #8: Sin stock control, item manual se acepta sin tocar stock
// ═══════════════════════════════════════════════════════════════════

describe('Seccion 3: Item manual sin controls_stock', () => {
  beforeEach(() => resetMocks());

  it('NO descuenta stock si controls_stock = false', async () => {
    const queries: string[] = [];
    const mockClient = {
      query: vi.fn().mockImplementation(async (sql: string) => {
        queries.push(sql);
        if (sql === 'BEGIN' || sql === 'COMMIT') return { rows: [] };
        if (sql.includes('MAX(remito_number)')) return { rows: [{ next_number: 1 }] };
        if (sql.includes('SELECT id, controls_stock FROM products')) return { rows: [{ id: 'prod-1', controls_stock: false }] };
        return { rows: [] };
      }),
      release: vi.fn(),
    };
    mockPoolQuery.mockImplementation(enterpriseOkPoolQuery());
    (pool.connect as any).mockResolvedValue(mockClient);

    const { RemitosService } = await import('../src/modules/remitos/remitos.service');
    const service = new (RemitosService as any)();
    service.tablesEnsured = true;

    const result = await service.createRemito('comp-1', 'user-1', {
      enterprise_id: 'ent-1',
      items: [{ product_name: 'Servicio', quantity: 1, product_id: 'prod-1' }],
    });
    expect(result.id).toBeDefined();

    // NO debe tener stock_movements
    const stockMov = queries.find(q => q.includes('INSERT INTO stock_movements'));
    expect(stockMov).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════
// T3.2: Item manual sin product_id (texto libre)
// ═══════════════════════════════════════════════════════════════════

describe('Seccion 3 T3.2: Item manual texto libre', () => {
  beforeEach(() => resetMocks());

  it('acepta item manual sin product_id', async () => {
    const queries: string[] = [];
    const mockClient = {
      query: vi.fn().mockImplementation(async (sql: string) => {
        queries.push(sql);
        if (sql === 'BEGIN' || sql === 'COMMIT') return { rows: [] };
        if (sql.includes('MAX(remito_number)')) return { rows: [{ next_number: 1 }] };
        return { rows: [] };
      }),
      release: vi.fn(),
    };
    mockPoolQuery.mockImplementation(enterpriseOkPoolQuery());
    (pool.connect as any).mockResolvedValue(mockClient);

    const { RemitosService } = await import('../src/modules/remitos/remitos.service');
    const service = new (RemitosService as any)();
    service.tablesEnsured = true;

    const result = await service.createRemito('comp-1', 'user-1', {
      enterprise_id: 'ent-1',
      items: [{ product_name: 'Muestra gratis', quantity: 1 }],
    });
    expect(result.id).toBeDefined();

    // No consulta productos ni stock
    const prodQuery = queries.find(q => q.includes('SELECT id, controls_stock FROM products'));
    expect(prodQuery).toBeUndefined();
  });
});
