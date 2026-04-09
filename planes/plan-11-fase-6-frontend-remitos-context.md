# Plan 11 — Fase 6: Frontend Remitos — Context Menu + Expandible + Status

## Objetivo
Agregar click derecho en remitos para ver facturas vinculadas y crear facturas, y expandible con status de facturacion por item.

## Pre-requisitos
- Fase 4 (invoice_remitos existe, queries de facturacion)
- Fase 5 (remitos tienen items vinculados)

## Archivo a modificar
- `frontend/src/pages/Remitos.tsx`

## Cambio 1: Context menu en tabla de remitos

Agregar `useContextMenu<Remito>()` (similar a Orders.tsx linea 182).

### Al hacer click derecho en un remito:
1. Cargar datos de contexto via API (facturas vinculadas + status items)
2. Mostrar menu

### Menu:
```
Click derecho en Remito #0005:
┌──────────────────────────────────────────────────┐
│ Remito 0001-00000005 — Garcia Construcciones     │
│ Estado: entregado | 3/8 items facturados         │
├──────────────────────────────────────────────────┤
│ Facturas vinculadas:                             │
│   📄 Factura B-003 ($36.300) → click navega     │
│                                                  │
│ Items pendientes de facturar:                    │
│   → 2x Pintura 20L ($20.000)                    │
│   → 3x Cemento 50kg ($21.000)                   │
├──────────────────────────────────────────────────┤
│ [Crear factura de pendientes]                    │
│ [Descargar PDF]                                  │
│ [Eliminar remito]                                │
└──────────────────────────────────────────────────┘
```

### API necesaria: getRemitoContextData(companyId, remitoId)

**Backend** (`remitos.service.ts`):
```typescript
async getRemitoContextData(companyId: string, remitoId: string): Promise<{
  invoices: Array<{ id, invoice_number, invoice_type, total_amount, status }>,
  items_status: Array<{
    product_name, quantity, qty_invoiced, qty_pending,
    invoice_refs: Array<{ invoice_id, invoice_number, qty }>
  }>
}>
```

**Query**:
```sql
-- Facturas vinculadas
SELECT i.id, i.invoice_number, i.invoice_type, CAST(i.total_amount AS text), i.status
FROM invoices i
JOIN invoice_remitos ir ON ir.invoice_id = i.id
WHERE ir.remito_id = $1 AND i.company_id = $2

-- Items con status
SELECT ri.product_name, ri.quantity,
  COALESCE(SUM(ii.quantity), 0) as qty_invoiced,
  ri.quantity - COALESCE(SUM(ii.quantity), 0) as qty_pending
FROM remito_items ri
LEFT JOIN invoice_items ii ON ii.remito_item_id = ri.id
  AND ii.invoice_id IN (SELECT id FROM invoices WHERE status != 'cancelled')
WHERE ri.remito_id = $1
GROUP BY ri.id, ri.product_name, ri.quantity
```

**Endpoint**: `GET /api/remitos/:id/context`

### "Crear factura de pendientes":
Navega a: `/facturas?nuevo=true&remito_id=REMITO_ID`
(La pagina de facturas carga items del remito pendientes via RemitoItemsImporter)

### Click en factura vinculada:
Navega a: `/facturas?expand=INVOICE_ID`

## Cambio 2: Expandible en tabla de remitos

Al expandir un remito, mostrar items con status de facturacion:

```
▼ Remito 0001-00000005 — Garcia Construcciones — Entregado
┌──────────────────────────────────────────────────────────┐
│ Producto      │ Qty │ Facturado │ Pendiente │ Origen     │
│ Pintura 20L   │ 5   │ 3/5       │ 2         │ Pedido #3  │
│ Cemento 50kg  │ 3   │ 0/3       │ 3         │ Pedido #3  │
├──────────────────────────────────────────────────────────┤
│ Total pendiente de facturar: 5 items ($41.000+IVA)       │
│ Factura vinculada: B-003 ($36.300)                       │
│ [Crear factura de pendientes]                             │
└──────────────────────────────────────────────────────────┘
```

### Datos necesarios:
Usar `getRemito()` (ya existe, linea 118-145) pero agregar la info de facturacion por item.

Modificar query de getRemito para incluir:
```sql
COALESCE((SELECT SUM(ii.quantity) FROM invoice_items ii
  WHERE ii.remito_item_id = ri.id
  AND ii.invoice_id IN (SELECT id FROM invoices WHERE status != 'cancelled')
), 0) as qty_invoiced
```

Y agregar el origen:
```sql
CASE 
  WHEN ri.order_item_id IS NOT NULL THEN 
    (SELECT 'Pedido #' || LPAD(o.order_number::text, 4, '0') 
     FROM order_items oi JOIN orders o ON oi.order_id = o.id 
     WHERE oi.id = ri.order_item_id)
  WHEN ri.invoice_item_id IS NOT NULL THEN 'Factura'
  ELSE 'Manual'
END as source_ref
```

## Cambio 3: Filtros en tabla de remitos

Agregar filtro por "tiene items pendientes de facturar" para ver rapidamente cuales remitos faltan facturar.

```typescript
// Nuevo filtro: pendiente_facturacion: boolean
// En la query de getRemitos, agregar HAVING con subquery
```

## Verificacion
1. Click derecho en remito → muestra facturas vinculadas
2. Click en factura → navega a /facturas?expand=ID
3. "Crear factura de pendientes" → navega a /facturas?nuevo=true&remito_id=ID
4. Expandible muestra items con qty_invoiced/qty_pending correctos
5. Expandible muestra origen (Pedido #XXXX / Factura / Manual)
