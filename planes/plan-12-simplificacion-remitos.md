# Plan 12: Simplificacion Remitos — Independientes de Facturacion

## Cambio conceptual
Remitos y facturas son INDEPENDIENTES. Un remito trackea ENTREGA de items de pedidos.
Una factura trackea FACTURACION de items de pedidos. No se bloquean entre si.

## Reglas nuevas
1. Remitos SIEMPRE descuentan de order_items.qty_delivered
2. Facturar NO depende de si fue remitado o no (y viceversa)
3. Items manuales con product_id: descuentan stock si controls_stock=true
4. Items manuales sin product_id: se agregan al remito sin descontar nada
5. No se editan remitos — solo se ANULAN (devuelve qty_delivered + stock)
6. No se eliminan remitos — se anulan (status='anulado')
7. Un remito = una sola empresa
8. "Crear remito desde factura" = resolver order_item_ids de los items de la factura + items sin pedido como manuales

## Que se ELIMINA
- invoice_item_id en remito_items
- invoice_remitos tabla N:N
- remito_item_id en invoice_items
- RemitoItemsImporter en Facturas
- Bloqueo de items remitados en OrderItemsImporter
- CTEs item_delivered, item_invoiced_via_remito, item_remito_info en getAvailableOrderItemsForInvoicing
- getAvailableRemitoItemsForInvoicing()
- getRemitosWithPendingItems()
- getAvailableInvoiceItemsForRemito()
- getInvoicesWithPendingDelivery()

## Que se MANTIENE
- order_item_id en remito_items (vinculo remito → pedido)
- remito_orders tabla N:N (vinculo remito → pedidos)
- qty_delivered en order_items
- Expandible en remitos con items + status
- Context menu en remitos y pedidos
- PDF formato fiscal

## Que se AGREGA
- Stock deduction para items manuales con product_id
- Anulacion de remito (status='anulado', devuelve qty_delivered + stock)
- "Importar desde factura" en remitos = resolver order_items de la factura

---

## Fase A: Limpiar backend

### invoices.service.ts
1. En createInvoice: ELIMINAR bloque que setea remito_item_id (lineas ~290-314)
2. En getAvailableOrderItemsForInvoicing: ELIMINAR CTEs item_delivered, item_invoiced_via_remito, item_remito_info. ELIMINAR campos qty_delivered, qty_remito_pending_invoice, qty_available_direct, remito_info del SELECT. Volver a la version simple con solo item_invoiced CTE.
3. ELIMINAR funciones: getAvailableRemitoItemsForInvoicing, getRemitosWithPendingItems
4. ELIMINAR endpoints: /available-remito-items/:remitoId, /remitos-with-pending

### invoices.controller.ts
5. ELIMINAR handlers: getAvailableRemitoItems, getRemitosWithPendingItems

### invoices.router.ts
6. ELIMINAR rutas: /available-remito-items/:remitoId, /remitos-with-pending

### remitos.service.ts
7. En migraciones: ELIMINAR invoice_item_id de remito_items, ELIMINAR invoice_remitos tabla, ELIMINAR remito_item_id de invoice_items
8. En createRemito: ELIMINAR toda validacion de invoice_items (lineas ~260, ~293-316)
9. ELIMINAR funciones: getAvailableInvoiceItemsForRemito, getInvoicesWithPendingDelivery
10. En getRemitoContextData: ELIMINAR query de invoice_remitos

### remitos.controller.ts
11. ELIMINAR handlers: getAvailableInvoiceItems, getAvailableInvoiceItemsByInvoice

### remitos.router.ts
12. ELIMINAR rutas: /available-invoice-items, /available-invoice-items/:invoiceId

### api.ts (frontend)
13. ELIMINAR: getAvailableInvoiceItemsForRemito, getInvoicesWithPendingDelivery, getAvailableRemitoItemsForInvoicing, getRemitosWithPendingItems

---

## Fase B: Reescribir createRemito

### Nuevo flujo:
```
1. Validar empresa requerida
2. Validar items (al menos 1)
3. BEGIN transaction
4. Lock order_items FOR UPDATE (solo los que tienen order_item_id)
5. Validar qty <= available para cada order_item
6. Validar misma empresa en todos los pedidos
7. INSERT remito
8. Para cada item:
   a. Si tiene order_item_id:
      - INSERT remito_item con order_item_id
      - UPDATE order_items SET qty_delivered += qty
   b. Si tiene product_id (manual con producto):
      - INSERT remito_item
      - Si product.controls_stock: INSERT stock_movement (descuento)
   c. Si no tiene ni order_item_id ni product_id (manual puro):
      - INSERT remito_item (solo texto)
9. INSERT remito_orders para cada order_id unico
10. COMMIT
```

