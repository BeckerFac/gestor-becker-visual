# Plan 11 — Fase 8b: Expandible Pedidos — qty_delivered por Item

## Objetivo
Agregar columna "Entregado" al expandible de pedidos mostrando qty_delivered por item.

## Archivo: frontend/src/pages/Orders.tsx

## Buscar donde se renderiza el expandible de items del pedido
El expandible actual muestra items con qty_invoiced/qty_remaining. Agregar qty_delivered.

## Cambio en getOrderInvoicingDetail (backend, ya hecho)
La query ya incluye `COALESCE(oi.qty_delivered, 0) as qty_delivered` (verificar).

Si no lo tiene, agregar en orders.service.ts:
```sql
COALESCE(oi.qty_delivered, 0) as qty_delivered
```

## Cambio en frontend: agregar columna al expandible

### Header de tabla (agregar columna):
```tsx
<th>Entregado</th>
```

### Body de item row (agregar celda):
```tsx
<td>
  <span className={item.qty_delivered >= item.quantity ? 'text-green-600' : 
    item.qty_delivered > 0 ? 'text-amber-600' : 'text-gray-400'}>
    {item.qty_delivered}/{item.quantity}
  </span>
</td>
```

### Status por item:
```tsx
<td>
  {(() => {
    const fullyInvoiced = item.qty_invoiced >= item.quantity;
    const fullyDelivered = item.qty_delivered >= item.quantity;
    if (fullyInvoiced && fullyDelivered) return <span className="text-green-600 text-xs">Completo</span>;
    if (fullyDelivered) return <span className="text-amber-600 text-xs">Entregado, pend. facturar</span>;
    if (fullyInvoiced) return <span className="text-blue-600 text-xs">Facturado, pend. entregar</span>;
    if (item.qty_invoiced > 0 || item.qty_delivered > 0) return <span className="text-amber-500 text-xs">Parcial</span>;
    return <span className="text-gray-400 text-xs">Pendiente</span>;
  })()}
</td>
```

### Remitos vinculados debajo de items:
```tsx
{orderRemitos.length > 0 && (
  <div className="mt-2 flex items-center gap-2 text-sm text-gray-600">
    <span>Remitos:</span>
    {orderRemitos.map(r => (
      <button key={r.id} className="text-blue-600 hover:underline"
        onClick={() => navigate(`/remitos?expand=${r.id}`)}>
        #{String(r.remito_number).padStart(5,'0')} ({r.status})
      </button>
    ))}
  </div>
)}
```

### Boton "Crear remito de pendientes":
```tsx
{items.some(i => i.qty_delivered < i.quantity) && (
  <Button size="sm" variant="outline"
    onClick={() => navigate(`/remitos?nuevo=true&order_id=${order.id}`)}>
    Crear remito de pendientes
  </Button>
)}
```

## Verificacion
- Expandir pedido → columna "Entregado" visible con X/Y
- Item totalmente entregado → verde
- Item parcialmente entregado → amarillo
- Item no entregado → gris
- Status "Completo" cuando facturado+entregado
- Remitos vinculados clickeables abajo
- Boton "Crear remito" si hay pendientes

## Complejidad: Media
