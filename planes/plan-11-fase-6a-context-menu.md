# Plan 11 — Fase 6a: Context Menu en Remitos

## Objetivo
Agregar click derecho en la tabla de remitos para ver facturas vinculadas y crear facturas.

## Archivo: frontend/src/pages/Remitos.tsx

## Imports nuevos
```typescript
import { useContextMenu } from '@/hooks/useContextMenu';
import ContextMenuBase from '@/components/ui/ContextMenuBase';
```

## State nuevo
```typescript
const contextMenu = useContextMenu<Remito>();
const [contextData, setContextData] = useState<Record<string, any>>({});
```

## Agregar onContextMenu en tabla row (linea ~803)
```tsx
<tr key={remito.id}
  onContextMenu={(e) => {
    contextMenu.openMenu(e, remito);
    if (!contextData[remito.id]) {
      api.getRemitoContextData(remito.id).then(data => {
        setContextData(prev => ({ ...prev, [remito.id]: data }));
      });
    }
  }}
>
```

## Renderizar ContextMenuBase (antes del cierre del return)
```tsx
{contextMenu.menu && (
  <ContextMenuBase
    x={contextMenu.menu.x}
    y={contextMenu.menu.y}
    header={{
      title: `Remito #${fmtRemitoNumber(contextMenu.menu.item.remito_number)}`,
      subtitle: contextMenu.menu.item.enterprise?.name || '',
    }}
    items={buildRemitoContextMenuItems(contextMenu.menu.item)}
    onClose={contextMenu.closeMenu}
  />
)}
```

## Funcion buildRemitoContextMenuItems:
```typescript
function buildRemitoContextMenuItems(remito: Remito): ContextMenuItem[] {
  const data = contextData[remito.id];
  const items: ContextMenuItem[] = [];

  // Facturas vinculadas
  if (data?.invoices?.length > 0) {
    items.push({ id: 'facturas-label', label: 'Facturas vinculadas:', disabled: true });
    for (const inv of data.invoices) {
      items.push({
        id: `inv-${inv.id}`,
        label: `Factura ${inv.invoice_type}-${inv.invoice_number} ($${parseFloat(inv.total_amount).toLocaleString('es-AR')})`,
        onClick: () => navigate(`/facturas?expand=${inv.id}`),
      });
    }
    items.push({ id: 'sep1', separator: true });
  }

  // Items pendientes de facturar
  const pendingItems = data?.items_status?.filter((i: any) => i.qty_pending > 0) || [];
  if (pendingItems.length > 0) {
    items.push({ id: 'pending-label', label: `${pendingItems.length} items pendientes de facturar`, disabled: true });
    items.push({ id: 'sep2', separator: true });
  }

  // Acciones
  items.push({
    id: 'crear-factura',
    label: 'Crear factura de este remito',
    onClick: () => navigate(`/facturas?nuevo=true&remito_id=${remito.id}`),
  });
  items.push({
    id: 'descargar-pdf',
    label: 'Descargar PDF',
    onClick: () => handleDownloadPdf(remito.id, remito.remito_number),
  });
  items.push({
    id: 'eliminar', label: 'Eliminar remito', danger: true,
    onClick: () => { setDeleteTarget(remito); contextMenu.closeMenu(); },
  });

  return items;
}
```

## Importar useNavigate
```typescript
import { useSearchParams, useNavigate } from 'react-router-dom';
const navigate = useNavigate();
```

## Verificacion
- Click derecho en remito → menu con facturas vinculadas
- Click en factura → navega a /facturas?expand=ID
- "Crear factura" → navega a /facturas?nuevo=true&remito_id=ID
- Menu se cierra al hacer click fuera
- Sin context data → muestra menu basico (sin facturas)

## Complejidad: Media
