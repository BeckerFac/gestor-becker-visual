# Full QA, Bug Fixes & Security Hardening Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all critical bugs (orders not showing, cobros crash), harden the codebase with safety guards so regressions cannot recur, normalize visual inconsistencies, and establish a testing baseline that validates the full app.

**Architecture:** Three-phase approach: (1) P0 critical fixes that restore broken functionality, (2) safety infrastructure that prevents future regressions (pre-deploy checks, defensive queries, transactions), (3) systematic QA pass across all 19 pages normalizing visuals, fixing UX issues, and validating every interactive element.

**Tech Stack:** TypeScript, React, Express, PostgreSQL (Drizzle ORM), Vitest (backend), Vite, Docker/Render

---

## Chunk 1: P0 Critical Fixes (Data Visibility)

These fixes restore broken functionality. Must be deployed BEFORE any other work.

### Task 1: Fix Orders query crashing on cobros JOIN

The `getOrders()` query fails because `LEFT JOIN cobros cb ON o.cobro_id = cb.id` crashes if the cobros table migration hasn't run yet when orders loads first. This hides ALL orders from the user.

**Files:**
- Modify: `backend/src/modules/orders/orders.service.ts:61-84`

**Root cause:** The query assumes the `cobros` table exists. If the cobros module hasn't been called yet (its `ensureMigrations()` hasn't fired), the table may not exist.

- [ ] **Step 1: Make the orders query defensive against missing cobros table**

Wrap the cobros JOIN in a subquery that won't crash if the table doesn't exist. Simpler fix: ensure cobros table creation runs from orders service too.

In `backend/src/modules/orders/orders.service.ts`, add to `ensureMigrations()` after line 17:

```typescript
// Ensure cobros table exists before we JOIN on it
await db.execute(sql`
  CREATE TABLE IF NOT EXISTS cobros (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL,
    enterprise_id UUID,
    customer_id UUID,
    order_id UUID,
    invoice_id UUID,
    amount DECIMAL(12,2) NOT NULL,
    payment_method VARCHAR(50),
    payment_date TIMESTAMP WITH TIME ZONE,
    reference VARCHAR(255),
    notes TEXT,
    receipt_image TEXT,
    created_by UUID,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
  )
`).catch(() => {});
```

- [ ] **Step 2: Also ensure quotes table exists for the JOIN**

Add after the cobros creation:

```typescript
// Ensure quotes table exists before we JOIN on it
await db.execute(sql`
  CREATE TABLE IF NOT EXISTS quotes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL,
    customer_id UUID,
    enterprise_id UUID,
    quote_number INTEGER,
    title VARCHAR(255),
    valid_until TIMESTAMP WITH TIME ZONE,
    subtotal DECIMAL(12,2) DEFAULT 0,
    vat_amount DECIMAL(12,2) DEFAULT 0,
    total_amount DECIMAL(12,2) DEFAULT 0,
    status VARCHAR(50) DEFAULT 'draft',
    notes TEXT,
    created_by UUID,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
  )
`).catch(() => {});
```

- [ ] **Step 3: Run `tsc --noEmit` on backend**

Run: `cd backend && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add backend/src/modules/orders/orders.service.ts
git commit -m "fix(critical): ensure cobros/quotes tables exist before orders query JOINs"
```

---

### Task 2: Fix Cobros page "Failed to get orders" error

The Cobros page calls `api.getOrders()` to load orders for the receipt form. This fails because of the same orders query crash above. But additionally, it should handle the error gracefully.

**Files:**
- Modify: `frontend/src/pages/Cobros.tsx:154`

- [ ] **Step 1: Add defensive catch for getOrders in Cobros**

In `Cobros.tsx`, find the `loadData` function. Wrap the `getOrders()` call:

```typescript
// Change from:
ordersRes = await api.getOrders()
// To:
ordersRes = await api.getOrders().catch(() => ({ items: [] }))
```

- [ ] **Step 2: Run `npx tsc --noEmit` from frontend**

Run: `cd frontend && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/Cobros.tsx
git commit -m "fix: handle getOrders failure gracefully in Cobros page"
```

