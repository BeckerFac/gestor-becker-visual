# Plan 11 — Fase 1: Migraciones de Base de Datos

## Objetivo
Crear las tablas y columnas necesarias para soportar la vinculacion item por item entre pedidos, remitos y facturas.

## Pre-requisitos
- Ninguno. Esta fase se ejecuta primero.

## Archivo a modificar
- `backend/src/config/db.ts` — funcion `runAutoMigrations()` (o donde se agregan ALTER TABLE)
- `backend/src/modules/remitos/remitos.service.ts` — funcion `ensureTables()` (lineas 11-55)

## Migracion 1: Columnas nuevas en remito_items

**Donde**: `remitos.service.ts` → `ensureTables()` (despues de linea 42)

```sql
ALTER TABLE remito_items ALTER COLUMN quantity TYPE DECIMAL(12,2);
ALTER TABLE remito_items ADD COLUMN IF NOT EXISTS product_id UUID REFERENCES products(id) ON DELETE SET NULL;
ALTER TABLE remito_items ADD COLUMN IF NOT EXISTS unit_price DECIMAL(12,2);
ALTER TABLE remito_items ADD COLUMN IF NOT EXISTS vat_rate DECIMAL(5,2) DEFAULT 21;
ALTER TABLE remito_items ADD COLUMN IF NOT EXISTS order_item_id UUID REFERENCES order_items(id) ON DELETE SET NULL;
ALTER TABLE remito_items ADD COLUMN IF NOT EXISTS invoice_item_id UUID REFERENCES invoice_items(id) ON DELETE SET NULL;
```

**Riesgo**: El ALTER de quantity INT → DECIMAL puede fallar si hay datos. Usar `USING quantity::decimal(12,2)`.

**Verificacion**: `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'remito_items'` debe mostrar 10+ columnas.

## Migracion 2: Tabla remito_orders (N:N)

**Donde**: `remitos.service.ts` → `ensureTables()` (despues de migracion 1)

```sql
CREATE TABLE IF NOT EXISTS remito_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  remito_id UUID NOT NULL REFERENCES remitos(id) ON DELETE CASCADE,
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  UNIQUE(remito_id, order_id)
);
CREATE INDEX IF NOT EXISTS idx_remito_orders_remito ON remito_orders(remito_id);
CREATE INDEX IF NOT EXISTS idx_remito_orders_order ON remito_orders(order_id);
```

**Verificacion**: `SELECT * FROM remito_orders LIMIT 0` no debe dar error.

## Migracion 3: Tabla invoice_remitos (N:N)

**Donde**: `remitos.service.ts` → `ensureTables()` (despues de migracion 2)

```sql
CREATE TABLE IF NOT EXISTS invoice_remitos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  remito_id UUID NOT NULL REFERENCES remitos(id) ON DELETE CASCADE,
  UNIQUE(invoice_id, remito_id)
);
CREATE INDEX IF NOT EXISTS idx_invoice_remitos_invoice ON invoice_remitos(invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_remitos_remito ON invoice_remitos(remito_id);
```

## Migracion 4: remito_item_id en invoice_items

**Donde**: `db.ts` → `runAutoMigrations()` o `invoices.service.ts` → `ensureMigrations()`

```sql
ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS remito_item_id UUID REFERENCES remito_items(id) ON DELETE SET NULL;
```

**Importancia**: Este es el vinculo item-por-item entre factura y remito. Sin esto, no se puede saber que items del remito ya fueron facturados.

## Migracion 5: qty_delivered en order_items

**Donde**: `db.ts` → `runAutoMigrations()` o `orders.service.ts`

```sql
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS qty_delivered DECIMAL(12,2) DEFAULT 0;
```

**Nota**: Este es un campo CALCULADO que se actualiza en cascada al crear/cancelar remitos. Se mantiene denormalizado para performance en las queries de disponibilidad.

