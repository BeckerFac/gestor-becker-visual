# Plan 11 — Fase 8a: Context Menu Pedidos — Remitos Vinculados

## Objetivo
Agregar seccion "Remitos vinculados" al context menu de pedidos, con links clickeables.

## Archivo: frontend/src/pages/Orders.tsx

## El context menu ya existe (lineas 2364-2462)
Ya tiene secciones para facturas y recibos. Agregar remitos.

## getOrderContextData ya retorna remitos (Fase 2)
El response ahora incluye `remitos[]` junto a `invoices[]` y `receipts[]`.

## Cambio en buildContextMenuItems (lineas ~2371-2449)

Despues de la seccion de facturas y antes de recibos, agregar:

```typescript
// ═══ REMITOS SECTION ═══
const remitos = contextData[order.id]?.remitos || [];
if (remitos.length > 0) {
  menuItems.push({ id: 'sep-remitos', separator: true });
  menuItems.push({ id: 'remitos-label', label: `Remitos (${remitos.length}):`, disabled: true });

  for (const remito of remitos) {
    const num = fmtRemitoNum(remito.remito_number, remito.punto_venta);
    const statusIcon = remito.status === 'entregado' ? '✓' : remito.status === 'firmado' ? '✓✓' : '⏳';
    const itemsSummary = remito.items?.slice(0, 2).map((i: any) => `${i.quantity}x ${i.product_name}`).join(', ');

    menuItems.push({
      id: `remito-${remito.id}`,
      label: `📦 Remito ${num} ${statusIcon}`,
      onClick: () => navigate(`/remitos?expand=${remito.id}`),
    });
  }
}

// Accion: Crear remito
menuItems.push({ id: 'sep-actions-remito', separator: true });
menuItems.push({
  id: 'crear-remito',
  label: '+ Crear remito de este pedido',
  onClick: () => navigate(`/remitos?nuevo=true&order_id=${order.id}`),
});
```

### Helper fmtRemitoNum:
```typescript
function fmtRemitoNum(num: number, pv?: number): string {
  return `${String(pv || 1).padStart(4, '0')}-${String(num).padStart(8, '0')}`;
}
```

## Verificacion
- Click derecho en pedido → seccion "Remitos (N):" aparece
- Click en remito → navega a /remitos?expand=ID
- "Crear remito de este pedido" → navega a /remitos?nuevo=true&order_id=ID
- Sin remitos → no aparece la seccion (limpio)
- Icono de status correcto (pendiente/entregado/firmado)

## Complejidad: Baja (agregar seccion a menu existente)
