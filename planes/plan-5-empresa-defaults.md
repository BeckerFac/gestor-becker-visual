# Plan 5: Empresa con lista de precios default + descuento default

## Contexto
Las empresas ya tienen `price_list_id` (lista default). Falta `default_discount` para que al crear un pedido se pre-carguen automaticamente la lista de precios y el descuento.

## Estado actual
- `enterprises.price_list_id`: existe en DB y UI (dropdown en form de empresa)
- NO existe `default_discount` en la tabla enterprises
- Orders.tsx: tiene selector de criterio de precio al crear pedido
- Al seleccionar empresa en pedido, NO se pre-carga la lista de precios de la empresa

## Relaciones
- **Depende de Plan 0**: necesita el campo `discount_percent` en pedidos para pre-llenarlo
- **Depende de Plan 3**: las listas de precios deben ser editables (nombre, %) para que tenga sentido asignarlas a empresas

## Cambios

### Backend (`backend/src/modules/enterprises/enterprises.service.ts` + `config/db.ts`):
- Migration: `ALTER TABLE enterprises ADD COLUMN IF NOT EXISTS default_discount DECIMAL(5,2) DEFAULT 0`
- `createEnterprise()`: recibir y guardar `default_discount`
- `updateEnterprise()`: aceptar y guardar `default_discount`
- `getEnterprises()`/`getEnterprise()`: retornar `default_discount` (ya viene con SELECT *)

### Frontend (`frontend/src/pages/Enterprises.tsx`):
- Form crear/editar: agregar input "Descuento predeterminado %" (0-100) debajo del selector de lista de precios
- Mostrar en detalle/tabla de empresa si > 0

### Frontend (`frontend/src/pages/Orders.tsx`):
- Al seleccionar empresa en form de pedido (`handleEnterpriseChange` o similar):
  1. Buscar la empresa seleccionada en el array `enterprises`
  2. Si tiene `price_list_id`: auto-seleccionar esa lista en el dropdown de criterio de precio
  3. Si tiene `default_discount > 0`: auto-llenar el campo `discount_percent` (del Plan 0)
  4. Mostrar indicador sutil: "(Pre-configurado: Lista Mayorista, Descuento 10%)" debajo del enterprise selector
  5. Ambos valores son modificables por el usuario (no se bloquean)

## Flujo completo
1. Crear empresa "Pampa SAS" con lista "Mayorista" (+15%) y descuento 5%
2. Crear pedido -> seleccionar "Pampa SAS"
3. Auto: lista "Mayorista" seleccionada -> precios de items resueltos al +15%
4. Auto: descuento 5% pre-llenado -> total refleja -5% sobre neto
5. Usuario puede cambiar lista y/o descuento si quiere para este pedido puntual

## Verificacion
- Crear empresa con lista + descuento 8%
- Crear pedido para esa empresa -> verificar lista auto-seleccionada y descuento 8% pre-llenado
- Cambiar descuento a 0% en el pedido -> total vuelve a sin descuento
- Crear pedido para empresa SIN lista/descuento -> todo queda en blanco/0%
