# Plan 11 — Fase 7b: Bloquear Items Remitados en OrderItemsImporter

## Objetivo
Cuando se importan items de pedidos para facturar, los items que ya fueron remitados aparecen bloqueados con link al remito.

## Archivo: frontend/src/pages/Invoices.tsx → componente OrderItemsImporter (lineas 201-309)

## Cambio en los datos
La API getAvailableOrderItemsForInvoicing ahora retorna campos nuevos (Fase 2/4):
- `qty_available_direct`: lo que se puede facturar directo (sin pasar por remito)
- `qty_remito_pending_invoice`: remitado pero no facturado
- `remito_info`: array con {remito_id, remito_number, qty}

## Cambio en el render de items (lineas ~269-298)

Antes: cada item mostraba qty_remaining y input de cantidad.

Despues: cada item tiene 2 posibles displays:

### Display 1: Disponible directo (qty_available_direct > 0)
```tsx
<div className="flex items-center gap-2">
  <span>{item.product_name}</span>
  <span className="text-xs">{item.qty_available_direct} disponible</span>
  <input type="number" max={item.qty_available_direct} ... />
  <button onClick={() => selectAll()}>Todo</button>
</div>
```

### Display 2: Remitado, no disponible directo (qty_remito_pending_invoice > 0)
```tsx
<div className="flex items-center gap-2 opacity-60">
  <span className="text-amber-600">🔒</span>
  <span>{item.product_name}</span>
  <span className="text-xs text-amber-600">
    {item.qty_remito_pending_invoice} en remito
    {item.remito_info?.map(r => (
      <button key={r.remito_id} className="underline ml-1"
        onClick={() => navigate(`/remitos?expand=${r.remito_id}`)}>
        #{String(r.remito_number).padStart(5,'0')}
      </button>
    ))}
    — facturar desde el remito
  </span>
</div>
```

### Logica:
```typescript
// Un item puede tener AMBOS: parte disponible directo + parte remitada
// Ejemplo: pedido 10 unidades, 3 remitadas, 2 ya facturadas
// qty_available_direct = 5 (facturar directo)
// qty_remito_pending_invoice = 3 (facturar desde remito)

// Mostrar 2 filas si el item tiene ambos:
// Fila 1: 5 disponible [input] 
// Fila 2: 🔒 3 remitadas → Remito #0005
```

## Cambio en el input max
```typescript
// ANTES:
max={item.qty_remaining}

// DESPUES:
max={item.qty_available_direct}
```

## Verificacion
- Item completamente remitado → bloqueado, no aparece input
- Item parcialmente remitado → input con max = qty_available_direct, info de remito abajo
- Item sin remitar → funciona como antes (max = qty_remaining)
- Click en link al remito → navega a /remitos?expand=ID
- Link dice "facturar desde el remito" (claro para el usuario)

## Complejidad: Media (modificacion de componente existente)
