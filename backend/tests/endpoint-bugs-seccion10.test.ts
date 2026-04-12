/**
 * SECCION 10: Edge cases
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockPoolQuery, mockDbExecute, resetMocks } from './helpers/setup';
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

function minimalClient() {
  return {
    query: vi.fn().mockImplementation(async (sql: string) => {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
      if (sql.includes('pg_advisory_xact_lock')) return { rows: [] };
      if (sql.includes('MAX(remito_number)')) return { rows: [{ next_number: 1 }] };
      return { rows: [] };
    }),
    release: vi.fn(),
  };
}

// ═══════════════════════════════════════════════════════════════════
// updateRemito es INMUTABLE post-creacion (cambio de diseno 2026-04-12)
// Los remitos no se pueden modificar. Solo cambiar status via
// updateRemitoStatus, o anular via anularRemito.
// ═══════════════════════════════════════════════════════════════════

describe('Seccion 10: updateRemito inmutable', () => {
  beforeEach(() => resetMocks());

  it('rechaza cualquier intento de update (remito pendiente)', async () => {
    const service = await makeService();
    await expect(service.updateRemito('comp-1', 'r1', { notes: 'new' }))
      .rejects.toThrow(/no se pueden modificar una vez creados/);
  });

  it('rechaza update a remito anulado', async () => {
    const service = await makeService();
    await expect(service.updateRemito('comp-1', 'r1', { notes: 'new' }))
      .rejects.toThrow(/no se pueden modificar una vez creados/);
  });

  it('rechaza cualquier cambio de delivery_address', async () => {
    const service = await makeService();
    await expect(service.updateRemito('comp-1', 'r1', { delivery_address: 'otra' }))
      .rejects.toThrow(/no se pueden modificar una vez creados/);
  });
});

// ═══════════════════════════════════════════════════════════════════
// BUG #4: createRemito date range
// ═══════════════════════════════════════════════════════════════════

describe('Seccion 10 BUG #4: createRemito date range', () => {
  beforeEach(() => {
    resetMocks();
    mockPoolQuery.mockImplementation(async (sql: string) => {
      if (sql?.includes('FROM enterprises')) return { rows: [{ id: 'ent-1' }] };
      return { rows: [] };
    });
    (pool.connect as any).mockResolvedValue(minimalClient());
  });

  it('rechaza fecha >1 año en el futuro', async () => {
    const future = new Date(Date.now() + 2 * 365 * 24 * 3600 * 1000).toISOString();
    const service = await makeService();
    await expect(service.createRemito('comp-1', 'user-1', {
      enterprise_id: 'ent-1',
      date: future,
      items: [{ product_name: 'Item', quantity: 1 }],
    })).rejects.toThrow(/futuro/);
  });

  it('rechaza fecha >5 años en el pasado', async () => {
    const past = new Date(Date.now() - 6 * 365 * 24 * 3600 * 1000).toISOString();
    const service = await makeService();
    await expect(service.createRemito('comp-1', 'user-1', {
      enterprise_id: 'ent-1',
      date: past,
      items: [{ product_name: 'Item', quantity: 1 }],
    })).rejects.toThrow(/pasado/);
  });
});

// ═══════════════════════════════════════════════════════════════════
// BUG #5: punto_venta validation
// ═══════════════════════════════════════════════════════════════════

describe('Seccion 10 BUG #5: punto_venta validation', () => {
  beforeEach(() => {
    resetMocks();
    mockPoolQuery.mockImplementation(async (sql: string) => {
      if (sql?.includes('FROM enterprises')) return { rows: [{ id: 'ent-1' }] };
      return { rows: [] };
    });
    (pool.connect as any).mockResolvedValue(minimalClient());
  });

  it('rechaza punto_venta = -1', async () => {
    const service = await makeService();
    await expect(service.createRemito('comp-1', 'user-1', {
      enterprise_id: 'ent-1',
      punto_venta: -1,
      items: [{ product_name: 'Item', quantity: 1 }],
    })).rejects.toThrow(/punto_venta/);
  });

  it('rechaza punto_venta = 99999', async () => {
    const service = await makeService();
    await expect(service.createRemito('comp-1', 'user-1', {
      enterprise_id: 'ent-1',
      punto_venta: 99999,
      items: [{ product_name: 'Item', quantity: 1 }],
    })).rejects.toThrow(/punto_venta/);
  });
});

// ═══════════════════════════════════════════════════════════════════
// BUG #6: tipo whitelist strict
// ═══════════════════════════════════════════════════════════════════

describe('Seccion 10 BUG #6: tipo whitelist estricto', () => {
  beforeEach(() => {
    resetMocks();
    mockPoolQuery.mockImplementation(async (sql: string) => {
      if (sql?.includes('FROM enterprises')) return { rows: [{ id: 'ent-1' }] };
      return { rows: [] };
    });
    (pool.connect as any).mockResolvedValue(minimalClient());
  });

  it('rechaza tipo = "garbage"', async () => {
    const service = await makeService();
    await expect(service.createRemito('comp-1', 'user-1', {
      enterprise_id: 'ent-1',
      tipo: 'garbage',
      items: [{ product_name: 'Item', quantity: 1 }],
    })).rejects.toThrow(/tipo invalido/);
  });

  it('acepta tipo = "recepcion"', async () => {
    const service = await makeService();
    const result = await service.createRemito('comp-1', 'user-1', {
      enterprise_id: 'ent-1',
      tipo: 'recepcion',
      items: [{ product_name: 'Item', quantity: 1 }],
    });
    expect(result.id).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════
// BUG #7/#8: unit_price + vat_rate validation
// ═══════════════════════════════════════════════════════════════════

describe('Seccion 10 BUG #7/#8: unit_price y vat_rate validation', () => {
  beforeEach(() => {
    resetMocks();
    mockPoolQuery.mockImplementation(async (sql: string) => {
      if (sql?.includes('FROM enterprises')) return { rows: [{ id: 'ent-1' }] };
      return { rows: [] };
    });
    (pool.connect as any).mockResolvedValue(minimalClient());
  });

  it('rechaza unit_price negativo', async () => {
    const service = await makeService();
    await expect(service.createRemito('comp-1', 'user-1', {
      enterprise_id: 'ent-1',
      items: [{ product_name: 'X', quantity: 1, unit_price: -100 }],
    })).rejects.toThrow(/Precio unitario invalido/);
  });

  it('rechaza vat_rate > 100', async () => {
    const service = await makeService();
    await expect(service.createRemito('comp-1', 'user-1', {
      enterprise_id: 'ent-1',
      items: [{ product_name: 'X', quantity: 1, vat_rate: 150 }],
    })).rejects.toThrow(/IVA invalido/);
  });

  it('rechaza vat_rate negativo', async () => {
    const service = await makeService();
    await expect(service.createRemito('comp-1', 'user-1', {
      enterprise_id: 'ent-1',
      items: [{ product_name: 'X', quantity: 1, vat_rate: -5 }],
    })).rejects.toThrow(/IVA invalido/);
  });
});

// ═══════════════════════════════════════════════════════════════════
// BUG #10: updateRemitoStatus state machine
// ═══════════════════════════════════════════════════════════════════

describe('Seccion 10 BUG #10: state machine transitions', () => {
  beforeEach(() => resetMocks());

  it('rechaza transicion entregado → pendiente', async () => {
    mockDbExecute.mockImplementation(async () => ({
      rows: [{ id: 'r1', status: 'entregado' }],
    }));
    const service = await makeService();
    await expect(service.updateRemitoStatus('comp-1', 'r1', 'pendiente'))
      .rejects.toThrow(/Transicion invalida/);
  });

  it('rechaza transicion firmado → entregado', async () => {
    mockDbExecute.mockImplementation(async () => ({
      rows: [{ id: 'r1', status: 'firmado' }],
    }));
    const service = await makeService();
    await expect(service.updateRemitoStatus('comp-1', 'r1', 'entregado'))
      .rejects.toThrow(/Transicion invalida/);
  });

  it('acepta transicion pendiente → entregado', async () => {
    mockDbExecute.mockImplementation(async () => ({
      rows: [{ id: 'r1', status: 'pendiente' }],
    }));
    const service = await makeService();
    const result = await service.updateRemitoStatus('comp-1', 'r1', 'entregado');
    expect(result.status).toBe('entregado');
  });

  it('acepta transicion entregado → firmado', async () => {
    mockDbExecute.mockImplementation(async () => ({
      rows: [{ id: 'r1', status: 'entregado' }],
    }));
    const service = await makeService();
    const result = await service.updateRemitoStatus('comp-1', 'r1', 'firmado');
    expect(result.status).toBe('firmado');
  });
});

// ═══════════════════════════════════════════════════════════════════
// BUG #9: getRemitos search length
// ═══════════════════════════════════════════════════════════════════

describe('Seccion 10 BUG #9: search length cap', () => {
  beforeEach(() => {
    resetMocks();
    mockDbExecute.mockImplementation(async () => ({ rows: [{ total: 0 }] }));
  });

  it('acepta search de 1MB sin crashear (cap a 200)', async () => {
    const service = await makeService();
    const result = await service.getRemitos('comp-1', { search: 'A'.repeat(1_000_000) });
    expect(result).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════
// BUG #11: date_from format validation
// ═══════════════════════════════════════════════════════════════════

describe('Seccion 10 BUG #11: date_from format', () => {
  beforeEach(() => {
    resetMocks();
    mockDbExecute.mockImplementation(async () => ({ rows: [] }));
  });

  it('rechaza date_from invalida', async () => {
    const service = await makeService();
    await expect(service.getRemitos('comp-1', { date_from: 'not-a-date' }))
      .rejects.toThrow(/date_from invalido/);
  });
});
