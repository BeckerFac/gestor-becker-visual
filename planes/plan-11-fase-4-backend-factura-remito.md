# Plan 11 — Fase 4: Factura desde Remito + Bloqueo de Remitados

## Objetivo
Permitir crear facturas importando items de remitos, y bloquear items remitados al facturar directo desde pedido.

## Pre-requisitos
- Fase 1 (columna remito_item_id en invoice_items)
- Fase 2 (query getAvailableRemitoItemsForInvoicing)

## Archivos a modificar
- `backend/src/modules/invoices/invoices.service.ts` — createInvoice() + getAvailableOrderItemsForInvoicing()

## Cambio 1: createInvoice acepta remito_item_id

**Archivo**: `invoices.service.ts` → `createInvoice()`

El payload de items ya acepta `order_item_id`. Agregar `remito_item_id`:

```typescript
items: Array<{
  product_name: string,
  quantity: number,
  unit_price: number,
  vat_rate?: number,
  order_item_id?: string,     // ya existe
  remito_item_id?: string,    // NUEVO
}>
```

### En el INSERT de invoice_items:
Despues del INSERT, si el item tiene `remito_item_id`:
```sql
UPDATE invoice_items SET remito_item_id = $remitoItemId WHERE id = $invoiceItemId;
```

### Crear entrada en invoice_remitos (N:N):
```typescript
// Derivar remito_ids unicos de los items
const remitoItemIds = items.filter(i => i.remito_item_id).map(i => i.remito_item_id);
if (remitoItemIds.length > 0) {
  const remitoIds = await pool.query(`
    SELECT DISTINCT ri.remito_id FROM remito_items ri WHERE ri.id = ANY($1)
  `, [remitoItemIds]);
  
  for (const row of remitoIds.rows) {
    await pool.query(`
      INSERT INTO invoice_remitos (id, invoice_id, remito_id)
      VALUES (gen_random_uuid(), $1, $2)
      ON CONFLICT (invoice_id, remito_id) DO NOTHING
    `, [invoiceId, row.remito_id]);
  }
}
```

### Validacion: no facturar mas de lo disponible del remito
```typescript
for (const item of items) {
  if (item.remito_item_id) {
    const avail = await pool.query(`
      SELECT ri.quantity - COALESCE(SUM(ii.quantity), 0) as qty_available
      FROM remito_items ri
      LEFT JOIN invoice_items ii ON ii.remito_item_id = ri.id
        AND ii.invoice_id IN (SELECT id FROM invoices WHERE status != 'cancelled')
      WHERE ri.id = $1
      GROUP BY ri.id, ri.quantity
    `, [item.remito_item_id]);
    
    if (item.quantity > avail.rows[0]?.qty_available) {
      throw new Error(`Solo quedan ${avail.rows[0]?.qty_available} disponibles del item del remito`);
    }
  }
}
```

## Cambio 2: Modificar getAvailableOrderItemsForInvoicing

**Archivo**: `invoices.service.ts` lineas 1287-1341

El resultado ya tiene `qty_remaining`. Ahora necesita:
- `qty_delivered`: cuantas unidades fueron remitadas
- `qty_remito_pending_invoice`: remitadas pero no facturadas via remito
- `qty_available_direct`: lo que se puede facturar DIRECTO (excluyendo remitados no facturados)
- `remito_info`: array con {remito_number, remito_id, qty} para mostrar el link en el UI

### Agregar CTEs a la query existente:

```sql
item_delivered AS (
  SELECT ri.order_item_id,
    COALESCE(SUM(ri.quantity), 0) as qty_delivered
  FROM remito_items ri
  WHERE ri.order_item_id IS NOT NULL
  GROUP BY ri.order_item_id
),
item_invoiced_via_remito AS (
  SELECT ri.order_item_id,
    COALESCE(SUM(ii.quantity), 0) as qty_inv_via_remito
  FROM invoice_items ii
  JOIN remito_items ri ON ii.remito_item_id = ri.id
  JOIN invoices inv ON ii.invoice_id = inv.id AND inv.status != 'cancelled'
  WHERE ri.order_item_id IS NOT NULL
  GROUP BY ri.order_item_id
),
item_remito_info AS (
  SELECT ri.order_item_id,
    json_agg(json_build_object(
      'remito_id', r.id,
      'remito_number', r.remito_number,
      'punto_venta', r.punto_venta,
      'qty', ri.quantity,
      'qty_invoiced', COALESCE((
        SELECT SUM(ii2.quantity) FROM invoice_items ii2
        WHERE ii2.remito_item_id = ri.id
        AND ii2.invoice_id IN (SELECT id FROM invoices WHERE status != 'cancelled')
      ), 0)
    )) as remitos
  FROM remito_items ri
  JOIN remitos r ON ri.remito_id = r.id
  WHERE ri.order_item_id IS NOT NULL
  GROUP BY ri.order_item_id
)
```

