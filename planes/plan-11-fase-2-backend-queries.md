# Plan 11 — Fase 2: Backend Queries de Disponibilidad

## Objetivo
Crear las queries que responden: "que items se pueden remitar?" y "que items del remito se pueden facturar?". Estas queries alimentan los importers del frontend.

## Pre-requisitos
- Fase 1 completa (tablas y columnas existen)

## Archivos a modificar
- `backend/src/modules/remitos/remitos.service.ts` — agregar 2 funciones
- `backend/src/modules/invoices/invoices.service.ts` — agregar 1 funcion, modificar 1 existente
- `backend/src/modules/orders/orders.service.ts` — modificar getOrderContextData

## Query 1: getAvailableOrderItemsForRemito(companyId, orderId)

**Archivo**: `remitos.service.ts`
**Retorna**: Items del pedido que todavia se pueden remitar (qty_delivered < quantity)

```sql
SELECT 
  oi.id as order_item_id,
  oi.product_id,
  oi.product_name,
  oi.description,
  oi.quantity,
  oi.unit_price,
  oi.vat_rate,
  COALESCE(oi.qty_delivered, 0) as qty_delivered,
  oi.quantity - COALESCE(oi.qty_delivered, 0) as qty_available,
  o.order_number,
  o.title as order_title,
  o.enterprise_id,
  e.name as enterprise_name
FROM order_items oi
JOIN orders o ON oi.order_id = o.id
LEFT JOIN enterprises e ON o.enterprise_id = e.id
WHERE o.company_id = $1
  AND o.id = $2
  AND o.status != 'cancelado'
  AND oi.quantity - COALESCE(oi.qty_delivered, 0) > 0
ORDER BY oi.created_at ASC
```

**Endpoint nuevo**: `GET /api/remitos/available-order-items/:orderId`

## Query 2: getAvailableOrderItemsForRemitoByEnterprise(companyId, enterpriseId)

**Archivo**: `remitos.service.ts`
**Retorna**: TODOS los items de TODOS los pedidos de una empresa que se pueden remitar. Para el flujo "agregar otro pedido al remito".

```sql
-- Misma query que Query 1 pero WHERE o.enterprise_id = $2 en vez de o.id = $2
-- Y agrupado por pedido para mostrar en el UI
```

**Endpoint nuevo**: `GET /api/remitos/available-order-items?enterprise_id=XXX`

## Query 3: getAvailableInvoiceItemsForRemito(companyId, invoiceId)

**Archivo**: `remitos.service.ts`
**Retorna**: Items de una factura que todavia no fueron remitados (para remitar desde factura)

```sql
SELECT
  ii.id as invoice_item_id,
  ii.product_id,
  ii.product_name,
  ii.quantity,
  ii.unit_price,
  ii.vat_rate,
  ii.order_item_id,
  COALESCE(SUM(ri.quantity), 0) as qty_delivered,
  ii.quantity - COALESCE(SUM(ri.quantity), 0) as qty_available
FROM invoice_items ii
JOIN invoices i ON ii.invoice_id = i.id
LEFT JOIN remito_items ri ON ri.invoice_item_id = ii.id
WHERE i.company_id = $1
  AND i.id = $2
  AND i.status != 'cancelled'
GROUP BY ii.id, ii.product_id, ii.product_name, ii.quantity, ii.unit_price, ii.vat_rate, ii.order_item_id
HAVING ii.quantity - COALESCE(SUM(ri.quantity), 0) > 0
ORDER BY ii.created_at ASC
```

**Endpoint nuevo**: `GET /api/remitos/available-invoice-items/:invoiceId`

## Query 4: getAvailableRemitoItemsForInvoicing(companyId, remitoId)

**Archivo**: `invoices.service.ts`
**Retorna**: Items de un remito que todavia no fueron facturados (para facturar desde remito)

```sql
SELECT
  ri.id as remito_item_id,
  ri.product_id,
  ri.product_name,
  ri.quantity,
  ri.unit_price,
  ri.vat_rate,
  ri.order_item_id,
  r.remito_number,
  r.enterprise_id,
  e.name as enterprise_name,
  COALESCE(SUM(ii.quantity), 0) as qty_invoiced,
  ri.quantity - COALESCE(SUM(ii.quantity), 0) as qty_available
FROM remito_items ri
JOIN remitos r ON ri.remito_id = r.id
LEFT JOIN enterprises e ON r.enterprise_id = e.id
LEFT JOIN invoice_items ii ON ii.remito_item_id = ri.id
  AND ii.invoice_id IN (SELECT id FROM invoices WHERE status != 'cancelled')
WHERE r.company_id = $1
  AND r.id = $2
GROUP BY ri.id, ri.product_id, ri.product_name, ri.quantity, ri.unit_price, ri.vat_rate, ri.order_item_id, r.remito_number, r.enterprise_id, e.name
HAVING ri.quantity - COALESCE(SUM(ii.quantity), 0) > 0
ORDER BY ri.id
```

