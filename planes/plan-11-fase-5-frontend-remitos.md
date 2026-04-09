# Plan 11 — Fase 5: Frontend Remitos — Item Picker Completo

## Objetivo
Reescribir el form de creacion de remitos para soportar importar items de pedidos + facturas + manual, multi-pedido, y todos los campos del formato real.

## Pre-requisitos
- Fase 2 (endpoints de disponibilidad)
- Fase 3 (createRemito acepta vinculos)

## Archivo a modificar
- `frontend/src/pages/Remitos.tsx` (940 lineas)

## Estado actual del form (lineas 571-763)
1. Tipo (entrega/recepcion)
2. Enterprise + Customer selector
3. Order selector + Date
4. Delivery details (address, receiver, transport)
5. Items (product_name, description, quantity, unit)
6. Notes
7. Submit

## Nuevo form

### Seccion 1: Tipo (se mantiene)
Sin cambios.

### Seccion 2: Empresa (OBLIGATORIA)
- Enterprise selector como hoy
- Customer selector como hoy
- Al seleccionar empresa, se cargan automaticamente:
  - razon_social, direccion, CUIT, condicion IVA (mostrar pre-llenado, editable)

### Seccion 3: Datos del remito
- Numero: auto-generado o manual (toggle). Format: PPPP-NNNNNNNN
- Fecha: DateInput, default hoy
- Direccion entrega, Receptor, Transporte (como hoy)

### Seccion 4: Items — REESCRIBIR COMPLETO

```
┌──────────────────────────────────────────────────────────────┐
│ Importar items de:                                           │
│ [Pedido ▼] [Factura ▼] [+ Item manual]                      │
└──────────────────────────────────────────────────────────────┘

Pedido: Al hacer click, abre modal/dropdown con pedidos de la empresa.
  → Lista: Pedido #0003 (5 items, $60.500)
  → Al seleccionar: carga items con qty_available, order_item_id
  → Puede seleccionar MULTIPLES pedidos

Factura: Al hacer click, abre modal/dropdown con facturas de la empresa.
  → Lista: Factura B-002 (5 items, $60.500)
  → Al seleccionar: carga items con qty_available, invoice_item_id
  → Solo items no remitados de la factura

Item manual: Agrega una fila vacia sin vinculo.
```

### Items cargados

```
┌─────────────────────────────────────────────────────────────────────┐
│ Origen       │ Producto      │ Disponible │ Remitar │ Precio │ ✕  │
│ Pedido #0003 │ Pintura 20L   │ 5/5        │ [5]     │ $10k   │ ✕  │
│ Pedido #0003 │ Cemento 50kg  │ 10/10      │ [10]    │ $7k    │ ✕  │
│ Pedido #0005 │ GoBecker Int  │ 2/3        │ [2]     │ $65k   │ ✕  │
│ Fact B-002   │ Pintura 20L   │ 3/5        │ [3]     │ $10k   │ ✕  │
│ Manual       │ Muestra gratis│ -          │ [1]     │ -      │ ✕  │
└─────────────────────────────────────────────────────────────────────┘
```

Cada fila:
- **Origen**: badge con "Pedido #XXXX" o "Factura B-XXX" o "Manual"
- **Producto**: pre-llenado si viene de pedido/factura, editable si manual
- **Disponible**: X/Y (disponible/total). Solo si viene de pedido/factura
- **Remitar**: input numerico. Max = disponible. Validacion: 0 < qty <= disponible
- **Precio**: mostrar unit_price si viene de pedido/factura. No editable
- **Quitar**: boton X para remover item

### Seccion 5: Referencias cruzadas (auto-calculadas)
- Factura N°: se llena auto si hay items de factura
- O. Pedido N°: se llena auto si hay items de pedido
- Ambas editables (override manual)

### Seccion 6: Notas + Submit (como hoy)

## URL params (NUEVO)

Soportar query params para pre-cargar:
```
/remitos?nuevo=true&order_id=XXX        → pre-carga items del pedido
/remitos?nuevo=true&invoice_id=XXX      → pre-carga items de la factura
/remitos?nuevo=true&enterprise_id=XXX   → pre-selecciona empresa
```

### Implementacion:
```typescript
const [searchParams] = useSearchParams();
const preloadOrderId = searchParams.get('order_id');
const preloadInvoiceId = searchParams.get('invoice_id');

useEffect(() => {
  if (preloadOrderId) {
    setShowForm(true);
    // Cargar items del pedido via API
    loadOrderItemsForRemito(preloadOrderId);
  }
}, [preloadOrderId]);
```

## Componente nuevo: OrderItemsImporterForRemito

Similar al `OrderItemsImporter` de Invoices.tsx (lineas 201-309) pero para remitos:

```typescript
const OrderItemsImporterForRemito: React.FC<{
  enterpriseId: string;
  onImport: (items: RemitoItemWithSource[]) => void;
  existingOrderItemIds: string[];
}> = ({ enterpriseId, onImport, existingOrderItemIds }) => {
  // Llama a api.getAvailableOrderItemsForRemitoByEnterprise(enterpriseId)
  // Muestra items agrupados por pedido
  // Permite seleccionar qty por item
  // Al importar, cada item tiene order_item_id
}
```

## Componente nuevo: InvoiceItemsImporterForRemito

```typescript
const InvoiceItemsImporterForRemito: React.FC<{
  enterpriseId: string;
  onImport: (items: RemitoItemWithSource[]) => void;
}> = ({ enterpriseId, onImport }) => {
  // Llama a api.getAvailableInvoiceItemsForRemito por cada factura
  // O un endpoint que liste todas las facturas con items disponibles
  // Permite seleccionar qty por item
  // Al importar, cada item tiene invoice_item_id
}
```

## Interface RemitoItemWithSource
```typescript
interface RemitoItemWithSource {
  product_name: string;
  description?: string;
  quantity: number;
  unit: string;
  product_id?: string;
  unit_price?: number;
  vat_rate?: number;
  order_item_id?: string;
  invoice_item_id?: string;
  source: 'order' | 'invoice' | 'manual';
  source_ref?: string;  // "Pedido #0003" o "Factura B-002"
  qty_available?: number;
}
```

## Payload que se envia al backend
```typescript
const payload = {
  enterprise_id: form.enterprise_id,
  customer_id: form.customer_id,
  delivery_address: form.delivery_address,
  receiver_name: form.receiver_name,
  transport: form.transport,
  notes: form.notes,
  date: form.date,
  tipo: form.tipo,
  punto_venta: form.punto_venta,
  factura_ref: autoFacturaRef,
  pedido_ref: autoPedidoRef,
  items: items.map(i => ({
    product_name: i.product_name,
    description: i.description,
    quantity: i.quantity,
    unit: i.unit,
    product_id: i.product_id,
    unit_price: i.unit_price,
    vat_rate: i.vat_rate,
    order_item_id: i.order_item_id,
    invoice_item_id: i.invoice_item_id,
  })),
};
```

## Verificacion
1. Crear remito desde pedido: items vinculados con order_item_id
2. Crear remito desde factura: items vinculados con invoice_item_id
3. Crear remito multi-pedido: items de 2+ pedidos
4. Crear remito mixto: items de pedido + factura + manual
5. Validacion: no permite qty > disponible
6. URL params: /remitos?nuevo=true&order_id=XXX → abre form con items pre-cargados
7. Referencias auto: pedido_ref y factura_ref se llenan automaticamente
