# Plan 11 — Fase 8: Frontend Pedidos — Context Menu Remitos + Expandible Delivery

## Objetivo
Agregar remitos vinculados al context menu de pedidos (clickeables) y mostrar qty_delivered por item en el expandible.

## Pre-requisitos
- Fase 2 (getOrderContextData devuelve remitos)
- Fase 1 (qty_delivered en order_items)

## Archivo a modificar
- `frontend/src/pages/Orders.tsx`

## Cambio 1: Context menu — agregar seccion remitos

**Ubicacion**: lineas 2371-2449 (donde se construyen los menu items)

Actualmente el context menu muestra:
- Facturas vinculadas (con status y links)
- Recibos vinculados
- Acciones (crear factura, etc.)

Agregar seccion REMITOS entre facturas y recibos:

```typescript
// Despues de la seccion de facturas (linea ~2405)
// y antes de recibos

// REMITOS SECTION
if (contextData[order.id]?.remitos?.length > 0) {
  menuItems.push({ type: 'separator' });
  menuItems.push({ type: 'label', text: 'Remitos vinculados:' });
  
  for (const remito of contextData[order.id].remitos) {
    const num = `${String(remito.punto_venta || 1).padStart(4, '0')}-${String(remito.remito_number).padStart(8, '0')}`;
    const statusIcon = remito.status === 'entregado' ? '✓' : remito.status === 'firmado' ? '✓✓' : '⏳';
    const itemsSummary = remito.items?.map((i: any) => `${i.quantity}x ${i.product_name}`).join(', ');
    
    menuItems.push({
      text: `📦 Remito ${num} ${statusIcon}`,
      subtext: itemsSummary,
      onClick: () => navigate(`/remitos?expand=${remito.id}`),
    });
  }
}

// Accion: Crear remito
menuItems.push({
  text: '+ Crear remito',
  onClick: () => navigate(`/remitos?nuevo=true&order_id=${order.id}`),
});
```

### getOrderContextData ya devuelve remitos (Fase 2):
```typescript
// El tipo ContextData necesita expandirse:
interface OrderContextData {
  invoices: Array<{...}>;
  receipts: Array<{...}>;
  remitos: Array<{        // NUEVO
    id: string;
    remito_number: number;
    punto_venta: number;
    status: string;
    date: string;
    items: Array<{ product_name: string; quantity: number }>;
  }>;
}
```

## Cambio 2: Expandible — agregar columnas de entrega

**Ubicacion**: La seccion expandible de pedidos muestra items con datos de facturacion.

Agregar columnas `Entregado` y estado visual:

```
▼ Pedido #0003 — Garcia Construcciones — En Produccion
┌───────────────────────────────────────────────────────────────┐
│ Producto      │ Qty │ Facturado │ Entregado │ Estado          │
│ Pintura 20L   │ 10  │ 6/10     │ 4/10      │ ⚠️ Pend. ambos │
│ Cemento 50kg  │ 20  │ 0/20     │ 20/20     │ ✓ Entregado    │
├───────────────────────────────────────────────────────────────┤
│ Remitos: #0005 (4x Pintura), #0008 (20x Cemento)            │
│ [Crear remito de pendientes] [Crear factura]                  │
└───────────────────────────────────────────────────────────────┘
```

### Datos necesarios:
Modificar `getOrderInvoicingDetail` (linea 858 de orders.service.ts) para incluir qty_delivered:

Agregar al SELECT de order_items:
```sql
COALESCE(oi.qty_delivered, 0) as qty_delivered
```

### Frontend: columna Entregado
```tsx
<td>
  {item.qty_delivered}/{item.quantity}
  {item.qty_delivered >= item.quantity && ' ✓'}
  {item.qty_delivered > 0 && item.qty_delivered < item.quantity && ' ⚠️'}
</td>
```

### Estado por item:
```typescript
function getItemStatus(item: OrderItem): string {
  const fullyInvoiced = item.qty_invoiced >= item.quantity;
  const fullyDelivered = item.qty_delivered >= item.quantity;
  
  if (fullyInvoiced && fullyDelivered) return 'Completo';
  if (fullyDelivered && !fullyInvoiced) return 'Entregado, pend. facturar';
  if (fullyInvoiced && !fullyDelivered) return 'Facturado, pend. entregar';
  if (item.qty_invoiced > 0 || item.qty_delivered > 0) return 'Parcial';
  return 'Pendiente';
}
```

## Cambio 3: Boton "Crear remito" en expandible

Debajo de la tabla de items del pedido expandido:

```tsx
{hasUndeliveredItems && (
  <button onClick={() => navigate(`/remitos?nuevo=true&order_id=${order.id}`)}>
    Crear remito de pendientes
  </button>
)}
```

## Cambio 4: Remitos vinculados en expandible

Mostrar lista de remitos vinculados debajo de los items:

```tsx
{orderRemitos.length > 0 && (
  <div>
    <span>Remitos:</span>
    {orderRemitos.map(r => (
      <button key={r.id} onClick={() => navigate(`/remitos?expand=${r.id}`)}>
        #{String(r.remito_number).padStart(5, '0')} ({r.status})
      </button>
    ))}
  </div>
)}
```

## API type updates

```typescript
// En el type de Order o en getOrderInvoicingDetail response
interface OrderItemDetail {
  // campos existentes...
  qty_invoiced: number;
  qty_remaining: number;
  qty_delivered: number;  // NUEVO
}
```

## Verificacion
1. Click derecho en pedido → seccion "Remitos vinculados" aparece
2. Click en remito → navega a /remitos?expand=ID
3. "+ Crear remito" → navega a /remitos?nuevo=true&order_id=ID
4. Expandible muestra Entregado X/Y por item
5. Estado por item correcto (Completo, Parcial, Pendiente, etc.)
6. Boton "Crear remito de pendientes" visible cuando hay items sin entregar