### Agregar al SELECT:
```sql
COALESCE(del.qty_delivered, 0) as qty_delivered,
COALESCE(del.qty_delivered, 0) - COALESCE(ivr.qty_inv_via_remito, 0) as qty_remito_pending_invoice,
GREATEST(oi.quantity - COALESCE(inv.qty_invoiced, 0) - (COALESCE(del.qty_delivered, 0) - COALESCE(ivr.qty_inv_via_remito, 0)), 0) as qty_available_direct,
COALESCE(rinfo.remitos, '[]'::json) as remito_info
```

### El frontend usa:
- `qty_available_direct` > 0 → item habilitado para facturar directo
- `qty_remito_pending_invoice` > 0 → item BLOQUEADO, mostrar "Remitado en Remito #XXXX"
- `remito_info` → para mostrar links a los remitos

## Cambio 3: Endpoint para listar remitos facturables por empresa

Para el RemitoItemsImporter del frontend, necesita listar remitos con items pendientes:

```typescript
async getRemitosWithPendingItems(companyId: string, enterpriseId: string): Promise<Array<{
  remito_id: string,
  remito_number: number,
  punto_venta: number,
  date: string,
  items: Array<{
    remito_item_id: string,
    product_name: string,
    quantity: number,
    unit_price: number,
    vat_rate: number,
    qty_invoiced: number,
    qty_available: number,
    order_item_id: string | null,
  }>
}>>
```

**Query**:
```sql
SELECT r.id as remito_id, r.remito_number, r.punto_venta, r.date,
  (SELECT json_agg(json_build_object(
    'remito_item_id', ri.id,
    'product_name', ri.product_name,
    'quantity', ri.quantity,
    'unit_price', ri.unit_price,
    'vat_rate', ri.vat_rate,
    'order_item_id', ri.order_item_id,
    'qty_invoiced', COALESCE((
      SELECT SUM(ii.quantity) FROM invoice_items ii
      WHERE ii.remito_item_id = ri.id
      AND ii.invoice_id IN (SELECT id FROM invoices WHERE status != 'cancelled')
    ), 0),
    'qty_available', ri.quantity - COALESCE((
      SELECT SUM(ii.quantity) FROM invoice_items ii
      WHERE ii.remito_item_id = ri.id
      AND ii.invoice_id IN (SELECT id FROM invoices WHERE status != 'cancelled')
    ), 0)
  ) FILTER (WHERE ri.quantity - COALESCE(...) > 0)
  ) as items
FROM remitos r
WHERE r.company_id = $1
  AND r.enterprise_id = $2
GROUP BY r.id
HAVING COUNT(*) FILTER (WHERE qty_available > 0) > 0
ORDER BY r.date DESC
```

**Endpoint**: `GET /api/invoices/remitos-with-pending?enterprise_id=XXX`

## Verificacion
1. Crear factura desde remito → invoice_items tiene remito_item_id correcto
2. Crear factura desde remito → invoice_remitos tiene entrada
3. getAvailableOrderItemsForInvoicing → items remitados tienen qty_available_direct = 0
4. getAvailableOrderItemsForInvoicing → items remitados tienen remito_info con link
5. Intentar facturar mas de lo disponible del remito → error
6. Factura parcial del remito → items restantes siguen disponibles

---

## CORRECCIONES POST-REVIEW

### FIX C1: Cancelar factura — limpiar invoice_remitos
En `cancelInvoice()` o `updateInvoiceStatus('cancelled')`, agregar:
```typescript
// Limpiar invoice_remitos para facturas canceladas
await pool.query('DELETE FROM invoice_remitos WHERE invoice_id = $1', [invoiceId]);
```
Las queries de disponibilidad ya filtran por `status != 'cancelled'`, pero limpiar la tabla N:N evita datos fantasma.

### FIX H1: Endpoint para listar facturas con items sin remitar
Agregar `getInvoicesWithPendingDelivery(companyId, enterpriseId)`:
```sql
SELECT i.id, i.invoice_type, i.invoice_number, CAST(i.total_amount AS text),
  (SELECT json_agg(json_build_object(
    'invoice_item_id', ii.id, 'product_name', ii.product_name,
    'quantity', ii.quantity, 'unit_price', ii.unit_price, 'vat_rate', ii.vat_rate,
    'order_item_id', ii.order_item_id,
    'qty_delivered', COALESCE(SUM(ri.quantity), 0),
    'qty_available', ii.quantity - COALESCE(SUM(ri.quantity), 0)
  ) FILTER (WHERE ii.quantity - COALESCE(SUM(ri.quantity), 0) > 0))
  FROM invoice_items ii
  LEFT JOIN remito_items ri ON ri.invoice_item_id = ii.id
  WHERE ii.invoice_id = i.id
  GROUP BY ii.id
  ) as items
FROM invoices i
WHERE i.company_id = $1 AND i.enterprise_id = $2 AND i.status != 'cancelled'
-- Solo facturas que tienen items sin remitar
```
Endpoint: `GET /api/remitos/available-invoice-items?enterprise_id=XXX`

### FIX H2: company_id filtering en Query 3
Agregar filtro al LEFT JOIN de remito_items:
```sql
LEFT JOIN remito_items ri ON ri.invoice_item_id = ii.id
  AND ri.remito_id IN (SELECT id FROM remitos WHERE company_id = $1)
```