**Endpoint nuevo**: `GET /api/invoices/available-remito-items/:remitoId`

## Query 5: Modificar getAvailableOrderItemsForInvoicing (ya existe, linea 1287)

**Archivo**: `invoices.service.ts`
**Cambio**: Agregar qty_delivered y qty_remito_pending_invoice al resultado. Esto permite al frontend mostrar items remitados como bloqueados.

La CTE `item_invoiced` se mantiene. Agregar CTE `item_delivered`:

```sql
WITH item_invoiced AS (
  -- ya existe
),
item_delivered AS (
  SELECT ri.order_item_id,
    COALESCE(SUM(ri.quantity), 0) as qty_delivered
  FROM remito_items ri
  WHERE ri.order_item_id IS NOT NULL
  GROUP BY ri.order_item_id
),
item_invoiced_via_remito AS (
  SELECT ri.order_item_id,
    COALESCE(SUM(ii.quantity), 0) as qty_invoiced_via_remito
  FROM invoice_items ii
  JOIN remito_items ri ON ii.remito_item_id = ri.id
  JOIN invoices inv ON ii.invoice_id = inv.id AND inv.status != 'cancelled'
  WHERE ri.order_item_id IS NOT NULL
  GROUP BY ri.order_item_id
)
SELECT 
  -- campos existentes...
  oi.quantity - COALESCE(inv.qty_invoiced, 0) as qty_remaining, -- ya existe
  COALESCE(del.qty_delivered, 0) as qty_delivered,              -- NUEVO
  COALESCE(del.qty_delivered, 0) - COALESCE(ivr.qty_invoiced_via_remito, 0) as qty_remito_pending_invoice, -- NUEVO
  oi.quantity - COALESCE(inv.qty_invoiced, 0) - (COALESCE(del.qty_delivered, 0) - COALESCE(ivr.qty_invoiced_via_remito, 0)) as qty_available_direct -- NUEVO
FROM order_items oi
-- JOINs existentes...
LEFT JOIN item_delivered del ON del.order_item_id = oi.id
LEFT JOIN item_invoiced_via_remito ivr ON ivr.order_item_id = oi.id
```

**Campos nuevos en el resultado**:
- `qty_delivered`: cuantas unidades fueron remitadas
- `qty_remito_pending_invoice`: remitadas pero no facturadas (debe facturarse desde remito)
- `qty_available_direct`: lo que se puede facturar DIRECTO del pedido (sin pasar por remito)

## Query 6: Agregar remitos a getOrderContextData

**Archivo**: `orders.service.ts` → `getOrderContextData()` (linea 797)
**Cambio**: Agregar query de remitos vinculados via `remito_orders` (cuando exista) o via `remitos.order_id` (legacy)

```sql
SELECT r.id, r.remito_number, r.status, r.date, r.punto_venta,
  COALESCE((SELECT json_agg(json_build_object(
    'product_name', ri.product_name, 'quantity', ri.quantity
  )) FROM remito_items ri WHERE ri.remito_id = r.id), '[]') as items
FROM remitos r
LEFT JOIN remito_orders ro ON ro.remito_id = r.id
WHERE (ro.order_id = $1 OR r.order_id = $1)
  AND r.company_id = $2
ORDER BY r.date DESC
```

Agregar al resultado de `getOrderContextData`: campo `remitos[]` junto a `invoices[]` y `receipts[]`.

## Endpoints nuevos (router)

**Archivo**: `backend/src/modules/remitos/remitos.router.ts`

```
GET /api/remitos/available-order-items/:orderId
GET /api/remitos/available-order-items?enterprise_id=XXX
GET /api/remitos/available-invoice-items/:invoiceId
```

**Archivo**: `backend/src/modules/invoices/invoices.router.ts`

```
GET /api/invoices/available-remito-items/:remitoId
```

## API client (frontend)

**Archivo**: `frontend/src/services/api.ts`

```typescript
getAvailableOrderItemsForRemito(orderId: string): Promise<OrderItem[]>
getAvailableOrderItemsForRemitoByEnterprise(enterpriseId: string): Promise<OrderItem[]>
getAvailableInvoiceItemsForRemito(invoiceId: string): Promise<InvoiceItem[]>
getAvailableRemitoItemsForInvoicing(remitoId: string): Promise<RemitoItem[]>
```

## Verificacion
- Endpoint devuelve items con qty_available > 0
- Items completamente remitados NO aparecen
- Items parcialmente remitados aparecen con qty_available correcta
- Pedidos cancelados no aparecen
- Facturas canceladas no se cuentan en qty_invoiced
