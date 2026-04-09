# Plan 11 — Fase 6b: Expandible con Status por Item en Remitos

## Objetivo
Al expandir un remito (preview modal o inline), mostrar items con status de facturacion (qty_invoiced/qty_pending) y origen (pedido/factura/manual).

## Archivo: frontend/src/components/shared/RemitoPreviewModal.tsx (o inline en Remitos.tsx)

## Opcion: Mejorar el getRemito response del backend

El backend getRemito (linea 180-207 de remitos.service.ts) ya retorna items. Modificar para incluir qty_invoiced y source_ref:

### Backend: Modificar getRemito query
```sql
SELECT ri.*, 
  COALESCE((SELECT SUM(ii.quantity) FROM invoice_items ii
    WHERE ii.remito_item_id = ri.id
    AND ii.invoice_id IN (SELECT id FROM invoices WHERE status != 'cancelled')
  ), 0) as qty_invoiced,
  CASE
    WHEN ri.order_item_id IS NOT NULL THEN (
      SELECT 'Pedido #' || LPAD(o.order_number::text, 4, '0')
      FROM order_items oi JOIN orders o ON oi.order_id = o.id WHERE oi.id = ri.order_item_id
    )
    WHEN ri.invoice_item_id IS NOT NULL THEN 'Factura'
    ELSE 'Manual'
  END as source_ref
FROM remito_items ri WHERE ri.remito_id = $1
```

### Frontend: Mostrar en el preview modal o expandible

```tsx
<table>
  <thead>
    <tr>
      <th>Origen</th>
      <th>Producto</th>
      <th>Cantidad</th>
      <th>Facturado</th>
      <th>Pendiente</th>
    </tr>
  </thead>
  <tbody>
    {remito.items.map(item => (
      <tr key={item.id}>
        <td><span className="text-xs bg-gray-100 px-1 rounded">{item.source_ref}</span></td>
        <td>{item.product_name}</td>
        <td>{item.quantity}</td>
        <td>{item.qty_invoiced}/{item.quantity}</td>
        <td>{item.quantity - item.qty_invoiced}</td>
      </tr>
    ))}
  </tbody>
</table>

{/* Boton crear factura si hay pendientes */}
{remito.items.some(i => i.quantity - i.qty_invoiced > 0) && (
  <Button onClick={() => navigate(`/facturas?nuevo=true&remito_id=${remito.id}`)}>
    Crear factura de items pendientes
  </Button>
)}
```

## Verificacion
- Expandir remito → items muestran Facturado X/Y
- Items con origen "Pedido #0003" en badge
- Items totalmente facturados → row gris
- Boton "Crear factura" visible si hay pendientes
- Sin items de factura → no muestra columna Facturado

## Complejidad: Media
