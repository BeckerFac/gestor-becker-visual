# SECCION 5 — Remito desde factura

## Scope
Endpoints involucrados:
- `GET /remitos/invoice-items-for-remito/:invoiceId` → `getInvoiceItemsForRemito`
- `POST /remitos` con `factura_ref` (free text)

Post Plan 12 el remito es INDEPENDIENTE de facturación. Pero queda:
1. Endpoint para LISTAR items de una factura para construir remito desde UI
2. Campo `factura_ref` texto libre en el remito

## Bugs sospechados

### BUG #1 CRITICAL: `getInvoiceItemsForRemito` filtra solo 'cancelled' (ingles)
`WHERE i.status != 'cancelled'` — NO filtra 'cancelado' (espanol). Facturas canceladas en espanol aparecen en availability.

### BUG #2 CRITICAL: Facturas DRAFT/no-autorizadas entran en availability
No filtra por `status = 'authorized'` → se pueden generar remitos de items de facturas borrador.

### BUG #3 HIGH: Cross-tenant via orders JOIN
`LEFT JOIN orders o ON oi.order_id = o.id` sin `o.company_id = i.company_id`. Dirty cross-tenant data via order_item_id puede linkear orders de otra empresa.

### BUG #4 HIGH: No 404 si invoice no existe / cross-company
Si `invoiceId` es de otra compania o inexistente, retorna `[]` en vez de 404. Masking.

### BUG #5 HIGH: Invoice items manuales sin tracking de remitos
Items con `ii.order_item_id IS NULL` retornan `qty_available = ii.quantity` SIEMPRE. No se trackea cuantas se remitieron → se puede remitir el mismo item manual N veces (double delivery).

### BUG #6 MEDIUM: `factura_ref` length sin validar
Free text sin limite. Se puede guardar 1MB en factura_ref.

### BUG #7 MEDIUM: `factura_ref` formato sin validar
No se valida que coincida con formato factura (e.g. "B-0001-00000001"). Usuario puede poner cualquier cosa.

### BUG #8 MEDIUM: qty_available calculation race condition
`LEAST(ii.quantity, qty - delivered)` — qty_delivered se lee sin lock. Mientras se calcula, otro proceso puede remitir y el availability queda stale.

### BUG #9 LOW: filter en JS
`r.rows.filter(qty_available > 0)` — debería ser WHERE en SQL para eficiencia.

### BUG #10 MEDIUM: No valida invoice_id formato UUID
Si el cliente manda `?invoiceId=../../etc/passwd` o cualquier string, se va directo a la query. PostgreSQL da error de UUID inválido, pero el error puede leakear info del backend.
