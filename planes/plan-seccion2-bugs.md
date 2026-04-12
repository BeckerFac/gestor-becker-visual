# SECCION 2 — Bugs encontrados en createRemito + getAvailableOrderItemsForRemito

## Tests planeados (T2.1, T2.2, T2.3)
- T2.1: Click derecho pedido → crea remito con items pre-cargados
- T2.2: Remito parcial (qty menor al total)
- T2.3: Stock NO se mueve (items vienen del pedido)

## Bugs encontrados con ojo critico

### BUG #1 CRITICAL: Validacion NO acumulativa por order_item_id (over-delivery)
**Linea 253-264 de remitos.service.ts**

Si envio 2 items con el MISMO `order_item_id`, la validacion se hace por item individual en lugar de sumar.

**Ejemplo**:
- order_item: quantity=10, qty_delivered=7, available=3
- Items enviados: `[{ order_item_id: oi-1, qty: 2 }, { order_item_id: oi-1, qty: 2 }]`
- Validacion individual: `2 <= 3` OK para ambos
- Total remitado: `2 + 2 = 4 > 3 disponible`
- `qty_delivered` termina en `7 + 2 + 2 = 11 > 10 total` → **data corruption**

**Fix**: acumular por order_item_id ANTES de validar.

---

### BUG #2 HIGH: IDOR en enterprise_id
**Linea 226**: `let enterpriseId = data.enterprise_id || null;`

Se acepta sin validar contra company. Misma vulnerabilidad que en orders.

**Fix**: `SELECT id FROM enterprises WHERE id=$1 AND company_id=$2`

---

### BUG #3 HIGH: IDOR en customer_id
**Linea 228**: `SELECT enterprise_id FROM customers WHERE id = $1`

No filtra por company_id.

**Fix**: `WHERE id=$1 AND company_id=$2`

---

### BUG #4 HIGH: Bypass de validacion enterprise cuando enterpriseId es null
**Linea 257**: `if (enterpriseId && locked.enterprise_id && locked.enterprise_id !== enterpriseId)`

Si el usuario no pasa enterprise_id y tampoco customer_id, `enterpriseId` es null, la validacion no se ejecuta, y puedo meter items de cualquier empresa en el mismo remito.

**Fix**: si no hay enterpriseId, DERIVARLO del primer order_item y validar que todos coincidan.

---

### BUG #5 HIGH: qty negativa corrompe qty_delivered
**Linea 284**: `const qty = item.quantity || 1;`

Si el usuario envia `quantity: -5`, el `|| 1` no lo captura (porque -5 es truthy). Luego:
- `UPDATE order_items SET qty_delivered = qty_delivered + (-5)` → **resta 5 al contador**

Permite corromper el estado del sistema.

**Fix**: validar `qty > 0` con throw 400.

---

### BUG #6 MEDIUM: qty = 0 se convierte silenciosamente a 1
**Linea 284**: `const qty = item.quantity || 1`

Si qty=0, el `||` devuelve 1. Se crea un remito_item con qty=1 sin que el usuario lo haya pedido.

**Fix**: validar `qty > 0`.

---

### BUG #7 MEDIUM: Fecha invalida causa error 500 generico
**Linea 276**: `data.date || new Date().toISOString()`

Si `data.date = "2026-13-45"`, PostgreSQL tira error poco claro en lugar de 400.

**Fix**: validar formato ISO 8601 antes del INSERT.

---

### BUG #8 MEDIUM: N+1 query — SELECT order_id por cada item
**Linea 300**: `SELECT order_id FROM order_items WHERE id = $1`

Se hace 1 query por item cuando ya tenemos los datos en `lockedItems`. Performance issue.

**Fix**: incluir `order_id` en el SELECT FOR UPDATE inicial.

---

### BUG #9 MEDIUM: Campos de texto sin limite de longitud
**Lineas 277**: `delivery_address`, `receiver_name`, `transport`, `notes`

Sin validacion de max length. Un usuario puede enviar 10MB de texto y saturar la DB.

**Fix**: validar `length <= 500` para address/receiver/transport, `<= 2000` para notes.

---

### BUG #10 LOW: getAvailableOrderItemsForRemito no valida pedido cancelado con mensaje claro
**Linea 830**: `AND o.status != 'cancelado'`

Si el pedido esta cancelado, devuelve array vacio sin mensaje. El frontend no sabe si el pedido no existe o esta cancelado.

**Fix**: devolver objeto con flag `order_cancelled: true` o similar.
