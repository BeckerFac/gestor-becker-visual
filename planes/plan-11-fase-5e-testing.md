# Plan 11 — Fase 5e: Testing de Fase 5 completa

## Objetivo
Verificar que todos los cambios de Fase 5 (a-d) funcionan correctamente.

## Tests a ejecutar

### Test 1: TypeScript compila
```bash
npx tsc --noEmit
```
Debe pasar sin errores en frontend Y backend.

### Test 2: Build de frontend
```bash
cd frontend && npx vite build
```
Debe compilar sin errores.

### Test 3: Backend test suite completa
```bash
cd backend && npx vitest run
```
Todos los tests existentes + nuevos deben pasar.

### Test 4: Verificar API methods existen
Grep en api.ts por los 7 metodos nuevos:
```
getAvailableOrderItemsForRemito
getAvailableOrderItemsForRemitoByEnterprise
getAvailableInvoiceItemsForRemito
getInvoicesWithPendingDelivery
getRemitoContextData
getAvailableRemitoItemsForInvoicing
getRemitosWithPendingItems
```

### Test 5: Verificar tipos existen
Grep en Remitos.tsx por:
```
RemitoItemWithSource
order_item_id
invoice_item_id
source: 'order'
source: 'invoice'
source: 'manual'
```

### Test 6: Verificar URL params
Grep en Remitos.tsx por:
```
useSearchParams
order_id
invoice_id
expand
```

### Test 7: Verificar item picker
Grep en Remitos.tsx por:
```
Importar de Pedido
Importar de Factura
Item manual
showOrderImporter
showInvoiceImporter
qty_available
source_ref
```

### Test 8: Verificar payload incluye campos nuevos
Grep en handleCreateRemito por:
```
order_item_id
invoice_item_id
product_id
unit_price
vat_rate
pedido_ref
factura_ref
```

## Orden de ejecucion
1. Test 1 (tsc) → si falla, arreglar tipos
2. Test 2 (build) → si falla, arreglar imports/JSX
3. Test 3 (backend tests) → debe seguir 415/415
4. Tests 4-8 (verificacion estatica) → confirmar que todo existe

## Criterio de exito
- 0 errores TypeScript
- Build exitoso
- 415+ tests pasan
- Todos los greps encuentran resultados