---

### Task 3: Push P0 fixes and verify deploy

- [ ] **Step 1: Full build verification**

```bash
cd frontend && npx tsc && npx vite build
cd ../backend && npx tsc --noEmit
```

- [ ] **Step 2: Push**

```bash
git push origin master
```

- [ ] **Step 3: Monitor Render deploy logs for success**

Wait for Render to show "Live" status. Verify `/orders` page shows data.

---

## Chunk 2: Safety Infrastructure

Rules and guards that prevent future regressions. Every change after this MUST pass these checks.

### Task 4: Create pre-push validation script

A single script that runs ALL checks that Render will run. If this passes locally, the deploy WILL succeed.

**Files:**
- Create: `scripts/validate.sh`

- [ ] **Step 1: Create validation script**

```bash
#!/bin/bash
set -e
echo "=== FRONTEND TYPE CHECK ==="
cd frontend && npx tsc --noEmit
echo "=== FRONTEND BUILD ==="
npx vite build
echo "=== BACKEND TYPE CHECK ==="
cd ../backend && npx tsc --noEmit
echo ""
echo "ALL CHECKS PASSED"
```

- [ ] **Step 2: Make executable and test**

```bash
chmod +x scripts/validate.sh
./scripts/validate.sh
```

- [ ] **Step 3: Commit**

```bash
git add scripts/validate.sh
git commit -m "chore: add pre-push validation script (tsc + build)"
```

---

### Task 5: Add database transaction wrapper for receipts

Receipt creation currently has no transaction. A partial failure leaves orphaned data.

**Files:**
- Modify: `backend/src/modules/receipts/receipts.service.ts:75-137`

- [ ] **Step 1: Wrap createReceipt in a transaction**

Replace the current `createReceipt` method body to use `db.transaction()`:

```typescript
async createReceipt(companyId: string, userId: string, data: any) {
  await this.ensureMigrations();
  try {
    const { items, payment_method, receipt_date, notes } = data;
    if (!items || !Array.isArray(items) || items.length === 0) {
      throw new ApiError(400, 'Se requiere al menos un item');
    }

    const totalAmount = items.reduce((sum: number, it: any) => sum + (parseFloat(it.amount) || 0), 0);
    if (totalAmount <= 0) throw new ApiError(400, 'El monto total debe ser mayor a 0');

    // Get next receipt number
    const numResult = await db.execute(sql`
      SELECT COALESCE(MAX(receipt_number), 0) + 1 as next_num FROM receipts WHERE company_id = ${companyId}
    `);
    const numRows = (numResult as any).rows || numResult || [];
    const receiptNumber = parseInt(numRows[0]?.next_num || '1');

    const receiptId = uuid();

    // Use raw SQL transaction
    await db.execute(sql`BEGIN`);
    try {
      await db.execute(sql`
        INSERT INTO receipts (id, company_id, receipt_number, receipt_date, total_amount, payment_method, notes, created_by, created_at)
        VALUES (${receiptId}, ${companyId}, ${receiptNumber}, ${receipt_date || new Date().toISOString()}, ${totalAmount.toFixed(2)}, ${payment_method || null}, ${notes || null}, ${userId}, NOW())
      `);

      for (const item of items) {
        const itemId = uuid();
        await db.execute(sql`
          INSERT INTO receipt_items (id, receipt_id, invoice_id, amount, created_at)
          VALUES (${itemId}, ${receiptId}, ${item.invoice_id}, ${parseFloat(item.amount).toFixed(2)}, NOW())
        `);

        // Get invoice info for cobro
        const invResult = await db.execute(sql`SELECT enterprise_id, order_id FROM invoices WHERE id = ${item.invoice_id}`);
        const invRows = (invResult as any).rows || invResult || [];
        const inv = invRows[0] || {};

        await db.execute(sql`
          INSERT INTO cobros (id, company_id, enterprise_id, order_id, invoice_id, amount, payment_method, payment_date, reference, notes, created_by, created_at)
          VALUES (${uuid()}, ${companyId}, ${inv.enterprise_id || null}, ${inv.order_id || null}, ${item.invoice_id}, ${parseFloat(item.amount).toFixed(2)}, ${payment_method || null}, ${receipt_date || new Date().toISOString()}, ${'Recibo #' + receiptNumber}, ${notes || null}, ${userId}, NOW())
        `);
      }

      await db.execute(sql`COMMIT`);
    } catch (innerError) {
      await db.execute(sql`ROLLBACK`);
      throw innerError;
    }

    return { id: receiptId, receipt_number: receiptNumber, total_amount: totalAmount };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    console.error('Create receipt error:', error);
    throw new ApiError(500, 'Failed to create receipt');
  }
}
```

