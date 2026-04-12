# SECCION 10 — Edge cases

## Scope
Todos los endpoints — edge cases, boundary values, invalid input, race conditions residuales, unicode, DoS.

## Bugs sospechados

### BUG #1 CRITICAL: updateRemito permite editar remitos ANULADOS
Sin check `status !== 'anulado'`. Se puede modificar header de un remito anulado.

### BUG #2 HIGH: updateRemito sin validacion de length de campos
`delivery_address`, `receiver_name`, `transport`, `notes` sin limite — permitir 1MB de notes.

### BUG #3 HIGH: updateRemito sin validacion de date format
`date: data.date || existing.date` — puede entrar 'garbage-date'.

### BUG #4 HIGH: createRemito date range sin validar
Fecha futura año 3000 o pasado año 1900 aceptada. Back-dating fiscal.

### BUG #5 MEDIUM: createRemito punto_venta sin validar rango
Puede ser -1, NaN, 999999.

### BUG #6 HIGH: createRemito tipo whitelist permisiva
`tipo === 'recepcion' ? 'recepcion' : 'entrega'` — cualquier otro valor cae en 'entrega' sin error. Debería rechazar `tipo: 'garbage'`.

### BUG #7 HIGH: Items unit_price puede ser negativo
Sin validar `unit_price >= 0`.

### BUG #8 HIGH: Items vat_rate puede ser cualquier numero
Sin validar 0 <= vat_rate <= 100.

### BUG #9 HIGH: getRemitos search sin limite de length
DoS: search=A.repeat(1e6) → query enorme.

### BUG #10 MEDIUM: updateRemitoStatus sin state machine
entregado → pendiente, firmado → pendiente permitidos silenciosamente.

### BUG #11 MEDIUM: getRemitos date_from sin validar formato
`r.date >= ${date_from}` acepta texto arbitrario, PG falla con error feo.

### BUG #12 LOW: createRemito NO maneja Unicode RTL/zero-width
product_name con `U+202E` (RTL override) puede ocultar strings en PDF/UI.
