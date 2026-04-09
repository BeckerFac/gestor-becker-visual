# Plan 11 — Fase 7: Frontend Facturas — RemitoItemsImporter + Bloqueo Remitados

## Objetivo
Agregar importador de items desde remitos en la pagina de facturas, y bloquear items remitados en el importador de pedidos existente.

## Pre-requisitos
- Fase 4 (endpoint getAvailableRemitoItemsForInvoicing, getRemitosWithPendingItems)
- Fase 2 (getAvailableOrderItemsForInvoicing con qty_remito_pending_invoice)

## Archivo a modificar
- `frontend/src/pages/Invoices.tsx`

## Cambio 1: Nuevo componente RemitoItemsImporter

Similar a `OrderItemsImporter` (lineas 201-309 de Invoices.tsx).

```typescript
const RemitoItemsImporter: React.FC<{
  enterpriseId?: string;
  onImport: (items: InvoiceFormItem[]) => void;
  existingRemitoItemIds?: string[];
}> = ({ enterpriseId, onImport, existingRemitoItemIds = [] }) => {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [remitos, setRemitos] = useState<any[]>([]);
  const [selectedQty, setSelectedQty] = useState<Record<string, string>>({});

  const loadRemitos = async () => {
    if (!enterpriseId) return;
    setLoading(true);
    const data = await api.getRemitosWithPendingItems(enterpriseId);
    // Filtrar items ya importados
    setRemitos(data.filter(r => r.items.some(i => !existingRemitoItemIds.includes(i.remito_item_id))));
    setLoading(false);
  };

  useEffect(() => { if (open && enterpriseId) loadRemitos(); }, [open, enterpriseId]);

  const handleImport = () => {
    const items: InvoiceFormItem[] = [];
    for (const remito of remitos) {
      for (const item of remito.items) {
        const qty = parseFloat(selectedQty[item.remito_item_id] || '0');
        if (qty > 0) {
          items.push({
            product_name: item.product_name,
            quantity: qty,
            unit_price: item.unit_price || 0,
            vat_rate: item.vat_rate || 21,
            order_item_id: item.order_item_id || null,
            remito_item_id: item.remito_item_id,
          });
        }
      }
    }
    onImport(items);
    setOpen(false);
  };

  // Render: similar a OrderItemsImporter pero agrupado por remito
};
```

### UI del componente:
```
┌──────────────────────────────────────────────────────────┐
│ Importar items de Remitos                          [X]   │
├──────────────────────────────────────────────────────────┤
│                                                          │
│ Remito #0005 (24/03/2026) — Garcia Construcciones       │
│   Pintura 20L    │ disponible: 2 │ facturar: [2] [Todo] │
│   Cemento 50kg   │ disponible: 3 │ facturar: [3] [Todo] │
│                                                          │
│ Remito #0008 (28/03/2026) — Garcia Construcciones       │
│   GoBecker Int   │ disponible: 1 │ facturar: [1] [Todo] │
│                                                          │
├──────────────────────────────────────────────────────────┤
│ [Importar seleccionados]                                 │
└──────────────────────────────────────────────────────────┘
```

### Ubicacion en el form de factura:
Justo debajo del OrderItemsImporter existente (linea ~1455):

```tsx
<OrderItemsImporter ... />
<RemitoItemsImporter
  enterpriseId={formEnterpriseId}
  existingRemitoItemIds={formItems.filter(i => i.remito_item_id).map(i => i.remito_item_id!)}
  onImport={(importedItems) => {
    setFormItems(prev => [...prev, ...importedItems]);
  }}
/>
```

## Cambio 2: Modificar OrderItemsImporter — bloquear items remitados

**Archivo**: `Invoices.tsx` → `OrderItemsImporter` (lineas 201-309)

### Cambios en la data:
La API ahora devuelve `qty_available_direct`, `qty_remito_pending_invoice`, y `remito_info` por item.

### Render:
Cada item ahora tiene 2 estados posibles:

**Estado 1: Disponible para facturar directo** (qty_available_direct > 0)
```
☑ Pintura 20L │ 3 disponibles │ facturar: [3] [Todo]
```

**Estado 2: Remitado, facturar desde remito** (qty_remito_pending_invoice > 0)
```
🔒 Pintura 20L │ 5 remitadas │ Facturar desde Remito #0005 →
```
- Input DESHABILITADO
- Link clickeable al remito o al RemitoItemsImporter
- Color gris/amarillo para diferenciar

### Implementacion:
```tsx
{item.qty_available_direct > 0 ? (
  // Input habilitado como hoy
  <input type="number" max={item.qty_available_direct} ... />
) : null}

{item.qty_remito_pending_invoice > 0 && (
  <div className="text-amber-600 text-sm flex items-center gap-1">
    <LockIcon className="w-4 h-4" />
    {item.qty_remito_pending_invoice} en Remito 
    {item.remito_info?.map(r => (
      <button onClick={() => /* scroll to RemitoItemsImporter o navigate */}>
        #{String(r.remito_number).padStart(5, '0')}
      </button>
    ))}
    — facturar desde el remito
  </div>
)}
```

## Cambio 3: URL params para pre-cargar remito

Soportar: `/facturas?nuevo=true&remito_id=XXX`

```typescript
const [searchParams] = useSearchParams();
const preloadRemitoId = searchParams.get('remito_id');

useEffect(() => {
  if (preloadRemitoId) {
    setShowForm(true);
    // Cargar items del remito pendientes
    api.getAvailableRemitoItemsForInvoicing(preloadRemitoId).then(items => {
      // Pre-llenar empresa del remito
      // Pre-llenar items con remito_item_id
    });
  }
}, [preloadRemitoId]);
```

## Cambio 4: Agregar remito_item_id al payload de createInvoice

El form de factura ya envia `order_item_id` por item. Agregar `remito_item_id`:

```typescript
const payload = {
  ...formData,
  items: formItems.map(item => ({
    product_name: item.product_name,
    quantity: item.quantity,
    unit_price: item.unit_price,
    vat_rate: item.vat_rate,
    order_item_id: item.order_item_id || null,
    remito_item_id: item.remito_item_id || null,  // NUEVO
  })),
};
```

## Cambio 5: Context menu de facturas — agregar remitos vinculados

Similar al cambio en pedidos, agregar seccion de remitos vinculados en el context menu de facturas:

```
Click derecho en Factura B-003:
┌──────────────────────────────────────────┐
│ Remitos vinculados:                      │
│   📦 Remito #0005 (entregado) → click   │
│                                          │
│ [Crear remito de esta factura]           │
└──────────────────────────────────────────┘
```

"Crear remito de esta factura" → navega a `/remitos?nuevo=true&invoice_id=INVOICE_ID`

## API client nuevas

```typescript
// api.ts
getRemitosWithPendingItems(enterpriseId: string): Promise<RemitoWithPendingItems[]>
getAvailableRemitoItemsForInvoicing(remitoId: string): Promise<RemitoItemForInvoicing[]>
```

## Verificacion
1. RemitoItemsImporter muestra remitos con items pendientes agrupados
2. OrderItemsImporter bloquea items remitados con link al remito
3. Crear factura desde remito: items tienen remito_item_id
4. URL /facturas?nuevo=true&remito_id=XXX → pre-carga items
5. Context menu factura → remitos vinculados clickeables
6. "Crear remito de esta factura" navega correctamente