- [ ] **Step 2: Run backend type check**

```bash
cd backend && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/modules/receipts/receipts.service.ts
git commit -m "fix: wrap receipt creation in database transaction for atomicity"
```

---

### Task 6: Add defensive API response handling pattern

Create a utility that safely unwraps API responses, preventing `t.find is not a function` type crashes.

**Files:**
- Create: `frontend/src/lib/api-helpers.ts`

- [ ] **Step 1: Create helper**

```typescript
/** Safely extract an array from an API response */
export function safeArray<T = any>(data: any, key?: string): T[] {
  if (key && data && typeof data === 'object' && Array.isArray(data[key])) {
    return data[key]
  }
  if (Array.isArray(data)) return data
  if (data && typeof data === 'object' && Array.isArray(data.items)) return data.items
  return []
}

/** Safely extract a number */
export function safeNumber(val: any, fallback = 0): number {
  const n = parseFloat(val)
  return isFinite(n) ? n : fallback
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/lib/api-helpers.ts
git commit -m "chore: add defensive API response helpers (safeArray, safeNumber)"
```

---

### Task 7: Fix production timer memory leak

The Orders page production timer uses `setInterval` that may not clean up properly.

**Files:**
- Modify: `frontend/src/pages/Orders.tsx` (timer section)

- [ ] **Step 1: Find and fix the timer**

Search for `setInterval` in Orders.tsx. Ensure it has a proper cleanup in a `useEffect` return function:

```typescript
useEffect(() => {
  const interval = setInterval(() => {
    setTimerTick(t => t + 1)
  }, 60000)
  return () => clearInterval(interval)
}, [])
```

If the interval is inside a component without cleanup, wrap it in a `useEffect` with proper cleanup.

- [ ] **Step 2: Run tsc**

```bash
cd frontend && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/Orders.tsx
git commit -m "fix: clean up production timer interval to prevent memory leak"
```

---

### Task 8: Optimize enterprise price list linking

Currently `linkEnterpriseToPriceList` is called on every enterprise edit regardless of changes.

**Files:**
- Modify: `frontend/src/pages/Enterprises.tsx` (handleEnterpriseSubmit)

- [ ] **Step 1: Only call linkEnterpriseToPriceList when the value actually changed**

Store the original `price_list_id` when editing starts. Compare on save:

```typescript
// In handleEditEnterprise, store original:
const originalPriceListId = (ent as any).price_list_id || ''

// In handleEnterpriseSubmit, only call if changed:
if (editingEnterpriseId && price_list_id !== originalPriceListId) {
  await api.linkEnterpriseToPriceList(editingEnterpriseId, price_list_id || '').catch(() => {})
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/pages/Enterprises.tsx
git commit -m "perf: only update enterprise price list when actually changed"
```

---

## Chunk 3: Visual Normalization & UX Consistency

Systematic pass across all 19 pages to normalize patterns.

### Task 9: Normalize status badge colors to single source of truth

Multiple pages define their own status color maps instead of using `StatusBadge`.

**Files:**
- Modify: `frontend/src/components/ui/StatusBadge.tsx` (add all statuses)
- Modify: `frontend/src/pages/Cheques.tsx` (use StatusBadge)
- Modify: `frontend/src/pages/Remitos.tsx` (use StatusBadge)

- [ ] **Step 1: Extend StatusBadge with all status types from all pages**

