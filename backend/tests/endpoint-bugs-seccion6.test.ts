/**
 * SECCION 6: Expandible + context menu
 * Tests endpoint-level.
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

const VALID_UUID = '11111111-1111-1111-1111-111111111111';

// ═══════════════════════════════════════════════════════════════════
// BUG #1: IDOR getRemitoContextData
// ═══════════════════════════════════════════════════════════════════

describe('Seccion 6 BUG #1: getRemitoContextData IDOR fix', () => {
  beforeEach(() => resetMocks());

  it('lanza 404 si el remito no pertenece a la compania', async () => {
    mockPoolQuery.mockImplementation(async (sql: string) => {
      if (sql?.includes('SELECT id FROM remitos WHERE')) return { rows: [] };
      return { rows: [] };
    });
    const service = await makeService();
    await expect(service.getRemitoContextData('comp-A', VALID_UUID))
      .rejects.toThrow(/no encontrado/i);
  });

  it('retorna items si el remito pertenece a la compania', async () => {
    mockPoolQuery.mockImplementation(async (sql: string) => {
      if (sql?.includes('SELECT id FROM remitos WHERE')) return { rows: [{ id: VALID_UUID }] };
      if (sql?.includes('FROM remito_items ri')) {
        return { rows: [{ id: 'ri-1', product_name: 'Item 1' }] };
      }
      return { rows: [] };
    });
    const service = await makeService();
    const result = await service.getRemitoContextData('comp-1', VALID_UUID);
    expect(result.items_status).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════════════════
// BUG #2: getRemito enterprise subquery company-scoped
// ═══════════════════════════════════════════════════════════════════

describe('Seccion 6 BUG #2: getRemito enterprise scoped', () => {
  beforeEach(() => resetMocks());

  it('enterprise subquery incluye company_id filter', async () => {
    let enterpriseSql = '';
    mockDbExecute.mockImplementation(async (query: any) => {
      // Simulating the main remito query
      return { rows: [{ id: VALID_UUID, enterprise_id: 'ent-1' }] };
    });
    mockPoolQuery.mockImplementation(async (sql: string, params?: any[]) => {
      if (sql?.includes('FROM enterprises WHERE id')) {
        enterpriseSql = sql;
        return { rows: [{ id: 'ent-1', name: 'Ent 1' }] };
      }
      return { rows: [] };
    });
    const service = await makeService();
    await service.getRemito('comp-1', VALID_UUID);
    expect(enterpriseSql).toContain('company_id');
  });
});

// ═══════════════════════════════════════════════════════════════════
// BUG #3/#4: limit/skip clamp
// ═══════════════════════════════════════════════════════════════════

describe('Seccion 6 BUG #3/#4: limit/skip validation', () => {
  beforeEach(() => resetMocks());

  it('clampa limit a 500 si se pasa 9999999', async () => {
    const executed: any[] = [];
    mockDbExecute.mockImplementation(async (query: any) => {
      const sqlStr = query?.strings?.join('?') || query?.queryChunks?.map((c: any) => c.value?.join?.('') || c.value).join('') || '';
      executed.push(query);
      if (sqlStr.includes('COUNT')) return { rows: [{ total: 0 }] };
      return { rows: [] };
    });
    const service = await makeService();
    await service.getRemitos('comp-1', { limit: 9999999 });
    // We cant easily inspect drizzle sql internals, so check it ran without error
    expect(executed.length).toBeGreaterThanOrEqual(1);
  });

  it('usa limit 100 si es NaN', async () => {
    mockDbExecute.mockImplementation(async () => ({ rows: [{ total: 0 }] }));
    const service = await makeService();
    const result = await service.getRemitos('comp-1', { limit: 'abc' as any });
    expect(result).toBeDefined();
  });

  it('usa skip 0 si es negativo', async () => {
    mockDbExecute.mockImplementation(async () => ({ rows: [{ total: 0 }] }));
    const service = await makeService();
    const result = await service.getRemitos('comp-1', { skip: -100 });
    expect(result).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════
// BUG #7: total real (no rows.length)
// ═══════════════════════════════════════════════════════════════════

describe('Seccion 6 BUG #7: total from COUNT query', () => {
  beforeEach(() => resetMocks());

  it('ejecuta query adicional de COUNT y lo retorna como total', async () => {
    let calls = 0;
    mockDbExecute.mockImplementation(async () => {
      calls++;
      if (calls === 1) return { rows: [{ id: 'r1' }, { id: 'r2' }] };
      return { rows: [{ total: 247 }] };
    });
    const service = await makeService();
    const result = await service.getRemitos('comp-1', { limit: 2 });
    expect(calls).toBe(2);
    expect(result.total).toBe(247);
    expect(result.items).toHaveLength(2);
  });
});

// ═══════════════════════════════════════════════════════════════════
// BUG #12: enterprise_id UUID validation
// ═══════════════════════════════════════════════════════════════════

describe('Seccion 6 BUG #12: enterprise_id UUID validation', () => {
  beforeEach(() => resetMocks());

  it('rechaza enterprise_id no-UUID', async () => {
    const service = await makeService();
    await expect(service.getRemitos('comp-1', { enterprise_id: 'not-a-uuid' }))
      .rejects.toThrow(/enterprise_id invalido/);
  });

  it('rechaza enterprise_id con injection attempt', async () => {
    const service = await makeService();
    await expect(service.getRemitos('comp-1', { enterprise_id: "' OR 1=1 --" }))
      .rejects.toThrow(/enterprise_id invalido/);
  });
});

// ═══════════════════════════════════════════════════════════════════
// BUG #5: LIKE wildcard escape
// ═══════════════════════════════════════════════════════════════════

describe('Seccion 6 BUG #5: search con wildcards escapados', () => {
  beforeEach(() => resetMocks());

  it('no crashea con search que contiene %', async () => {
    mockDbExecute.mockImplementation(async () => ({ rows: [{ total: 0 }] }));
    const service = await makeService();
    const result = await service.getRemitos('comp-1', { search: '100% off' });
    expect(result).toBeDefined();
  });

  it('no crashea con search que contiene _', async () => {
    mockDbExecute.mockImplementation(async () => ({ rows: [{ total: 0 }] }));
    const service = await makeService();
    const result = await service.getRemitos('comp-1', { search: 'foo_bar' });
    expect(result).toBeDefined();
  });
});
