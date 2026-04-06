# Plan 0: Descuento % en Pedidos + Quitar Formas de Pago

## Contexto
Los pedidos NO son el lugar para definir forma de pago (eso va en recibos/cobros). Se necesita un campo de descuento % global aplicado al total del pedido.

## Estado actual
- Tabla `orders`: NO tiene columna `discount_percent`
- Form de pedido: tiene selector "Forma de Pago" + "Banco" al final (lines ~1536-1582)
- Totales: calcula Neto + IVA = Total, sin descuento
- `order_items` tampoco tiene descuento

## Cambios

### Backend (`backend/src/modules/orders/orders.service.ts`):
- `ensureMigrations()`: `ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount_percent DECIMAL(5,2) DEFAULT 0`
- `createOrder()`: recibir `discount_percent`, aplicar al calculo:
  ```
  subtotal_neto = SUM(qty * unit_price) por cada item
  descuento_monto = subtotal_neto * (discount_percent / 100)
  neto_con_descuento = subtotal_neto - descuento_monto
  total_iva = SUM por item: (qty * unit_price * (1 - discount_percent/100)) * vat_rate/100
  total = neto_con_descuento + total_iva
  ```
  Guardar `discount_percent` en el INSERT
- `updateOrder()`: aceptar y guardar `discount_percent`

### Frontend (`frontend/src/pages/Orders.tsx`):
- Form: agregar input "Descuento %" numerico (0-100) entre items y totales (~line 1509)
- Form: ELIMINAR bloque "Forma de Pago" (~lines 1536-1539) y "Banco" (~lines 1540-1582)
- Totales: agregar linea "Descuento (X%): -$XXX" entre Neto y Total
- Interface Order: agregar `discount_percent: number`
- Form state: agregar `discount_percent: 0` al initial form
- Expandable: en el resumen Neto/IVA/Total, mostrar descuento si > 0

## Relacion con Plan 5
El `default_discount` de la empresa se pre-carga en este campo al crear pedido.

## Verificacion
- Crear pedido con descuento 10%, total = (neto * 0.9) + IVA_proporcional
- Verificar que NO aparece forma de pago en el form
- Expandir pedido, verificar que muestra descuento en resumen
