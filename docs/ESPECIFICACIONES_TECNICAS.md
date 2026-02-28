# ESPECIFICACIONES TÉCNICAS - GESTOR BECKER VISUAL

## RESUMEN EJECUTIVO

**Gestor BeckerVisual** es un sistema de gestión comercial moderno, cloud-first y multi-plataforma diseñado para PyMEs de Argentina. Replica y mejora todas las funcionalidades de Cartagos/Phenician Software, pero con tecnología contemporánea, interfaz moderna y experiencia de usuario superior.

**Objetivo**: Crear la alternativa moderna a Cartagos que el mercado necesita.

---

## 1. ARQUITECTURA GENERAL DEL SISTEMA

### 1.1 Stack Tecnológico Recomendado

```
┌─────────────────────────────────────────────────────────┐
│                    CLIENTE (Frontend)                    │
├─────────────────────────────────────────────────────────┤
│ • Web: React 19 + TypeScript + Tailwind CSS v4          │
│ • Desktop: Electron + React (Windows, Mac, Linux)       │
│ • Mobile: React Native (iOS, Android)                   │
└──────────────┬──────────────────────────────────────────┘
               │ (REST API + GraphQL)
┌──────────────▼──────────────────────────────────────────┐
│                  API Gateway (Node.js)                   │
│          Backend: Express + TypeScript + NestJS          │
├─────────────────────────────────────────────────────────┤
│ • Autenticación & Authorization (JWT + RBAC)            │
│ • Rate limiting, Logging, Monitoring                    │
│ • Integración AFIP WebService                           │
└──────────────┬──────────────────────────────────────────┘
               │ (SQL)
┌──────────────▼──────────────────────────────────────────┐
│               Base de Datos - PostgreSQL                │
│     (Alternativa: SQL Server para compatibilidad)      │
├─────────────────────────────────────────────────────────┤
│ • Schemas separados por empresa (multi-tenant)         │
│ • Auditoría (audit tables)                             │
│ • Respaldos automáticos                                │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│              Servicios Externos (Integraciones)          │
├─────────────────────────────────────────────────────────┤
│ • AFIP WebService (Facturación)                         │
│ • SendGrid/Mailgun (Email)                             │
│ • S3/Google Cloud Storage (PDFs, backups)              │
│ • Stripe/Mercado Pago (Pagos online)                   │
│ • SMS Gateway (Notificaciones)                         │
└─────────────────────────────────────────────────────────┘
```

---

## 2. MÓDULOS DEL SISTEMA

### 2.1 Módulo de AUTENTICACIÓN & AUTORIZACIÓN

**Funcionalidades**:
- Login/Logout
- Registro de usuario
- Recuperación de contraseña
- Autenticación de 2 factores (2FA)
- Roles y permisos (Admin, Vendedor, Gerente, Contable)
- Auditoría de accesos (login/logout + acción realizada)
- Sesiones múltiples por usuario
- Token JWT con refresh token

**Datos**:
```sql
Users (id, email, password_hash, 2fa_secret, enabled, created_at)
Roles (id, name, description)
Permissions (id, name, module)
UserRoles (user_id, role_id)
RolePermissions (role_id, permission_id)
AuditLog (id, user_id, action, resource, timestamp, details)
```

---

### 2.2 Módulo de GESTIÓN DE EMPRESAS (Multi-tenant)

**Funcionalidades**:
- Crear empresa (razón social, CUIT, domicilio, logo)
- Datos de facturación
- Configuración de IVA
- Configuración de impresoras
- Usuarios de la empresa
- Almacenes/sucursales

**Datos**:
```sql
Companies (id, name, cuit, address, logo_url, active)
CompanyConfig (company_id, key, value)
CompanyUsers (company_id, user_id, role_id)
Warehouses (id, company_id, name, address)
```

---

### 2.3 Módulo de GESTIÓN DE PRODUCTOS & CATÁLOGO

**Funcionalidades**:
- CRUD de productos
- SKU único
- Categorías y subcategorías
- Marcas
- Códigos de barras (generación automática EAN-13)
- Atributos personalizables (color, tamaño, etc.)
- Imágenes (upload a cloud storage)
- Descripción extendida
- Filtros y búsqueda avanzada

