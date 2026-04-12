# SECCION 8 — Anular remito

## Scope
- `DELETE /remitos/:id` (anularRemito)
- `POST /remitos/:id/anular` (alias)

## Bugs sospechados

### BUG #1 CRITICAL: Race condition double-anular (sin FOR UPDATE)
`SELECT id, status FROM remitos WHERE id AND company_id` sin FOR UPDATE. Dos requests concurrentes pasan el check `status !== 'anulado'` y ambos ejecutan revert → **doble devolución de stock y doble revert de qty_delivered**.

### BUG #2 CRITICAL: recalculateQtyDelivered usa pool.query (fuera de transaccion)
```ts
async recalculateQtyDelivered(orderItemId) {
  await pool.query(...) // NO usa el client!
}
```
- Si la transaccion hace ROLLBACK → el recalculate queda PERSISTIDO.
- Inconsistencia con el UPDATE que hizo dentro del client.

### BUG #3 CRITICAL: Recalculate corre ANTES de marcar anulado
`recalculateQtyDelivered` suma desde `remito_items` SIN filtrar remitos anulados. En el momento del recalculate, el remito que estamos anulando TODAVIA no está marcado como anulado → **sus items siguen contando como delivered** → el revert manual es sobreescrito por el recalculate. **Bug lógico que hace que el anular NO libere el pedido**.

### BUG #4 HIGH: Recalculate no excluye remitos anulados PREVIAMENTE
```sql
SELECT SUM(ri.quantity) FROM remito_items ri WHERE ri.order_item_id = ...
```
No hay JOIN con remitos para excluir `status = 'anulado'`. Si antes hubo otras anulaciones, sus items siguen contando.

### BUG #5 HIGH: stock_movement lookup no filtra movement_type
`WHERE reference_type = 'remito' AND reference_id = $1 AND product_id = $2` — si por algun motivo el mismo remito tiene un movement de tipo distinto, puede retornar warehouse wrong.

### BUG #6 HIGH: Stock no devuelto silenciosamente si no hay movement
Si `originalWarehouseId` es NULL, el for-loop sigue sin devolver el stock. No hay warning ni fallback. Inventario se pierde.

### BUG #7 HIGH: deleteRemito legacy pasa userId='system' que puede violar FK
`users_id` FK puede no tener row 'system' → INSERT stock_movements falla.

### BUG #8 MEDIUM: No valida permisos temporales (anular un remito de hace 1 ano)
Sin check de antiguedad ni rol especial. Cualquiera con edit puede anular remitos viejos alterando estadisticas.

### BUG #9 HIGH: Items con BOTH order_item_id Y product_id
Solo se revierte `qty_delivered`, NO se devuelve stock. Inventory leak.

### BUG #10 MEDIUM: Recalculate ejecuta N queries separadas (N+1)
Un loop en JS + pool.query por cada item → N round-trips.
