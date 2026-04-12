# SECCION 3 — Remito con items manuales + stock

## Scope
- T3.1: Remito manual con producto que controla stock
- T3.2: Remito manual con texto libre (sin producto)
- T3.3: Anular remito con items manuales devuelve stock

## Bugs sospechados en profundidad

### BUG #1 CRITICAL: Stock race condition (no hay lock)
El UPDATE de `stock` NO tiene `FOR UPDATE` lock. 2 remitos simultaneos del mismo producto pueden oversell.

### BUG #2 CRITICAL: Stock puede quedar NEGATIVO
`UPDATE stock SET quantity = quantity - $1` — sin CHECK de que quantity >= 0. Si hay 5 en stock y mando remito de 10, stock queda -5.

### BUG #3 CRITICAL: Warehouse wrong al anular (se busca "default" pero el original puede haber sido otro)
Al crear, hace `SELECT id FROM warehouses ORDER BY created_at ASC LIMIT 1`. Al anular, MISMO query. Pero si entre creacion y anulacion se crea un nuevo warehouse, puede cambiar el default y devolver stock al warehouse incorrecto.

**PEOR AUN**: El stock_movement del remito original guarda `warehouse_id` pero `anularRemito` NO lo usa — busca el warehouse actual por defecto. **Stock puede ir a warehouse equivocado.**

### BUG #4 HIGH: Stock_movement se crea aunque UPDATE stock afecte 0 rows
Si el producto no tiene row en `stock` todavia (recien creado), el UPDATE afecta 0 filas pero el `stock_movement` se inserta igual. **Inconsistencia**.

### BUG #5 HIGH: No valida que el producto EXISTA
`SELECT controls_stock FROM products WHERE id = $1 AND company_id = $2` — si el producto NO existe, `prodCheck.rows[0]?.controls_stock` es undefined, `if (undefined)` es false, y se silencia. Se crea el remito_item con `product_id` que no existe. **Foreign key orphan**.

### BUG #6 HIGH: Items manuales no validan length de product_name
Sin limite max. Puede guardar 100KB en product_name.

### BUG #7 MEDIUM: "controls_stock" case sensitivity
Si la columna es boolean PostgreSQL, `controls_stock = 't'` o `true`. El check `if (prodCheck.rows[0]?.controls_stock)` solo funciona si PG devuelve `true` boolean, no string `'t'`. Dependiendo del driver, puede ser string.

### BUG #8 MEDIUM: notes hardcoded en espanol
`notes: 'Remito item manual'` — ineternacionalizacion rota.

### BUG #9 HIGH: anularRemito no usa warehouse_id del stock_movement original
Busca warehouse actual en vez de el warehouse donde se descontó. Si hay multiples warehouses, stock vuelve al incorrecto.

### BUG #10 MEDIUM: anularRemito no valida que stock_movement exista
Si alguien borra manualmente el stock_movement, anular no reconstruye correctamente.

### BUG #11 HIGH: Pedido 'cancelled' (ingles) NO es filtrado
`WHERE o.status != 'cancelado'` — solo filtra 'cancelado' espanol, no 'cancelled' ingles. Si un pedido se cancela con status en ingles, aparece en availability.

### BUG #12 MEDIUM: Decimal precision en stock
`UPDATE stock SET quantity = COALESCE(quantity, 0) - $1` — PG convierte correctamente, pero si qty es 3.5 y producto es unidades, deberia rechazar.