**Datos**:
```sql
Products (
  id, sku, barcode, name, description,
  brand_id, category_id, image_url,
  active, created_at, updated_at
)
Categories (id, company_id, name, parent_id, active)
ProductAttributes (product_id, attribute_name, attribute_value)
ProductImages (product_id, image_url, is_primary)
```

---

### 2.4 Módulo de GESTIÓN DE PRECIOS

**Funcionalidades**:
- **Estructura de precio**: Costo → % Ganancia → Precio Final + IVA
- Múltiples listas de precio
- Listas por cliente / por canal / por período
- Descuentos por volumen
- Descuentos por cliente (variables)
- Histórico de cambios de precio
- Cálculo automático de márgenes
- Alertas si precio < costo

**Datos**:
```sql
Products_Pricing (
  product_id, cost, margin_percent, final_price,
  vat_rate (0|2.5|10.5|21), created_at
)
PriceLists (
  id, company_id, name, type (default|customer|channel|promo),
  valid_from, valid_to, active
)
PriceListItems (price_list_id, product_id, price, discount_percent)
PriceHistory (product_id, old_price, new_price, changed_by, changed_at)
```

---

### 2.5 Módulo de GENERACIÓN DE CATÁLOGOS (PDF)

**Funcionalidades**:
- Seleccionar productos de la lista de precio
- Personalizar encabezado/pie de página
- Agregar logo, datos empresa
- Generar PDF profesional
- Descarga inmediata
- Guardar plantillas de catálogo
- Filtrar por categoría/marca/rango de precio

**Datos**:
```sql
CatalogTemplates (id, company_id, name, header, footer, logo_url)
GeneratedCatalogs (id, company_id, template_id, pdf_url, created_at)
```

**Integración**: S3/Google Cloud Storage para almacenar PDFs

---

### 2.6 Módulo de CLIENTES

**Funcionalidades**:
- CRUD de clientes
- CUIT/CUIL
- Razón social
- Domicilio completo (calle, número, ciudad, provincia)
- Contactos (teléfono, email, múltiples)
- Condición tributaria (IVA, Monotributo, Exento)
- Límite de crédito
- Plazo de pago
- Zona/Territorio
- Vendedor asignado
- Categoría (mayorista, minorista, otros)
- Historial de compras
- Estado (activo, inactivo, suspendido)
- Descuentos especiales

**Datos**:
```sql
Customers (
  id, company_id, cuit, business_name, contact_name,
  address, city, province, phone, email,
  tax_condition, credit_limit, payment_terms,
  zone_id, salesman_id, category, status,
  created_at, updated_at
)
CustomerContacts (customer_id, type (phone|email|contact), value, primary)
CustomerPrices (customer_id, product_id, special_price)
```

---

### 2.7 Módulo de PROVEEDORES

**Funcionalidades**:
- CRUD de proveedores
- CUIT
- Contactos
- Productos que vende
- Precios de compra
- Plazo de pago
- Condiciones especiales
- Histórico de compras
- Rating/Evaluación

**Datos**:
```sql
Suppliers (
  id, company_id, cuit, business_name, contact_name,
  address, phone, email, payment_terms
)
SupplierProducts (supplier_id, product_id, supplier_sku, cost_price)
SupplierPurchaseHistory (supplier_id, purchase_count, last_purchase_date, rating)
```

---

### 2.8 Módulo de INVENTARIO & STOCK

**Funcionalidades**:
- Control de stock por almacén
- Niveles mínimos/máximos
- Alertas de stock bajo
- Ajustes manuales (pérdidas, mermas)
- Trasferencias entre almacenes
- Histórico de movimientos
- Rotación de productos (FIFO/LIFO)
- Vencimientos (si aplica)
- Bloqueo de stock para órdenes