Add to `defaultStatusColors` in StatusBadge.tsx:
```typescript
// Cheques
a_cobrar: 'yellow',
endosado: 'blue',
depositado: 'purple',
cobrado: 'green',
rechazado: 'red',
// Quotes
draft: 'gray',
sent: 'blue',
accepted: 'green',
rejected: 'red',
expired: 'yellow',
// Invoices
authorized: 'green',
emitido: 'green',
cancelled: 'red',
// Payments
pagado: 'green',
pago_parcial: 'orange',
no_pagado: 'red',
```

- [ ] **Step 2: Replace inline color maps in Cheques.tsx and Remitos.tsx with StatusBadge**

- [ ] **Step 3: Run full build**

```bash
cd frontend && npx tsc && npx vite build
```

- [ ] **Step 4: Commit**

```bash
git commit -m "refactor: normalize all status badges to single StatusBadge component"
```

---

### Task 10: Normalize date and currency formatting

Some pages use inline formatting instead of centralized `formatDate`/`formatCurrency`.

**Files:**
- Modify: `frontend/src/pages/Cobros.tsx` (inline date/currency)
- Modify: `frontend/src/pages/CuentaCorriente.tsx` (inline formatting)

- [ ] **Step 1: Replace all inline formatting**

Search for `toLocaleDateString` and `toLocaleString` across all page files. Replace with `formatDate()` and `formatCurrency()` from `@/lib/utils`.

- [ ] **Step 2: Run full build**

- [ ] **Step 3: Commit**

```bash
git commit -m "refactor: normalize date/currency formatting to centralized utils"
```

---

### Task 11: Normalize EmptyState component usage

Two EmptyState components exist: `ui/EmptyState` and `shared/EmptyState`. Consolidate.

**Files:**
- Audit: all pages importing EmptyState
- Modify: pages using wrong import

- [ ] **Step 1: Check which EmptyState has more features**

Read both files. Keep the more feature-rich one, update imports in all pages to use it.

- [ ] **Step 2: Remove the duplicate**

- [ ] **Step 3: Commit**

```bash
git commit -m "refactor: consolidate duplicate EmptyState components"
```

---

### Task 12: Add missing CSV export to pages that lack it

**Pages missing CSV export:** Inventory, Users, Customers, CuentaCorriente

**Files:**
- Modify: `frontend/src/pages/Inventory.tsx`
- Modify: `frontend/src/pages/Users.tsx`
- Modify: `frontend/src/pages/Customers.tsx`

- [ ] **Step 1: Add ExportCSVButton to each page**

Follow the pattern used in Products.tsx:
```typescript
import { ExportCSVButton } from '@/components/shared/ExportCSV'

<ExportCSVButton
  data={filteredData.map(item => ({ /* mapped fields */ }))}
  columns={[{ key: 'field', label: 'Label' }]}
  filename="export-name"
/>
```

- [ ] **Step 2: Run full build**

- [ ] **Step 3: Commit**

```bash
git commit -m "feat: add CSV export to Inventory, Users, and Customers pages"
```

---

### Task 13: Verify Dashboard period selector works with data

The period selector code is correctly implemented. The issue may be that there's no data in the selected period ranges.

**Files:**
- Modify: `frontend/src/pages/Dashboard.tsx` (add visual feedback)

- [ ] **Step 1: Add period label to summary cards**

Show which period is selected in the card titles. Change "Facturado este Mes" to dynamically reflect the selected period:

```typescript
const periodLabel = period === 'today' ? 'Hoy' : period === 'week' ? 'esta Semana' : period === 'month' ? 'este Mes' : period === '3months' ? 'ultimos 3 Meses' : period === 'year' ? 'este Ano' : 'Total'
```

Use `periodLabel` in the card titles so it's clear the filter is working even when values are $0.

- [ ] **Step 2: Commit**

```bash
git commit -m "fix: dashboard shows active period in card titles for clarity"
```

---

## Chunk 4: Full User Journey Validation

Systematic verification of every interactive element. Each task covers one page.

### Task 14: Validate Empresas page

