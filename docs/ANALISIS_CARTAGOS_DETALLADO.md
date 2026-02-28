# ANÁLISIS DETALLADO: CARTAGOS / PHENICIAN SOFTWARE

## 1. IDENTIDAD DEL PRODUCTO

### Evolución Histórica
- **1992**: SM Gestor (DOS, Clipper) - Primera versión para comercios
- **2000**: Phenician (Windows, Visual Basic + SQL Server) - Reescritura para Windows, consolidación
- **2019**: Cartagos (Rebranding) - Nombre actual por razones de marketing

### Información Oficial Actual
- **URL**: https://cartagos.com.ar/
- **Empresa**: Servimatica S.H.
- **Contacto**: servimatica@gmail.com | (0237) 463-6301
- **Ubicación**: Argentina (Mar del Plata)
- **Mercado**: Small-to-Medium Business (PyMEs comerciales)

### Posicionamiento
- Software de gestión comercial **integral** para empresas
- +30 años de evolución en el mercado argentino
- Solución **local** entendida la realidad de negocios en Argentina
- Cumple con regulaciones AFIP (Agencia Federal de Ingresos Públicos)

---

## 2. CATÁLOGO DE PRECIOS & MODELO COMERCIAL

### Pricing (2024-2025)
| Licencia | Costo | Pagos | Duración |
|----------|-------|-------|----------|
| 2 PC | $600,000 ARS | 12 cuotas de $60,000 | Pago único |

### Modelo de Negocio
- **Setup**: Instalación remota incluida
- **Trial**: 30 días de prueba
- **Facturación**: Pago único por licencia (no SaaS/suscripción mensual)
- **Setup AFIP**: Certificado digital + diseño de comprobantes incluido

---

## 3. FUNCIONALIDADES CORE IDENTIFICADAS

### 3.1 MÓDULO DE FACTURACIÓN ELECTRÓNICA
**Descripción**: Sistema integrado de facturación AFIP

**Funcionalidades**:
- Generación de facturas electrónicas (A, B, C)
- Presupuestos/Cotizaciones
- Remitos/Albaranes
- Facturas rectificativas (NC, ND)
- Comprobantes de venta
- Recibos
- Tickets (TPV)
- Control de numeración secuencial
- Integración directa con AFIP (WebService)
- Descarga de CUIT
- **INCLUIDO**: Setup inicial de certificado digital
- **INCLUIDO**: Diseño personalizado de comprobantes

**Características Técnicas**:
- Códigos QR en comprobantes
- Número fiscal único por comprobante
- Auditoría de cambios (quién/cuándo/qué cambió)
- Cancelación/anulación de comprobantes
- Resumen de facturación por período

---

### 3.2 MÓDULO DE GESTIÓN DE INVENTARIO

**Descripción**: Control de stock en tiempo real

**Funcionalidades**:
- Catálogo de productos completo
- SKU único por producto
- Códigos de barras (128, EAN-13)
- Stock por almacén/depósito
- Niveles mínimos y máximos de stock
- Alertas de stock bajo
- Control de rotación de productos
- Historial de movimientos
- Ajustes de stock manual
- Pérdidas/Mermas
- Devoluciones a proveedor
- Compras a clientes
- Transferencias entre almacenes

**Atributos de Producto**:
- Código de producto
- Descripción
- Categoría
- Marca
- Unidad de medida (pieza, kg, metro, etc.)
- Costo unitario
- Precio final
- % IVA (21%, 10.5%, 2.5%, 0%)
- Stock actual
- Costo total en depósito
- Fecha de vencimiento (si aplica)
- Foto/imagen del producto
- Proveedores asociados

---

### 3.3 MÓDULO DE GESTIÓN DE PRECIOS

**Descripción**: Control integral de precios de venta

**Funcionalidades**:
- **Estructura de Precios**:
  - Costo del producto
  - % de ganancia/margen
  - Impuestos (IVA)
  - Precio final calculado automáticamente

- **Listas de Precios**:
  - Múltiples listas de precios simultáneas
  - Listas por cliente
  - Listas por canal de venta
  - Aplicación de descuentos
  - Vigencia de lista (fecha inicio/fin)

- **Promociones**:
  - Descuentos por volumen
  - Descuentos por cliente
  - Descuentos por período
  - Descuentos por producto
  - Ofertas especiales

- **Márgenes**:
  - Cálculo automático de margen
  - Histórico de cambios de precio
  - Alertas si precio cae bajo costo

---

### 3.4 MÓDULO DE GESTIÓN DE CLIENTES

**Descripción**: Base de datos integral de clientes

**Funcionalidades**:
- Registro completo de clientes
- CUIT/CUIL
- Razón social/Nombre
- Dirección completa
- Teléfono/Email
- Contactos múltiples
- Condición tributaria (IVA, monotributo, etc.)
- Límite de crédito
- Plazo de pago
- Zona/Territorio
- Vendedor asignado
- Categoría de cliente
- Preferencias de contacto
- Historial de compras
- Estado (activo, inactivo, suspendido)

