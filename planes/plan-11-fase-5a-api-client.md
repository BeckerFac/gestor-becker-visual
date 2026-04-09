# Plan 11 — Fase 5a: API Client + Types (Frontend)

## Objetivo
Agregar los metodos de API y tipos TypeScript necesarios para todas las fases de frontend (5-8).

## Archivo: frontend/src/services/api.ts (lineas ~1319)

### Metodos nuevos a agregar despues de getSignedRemitoPdf:

```typescript
// Plan 11: Remitos ↔ Pedidos ↔ Facturas
getAvailableOrderItemsForRemito(orderId: string)
getAvailableOrderItemsForRemitoByEnterprise(enterpriseId: string)
getAvailableInvoiceItemsForRemito(invoiceId: string)
getInvoicesWithPendingDelivery(enterpriseId: string)
getRemitoContextData(remitoId: string)
getAvailableRemitoItemsForInvoicing(remitoId: string)
getRemitosWithPendingItems(enterpriseId: string)
```

### Endpoints:
```
GET /remitos/available-order-items/:orderId
GET /remitos/available-order-items?enterprise_id=XXX
GET /remitos/available-invoice-items/:invoiceId
GET /remitos/available-invoice-items?enterprise_id=XXX
GET /remitos/:id/context
GET /invoices/available-remito-items/:remitoId
GET /invoices/remitos-with-pending?enterprise_id=XXX
```

## Archivo: frontend/src/pages/Remitos.tsx (tipos, lineas 24-51)

### Tipo nuevo: RemitoItemWithSource
```typescript
interface RemitoItemWithSource {
  product_name: string;
  description: string;
  quantity: number;
  unit: string;
  product_id?: string;
  unit_price?: number;
  vat_rate?: number;
  order_item_id?: string;
  invoice_item_id?: string;
  source: 'order' | 'invoice' | 'manual';
  source_ref?: string;       // "Pedido #0003" o "Factura B-002"
  source_id?: string;        // order_id o invoice_id
  qty_available?: number;    // max seleccionable
}
```

### Tipo actualizado: RemitoItem (agregar campos)
```typescript
interface RemitoItem {
  product_name: string;
  description: string;
  quantity: number;
  unit: string;
  product_id?: string;       // NUEVO
  unit_price?: number;       // NUEVO
  vat_rate?: number;         // NUEVO
  order_item_id?: string;    // NUEVO
  invoice_item_id?: string;  // NUEVO
}
```

## Verificacion
- TypeScript compila sin errores
- Los nuevos metodos de api estan disponibles para importar
- Los tipos nuevos estan disponibles para los componentes

## Complejidad: Baja (solo tipos y funciones fetch)