## Migracion 6: Columnas de formato en remitos

**Donde**: `remitos.service.ts` → `ensureTables()`

```sql
ALTER TABLE remitos ADD COLUMN IF NOT EXISTS punto_venta INTEGER DEFAULT 1;
ALTER TABLE remitos ADD COLUMN IF NOT EXISTS factura_ref VARCHAR(30);
ALTER TABLE remitos ADD COLUMN IF NOT EXISTS pedido_ref VARCHAR(30);
```

- `punto_venta`: heredado de companies.punto_venta o configurable
- `factura_ref`: display "0001-00001833" si el remito viene de una factura
- `pedido_ref`: display "0001-00039116" si viene de un pedido

## Migracion 7: Campos emisor en companies

**Donde**: `db.ts` → `runAutoMigrations()`

Verificar primero cuales ya existen:
```sql
ALTER TABLE companies ADD COLUMN IF NOT EXISTS website VARCHAR(255);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS ingresos_brutos VARCHAR(50);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS inicio_actividad DATE;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS rubro_descripcion TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS punto_venta_remito INTEGER DEFAULT 1;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS cai_remito VARCHAR(20);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS cai_remito_vto DATE;
```

**Nota**: `punto_venta` ya existe en companies (linea 488 de db.ts). Verificar si `punto_venta_remito` debe ser separado o si se reutiliza `punto_venta`.

## Retrocompatibilidad
- Todos los campos nuevos son nullable o tienen DEFAULT → remitos existentes siguen funcionando
- remito_items.quantity cambia de INT a DECIMAL → datos existentes se mantienen
- No se borran columnas

## Verificacion post-migracion
```sql
-- Verificar todas las tablas nuevas
SELECT tablename FROM pg_tables WHERE tablename IN ('remito_orders', 'invoice_remitos');

-- Verificar columnas nuevas en remito_items
SELECT column_name FROM information_schema.columns WHERE table_name = 'remito_items' ORDER BY ordinal_position;

-- Verificar columna en invoice_items
SELECT column_name FROM information_schema.columns WHERE table_name = 'invoice_items' AND column_name = 'remito_item_id';

-- Verificar columna en order_items  
SELECT column_name FROM information_schema.columns WHERE table_name = 'order_items' AND column_name = 'qty_delivered';
```

---

## CORRECCIONES POST-REVIEW

### FIX L1: Indices en columnas de vinculo
Agregar despues de las migraciones:
```sql
CREATE INDEX IF NOT EXISTS idx_remito_items_order_item ON remito_items(order_item_id) WHERE order_item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_remito_items_invoice_item ON remito_items(invoice_item_id) WHERE invoice_item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_invoice_items_remito_item ON invoice_items(remito_item_id) WHERE remito_item_id IS NOT NULL;
```

### FIX H6: ON DELETE RESTRICT en tablas N:N
Cambiar las tablas N:N para que orders/invoices usen RESTRICT:
```sql
CREATE TABLE IF NOT EXISTS remito_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  remito_id UUID NOT NULL REFERENCES remitos(id) ON DELETE CASCADE,
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,  -- NO CASCADE
  UNIQUE(remito_id, order_id)
);

CREATE TABLE IF NOT EXISTS invoice_remitos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,  -- NO CASCADE
  remito_id UUID NOT NULL REFERENCES remitos(id) ON DELETE CASCADE,
  UNIQUE(invoice_id, remito_id)
);
```
Asi no se pueden borrar pedidos/facturas que tengan remitos vinculados sin pasar por la logica de negocio.

### FIX M2: pedido_ref y factura_ref como TEXT (no VARCHAR(30))
Cambiar a TEXT para soportar multiples referencias:
```sql
ALTER TABLE remitos ADD COLUMN IF NOT EXISTS factura_ref TEXT;
ALTER TABLE remitos ADD COLUMN IF NOT EXISTS pedido_ref TEXT;
```