**Datos**:
```sql
Stock (warehouse_id, product_id, quantity, min_level, max_level)
StockMovement (
  id, product_id, warehouse_id, type (purchase|sale|transfer|adjustment),
  quantity, reference_id, created_at
)
StockLevels (id, product_id, warehouse_id, min_alert, max_alert)
ProductLots (product_id, batch_number, expiry_date, quantity, warehouse_id)
```

---

### 2.9 Módulo de COMPRAS

**Funcionalidades**:
- Órdenes de compra
- Recepción de mercadería (matching contra OC)
- Factura de proveedor (importación)
- Gastos de compra (flete, etc.)
- Control de pagos
- Devoluciones
- Notas de débito de proveedor

**Datos**:
```sql
PurchaseOrders (
  id, company_id, supplier_id, order_date, delivery_date,
  status (draft|sent|received|invoiced|paid|cancelled)
)
PurchaseOrderItems (po_id, product_id, quantity, unit_cost, total)
SupplierInvoices (id, po_id, invoice_number, invoice_date, total, vat_amount)
PurchasePayments (invoice_id, payment_date, amount, method, reference)
```

---

### 2.10 Módulo de VENTAS

**Funcionalidades**:
- Presupuestos (cotizaciones)
- Pedidos de venta
- Remitos/Albaranes
- Facturas de venta
- Devoluciones de cliente
- Seguimiento de venta
- Análisis por vendedor

**Datos**:
```sql
Quotes (
  id, customer_id, quote_date, valid_until, status (draft|sent|accepted|rejected|expired),
  items (JSON), subtotal, vat_amount, total
)
SalesOrders (
  id, customer_id, order_date, delivery_date, status,
  items (JSON), subtotal, vat_amount, total
)
ShippingNotes (id, sales_order_id, shipping_date, items)
SalesInvoices (id, customer_id, invoice_date, invoice_number, status, total)
SalesReturns (id, invoice_id, return_date, reason, items, total)
```

---

### 2.11 Módulo de FACTURACIÓN ELECTRÓNICA (AFIP)

**Funcionalidades**:
- Integración WebService AFIP
- Tipos de factura (A, B, C)
- Notas de crédito (NC)
- Notas de débito (ND)
- Validación previa (CUIT cliente, datos)
- Generación de código QR
- Número fiscal único
- CAE (Código de Autorización Electrónica)
- Fecha de vencimiento CAE
- Cancelación de comprobantes
- Reporte de facturación periódica
- Sincronización con AFIP

**Datos**:
```sql
InvoiceHead (
  id, company_id, customer_id, invoice_type (A|B|C),
  invoice_number, invoice_date, due_date,
  subtotal, vat_amount, total_amount,
  cae, cae_expiry_date, qr_code,
  status (pending|authorized|cancelled),
  afip_response_json
)
InvoiceDetails (invoice_id, product_id, quantity, unit_price, vat_rate, subtotal)
AFIPSync (company_id, last_sync, status, error_log)
```

