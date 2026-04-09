# Plan 11 — Fase 3: Reescribir createRemito con Vinculos

## Objetivo
createRemito pasa de crear items planos a crear items vinculados por order_item_id/invoice_item_id, crear entradas en remito_orders, y actualizar qty_delivered en order_items.

## Pre-requisitos
- Fase 1 (migraciones DB)
- Fase 2 (queries de disponibilidad, para validacion)

## Archivo a modificar
- `backend/src/modules/remitos/remitos.service.ts` — funcion `createRemito()` (lineas 147-188)

## Payload actual (lineas 147-188)
```typescript
data: {
  customer_id?, enterprise_id?, order_id?,
  delivery_address?, receiver_name?, transport?,
  notes?, date?, tipo,
  items: Array<{ product_name, description?, quantity?, unit? }>
}
```

## Payload nuevo
```typescript
data: {
  customer_id?: string,
  enterprise_id?: string,   // REQUERIDO (ya no es opcional)
  delivery_address?: string,
  receiver_name?: string,
  transport?: string,
  notes?: string,
  date?: string,
  tipo: 'entrega' | 'recepcion',
  punto_venta?: number,     // NUEVO: heredar de company si no viene
  factura_ref?: string,     // NUEVO: "0001-00001833"
  pedido_ref?: string,      // NUEVO: "0001-00039116"
  
  items: Array<{
    product_name: string,        // REQUERIDO
    description?: string,
    quantity: number,             // REQUERIDO (era opcional)
    unit?: string,
    product_id?: string,         // NUEVO: vinculo al catalogo
    unit_price?: number,         // NUEVO: precio unitario
    vat_rate?: number,           // NUEVO: IVA
    order_item_id?: string,      // NUEVO: vinculo a item de pedido
    invoice_item_id?: string,    // NUEVO: vinculo a item de factura
  }>
}
```

## Logica nueva de createRemito

### Paso 1: Validar empresa
```typescript
if (!data.enterprise_id) throw new Error('enterprise_id es requerido');
```

### Paso 2: Validar cantidades contra disponibilidad
Para cada item con order_item_id:
```typescript
// Consultar qty disponible
const available = await pool.query(`
  SELECT quantity - COALESCE(qty_delivered, 0) as qty_available
  FROM order_items WHERE id = $1
`, [item.order_item_id]);

if (item.quantity > available.rows[0].qty_available) {
  throw new Error(`No se pueden remitar ${item.quantity} de ${item.product_name}, disponibles: ${available.rows[0].qty_available}`);
}
```

Para cada item con invoice_item_id:
```typescript
// Consultar qty disponible de la factura
const available = await pool.query(`
  SELECT ii.quantity - COALESCE(SUM(ri.quantity), 0) as qty_available
  FROM invoice_items ii
  LEFT JOIN remito_items ri ON ri.invoice_item_id = ii.id
  WHERE ii.id = $1
  GROUP BY ii.id, ii.quantity
`, [item.invoice_item_id]);
```

### Paso 3: Crear remito (dentro de transaction)
```sql
BEGIN;

-- Crear remito
INSERT INTO remitos (id, company_id, enterprise_id, customer_id, remito_number, 
  date, delivery_address, receiver_name, transport, tipo, notes, status,
  punto_venta, factura_ref, pedido_ref, created_by)
VALUES (...);

-- Crear items CON vinculos
INSERT INTO remito_items (id, remito_id, product_id, product_name, description,
  quantity, unit, unit_price, vat_rate, order_item_id, invoice_item_id)
VALUES (...);

-- Crear entradas en remito_orders (para cada order_id unico)
INSERT INTO remito_orders (id, remito_id, order_id)
VALUES (gen_random_uuid(), $remitoId, $orderId)
ON CONFLICT (remito_id, order_id) DO NOTHING;

-- Actualizar qty_delivered en order_items
UPDATE order_items SET qty_delivered = COALESCE(qty_delivered, 0) + $qty
WHERE id = $orderItemId;

COMMIT;
```

### Paso 4: Punto de venta
```typescript
const puntoVenta = data.punto_venta || await getPuntoVentaFromCompany(companyId);
```

### Paso 5: Referencias cruzadas auto
```typescript
// Si hay order_item_ids, derivar pedido_ref
const orderIds = [...new Set(items.filter(i => i.order_item_id).map(i => i.order_item_id))];
if (orderIds.length > 0) {
  // Buscar order_number de cada order
  // pedido_ref = "0001-00039116" (punto_venta + order_number)
}

// Si hay invoice_item_ids, derivar factura_ref
const invoiceIds = [...new Set(items.filter(i => i.invoice_item_id).map(i => i.invoice_item_id))];
if (invoiceIds.length > 0) {
  // factura_ref = "0001-00001833"
}
```

