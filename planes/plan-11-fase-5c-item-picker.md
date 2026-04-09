# Plan 11 — Fase 5c: Reescribir Item Picker (core del cambio)

## Objetivo
Reemplazar el item picker actual (items planos) por uno que soporta importar desde pedidos, facturas, y manual, con vinculos (order_item_id, invoice_item_id).

## Archivo: frontend/src/pages/Remitos.tsx

## Estado actual del item picker (lineas 664-733)
- Cada item tiene: product_name, description, quantity, unit
- Se pueden agregar/quitar items manualmente
- Al seleccionar un pedido (handleOrderSelect), se auto-llenan los items

## Nuevo item picker

### Seccion 1: Botones de importacion (reemplaza linea ~664-677)

Antes:
```tsx
<div className="flex items-center justify-between">
  <h3>Items del remito</h3>
  <Button onClick={handleAddItem}>+ Agregar item</Button>
</div>
```

Despues:
```tsx
<div className="flex items-center justify-between">
  <h3>Items del remito</h3>
  <div className="flex gap-2">
    <Button variant="outline" onClick={() => setShowOrderImporter(true)} disabled={!form.enterprise_id}>
      Importar de Pedido
    </Button>
    <Button variant="outline" onClick={() => setShowInvoiceImporter(true)} disabled={!form.enterprise_id}>
      Importar de Factura
    </Button>
    <Button onClick={handleAddManualItem}>+ Item manual</Button>
  </div>
</div>
```

### Seccion 2: Cada item row (reemplaza lineas ~679-731)

Antes: product_name, description, quantity, unit (todos editables)

Despues:
```tsx
{items.map((item, idx) => (
  <div key={idx} className="flex items-center gap-2 bg-gray-50 p-2 rounded">
    {/* Badge de origen */}
    <span className={`text-xs px-2 py-0.5 rounded ${
      item.source === 'order' ? 'bg-blue-100 text-blue-700' :
      item.source === 'invoice' ? 'bg-green-100 text-green-700' :
      'bg-gray-100 text-gray-600'
    }`}>
      {item.source_ref || 'Manual'}
    </span>

    {/* Producto (editable solo si manual) */}
    <Input
      value={item.product_name}
      onChange={e => handleItemChange(idx, 'product_name', e.target.value)}
      disabled={item.source !== 'manual'}
      className="flex-1"
      placeholder="Producto"
    />

    {/* Disponible (solo si tiene source) */}
    {item.qty_available != null && (
      <span className="text-xs text-gray-500 w-16 text-right">
        max: {item.qty_available}
      </span>
    )}

    {/* Cantidad */}
    <Input
      type="number"
      value={item.quantity}
      onChange={e => handleItemChange(idx, 'quantity', Math.min(
        parseFloat(e.target.value) || 0,
        item.qty_available ?? Infinity
      ))}
      className="w-20"
      min={0.01}
      max={item.qty_available}
      step="any"
    />

    {/* Precio (mostrar si existe, no editable) */}
    {item.unit_price != null && item.unit_price > 0 && (
      <span className="text-xs text-gray-500 w-24 text-right">
        ${item.unit_price.toLocaleString('es-AR')}
      </span>
    )}

    {/* Unidad */}
    <select value={item.unit} onChange={e => handleItemChange(idx, 'unit', e.target.value)}
      className="w-28 border rounded px-2 py-1 text-sm">
      {UNIT_OPTIONS.map(u => <option key={u} value={u}>{u}</option>)}
    </select>

    {/* Quitar */}
    <button onClick={() => handleRemoveItem(idx)} disabled={items.length === 1}
      className="w-8 h-8 text-red-500">✕</button>
  </div>
))}
```

### Seccion 3: Componente OrderItemsImporterForRemito (NUEVO)

Componente interno o extraido. Se abre como modal/collapsible:

```tsx
{showOrderImporter && (
  <div className="border rounded p-4 bg-blue-50 mb-4">
    <div className="flex justify-between mb-2">
      <h4 className="font-medium">Importar items de pedidos</h4>
      <button onClick={() => setShowOrderImporter(false)}>✕</button>
    </div>
    {/* Carga api.getAvailableOrderItemsForRemitoByEnterprise(form.enterprise_id) */}
    {/* Agrupa por pedido */}
    {/* Cada item: checkbox + qty input (max = qty_available) */}
    {/* Boton "Importar seleccionados" → agrega a items[] con source='order' */}
  </div>
)}
```

### Seccion 4: Componente InvoiceItemsImporterForRemito (NUEVO)

Igual pero para facturas:
```tsx
{showInvoiceImporter && (
  <div className="border rounded p-4 bg-green-50 mb-4">
    {/* Carga api.getInvoicesWithPendingDelivery(form.enterprise_id) */}
    {/* Agrupa por factura */}
    {/* Cada item: checkbox + qty input (max = qty_available) */}
    {/* Boton "Importar seleccionados" → agrega a items[] con source='invoice' */}
  </div>
)}
```

### State nuevo necesario:
```typescript
const [showOrderImporter, setShowOrderImporter] = useState(false);
const [showInvoiceImporter, setShowInvoiceImporter] = useState(false);
```

### handleAddManualItem:
```typescript
function handleAddManualItem() {
  setItems(prev => [...prev, {
    product_name: '', description: '', quantity: 1, unit: 'unidades',
    source: 'manual', source_ref: 'Manual',
  }]);
}
```

### handleCreateRemito actualizado (linea 272):
El payload que se envia ahora incluye los campos de linking:
```typescript
const payload = {
  ...form,
  items: validItems.map(i => ({
    product_name: i.product_name,
    description: i.description,
    quantity: i.quantity,
    unit: i.unit,
    product_id: i.product_id,
    unit_price: i.unit_price,
    vat_rate: i.vat_rate,
    order_item_id: i.order_item_id,
    invoice_item_id: i.invoice_item_id,
  })),
};
```

## Eliminar handleOrderSelect viejo
El dropdown de "Seleccionar pedido" (linea 618-640) se ELIMINA. Ahora los pedidos se importan desde el boton "Importar de Pedido" que abre el importer. Esto es mas claro y soporta multi-pedido.

## Verificacion
- Importar items de pedido → items aparecen con badge azul "Pedido #0003"
- Importar items de factura → items aparecen con badge verde "Factura B-002"
- Agregar item manual → badge gris "Manual"
- Cantidad no puede exceder qty_available
- Producto no editable si viene de pedido/factura
- Precio visible si existe
- Payload enviado tiene order_item_id/invoice_item_id correctos
- Multi-pedido: importar de 2 pedidos → items de ambos en la lista

## Complejidad: Alta (core del cambio)