---

### 3.5 MÓDULO DE GESTIÓN DE PROVEEDORES

**Descripción**: Control de proveedores y compras

**Funcionalidades**:
- Datos de proveedor
- CUIT
- Contactos
- Productos que vende
- Precios de compra
- Plazo de pago
- Condiciones especiales
- Histórico de compras
- Evaluación/rating de proveedor

---

### 3.6 MÓDULO DE COMPRAS

**Descripción**: Gestión de compras a proveedores

**Funcionalidades**:
- Órdenes de compra
- Recepción de mercadería
- Factura de proveedor (importación)
- Control de pagos a proveedores
- Devoluciones a proveedor
- Seguimiento de compras

---

### 3.7 MÓDULO DE VENTAS

**Descripción**: Gestión de operaciones de venta

**Funcionalidades**:
- Presupuestos a cliente
- Pedidos de venta
- Remitos
- Facturas de venta
- Devoluciones de cliente
- Seguimiento de venta
- Análisis por vendedor

---

### 3.8 MÓDULO DE COBRANZAS/CUENTAS POR COBRAR

**Descripción**: Control de crédito y cobranzas

**Funcionalidades**:
- Facturas pendientes de pago
- Seguimiento de pagos
- Vencimientos de deudas
- Planes de pago/Cuotas
- Reminders de vencimiento
- Histórico de pagos
- Notas de crédito/débito
- Control de morosos
- Cálculo de intereses por mora

---

### 3.9 MÓDULO DE PAGOS A PROVEEDORES

**Descripción**: Control de pagos outgoing

**Funcionalidades**:
- Facturas de proveedor pendientes
- Planes de pago
- Cancelación de pagos
- Métodos de pago (cheque, transferencia, etc.)
- Seguimiento de pagos
- Histórico

---

### 3.10 MÓDULO DE REPORTES & ANÁLISIS

**Descripción**: Generación de reportes y análisis empresariales

**Reportes Disponibles**:
- Reporte de ventas (por período, vendedor, cliente)
- Reporte de compras
- Reporte de stock/inventario
- Reporte de cuentas por cobrar
- Reporte de cuentas por pagar
- Reporte de rentabilidad por producto
- Reporte de rentabilidad por cliente
- Reporte de flujo de caja
- Reporte de márgenes
- Listado de productos
- Listado de clientes
- Movimiento de inventario

**Formatos**:
- Pantalla (visualización)
- PDF (descarga)
- Excel (exportación)
- Impresora (físico)

**Características**:
- Filtros por período
- Filtros por cliente/proveedor
- Filtros por producto/categoría
- Gráficas comparativas
- Totales y subtotales

---

### 3.11 MÓDULO DE GESTIÓN DE ALMACENES

**Descripción**: Control multi-almacén

**Funcionalidades**:
- Múltiples almacenes/sucursales
- Transferencias entre almacenes
- Stock por almacén
- Recepción en almacén
- Despacho desde almacén
- Auditoría de movimientos

---

### 3.12 MÓDULO DE PUNTO DE VENTA (TPV)

**Descripción**: Sistema de venta al mostrador

**Funcionalidades** (si implementado):
- Venta rápida
- Selección de producto por código/nombre
- Cálculo automático de total
- Aplicación de descuentos
- Métodos de pago (efectivo, tarjeta, cheque, mixto)
- Generación de ticket
- Apertura/cierre de caja
- Control de cambio

---

### 3.13 MÓDULO DE CONFIGURACIÓN GENERAL

**Descripción**: Configuración del sistema

**Funcionalidades**:
- Datos de empresa
- Logo/Imagen corporativa
- Impuestos (IVA por tasa)
- Condiciones de venta
- Usuarios del sistema
- Permisos por usuario
- Auditoría de accesos
- Respaldos de base de datos
- Restauración de respaldos
- Parámetros de sistema

---

### 3.14 MÓDULO DE SEGUIMIENTO Y TRAZABILIDAD

**Descripción**: Rastreo de operaciones

**Funcionalidades**:
- Historial completo de cada documento
- Quién creó/modificó/eliminó
- Cuándo se hizo cada cambio
- Qué se cambió
- Auditoría de cambios
- Trazabilidad de producto (lote, vencimiento)

---

## 4. CARACTERÍSTICAS TÉCNICAS

### Plataforma
- **Sistema Operativo**: Windows (equipos de escritorio)
- **Base de Datos**: SQL Server (desde versión Phenician 2000)
- **Idioma**: Español (Argentina)
- **Interfaz**: GUI Windows (Visual Basic)

### Requerimientos
- Internet obligatorio (para AFIP, actualizaciones)
- Impresora estándar
- Licencia de 2 PC simultáneos