### Stock deduction para items manuales:
```sql
-- Solo si el producto controla stock
INSERT INTO stock_movements (id, company_id, product_id, warehouse_id, quantity, 
  movement_type, reference_type, reference_id, notes, created_by)
VALUES (gen_random_uuid(), $companyId, $productId, $warehouseId, -$qty,
  'salida', 'remito', $remitoId, 'Remito manual', $userId)

UPDATE stock SET quantity = quantity - $qty 
WHERE product_id = $productId AND warehouse_id = $warehouseId
```

Para el warehouse: usar el default de la empresa o el primero disponible.

---

## Fase C: Anulacion de remito

### Nuevo endpoint: PUT /remitos/:id/anular

### Logica:
```
1. Verificar remito existe y no esta anulado
2. BEGIN transaction
3. Para cada remito_item con order_item_id:
   - UPDATE order_items SET qty_delivered -= qty
4. Para cada remito_item con product_id (manual con stock):
   - INSERT stock_movement inverso (+qty, 'entrada', 'anulacion_remito')
   - UPDATE stock SET quantity += qty
5. UPDATE remitos SET status = 'anulado'
6. COMMIT
```

### Frontend:
- Boton "Anular" en vez de "Eliminar" (rojo, con confirmacion)
- Remitos anulados: row gris, badge "Anulado", no editable
- No aparece boton "Anular" si ya esta anulado

---

## Fase D: Frontend Remitos — Importar facturas como pedidos

### Cambio en "Desde Factura":
Antes: importaba items de factura con invoice_item_id
Ahora: resuelve los order_item_ids detras de la factura y los importa como items de pedido

### Nuevo flujo:
1. Usuario toca "Desde Factura"
2. Se listan las facturas de la empresa
3. Al seleccionar una factura, se cargan sus items:
   a. Items con order_item_id → se importan como items de pedido (source='order', con qty_available del order_item)
   b. Items SIN order_item_id → se importan como items manuales (source='manual')
4. Deduplicacion: si un order_item ya fue importado de un pedido directo, no se duplica

### API necesaria:
`GET /invoices/:id/items` ya existe (getInvoiceDetail) — solo necesito los items con order_item_id.

O mejor: nuevo endpoint simple que devuelve items de una factura con qty_available del order_item:
```
GET /remitos/invoice-items-for-remito/:invoiceId
```

Query:
```sql
SELECT ii.id, ii.product_name, ii.quantity, ii.unit_price, ii.vat_rate,
  ii.order_item_id, ii.product_id,
  oi.quantity as order_qty,
  COALESCE(oi.qty_delivered, 0) as order_qty_delivered,
  oi.quantity - COALESCE(oi.qty_delivered, 0) as qty_available
FROM invoice_items ii
LEFT JOIN order_items oi ON ii.order_item_id = oi.id
WHERE ii.invoice_id = $1
```

Items con order_item_id: qty_available = min(ii.quantity, oi.quantity - oi.qty_delivered)
Items sin order_item_id: se importan como manuales (qty_available = ii.quantity)

---

## Fase E: Frontend Facturas — Limpiar

1. ELIMINAR componente RemitoItemsImporter completo
2. ELIMINAR su uso en el form
3. En OrderItemsImporter: REVERTIR a version simple (sin bloqueo de remitados)
   - Eliminar campos: qty_available_direct, qty_remito_pending_invoice, remito_info
   - Volver a usar qty_remaining como unico limite
   - Eliminar la fila "bloqueada" con link al remito

---

## Fase F: Testing

1. tsc --noEmit (backend + frontend)
2. vite build
3. vitest run (415+ tests)
4. Verificar flujos:
   - Crear pedido → Crear remito desde pedido → qty_delivered sube
   - Crear pedido → Crear factura → Crear remito desde factura → items de pedido pre-cargados
   - Crear remito con item manual (con producto stock) → stock baja
   - Anular remito → qty_delivered baja, stock sube
   - Crear remito multi-pedido → remito_orders tiene N entradas
   - Facturar pedido (sin importar si fue remitado) → funciona normal
   - Items de factura sin order_item_id → se importan como manuales en remito
