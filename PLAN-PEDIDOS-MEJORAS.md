# Plan: Mejoras de Pedidos - Navegacion, Precios, Estado de Pago

## Estado Actual (problemas detectados)

### Problema 1: Sin context menu (click derecho) en pedidos
- No existe context menu en Orders.tsx
- No hay forma de navegar directamente a facturas/recibos vinculados
- No hay forma rapida de crear factura desde click derecho

### Problema 2: Precios desaparecen en items facturados
- Seccion "Facturado" (linea 1749-1775): solo muestra Producto | Cant. Facturada | En Factura(s)
- **NO muestra**: P. Unitario, Subtotal → el usuario pierde visibilidad de montos
- Seccion "Sin Facturar" SI muestra precios (P. Unitario, Subtotal Pend.)

### Problema 3: Falta Neto Total y Total con IVA en desglose
- Solo se muestra IVA % (linea 1823-1824)
- No hay resumen de: Neto (sin IVA), IVA monto, Total con IVA
- Se necesita para ambas secciones (facturado y sin facturar)

### Problema 4: Estado de pago es MANUAL
- Lineas 1959-1972: dropdown manual (pendiente/parcial/pagado)
- Deberia calcularse automaticamente desde las facturas vinculadas
- Ya existe `recalculateOrderPaymentStatusFromInvoices()` en cobro-applications.service.ts (lineas 346-379)
- Pero el frontend permite override manual que desincroniza el estado

### Problema 5: Links a facturas no son clickeables
- Tags de facturas en expandable (lineas 1763-1769) son solo texto
- Los botones Ver/Ver Autorizar en col 3 (lineas 2045-2104) NO navegan a /invoices
- Solo abren un preview inline dentro de Orders

### Bug adicional detectado: Sincronizacion de payment_status
- `recalculateOrderPaymentStatusFromInvoices()` existe en backend
- Pero se llama SOLO cuando se linkea un cobro a una factura
- Si se crea un cobro SIN linkear a factura, el order.payment_status no se actualiza
- El dropdown manual en frontend genera inconsistencia con el calculo real

---

## Cambios Planificados

### Cambio 1: Context Menu (click derecho) en filas de pedidos
**Archivo**: `frontend/src/pages/Orders.tsx`

**Items del menu segun estado:**

A) Si `invoice_status === 'sin_facturar'`:
   - "Crear Factura" → navega a /invoices?preload=1 con sessionStorage (reutiliza handleGoToInvoice existente pero con todos los items)

B) Si `invoice_status === 'parcial'`:
   - "Ver Factura(s)" → submenu con cada factura vinculada → navega a /invoices?expand=INVOICE_ID
   - "Facturar Items Pendientes" → navega a /invoices?preload=1 con items pendientes

C) Si `invoice_status === 'facturado'`:
   - "Ver Factura(s)" → submenu con cada factura vinculada → navega a /invoices?expand=INVOICE_ID

D) Siempre:
   - "Ver Recibos" (solo si hay cobros vinculados a las facturas de este pedido) → navega a /recibos?expand=COBRO_ID
   - "Editar" → abre edicion
   - Separador
   - "Eliminar" → elimina pedido

**Implementacion:**
- Importar `ContextMenuBase` y `useContextMenu` (ya usados en PipelineKanban)
- Agregar `onContextMenu` en cada fila `<tr>`
- Construir items dinamicamente segun estado de facturacion

**Endpoint necesario (NUEVO)**: `GET /api/orders/:id/linked-receipts`
- Busca cobros que tienen cobro_invoice_applications vinculadas a facturas de este pedido
- Retorna: [{cobro_id, receipt_number, amount, date}]

### Cambio 2: Tags de facturas clickeables en expandable
**Archivo**: `frontend/src/pages/Orders.tsx` (lineas 1763-1769)

- Cambiar `<span>` por `<button>` con onClick
- onClick navega a `/invoices?expand=INVOICE_ID`
- Usar `navigate('/invoices?expand=' + inv.invoice_id)` (react-router)

**Archivo**: `frontend/src/pages/Invoices.tsx`
- Leer `searchParams.get('expand')` al montar
- Si hay expand param, setear `expandedInvoiceId` al valor
- Scroll to the invoice row via ref o scrollIntoView

### Cambio 3: Precios visibles en seccion Facturado
**Archivo**: `frontend/src/pages/Orders.tsx` (lineas 1749-1775)

**Antes:**
```
Producto | Cant. Facturada | En Factura(s)
```

**Despues:**
```
Producto | Cant. | P. Unitario | Subtotal | En Factura(s)
```

