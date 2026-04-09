# Plan 11 — Fase 5b: URL Params + Navegacion

## Objetivo
Permitir abrir Remitos.tsx con parametros URL para pre-cargar datos. Esto habilita los flujos:
- Desde pedidos: "Crear remito" → /remitos?nuevo=true&order_id=XXX
- Desde facturas: "Crear remito" → /remitos?nuevo=true&invoice_id=XXX
- Desde remitos context: "Expand" → /remitos?expand=REMITO_ID

## Archivo: frontend/src/pages/Remitos.tsx

### Cambio 1: Agregar useSearchParams (linea 1)
```typescript
import { useSearchParams } from 'react-router-dom';
```

### Cambio 2: Leer params (despues de linea 158)
```typescript
const [searchParams, setSearchParams] = useSearchParams();
const preloadOrderId = searchParams.get('order_id');
const preloadInvoiceId = searchParams.get('invoice_id');
const preloadEnterpriseId = searchParams.get('enterprise_id');
const shouldOpenNew = searchParams.get('nuevo') === 'true';
const expandRemitoId = searchParams.get('expand');
```

### Cambio 3: useEffect para pre-carga (despues de loadStaticData effect)
```typescript
useEffect(() => {
  if (shouldOpenNew) {
    setShowForm(true);
    if (preloadEnterpriseId) {
      setForm(prev => ({ ...prev, enterprise_id: preloadEnterpriseId }));
    }
    if (preloadOrderId) {
      // Cargar items del pedido via nueva API
      loadOrderItemsForRemito(preloadOrderId);
    }
    if (preloadInvoiceId) {
      // Cargar items de la factura via nueva API
      loadInvoiceItemsForRemito(preloadInvoiceId);
    }
    // Limpiar params despues de pre-cargar
    setSearchParams({});
  }
}, [shouldOpenNew]);
```

### Cambio 4: useEffect para expand
```typescript
useEffect(() => {
  if (expandRemitoId) {
    setPreviewRemitoId(expandRemitoId);
    setSearchParams({});
  }
}, [expandRemitoId]);
```

### Funciones helper nuevas:
```typescript
async function loadOrderItemsForRemito(orderId: string) {
  const items = await api.getAvailableOrderItemsForRemito(orderId);
  if (items.length > 0) {
    const enterprise_id = items[0].enterprise_id;
    setForm(prev => ({ ...prev, enterprise_id }));
    setItems(items.map(i => ({
      product_name: i.product_name,
      description: i.description || '',
      quantity: parseFloat(i.qty_available),
      unit: 'unidades',
      product_id: i.product_id,
      unit_price: parseFloat(i.unit_price),
      vat_rate: i.vat_rate,
      order_item_id: i.order_item_id,
      source: 'order' as const,
      source_ref: `Pedido #${String(i.order_number).padStart(4, '0')}`,
      qty_available: parseFloat(i.qty_available),
    })));
  }
}
```

## Verificacion
- /remitos?nuevo=true&order_id=XXX → abre form con items del pedido
- /remitos?nuevo=true&invoice_id=XXX → abre form con items de la factura
- /remitos?expand=XXX → abre preview modal del remito
- Params se limpian despues de usar

## Complejidad: Baja
