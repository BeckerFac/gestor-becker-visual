# Plan 11: Vinculacion Pedidos ↔ Remitos ↔ Facturas

## Contexto
Los remitos hoy son documentos planos sin vinculacion real a pedidos ni facturas. Se necesita un sistema donde:
- Un pedido puede facturarse total/parcial Y remitarse total/parcial
- Si un item fue remitado, se factura DESDE el remito (no directo del pedido)
- Si un item fue facturado, se remita DESDE la factura (no directo del pedido)
- Remitos pueden incluir items de MULTIPLES pedidos (misma empresa)
- Remitos pueden incluir items de facturas (misma empresa)
- Facturas pueden importar items de remitos (no facturados del remito)

## Formato de Remito Real (BeckerVisual)

### Cabecera EMISOR (pre-cargado de config empresa)
- Razon social, rubro, direccion, telefono, email, web
- Condicion IVA, CUIT, Ingresos Brutos, Inicio Actividad
- Letra "R" + "DOCUMENTO NO VALIDO COMO FACTURA COD. N° 91"

### Cabecera REMITO
- Numero: PPPP-NNNNNNNN (punto venta 4 dig + secuencial 8 dig)
- Fecha: default hoy, editable

### Datos RECEPTOR (auto desde enterprise)
- Senor/es (razon_social o name)
- Domicilio (address + city + CP)
- Condicion IVA (tax_condition)
- CUIT

### Referencias cruzadas (auto desde vinculo)
- N° Cliente (opcional)
- Factura N° (si viene de factura, formato PPPP-NNNNNNNN)
- O. Pedido N° (si viene de pedido, formato PPPP-NNNNNNNN)

### Items
- Cantidad (DECIMAL)
- Descripcion (product_name + descripcion libre)

### Pie
- RECIBI CONFORME (area firma)
- Aclaracion (texto)
- Firma (imagen/trazo)
- Datos imprenta (CAI, habilitacion, vto)
- Original blanco / Duplicado color

---

## Cambios en Base de Datos

### 1. ALTER TABLE remito_items (reescribir)
```sql
ALTER TABLE remito_items ALTER COLUMN quantity TYPE DECIMAL(12,2);
ALTER TABLE remito_items ADD COLUMN IF NOT EXISTS product_id UUID REFERENCES products(id) ON DELETE SET NULL;
ALTER TABLE remito_items ADD COLUMN IF NOT EXISTS unit_price DECIMAL(12,2);
ALTER TABLE remito_items ADD COLUMN IF NOT EXISTS vat_rate DECIMAL(5,2) DEFAULT 21;
ALTER TABLE remito_items ADD COLUMN IF NOT EXISTS order_item_id UUID REFERENCES order_items(id) ON DELETE SET NULL;
ALTER TABLE remito_items ADD COLUMN IF NOT EXISTS invoice_item_id UUID REFERENCES invoice_items(id) ON DELETE SET NULL;
```

### 2. CREATE TABLE remito_orders (N:N)
```sql
CREATE TABLE IF NOT EXISTS remito_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  remito_id UUID NOT NULL REFERENCES remitos(id) ON DELETE CASCADE,
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  UNIQUE(remito_id, order_id)
);
```

### 3. CREATE TABLE invoice_remitos (N:N)
```sql
CREATE TABLE IF NOT EXISTS invoice_remitos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  remito_id UUID NOT NULL REFERENCES remitos(id) ON DELETE CASCADE,
  UNIQUE(invoice_id, remito_id)
);
```

### 4. ALTER TABLE invoice_items
```sql
ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS remito_item_id UUID REFERENCES remito_items(id) ON DELETE SET NULL;
```

### 5. ALTER TABLE order_items
```sql
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS qty_delivered DECIMAL(12,2) DEFAULT 0;
```

### 6. ALTER TABLE remitos (numero formato + punto venta)
```sql
ALTER TABLE remitos ADD COLUMN IF NOT EXISTS punto_venta INTEGER DEFAULT 1;
ALTER TABLE remitos ADD COLUMN IF NOT EXISTS factura_ref VARCHAR(20);
ALTER TABLE remitos ADD COLUMN IF NOT EXISTS pedido_ref VARCHAR(20);
```

### 7. ALTER TABLE companies (datos emisor para PDF)
```sql
ALTER TABLE companies ADD COLUMN IF NOT EXISTS website VARCHAR(255);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS ingresos_brutos VARCHAR(50);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS inicio_actividad DATE;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS rubro_descripcion TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS punto_venta_remito INTEGER DEFAULT 1;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS cai_remito VARCHAR(20);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS cai_remito_vto DATE;
```

---

## Contadores por item de pedido

Cada order_item tiene estas cantidades calculadas:

```
quantity            = 10 (total pedido)
qty_invoiced        = SUM(invoice_items.qty WHERE order_item_id = este AND inv.status != cancelled)
qty_delivered       = SUM(remito_items.qty WHERE order_item_id = este)
qty_inv_via_remito  = SUM(invoice_items.qty WHERE remito_item_id IN (remito_items WHERE order_item_id = este))

qty_available_direct_invoice = quantity - qty_invoiced - (qty_delivered - qty_inv_via_remito)
  → Lo que podes facturar DIRECTO del pedido (no remitado)
qty_available_delivery       = quantity - qty_delivered
  → Lo que podes remitar del pedido
qty_remito_pending_invoice   = qty_delivered - qty_inv_via_remito
  → Lo que fue remitado pero NO facturado (facturar desde remito)
```

