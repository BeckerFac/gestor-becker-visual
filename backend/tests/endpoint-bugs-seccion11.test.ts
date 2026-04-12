/**
 * SECCION 11: Bug sistemico cancelled EN-only cross-module
 * Verifica que todas las queries filtren 'cancelled' Y 'cancelado'.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const BACKEND_MODULES = join(__dirname, '../src/modules');

const MODULES_TO_CHECK = [
  'orders/orders.service.ts',
  'invoices/invoices.service.ts',
  'crm/crm.service.ts',
  'purchases/purchases.service.ts',
  'purchase-invoices/purchase-invoices.service.ts',
  'cuenta-corriente/cuenta-corriente.service.ts',
  'cobros/cobros.service.ts',
  'cobro-applications/cobro-applications.service.ts',
  'pagos/pagos.service.ts',
  'pago-applications/pago-applications.service.ts',
  'collections/collections.service.ts',
  'reports/reports.service.ts',
  'secretaria/secretaria.v3.ts',
  'remitos/remitos.service.ts',
];

describe('Seccion 11: No quedan filtros solo en ingles (cancelled)', () => {
  for (const relPath of MODULES_TO_CHECK) {
    it(`${relPath} no contiene "status != 'cancelled'" aislado`, () => {
      const content = readFileSync(join(BACKEND_MODULES, relPath), 'utf-8');
      // Must NOT contain the EN-only pattern
      expect(content).not.toMatch(/status\s*!==?\s*'cancelled'/);
      expect(content).not.toMatch(/status\s*!=\s*'cancelled'/);
    });
  }
});

describe('Seccion 11: Filtros de cancelacion son bilingues (EN+ES)', () => {
  it('orders.service usa NOT IN con ambos idiomas', () => {
    const content = readFileSync(join(BACKEND_MODULES, 'orders/orders.service.ts'), 'utf-8');
    const matches = content.match(/NOT IN \('cancelled', 'cancelado'\)/g);
    expect(matches).toBeDefined();
    expect(matches!.length).toBeGreaterThanOrEqual(7);
  });

  it('cuenta-corriente.service usa NOT IN con ambos idiomas', () => {
    const content = readFileSync(join(BACKEND_MODULES, 'cuenta-corriente/cuenta-corriente.service.ts'), 'utf-8');
    const matches = content.match(/NOT IN \('cancelled', 'cancelado'\)/g);
    expect(matches).toBeDefined();
    expect(matches!.length).toBeGreaterThanOrEqual(5);
  });

  it('reports.service usa NOT IN con ambos idiomas', () => {
    const content = readFileSync(join(BACKEND_MODULES, 'reports/reports.service.ts'), 'utf-8');
    const matches = content.match(/NOT IN \('cancelled', 'cancelado'\)/g);
    expect(matches).toBeDefined();
    expect(matches!.length).toBeGreaterThanOrEqual(3);
  });

  it('invoices.service CTE item_invoiced filtra ambos', () => {
    const content = readFileSync(join(BACKEND_MODULES, 'invoices/invoices.service.ts'), 'utf-8');
    expect(content).toContain("NOT IN ('cancelled', 'cancelado')");
  });

  it('cobro-applications usa filtro bilingue', () => {
    const content = readFileSync(join(BACKEND_MODULES, 'cobro-applications/cobro-applications.service.ts'), 'utf-8');
    const matches = content.match(/NOT IN \('cancelled', 'cancelado'\)/g);
    expect(matches!.length).toBeGreaterThanOrEqual(3);
  });
});

describe('Seccion 11: Frontend Remitos filtra cancelado ES', () => {
  it('Remitos.tsx filtra invoices con cancelled O cancelado', () => {
    const content = readFileSync(
      join(__dirname, '../../frontend/src/pages/Remitos.tsx'),
      'utf-8'
    );
    expect(content).toContain("['cancelled', 'cancelado']");
  });
});