**Verify:**
- [ ] Create enterprise with all new fields (razon_social, postal_code, fiscal address)
- [ ] Toggle "Igual a direccion de empresa" checkbox
- [ ] Link enterprise to price list
- [ ] Edit enterprise - verify all fields load correctly
- [ ] Add contact to enterprise
- [ ] Edit contact
- [ ] Generate portal access code
- [ ] Delete contact
- [ ] Delete enterprise
- [ ] Tag management (assign, create, remove)
- [ ] Search by name and CUIT
- [ ] CSV export includes new fields
- [ ] Razon social shows in card header when different from name

---

### Task 15: Validate Productos page

**Verify:**
- [ ] Create product with all fields (SKU, name, type, barcode)
- [ ] Product type field shows dynamic types from DB + defaults
- [ ] IVA select shows 0%, 10.5%, 21%, 27% as presets
- [ ] Bidirectional price calculation works (change cost -> final updates, change final -> margin updates)
- [ ] "Sin IVA" column shows correct value in table
- [ ] Categories: create, create subcategory, delete
- [ ] Filter by category
- [ ] Price Lists: create list, add products, set custom prices, delete
- [ ] Bulk select (checkboxes) + bulk price increase
- [ ] Controls stock checkbox and low_stock_threshold input
- [ ] BOM: add component, view cost, remove component
- [ ] Edit product - all fields load
- [ ] Delete product
- [ ] CSV export

---

### Task 16: Validate Pedidos page

**Verify:**
- [ ] Create order with custom title ("Nombre del pedido" input)
- [ ] Enterprise/customer selector works
- [ ] Add multiple items with products
- [ ] "Descontar del inventario" checkbox
- [ ] Total calculations correct
- [ ] Edit order - title and all fields load (including deduct_stock)
- [ ] Status changes work (pendiente -> en_produccion -> terminado -> entregado)
- [ ] Production timer appears when status is "en_produccion"
- [ ] Timer shows total time when "finalizado"
- [ ] Click timer to edit production_started_at
- [ ] Quote badge shows when order linked to quote
- [ ] Cobro badge shows when linked
- [ ] "Crear Borrador de Factura" button works
- [ ] "No Fiscal" button creates non-fiscal invoice
- [ ] Enterprise name shows prominently when present
- [ ] Filters: status, type, enterprise, has_invoice
- [ ] Pagination

---

### Task 17: Validate Cotizaciones page

**Verify:**
- [ ] Create quote - verify quote_number auto-generates correctly
- [ ] Add items (from product catalog + custom)
- [ ] IVA presets in item vat_rate field
- [ ] Enterprise/customer selector
- [ ] Totals calculate correctly (subtotal, IVA, total)
- [ ] Status change: draft -> accepted creates order automatically
- [ ] PDF download
- [ ] Filters: enterprise, status, search, date range
- [ ] Pagination

---

### Task 18: Validate Facturas page

**Verify:**
- [ ] Create invoice - fiscal type selection
- [ ] CUIT validation: if customer has no CUIT, shows error for fiscal invoice
- [ ] Invoice preview modal shows all data
- [ ] Two-step AFIP authorization confirmation
- [ ] "Pagada"/"Pendiente"/"Pago parcial" labels show correctly
- [ ] No-fiscal invoices show as "emitido"
- [ ] Filters: enterprise, status, type, fiscal_type, date range
- [ ] Pagination

---

### Task 19: Validate Cobros page

**Verify:**
- [ ] Cobros tab loads without "Failed to get orders" error
- [ ] Register cobro with enterprise, payment method, amount
- [ ] Recibos tab: create receipt selecting multiple invoices
- [ ] Receipt shows remaining balance per invoice
- [ ] Delete receipt
- [ ] CSV export
- [ ] Filters: enterprise, payment method, date range
- [ ] Summary cards show correct totals

---

### Task 20: Validate Cheques page