- `unit_price` ya viene en el endpoint getOrderInvoicingDetail (campo `unit_price`)
- Subtotal = qty_invoiced * unit_price
- Agregar columnas al thead y tbody

### Cambio 4: Neto Total y Total con IVA en desglose
**Archivo**: `frontend/src/pages/Orders.tsx` (despues de seccion items, antes de IVA)

Agregar resumen al final de las tablas de items:

```
Neto (sin IVA):     $X.XXX,XX
IVA (21%):          $X.XXX,XX
Total con IVA:      $X.XXX,XX
```

Calculo:
- neto_facturado = SUM(qty_invoiced * unit_price) para items facturados
- neto_pendiente = SUM(qty_remaining * unit_price) para items sin facturar
- neto_total = neto_facturado + neto_pendiente (deberia = order.total_amount / 1.21 aprox)
- iva_monto = neto_total * (vat_rate / 100)
- total = neto_total + iva_monto

Nota: cada item puede tener vat_rate diferente, calcular por item:
```
total_neto = SUM(qty * unit_price) por cada item
total_iva = SUM(qty * unit_price * vat_rate / 100) por cada item
total = total_neto + total_iva
```

### Cambio 5: Payment status automatico (read-only)
**Archivo**: `frontend/src/pages/Orders.tsx` (lineas 1959-1972)

**Antes:** Dropdown editable (pendiente/parcial/pagado)
**Despues:** Badge read-only que muestra el estado calculado

- Remover el `<select>` manual
- Mostrar badge como en la columna de la tabla (verde/amarillo/rojo)
- El estado viene de `order.payment_status` que ya se calcula en backend via `recalculateOrderPaymentStatusFromInvoices()`

**Backend fix necesario**: Asegurar que `recalculateOrderPaymentStatusFromInvoices()` se llama:
1. Cuando se crea un cobro (ya existe)
2. Cuando se autoriza una factura vinculada a un pedido (verificar)
3. Cuando se elimina/anula un cobro (verificar)

**Archivo**: `backend/src/modules/cobro-applications/cobro-applications.service.ts`
- Verificar que recalculateOrderPaymentStatusFromInvoices se llama en todos los flujos

**Archivo**: `backend/src/modules/orders/orders.service.ts`
- Remover la capacidad de setear payment_status manualmente (o ignorar si viene en updateOrder)

### Cambio 6: Facturas en col 3 tambien clickeables
**Archivo**: `frontend/src/pages/Orders.tsx` (lineas 2045-2104)

Los botones "Ver" y "Ver / Autorizar" actualmente abren preview inline.
Agregar un boton adicional "Ir a Factura" que navega a /invoices?expand=INVOICE_ID.
O mejor: hacer el numero de factura (ej "A 00005-21023107") clickeable como link a /invoices?expand=ID.

---

## Orden de Implementacion

1. **Cambio 3** (precios en facturado) - mas simple, 0 riesgo
2. **Cambio 4** (neto/iva/total) - calculo local, 0 riesgo  
3. **Cambio 5** (payment status auto) - requiere backend + frontend
4. **Cambio 2** (tags clickeables + Invoices expand param) - requiere ambos lados
5. **Cambio 6** (facturas col 3 clickeables) - depende de cambio 2
6. **Cambio 1** (context menu) - mas complejo, depende de 2 y endpoint nuevo

## Errores de Sincronizacion Detectados

1. **payment_status manual vs automatico**: El dropdown permite setear "pagado" manualmente aunque no haya cobros. Solucion: hacerlo read-only.

2. **cobro sin factura**: Si se crea un cobro vinculado directamente a un order (legacy cobros.order_id), no pasa por cobro_invoice_applications y no recalcula el payment_status del order. Solucion: ya migrado al nuevo sistema, pero verificar que NO se permita crear cobros sin vincular a factura.

3. **invoice_status vs payment_status**: Son dos estados independientes pero relacionados:
   - invoice_status: sin_facturar → parcial → facturado (progreso de emision de facturas)
   - payment_status: pendiente → parcial → pagado (progreso de cobro de facturas)
   - Un pedido puede estar "facturado" pero "no pagado" → correcto
   - Un pedido NO deberia poder estar "pagado" si no esta al menos parcialmente facturado → agregar validacion

4. **Precios en items facturados**: El endpoint getOrderInvoicingDetail ya retorna unit_price para TODOS los items. Solo el frontend no lo muestra para facturados. Fix puro de frontend.

5. **Total del pedido vs suma de items**: order.total_amount deberia = SUM(qty * unit_price * (1 + vat_rate/100)). Si hay discrepancia, mostrar el calculado por items (mas confiable).