---

## Los 6 flujos

### FLUJO 1: Pedido → Remito
1. Click derecho pedido → "Crear remito"
2. Redirige a /remitos/nuevo?order_id=XXX
3. Datos receptor auto-llenados de la enterprise del pedido
4. Items del pedido con qty_available_delivery > 0
5. Puede agregar items de OTROS pedidos misma empresa
6. Puede agregar items de facturas misma empresa
7. Al guardar: remito_items con order_item_id, entrada en remito_orders

### FLUJO 2: Pedido → Factura (ya existe, SE MODIFICA)
1. Importar items de pedido en factura
2. Se muestran SOLO items con qty_available_direct_invoice > 0
3. Items remitados aparecen BLOQUEADOS: "Remitado en Remito #XXXX → facturar desde el remito"
4. Al crear: invoice_items con order_item_id

### FLUJO 3: Remito → Factura
1. Click derecho remito → "Crear factura de este remito"
2. Redirige a /facturas/nueva con items del remito pre-cargados
3. Solo items no facturados del remito (qty pendiente > 0)
4. Al crear: invoice_items con remito_item_id + order_item_id (si existe)
5. Entrada en invoice_remitos (N:N)

### FLUJO 4: Factura → Remito
1. Click derecho factura → "Crear remito"
2. Redirige a /remitos/nuevo con items de la factura
3. Solo items no entregados de la factura
4. Al guardar: remito_items con invoice_item_id

### FLUJO 5: Remito multi-pedido
1. Desde remitos, seleccionar empresa
2. Importar items de pedido A
3. Boton "Agregar otro pedido" → items de pedido B (misma empresa)
4. remito_orders tiene entrada para A y B

### FLUJO 6: Importar remito en factura (desde pagina facturas)
1. Desde facturas, "Importar de Remito"
2. Lista remitos de la empresa con items pendientes
3. Carga items con qty_available > 0
4. Al crear: invoice_items con remito_item_id

---

## Cambios en Frontend

### Pagina Remitos
- Reescribir item picker: importar de pedido + factura + manual
- Datos receptor auto-llenados de enterprise
- Referencias cruzadas auto (Factura N°, Pedido N°)
- Context menu: ver facturas vinculadas (clickeables), crear factura de pendientes
- Expandible: items con status facturado/pendiente por item
- PDF: formato real con todos los campos del emisor

### Pagina Facturas
- Agregar "Importar de Remito" (RemitoItemsImporter)
- Modificar OrderItemsImporter: bloquear items remitados, mostrar link al remito
- Context menu: agregar remitos vinculados clickeables

### Pagina Pedidos
- Context menu: agregar remitos vinculados (clickeables a /remitos?expand=ID)
- Expandible: agregar columnas qty_delivered, estado entrega por item

---

## Cambios en Backend

### remitos.service.ts
- createRemito: acepta order_item_id/invoice_item_id por item, crea remito_orders
- getAvailableOrderItemsForRemito(companyId, orderId)
- getAvailableInvoiceItemsForRemito(companyId, invoiceId)
- getRemitoContextData(companyId, remitoId) → facturas vinculadas
- cancelRemito: revertir qty_delivered

### invoices.service.ts
- getAvailableRemitoItemsForInvoicing(companyId, remitoId)
- Modificar getAvailableOrderItemsForInvoicing: excluir qty remitada no facturada
- createInvoice: aceptar remito_item_id, crear invoice_remitos

### orders.service.ts
- getOrderContextData: agregar remitos vinculados via remito_orders
- getOrderDeliveryStatus: qty_delivered por item

---

## Validaciones criticas

| Validacion | Donde |
|------------|-------|
| remito qty <= qty_available_delivery | createRemito |
| factura qty desde pedido <= qty_available_direct_invoice | createInvoice |
| factura qty desde remito <= remito_item.qty - ya_facturado | createInvoice |
| misma empresa en todo el remito | createRemito |
| no duplicar order_item en mismo remito | createRemito |
| cancelar remito revierte qty_delivered | cancelRemito |

---

## Orden de implementacion (9 fases)

| Fase | Que | Complejidad |
|------|-----|-------------|
| 1 | Migrations DB (7 cambios) | Baja |
| 2 | Backend: queries disponibilidad (4 nuevas) | Media |
| 3 | Backend: createRemito reescrito con vinculos | Alta |
| 4 | Backend: factura desde remito + modificar desde pedido | Alta |
| 5 | Frontend: Remitos item picker completo | Alta |
| 6 | Frontend: Remitos context menu + expandible | Media |
| 7 | Frontend: Facturas RemitoItemsImporter + bloqueo remitados | Alta |
| 8 | Frontend: Pedidos context menu remitos + expandible delivery | Media |
| 9 | Remito PDF formato real + testing E2E | Alta |
