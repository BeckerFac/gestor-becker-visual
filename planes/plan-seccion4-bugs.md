# SECCION 4 — Multi-pedido + Enterprise Switch

## Scope
- T4.1: Remito con items de N pedidos de la MISMA empresa
- T4.2: Remito con items de pedidos de DISTINTAS empresas → reject
- T4.3: Pedido con enterprise_id modificado después de crear → crear remito
- T4.4: Remito mixto (items de pedido + items manuales)
- T4.5: Pedido CANCELADO no permite remitir
- T4.6: IDOR en getAvailableByEnterprise
- T4.7: Legacy data.order_id cross-enterprise
- T4.8: Multi-orden con qty_delivered parcial distribuida

## Bugs sospechados

### BUG #1 CRITICAL: Lock no filtra pedidos cancelados
`FOR UPDATE OF oi` lockea order_items sin `o.status NOT IN ('cancelado','cancelled')`. Se pueden remitir items de un pedido cancelado.

### BUG #2 HIGH: Enterprise NULL en lock bypasea check
`if (locked.enterprise_id && locked.enterprise_id !== enterpriseId)` — si `locked.enterprise_id` es NULL (dirty data), el check se salta silenciosamente y permite mezcla.

### BUG #3 CRITICAL: getAvailableOrderItemsForRemitoByEnterprise IDOR
No valida que `enterpriseId` pertenezca a la company. Un usuario de company A puede pasar enterprise_id de company B y listar sus order_items.

### BUG #4 CRITICAL: Legacy order_id cross-enterprise
`data.order_id` legacy se linkea a `remito_orders` validando company pero NO enterprise. Permite linkear un pedido de empresa X a un remito de empresa Y.

### BUG #5 HIGH: Multi-pedido misma empresa derivación enterpriseId inconsistente
Si `enterprise_id` no se pasa, se deriva del PRIMER lock row (`lockResult.rows[0]`). El orden de rows no está garantizado sin `ORDER BY`. Puede derivar de uno arbitrario.

### BUG #6 MEDIUM: updateRemito no valida que enterprise switch esté permitido si ya tiene items vinculados a pedidos
Si remito ya tiene items con order_item_id de enterprise A, cambiar enterprise a B via updateRemito no se valida.

### BUG #7 HIGH: Pedido cancelado no aparece en availability pero SÍ se puede remitir via API directa
`getAvailable` filtra cancelled, pero `createRemito` no. Inconsistencia UI/API.

### BUG #8 MEDIUM: orderIdsSet puede incluir order de enterprise distinta (race)
Si entre lock y createRemito el user cambia orders.enterprise_id (otra transaccion), el check ya pasó pero stored state queda inconsistente.

### BUG #9 HIGH: qty_delivered parcial en multi-pedido no valida suma total
Si mando items de ord-A (5 unidades) + ord-B (3 unidades), pero ord-A solo tiene 2 disponibles y ord-B 4, el error por ord-A hace rollback pero el mensaje es confuso.

### BUG #10 MEDIUM: remito_orders duplicados si legacy order_id coincide con orderIdsSet
ON CONFLICT DO NOTHING maneja duplicate, pero es un patch. El código deberia deduplicar antes.