## Funcion nueva: cancelRemito (o modificar deleteRemito)

Cuando se cancela/elimina un remito, REVERTIR qty_delivered:

```sql
-- Para cada remito_item con order_item_id
UPDATE order_items SET qty_delivered = GREATEST(COALESCE(qty_delivered, 0) - $qty, 0)
WHERE id = $orderItemId;

-- Eliminar entradas de remito_orders
DELETE FROM remito_orders WHERE remito_id = $remitoId;
```

**CRITICO**: deleteRemito actual (linea 263-280) hace DELETE directo. Hay que agregar la reversion de qty_delivered ANTES del delete.

## Retrocompatibilidad
- Remitos existentes sin order_item_id siguen funcionando (items planos)
- El campo order_id en remitos se mantiene por legacy pero se prefiere remito_orders
- Si un item no tiene order_item_id ni invoice_item_id, es un item manual (valido)

## Validaciones
| Regla | Implementacion |
|-------|---------------|
| qty <= disponible del order_item | Chequear antes de INSERT |
| qty <= disponible del invoice_item | Chequear antes de INSERT |
| Misma empresa en todos los pedidos | Verificar enterprise_id de cada order |
| No duplicar order_item en mismo remito | UNIQUE check en memoria antes de INSERT |
| Revertir al cancelar | UPDATE qty_delivered antes de DELETE |

## Testing
1. Crear remito desde pedido → qty_delivered sube
2. Crear remito desde factura → items vinculados
3. Crear remito multi-pedido → remito_orders tiene N entradas
4. Eliminar remito → qty_delivered baja
5. Intentar remitar mas de lo disponible → error
6. Remito con items mixtos (pedido + factura + manual) → funciona

---

## CORRECCIONES POST-REVIEW (19 issues)

### FIX C2: updateRemito — PROHIBIR edicion de items vinculados
Decision: NO se permite editar items de un remito que tiene vinculos (order_item_id o invoice_item_id).
- Si el remito tiene items vinculados, solo se puede editar: delivery_address, receiver_name, transport, notes, date, status
- Para cambiar items, se debe CANCELAR y RECREAR el remito
- Esto evita la complejidad de diff de qty_delivered
- En el frontend: si el remito tiene items vinculados, deshabilitar edicion de items

### FIX C3: Race condition — SELECT FOR UPDATE
Mover validacion DENTRO de la transaccion:
```sql
BEGIN;
-- Lock order_items que vamos a afectar
SELECT id, quantity, COALESCE(qty_delivered, 0) as qty_delivered
FROM order_items WHERE id = ANY($orderItemIds) FOR UPDATE;

-- Validar cantidades contra el lock
-- Si alguna falla, ROLLBACK

-- INSERT remito + items
-- UPDATE qty_delivered
COMMIT;
```

### FIX C4: Funcion de reconciliacion
Agregar `recalculateQtyDelivered(orderItemId)`:
```sql
UPDATE order_items SET qty_delivered = (
  SELECT COALESCE(SUM(ri.quantity), 0)
  FROM remito_items ri WHERE ri.order_item_id = order_items.id
) WHERE id = $1;
```
Usar en deleteRemito como safety net (ademas del decremento).

### FIX H4: qty_delivered transitivo (factura → remito → order_item)
Cuando un remito_item tiene `invoice_item_id` pero NO `order_item_id`:
```typescript
// Buscar order_item_id transitivo
if (item.invoice_item_id && !item.order_item_id) {
  const invoiceItem = await pool.query(
    'SELECT order_item_id FROM invoice_items WHERE id = $1', [item.invoice_item_id]
  );
  if (invoiceItem.rows[0]?.order_item_id) {
    item.order_item_id = invoiceItem.rows[0].order_item_id;
    // Guardar en remito_item tambien para trazabilidad directa
  }
}
```
Asi qty_delivered se actualiza siempre en el order_item correcto.

### FIX H3: Validar misma empresa al crear desde factura
```typescript
if (item.invoice_item_id) {
  const check = await pool.query(`
    SELECT i.enterprise_id FROM invoice_items ii
    JOIN invoices i ON ii.invoice_id = i.id
    WHERE ii.id = $1 AND i.company_id = $2
  `, [item.invoice_item_id, companyId]);
  if (check.rows[0]?.enterprise_id !== data.enterprise_id) {
    throw new Error('La factura pertenece a otra empresa');
  }
}
```

### FIX H5: Constraint de qty_delivered <= quantity
Agregar CHECK constraint:
```sql
-- No como DB constraint (qty_delivered es denormalizado)
-- Sino como validacion en la transaccion:
IF (current_qty_delivered + new_qty) > order_item.quantity THEN
  ROLLBACK + error
```