**Integración**: WebService AFIP (https://servicios1.afip.gov.ar/wsfev1)

---

### 2.12 Módulo de COBRANZAS (Cuentas por Cobrar)

**Funcionalidades**:
- Seguimiento de facturas pendientes
- Vencimientos
- Planes de pago/cuotas
- Recordatorios de vencimiento
- Histórico de pagos
- Notas de crédito
- Control de morosos
- Cálculo de intereses por mora
- Cálculo de bonificaciones por pronto pago

**Datos**:
```sql
AccountsReceivable (
  invoice_id, customer_id, amount_due, due_date,
  days_overdue, status (pending|partial|paid|disputed)
)
PaymentPlans (id, invoice_id, plan_date, installments_count)
PaymentPlanInstallments (plan_id, installment_number, due_date, amount, paid_date, paid_amount)
Payments (id, customer_id, payment_date, amount, method, invoice_id)
Overdue (invoice_id, days_overdue, interest_calculated, interest_amount)
```

---

### 2.13 Módulo de PAGOS A PROVEEDORES (Cuentas por Pagar)

**Funcionalidades**:
- Facturas de proveedor pendientes
- Planes de pago
- Cancelación de pagos
- Métodos de pago (cheque, transferencia, efectivo)
- Seguimiento de pagos
- Histórico

**Datos**:
```sql
AccountsPayable (
  supplier_invoice_id, supplier_id, amount_due, due_date,
  status (pending|partial|paid)
)
SupplierPayments (id, supplier_id, payment_date, amount, method, reference)
```

---

### 2.14 Módulo de REPORTES & ANÁLISIS

**Reportes Core**:

1. **Reporte de Ventas**
   - Por período (día, semana, mes, año)
   - Por vendedor
   - Por cliente
   - Por producto
   - Formato: tabla, gráfico, PDF

2. **Reporte de Compras**
   - Por período
   - Por proveedor
   - Análisis de costos

3. **Reporte de Inventario**
   - Stock por producto
   - Stock por almacén
   - Productos con bajo stock
   - Rotación
   - Valor total de inventario

4. **Reporte de Rentabilidad**
   - Por producto
   - Por cliente
   - Por categoría
   - Margen bruto/neto

5. **Reporte de Cobranzas**
   - Facturas pendientes
   - Morosos
   - Vencimiento próximo
   - Proyección de cobro

6. **Reporte de Cuentas por Pagar**
   - Facturas pendientes
   - Vencimiento próximo

7. **Reporte Financiero**
   - Flujo de caja (cash flow)
   - Balance
   - P&L

**Características**:
- Filtros avanzados (período, cliente, producto, vendedor, etc.)
- Exportación (PDF, Excel, CSV)
- Gráficos interactivos
- Comparativas período a período
- Alertas automáticas

**Datos**:
```sql
ReportTemplates (id, company_id, name, type, filters, format)
GeneratedReports (id, template_id, generated_at, pdf_url, excel_url)
```

---

### 2.15 Módulo de PUNTO DE VENTA (TPV) - OPCIONAL

**Funcionalidades**:
- Interfaz simplificada para venta rápida
- Búsqueda rápida de producto
- Códigos de barras (scanner)
- Carrito de compra
- Cálculo automático
- Aplicación de descuentos
- Métodos de pago (efectivo, tarjeta, cheque, mixto)
- Apertura/cierre de caja
- Control de cambio
- Generación de ticket/factura

**Datos**: Usa las mismas tablas que Ventas/Facturas

**Interfaz**: Especial para pantalla táctil/mostrador

---

### 2.16 Módulo de CONFIGURACIÓN & AUDITORÍA

**Funcionalidades**:
- Configuración de empresa
- Configuración de IVA
- Configuración de impresoras
- Permisos de usuario
- Auditoría completa (quién cambió qué, cuándo)
- Respaldos automáticos
- Restauración de respaldos
- Logs del sistema

**Datos**:
```sql
CompanySettings (company_id, key, value)
UserAudit (id, user_id, action, resource, resource_id, details, timestamp)
SystemLogs (id, level (INFO|WARN|ERROR), message, timestamp)
```

---

## 3. CARACTERÍSTICAS TÉCNICAS ESPECÍFICAS

### 3.1 Flujo de Cálculo de Precio
```
COSTO_PRODUCTO
    ↓
+ MARGEN_PORCENTAJE (definido por usuario)
    ↓
PRECIO_SIN_IVA
    ↓
+ IVA (0% | 2.5% | 10.5% | 21%)
    ↓
PRECIO_FINAL (lo que ve el cliente)

Validación: Si PRECIO_FINAL < COSTO_PRODUCTO → Alerta
```

### 3.2 Flujo de Facturación AFIP
```
VENTA (Presupuesto/Orden) → FACTURA (borrador)
    ↓
VALIDACIÓN:
  - CUIT cliente válido
  - Datos completos
  - Stock disponible
  - Cliente no suspendido
    ↓
ENVÍO a WebService AFIP
    ↓
RESPUESTA AFIP:
  - CAE (si OK) → Guardar, generar QR
  - Error → Mostrar error, permitir corrección
    ↓
FACTURA AUTORIZADA
    ↓
ENVÍO a Cliente (email + PDF)
```

### 3.3 Flujo de Nota de Crédito
```
VENTA/DEVOLUCIÓN → NOTA DE CRÉDITO
    ↓
VALIDACIÓN (referencia a factura original)
    ↓
ENVÍO a AFIP
    ↓
ACTUALIZACIÓN de Cuentas por Cobrar
```

### 3.4 Sincronización de Inventario
```
COMPRA:
  Factura Proveedor → Stock +X

VENTA:
  Factura Cliente → Stock -X

DEVOLUCIÓN CLIENTE:
  Nota Crédito → Stock +X

DEVOLUCIÓN PROVEEDOR:
  Nota Débito → Stock -X

TRANSFERENCIA:
  Almacén A -X → Almacén B +X
```

---

## 4. SEGURIDAD & COMPLIANCE

### 4.1 Seguridad
- Autenticación JWT (tokens con expiración)
- Contraseñas hasheadas (bcrypt)
- 2FA opcional
- HTTPS obligatorio
- SQL Injection prevention (parametrized queries)
- XSS prevention (input sanitization)
- CSRF tokens
- Rate limiting en API
- Auditoría completa de acciones
- Backup encriptado

### 4.2 Compliance
- AFIP compliance (facturación electrónica)
- GDPR-ready (derecho al olvido, exportación de datos)
- Auditoría fiscal (historial de cambios)
- Retención de datos (configurable por empresa)

---

## 5. BASE DE DATOS - DISEÑO

### Esquema General
```
PUBLIC SCHEMA:
├── Users, Roles, Permissions, AuditLog
└── Companies, CompanyConfig

TENANT SCHEMAS (por cada empresa):
├── Products, Categories, ProductAttributes
├── Customers, Suppliers
├── Stock, StockMovement
├── PurchaseOrders, SupplierInvoices
├── SalesOrders, SalesInvoices, SalesReturns
├── InvoiceHead, InvoiceDetails (AFIP)
├── AccountsReceivable, Payments
├── AccountsPayable, SupplierPayments
├── PriceLists, PriceListItems, PriceHistory
├── Warehouses
└── CompanySettings, UserAudit
```

### Índices Críticos
- Products: (sku, barcode, company_id)
- Customers: (cuit, company_id)
- Stock: (warehouse_id, product_id)
- Invoices: (invoice_number, company_id, customer_id)
- AuditLog: (user_id, timestamp)

---

## 6. API REST - ENDPOINTS PRINCIPALES

### Autenticación
```
POST   /auth/register
POST   /auth/login
POST   /auth/refresh-token
POST   /auth/logout
POST   /auth/2fa/setup
POST   /auth/2fa/verify
```

### Productos
```
GET    /products
GET    /products/{id}
POST   /products
PUT    /products/{id}
DELETE /products/{id}
POST   /products/bulk-import (CSV)
GET    /products/search?q=...
POST   /products/generate-barcode
```

### Precios
```
GET    /pricing/{product_id}
PUT    /pricing/{product_id}
GET    /price-lists
POST   /price-lists
GET    /price-lists/{id}/items
POST   /price-lists/{id}/items
```

### Catálogos
```
POST   /catalogs/generate-pdf
POST   /catalogs/templates
GET    /catalogs/templates/{id}
```

### Clientes
```
GET    /customers
POST   /customers
GET    /customers/{id}
PUT    /customers/{id}
DELETE /customers/{id}
GET    /customers/{id}/purchase-history
```

### Ventas
```
POST   /sales/quotes
POST   /sales/orders
POST   /sales/invoices
GET    /sales/invoices/{id}
POST   /sales/invoices/{id}/send-email
POST   /sales/returns
```

### Facturación AFIP
```
POST   /afip/invoices/authorize
GET    /afip/invoices/{id}/status
POST   /afip/credit-notes
GET    /afip/sync-status
```

### Compras
```
POST   /purchases/orders
GET    /purchases/orders/{id}
POST   /purchases/invoices
POST   /purchases/payments
```

### Reportes
```
GET    /reports/sales
GET    /reports/inventory
GET    /reports/profitability
GET    /reports/accounts-receivable
POST   /reports/export (PDF/Excel)
```

### Configuración
```
GET    /company/settings
PUT    /company/settings
GET    /company/users
POST   /company/users
```

---

## 7. FUNCIONALIDADES DE INTERFAZ

### 7.1 Dashboard Principal
- Resumen de ventas (hoy, semana, mes)
- Productos más vendidos
- Clientes principales
- Facturas pendientes
- Órdenes por entregar
- Alertas de stock bajo
- Flujo de caja (proyectado)
- KPIs principales

### 7.2 Menú Principal
```
├── Dashboard
├── Productos
│   ├── Catálogo
│   ├── Categorías
│   ├── Importar (CSV/Excel)
│   └── Generar Catálogo PDF
├── Precios
│   ├── Gestión de Precios
│   ├── Listas de Precio
│   └── Descuentos
├── Clientes
│   ├── Listado
│   ├── Nuevo Cliente
│   └── Historial de Compras
├── Ventas
│   ├── Presupuestos
│   ├── Órdenes
│   ├── Facturas
│   └── Devoluciones
├── Compras
│   ├── Órdenes de Compra
│   ├── Facturas Proveedor
│   └── Devoluciones
├── Inventario
│   ├── Stock
│   ├── Ajustes
│   ├── Transferencias
│   └── Alertas
├── Cobranzas
│   ├── Cuentas por Cobrar
│   ├── Pagos
│   └── Vencimientos
├── Reportes
│   ├── Ventas
│   ├── Compras
│   ├── Rentabilidad
│   ├── Inventario
│   └── Flujo de Caja
├── Administración
│   ├── Usuarios
│   ├── Permisos
│   ├── Configuración
│   ├── Auditoría
│   └── Respaldos
└── Mi Perfil
    ├── Datos
    ├── Contraseña
    └── Preferencias
```

---

## 8. PLANES DE IMPLEMENTACIÓN

### FASE 1: MVP (8-10 semanas)
✅ Autenticación y gestión de empresas
✅ Gestión de productos y catálogos
✅ Gestión de precios
✅ Generación de PDFs de catálogos
✅ Clientes básicos
✅ Órdenes de venta simples
✅ Facturas básicas (sin AFIP)
✅ Reportes básicos
✅ Dashboard simple

### FASE 2: Funcionalidades Core (8-10 semanas)
✅ Integración AFIP completa
✅ Inventario avanzado
✅ Compras
✅ Cobranzas
✅ Reportes avanzados
✅ Punto de venta (TPV)

### FASE 3: Mejoras & Expansión (6-8 semanas)
✅ App móvil (React Native)
✅ Integraciones (pagos, email, SMS)
✅ Analytics avanzado
✅ Automatizaciones
✅ Multi-almacén avanzado

---

## 9. REQUISITOS NO-FUNCIONALES

### Performance
- Dashboard carga en <2 segundos
- Listados de productos cargan en <1 segundo
- Reportes generados en <5 segundos
- API response <200ms (p95)
- Soporte para >10,000 productos
- Soporte para >1,000 usuarios concurrentes

### Escalabilidad
- Multi-tenant desde el diseño
- Preparado para microservicios futuros
- Database con índices optimizados
- Caché (Redis) para datos frecuentes

### Disponibilidad
- 99.9% uptime (SLA)
- Backups diarios automáticos
- Recuperación ante desastres (RTO <1 hora)
- Health checks automáticos

### Usabilidad
- Interfaz intuitiva (sin necesidad de entrenamiento)
- Responsive (desktop, tablet, mobile)
- Dark mode & light mode
- Atajos de teclado
- Búsqueda rápida en todas partes
- Undo/Redo en operaciones críticas

---

## 10. CONCLUSIÓN

Gestor BeckerVisual será la solución moderna que reemplazará Cartagos, manteniendo todas sus funcionalidades pero con:
- ✅ Tecnología contemporánea
- ✅ Interfaz moderna y usable
- ✅ Cloud-first pero con opción on-premise
- ✅ App móvil nativa
- ✅ Mejor performance
- ✅ Más integraciones
- ✅ Mejor soporte

