# Plan 3 + 3.1: Modificar Listas de Precios (nombre + % global)

## Contexto
Las listas de precios se crean/eliminan pero no se pueden renombrar desde la UI. Se necesita: editar nombre, y poder configurar un % global sobre precio base que aplique a todos los productos. Tambien poder poner precios fijos por producto individual.

## Estado actual
- Backend `updatePriceList()` en `price-lists.service.ts`: YA soporta actualizar `name`, `type`, `valid_from`, `valid_to`, `active`
- Backend regla `percentage`: YA existe y funciona (rule_type='percentage', value=15 -> +15%)
- Backend regla `fixed`: YA existe (precio fijo por producto)
- `PriceListsManager.tsx`: muestra nombre como texto estático, NO editable inline
- API `api.updatePriceList(id, { name })`: existe en api.ts pero no se usa en la UI
- Bulk operation `increase_percent`: existe en backend

## Cambios

### Frontend (`frontend/src/components/products/PriceListsManager.tsx`):

**Nombre editable inline:**
- State nuevo: `editingListName: { id: string; name: string } | null`
- Al click en el nombre de la lista: se convierte en `<input>` editable
- Al blur/Enter: `api.updatePriceList(id, { name: newName })` + toast "Nombre actualizado"
- El cambio se propaga automaticamente porque los productos referencian `price_list_id` (UUID), no el nombre

**Seccion "% sobre precio base" por lista:**
- Mostrar input numerico "Ajuste % global" al lado de cada lista
- Leer el valor actual de la regla `percentage` global (sin product_id, sin category_id) de esa lista
- Al cambiar y confirmar:
  - Si no existe regla global percentage: `api.addPriceListRule(listId, { rule_type: 'percentage', value: X, product_id: null, category_id: null })`
  - Si ya existe: actualizar la regla existente (necesita endpoint PUT rule)
- Preview inline: "Ej: producto de $100 -> $115 (+15%)"

**Precio fijo por producto (3.1):**
- Ya existe en tab "Reglas" del PriceListsManager
- Mejorar labels: "Porcentaje sobre precio base" vs "Precio fijo por producto"
- Selector claro de alcance: "Todos los productos" (global) vs "Producto especifico" vs "Categoria"

### Backend - Verificar que existe:
- `PUT /price-lists/:id` -> actualizar nombre ✓ (ya existe)
- `POST /price-lists/:id/rules` -> crear regla ✓ (ya existe)
- Falta: `PUT /price-lists/:id/rules/:ruleId` para ACTUALIZAR regla existente
  - Agregar en `price-lists.router.ts` y `price-lists.service.ts` si no existe

## Relacion con Plan 5
Cuando una empresa tiene una lista asignada, los pedidos usan los precios resueltos de esa lista (ya funciona).

## Verificacion
- Renombrar lista "Lista1" -> "Mayorista" -> verificar que se actualiza en todos lados
- Aplicar +15% global a "Mayorista" -> todos los productos muestran precio_base * 1.15 en precios resueltos
- Poner precio fijo $500 a un producto especifico -> ese producto muestra $500, el resto sigue con %
- Cambiar % de 15 a 20 -> precios se actualizan