### Integración AFIP
- WebService directo con AFIP
- Sincronización de comprobantes
- Descarga de CUIT automática
- Validación en línea

---

## 5. ANÁLISIS COMPETITIVO

### Competidores Directos en Argentina

| Software | Modelo | Ventaja Principal | Limitación |
|----------|--------|-------------------|-----------|
| **TusFacturasAPP** | Cloud/Online | Acceso desde cualquier lado | Menos modular que Cartagos |
| **Xubio** | Cloud/Online | Fácil de usar, UI moderna | Más enfocado en pymes pequeñas |
| **Alegra** | Cloud/Online | Muy intuitivo | Menos funcionalidades de gestión |
| **Contabilium** | Cloud | Automatización contable | No incluye inventario avanzado |
| **Líder Gestión** | Desktop | Muy completo | Interfaz antigua |
| **GestionComercios** | Desktop | Módulos completos | Menos popular |
| **Jazz Gestión** | Desktop | Buena cobertura | Interfaz básica |

### Fortalezas de Cartagos
✅ 30 años de historia (confiabilidad)
✅ Muy adaptado a regulación AFIP argentina
✅ Modular y configurable
✅ Precio único (no suscripción mensual)
✅ Setup AFIP incluido
✅ Soporte local (Argentina)

### Debilidades/Oportunidades de Mejora
❌ Interfaz desactualizada (Windows Forms)
❌ No cloud-native (requiere instalación)
❌ Sin app móvil
❌ Difícil escalabilidad
❌ Información limitada en web
❌ Poca presencia en redes sociales
❌ UX/UI no moderna
❌ No integración con otros sistemas (CRM, contabilidad, etc.)

---

## 6. INSIGHTS DE MERCADO ARGENTINO

### Contexto
- Mercado PyME muy grande en Argentina
- AFIP obligatoria para facturación
- Preferencia por soluciones locales (que entienden regulación)
- Migración gradual a cloud pero muchos aún prefieren desktop
- Demanda de soluciones all-in-one

### Oportunidades Identificadas
1. **Modernización UI/UX**: La interfaz de Cartagos es antigua, hay espacio para mejorar
2. **Versión Cloud**: Migrar a SaaS daría acceso más amplio
3. **App Móvil**: Falta acceso desde teléfono/tablet
4. **Integraciones**: Conexión con banking, CRM, contabilidad
5. **Analytics Avanzados**: BI/Dashboards más visuales
6. **E-commerce**: Integración con tiendas online
7. **Automatización**: Flujos automáticos de órdenes, facturas, pagos

---

## 7. STACK TÉCNICO RECOMENDADO PARA REPLICAR

### Backend
- **Lenguaje**: C# .NET o TypeScript (Node.js)
- **BD**: PostgreSQL o SQL Server
- **API**: REST API moderna
- **Auth**: JWT + Role-Based Access Control (RBAC)

### Frontend
- **Framework**: React/Vue.js (moderno vs Windows Forms)
- **UI**: Tailwind CSS o Material UI
- **Desktop**: Electron o Tauri (cross-platform)
- **Mobile**: React Native o Flutter

### Integraciones Clave
- WebService AFIP
- APIs de bancos (para pagos)
- Servicios de impresión
- Backups en cloud

### Arquitectura
- Modular (cada módulo independiente)
- Escalable (preparado para crecer)
- Multi-tenant ready (múltiples empresas en mismo sistema)
- API-first (separar lógica de presentación)

---

## 8. FUNCIONALIDADES A IMPLEMENTAR (PRIORIDAD)

### TIER 1 (MVP - Crítico)
- ✅ Gestión de productos (CRUD)
- ✅ Gestión de precios (costo, margen, IVA)
- ✅ Catálogo de productos
- ✅ Generación de PDF de catálogos
- ✅ Facturación básica
- ✅ Control de inventario
- ✅ Clientes base

### TIER 2 (Importante)
- ✅ Facturación AFIP completa
- ✅ Reportes básicos
- ✅ Cobranzas
- ✅ Gestión de proveedores
- ✅ Compras

### TIER 3 (Deseable)
- ✅ Punto de venta (TPV)
- ✅ App móvil
- ✅ Analytics/Dashboards
- ✅ Integraciones externas
- ✅ Multi-almacén avanzado

---

## 9. CONCLUSIONES

Cartagos es un **software legacy pero funcional** que domina el mercado de PyMEs comerciales en Argentina por su especificidad local (AFIP) y modularidad. Sus principales limitaciones son:
- Interfaz desactualizada
- No disponible en cloud
- Sin app móvil
- Poca visibilidad digital

**Oportunidad**: Crear una versión **moderna, cloud-first, con app móvil** que mantenga toda la funcionalidad pero con mejor UX/tecnología, atrayendo nuevos usuarios y mejorando la experiencia de los actuales.