**Verify:**
- [ ] Create cheque with new fields (cheque_type, drawer_cuit)
- [ ] Cheque type selector (comun, cruzado, no a la orden, cruzado no a la orden)
- [ ] CUIT del librador field
- [ ] Status column merged with actions (no duplicate)
- [ ] Status transitions work (a_cobrar -> endosado -> cobrado etc)
- [ ] Due date alerts (vencido, vence hoy, vence en Xd)
- [ ] Expanded detail shows cheque type and drawer CUIT
- [ ] Status history
- [ ] Filter tabs, search, date range
- [ ] CSV export with new fields

---

### Task 21: Validate Inventario page

**Verify:**
- [ ] Stock items display with quantities
- [ ] Low stock threshold indicator (red/orange when below threshold)
- [ ] "Ajustar stock" button and form
- [ ] Adjustment with positive and negative quantities
- [ ] Reason field required
- [ ] Search functionality

---

### Task 22: Validate Busqueda Global page

**Verify:**
- [ ] Search bar filters enterprises by name/CUIT
- [ ] Select enterprise shows header card with all info
- [ ] All 8 tabs load data:
  - Contactos: shows enterprise contacts
  - Pedidos: shows orders with status/totals
  - Cotizaciones: shows quotes
  - Facturas: shows invoices with paid status
  - Cobros: shows collections
  - Pagos: shows payments
  - Cuenta Corriente: shows balance
  - Cheques: shows cheques for enterprise's customers
- [ ] Summary counts and totals per tab

---

### Task 23: Validate remaining pages

**Compras:**
- [ ] Create purchase, "Agregar al inventario" button works
- [ ] Product selector in purchase items

**Remitos:**
- [ ] Create, download PDF, status changes, signed PDF upload

**Pagos:**
- [ ] Register payment, filters, CSV

**Cuenta Corriente:**
- [ ] Enterprise summary loads, detail expandable

**Bancos:**
- [ ] CRUD banks, movements, balances

**Usuarios:**
- [ ] CRUD users, permission matrix, password reset, templates

**Configuracion:**
- [ ] Company info, AFIP certificates

**Portal Clientes:**
- [ ] Login with access code
- [ ] Orders, invoices, quotes tabs
- [ ] "Mi Cuenta" tab with balance

---

## Chunk 5: Final Validation & Deploy

### Task 24: Run full validation script

- [ ] **Step 1: Run `scripts/validate.sh`**

Expected: ALL CHECKS PASSED

- [ ] **Step 2: Push all changes**

```bash
git push origin master
```

- [ ] **Step 3: Monitor Render deploy**

Verify deploy succeeds and app is live.

- [ ] **Step 4: Manual smoke test on production**

Visit each page on `gestor-becker-backend.onrender.com`:
1. Dashboard - period selector responds
2. Orders - data shows
3. Cobros - no error
4. Cheques - new fields visible
5. Enterprises - new form fields work
6. Products - categories, price lists, IVA presets
7. Global - search and tabs

---

## Safety Rules (MANDATORY for all future changes)

### Rule 1: Never push without local validation
```bash
./scripts/validate.sh  # MUST pass before every push
```

### Rule 2: Frontend build = `tsc && vite build`
The Render Dockerfile runs `tsc` before `vite build`. Locally running only `vite build` is NOT sufficient. Always run `tsc --noEmit` first.

### Rule 3: Defensive SQL queries
Every `LEFT JOIN` must verify the joined table exists via `CREATE TABLE IF NOT EXISTS` in `ensureMigrations()`. Never JOIN on a table managed by another module without ensuring it exists first.

### Rule 4: API response handling
Never call `.find()`, `.filter()`, `.map()` on API responses without first verifying the value is an array. Use `Array.isArray(data) ? data : []` pattern or the `safeArray()` helper.

### Rule 5: Database transactions
Any operation that inserts into 2+ tables MUST use a transaction (`BEGIN`/`COMMIT`/`ROLLBACK`). Partial inserts corrupt data.

### Rule 6: Form state completeness
When adding a field to a form's initial state object, EVERY place that resets or reconstructs that object must include the new field. Search for all `setForm({` calls.

### Rule 7: Migration ordering
Inline migrations (`ensureMigrations`) that depend on tables from other modules must create those tables defensively with `CREATE TABLE IF NOT EXISTS` before referencing them.
