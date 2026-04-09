# Plan 11 — Fase 7a: RemitoItemsImporter en Facturas

## Objetivo
Agregar componente "Importar de Remito" en la pagina de facturas, similar al OrderItemsImporter existente (lineas 201-309).

## Archivo: frontend/src/pages/Invoices.tsx

## Componente nuevo: RemitoItemsImporter (insertar despues de OrderItemsImporter ~linea 309)

### Props:
```typescript
const RemitoItemsImporter: React.FC<{
  enterpriseId?: string;
  onImport: (items: any[]) => void;
  existingRemitoItemIds?: string[];
}>;
```

### Logica interna:
1. Cuando se abre (open=true) y hay enterpriseId, llama `api.getRemitosWithPendingItems(enterpriseId)`
2. Muestra remitos agrupados con items disponibles
3. Cada item tiene input de qty (max = qty_available)
4. Al importar, mapea cada item a formato de invoice form item con remito_item_id

### JSX:
```tsx
<div className="border rounded p-3 bg-green-50 mb-3">
  <div className="flex justify-between items-center mb-2">
    <h4>Importar items de Remitos</h4>
    <button onClick={() => setOpen(false)}>✕</button>
  </div>

  {loading ? <p>Cargando...</p> : remitos.length === 0 ? (
    <p>No hay remitos con items pendientes de facturar</p>
  ) : (
    remitos.map(remito => (
      <div key={remito.remito_id} className="mb-3">
        <h5>Remito #{remito.remito_number} ({formatDate(remito.date)})</h5>
        {remito.items.map(item => (
          <div key={item.remito_item_id} className="flex items-center gap-2">
            <span>{item.product_name}</span>
            <span className="text-xs text-gray-500">disp: {item.qty_available}</span>
            <input type="number" max={item.qty_available} min={0}
              value={selectedQty[item.remito_item_id] || ''}
              onChange={e => setSelectedQty(prev => ({...prev, [item.remito_item_id]: e.target.value}))}
            />
            <button onClick={() => setSelectedQty(prev => ({...prev, [item.remito_item_id]: String(item.qty_available)}))}>
              Todo
            </button>
          </div>
        ))}
      </div>
    ))
  )}

  <Button onClick={handleImport}>Importar seleccionados</Button>
</div>
```

### handleImport:
```typescript
const handleImport = () => {
  const imported = [];
  for (const remito of remitos) {
    for (const item of remito.items) {
      const qty = parseFloat(selectedQty[item.remito_item_id] || '0');
      if (qty > 0) {
        imported.push({
          product_name: item.product_name,
          quantity: qty,
          unit_price: parseFloat(item.unit_price || '0'),
          vat_rate: item.vat_rate || 21,
          order_item_id: item.order_item_id || null,
          remito_item_id: item.remito_item_id,
        });
      }
    }
  }
  onImport(imported);
  setOpen(false);
};
```

### Ubicacion en el form de factura:
Justo debajo del OrderItemsImporter:
```tsx
<OrderItemsImporter ... />
<RemitoItemsImporter
  enterpriseId={formEnterpriseId}
  existingRemitoItemIds={formItems.filter(i => i.remito_item_id).map(i => i.remito_item_id)}
  onImport={importedItems => setFormItems(prev => [...prev, ...importedItems])}
/>
```

### URL param: /facturas?nuevo=true&remito_id=XXX
```typescript
const preloadRemitoId = searchParams.get('remito_id');
useEffect(() => {
  if (preloadRemitoId) {
    // Auto-open form, load remito items, pre-select enterprise
  }
}, [preloadRemitoId]);
```

## Verificacion
- Boton "Importar de Remito" visible cuando hay empresa seleccionada
- Muestra remitos con items pendientes agrupados
- Input de qty tiene max correcto
- "Todo" llena el max
- Items importados tienen remito_item_id
- /facturas?nuevo=true&remito_id=XXX pre-carga items del remito

## Complejidad: Alta (componente nuevo completo)
