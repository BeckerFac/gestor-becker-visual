# SECCION 6 — Expandible + Context menu

## Scope
Endpoints:
- `GET /remitos` (list, con filtros para expandable view)
- `GET /remitos/:id` (expandable detail)
- `GET /remitos/context/:id` → `getRemitoContextData` (para items status)
- `GET /remitos/:id/pdf` (context menu "Imprimir")
- `GET /remitos/:id/signed-pdf` (ver firmado)
- `POST /remitos/:id/signed-pdf` (subir firmado)

## Bugs sospechados

### BUG #1 CRITICAL IDOR: `getRemitoContextData` sin company_id check
```ts
SELECT ri.id, ... FROM remito_items ri WHERE ri.remito_id = $1
```
Cualquier usuario puede leer items de cualquier remito de cualquier company pasando el UUID.

### BUG #2 HIGH IDOR: `getRemito` enterprise subquery sin company_id
```ts
SELECT ... FROM enterprises WHERE id = $1
```
Si el remito tiene enterprise_id dirty (punter a otra company), leak de nombre/CUIT/razon social.

### BUG #3 HIGH: `getRemitos` `limit` sin validacion
Cliente puede pasar `?limit=999999999` → scan completo de tabla. DoS via memory.

### BUG #4 HIGH: `getRemitos` `skip` negativo o no-numerico
`parseInt` devuelve NaN si viene texto. NaN inyectado a OFFSET puede causar error SQL verbose.

### BUG #5 MEDIUM: `getRemitos` search con wildcards SQL sin escape
`ILIKE '%${search}%'` — si search tiene `%` o `_`, matchea mas de lo esperado. No es sec issue pero semantic.

### BUG #6 MEDIUM: `getRemitos` `date_to` concat string sin TZ
`r.date <= ${date_to + 'T23:59:59'}` — Assumes local midnight. Si server est en UTC y usuario en AR, cutoff wrong.

### BUG #7 HIGH: `getRemitos.total` is rows.length (post-limit)
Devuelve `total: rows.length` que es la PAGINA actual, no el total real. Pagination UI quebrada.

### BUG #8 MEDIUM: `getRemitos` status/tipo sin whitelist
Usuario puede pasar `?status=ANY_STRING`. Siempre devuelve vacio si no existe, pero desperdicia query.

### BUG #9 HIGH: `getRemito` items query con `ORDER BY ri.id ASC`
IDs son UUIDs aleatorios, no ordering estable. El orden de items en la UI cambia entre llamadas.

### BUG #10 CRITICAL: `recalculateQtyDelivered` metodo publico sin company_id
Llamable desde otros services sin ownership check. Si se expone accidentalmente, IDOR.

### BUG #11 HIGH: `getSignedPdf` retorna base64 sin validar formato
Si alguien uploadea string sin header `%PDF`, getSignedPdf devuelve string arbitrario. upload ya valida, pero dirty data pre-fix puede colar.

### BUG #12 MEDIUM: `getRemitos` `enterprise_id` filtro sin validar UUID
Inject `?enterprise_id=not-a-uuid` → PG error verbose.
