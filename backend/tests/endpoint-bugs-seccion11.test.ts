/**
 * SECCION 11: Cancelled filter per-column-type
 *
 * IMPORTANTE - Descubierto en deploy a produccion:
 * - `invoices.status` es un Postgres ENUM con valores
 *   ['draft', 'pending', 'authorized', 'cancelled'] — SOLO INGLES.
 *   NOT IN ('cancelled','cancelado') rompe el cast del enum.
 * - `purchase_invoices.status` es VARCHAR(20) — ACEPTA ambos idiomas.
 * - `orders.status`, `remitos.status`, `purchases.status` son VARCHAR —
 *   aceptan bilingue.
 *
 * Por lo tanto, este test verifica:
 * 1. invoices (aliases i, inv) usa solo `!= 'cancelled'`
 * 2. purchase_invoices (aliases pi, pinv) usa NOT IN bilingue
 * 3. No queda ningun NOT IN aplicado a invoices ENUM
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const BACKEND_MODULES = join(__dirname, '../src/modules');

const FILES_WITH_INVOICE_STATUS = [
  'orders/orders.service.ts',
  'invoices/invoices.service.ts',
  'crm/crm.service.ts',
  'cuenta-corriente/cuenta-corriente.service.ts',
  'cobros/cobros.service.ts',
  'cobro-applications/cobro-applications.service.ts',
  'collections/collections.service.ts',
  'reports/reports.service.ts',
  'secretaria/secretaria.v3.ts',
  'remitos/remitos.service.ts',
];

describe('Seccion 11: invoices ENUM status usa solo ingles', () => {
  for (const relPath of FILES_WITH_INVOICE_STATUS) {
    it(`${relPath}: i.status / inv.status NO usa NOT IN bilingue (rompe enum)`, () => {
      const content = readFileSync(join(BACKEND_MODULES, relPath), 'utf-8');
      // These patterns would break the invoice_status enum cast in production
      expect(content).not.toMatch(/\bi\.status NOT IN \('cancelled', 'cancelado'\)/);
      expect(content).not.toMatch(/\binv\.status NOT IN \('cancelled', 'cancelado'\)/);
    });
  }
});

describe('Seccion 11: purchase_invoices VARCHAR status usa bilingue', () => {
  it('purchases.service: pinv.status usa NOT IN bilingue', () => {
    const content = readFileSync(join(BACKEND_MODULES, 'purchases/purchases.service.ts'), 'utf-8');
    const matches = content.match(/pinv\.status NOT IN \('cancelled', 'cancelado'\)/g);
    expect(matches).toBeDefined();
    expect(matches!.length).toBeGreaterThanOrEqual(3);
  });

  it('purchase-invoices.service: pinv.status usa NOT IN bilingue', () => {
    const content = readFileSync(join(BACKEND_MODULES, 'purchase-invoices/purchase-invoices.service.ts'), 'utf-8');
    expect(content).toContain("NOT IN ('cancelled', 'cancelado')");
  });

  it('cuenta-corriente.service: pi.status (purchase_invoices) usa NOT IN bilingue', () => {
    const content = readFileSync(join(BACKEND_MODULES, 'cuenta-corriente/cuenta-corriente.service.ts'), 'utf-8');
    const matches = content.match(/pi\.status NOT IN \('cancelled', 'cancelado'\)/g);
    expect(matches).toBeDefined();
    expect(matches!.length).toBeGreaterThanOrEqual(2);
  });

  it('pago-applications: pi.status usa NOT IN bilingue', () => {
    const content = readFileSync(join(BACKEND_MODULES, 'pago-applications/pago-applications.service.ts'), 'utf-8');
    expect(content).toContain("pi.status NOT IN ('cancelled', 'cancelado')");
  });
});

describe('Seccion 11: remitos lock filtra orders cancelados bilingue', () => {
  it('remitos.service: FOR UPDATE lock excluye cancelados EN+ES', () => {
    const content = readFileSync(join(BACKEND_MODULES, 'remitos/remitos.service.ts'), 'utf-8');
    expect(content).toMatch(/o\.status NOT IN \('cancelado', 'cancelled'\)/);
  });
});

describe('Seccion 11: Frontend Remitos filtra cancelado ES + cancelled EN', () => {
  it('Remitos.tsx filtra invoices con ambos idiomas', () => {
    const content = readFileSync(
      join(__dirname, '../../frontend/src/pages/Remitos.tsx'),
      'utf-8'
    );
    expect(content).toContain("['cancelled', 'cancelado']");
  });
});
