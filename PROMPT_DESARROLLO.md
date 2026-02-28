# PROMPT MAESTRO - DESARROLLO GESTOR BECKER VISUAL

## 🎯 OBJETIVO GENERAL

Construir **Gestor BeckerVisual**, un sistema de gestión comercial integral, moderno y multi-plataforma que replica y mejora todas las funcionalidades de Cartagos/Phenician Software, con tecnología contemporánea, interfaz moderna y experiencia superior.

**Posicionamiento**: La alternativa moderna, cloud-first a Cartagos para PyMEs argentinas.

---

## 📋 RESUMEN DE REQUERIMIENTOS

### Contexto de Negocio
- **Mercado**: PyMEs comerciales de Argentina
- **Competidor Principal**: Cartagos (legacy, 30 años, interfaz desactualizada)
- **Oportunidad**: Modernizar sin perder funcionalidades, agregar cloud + mobile
- **Diferenciador**: UI/UX moderna, cloud-ready, multi-plataforma, mejor integraciones

### Funcionalidades Clave (Todas Requeridas)
1. ✅ Gestión completa de productos y catálogos
2. ✅ Control de precios (costo → margen → precio final + IVA)
3. ✅ Generación de PDFs de catálogos profesionales
4. ✅ Facturación electrónica integrada con AFIP
5. ✅ Control de inventario (múltiples almacenes)
6. ✅ Gestión de clientes y proveedores
7. ✅ Órdenes de compra y venta
8. ✅ Cobranzas y cuentas por pagar
9. ✅ Reportes completos (ventas, compras, rentabilidad, flujo de caja)
10. ✅ Punto de venta (TPV)
11. ✅ Dashboard analítico
12. ✅ Multi-tenant (múltiples empresas)
13. ✅ App móvil (iOS/Android)

---

## 🏗️ ARQUITECTURA TÉCNICA

### Stack Recomendado

**Frontend Web/Desktop**:
- React 19 + TypeScript
- Tailwind CSS v4
- Vite (bundler)
- Electron (para versión desktop)
- Zustand (state management)
- React Query (data fetching)

**Frontend Mobile**:
- React Native
- TypeScript
- Redux o Context API

**Backend**:
- Node.js + Express (o NestJS)
- TypeScript
- PostgreSQL (o SQL Server)
- Jest (testing)

**Infraestructura**:
- Docker (containerización)
- Docker Compose (local development)
- GitHub Actions (CI/CD)
- AWS/GCP (hosting)
- S3 (almacenamiento PDFs/backups)

### Requisitos de Sistema
- Node.js 18+
- PostgreSQL 13+
- Docker & Docker Compose
- Git

---

## 📁 ESTRUCTURA DE CARPETAS

```
/home/facu/BECKER/Gestor\ BeckerVisual/
├── backend/                          # API REST
│   ├── src/
│   │   ├── auth/                     # Autenticación
│   │   ├── products/                 # Productos
│   │   ├── pricing/                  # Precios
│   │   ├── customers/                # Clientes
│   │   ├── suppliers/                # Proveedores
│   │   ├── sales/                    # Ventas/Facturas
│   │   ├── purchases/                # Compras
│   │   ├── inventory/                # Inventario
│   │   ├── afip/                     # Integración AFIP
│   │   ├── reports/                  # Reportes
│   │   ├── config/                   # Configuración
│   │   ├── database/                 # Migrations, schema
│   │   └── main.ts                   # Entry point
│   ├── tests/
│   ├── docker-compose.yml
│   ├── .env.example
│   ├── package.json
│   └── tsconfig.json
│
├── frontend/                         # Web + Desktop
│   ├── src/
│   │   ├── components/               # Componentes reutilizables
│   │   │   ├── ui/                   # Button, Input, Select, etc.
│   │   │   ├── layout/               # Header, Sidebar, Footer
│   │   │   └── modules/              # Productos, Clientes, Ventas, etc.
│   │   ├── pages/                    # Páginas/rutas
│   │   ├── stores/                   # Zustand stores
│   │   ├── hooks/                    # Custom hooks
│   │   ├── services/                 # API calls
│   │   ├── types/                    # TypeScript types
│   │   ├── styles/                   # Global CSS
│   │   └── App.tsx
│   ├── electron/                     # Electron main/preload
│   │   ├── main.ts
│   │   ├── preload.ts
│   │   └── utils/
│   ├── public/
│   ├── tests/
│   ├── vite.config.ts
│   ├── .env.example
│   ├── package.json
│   └── tsconfig.json
│
├── mobile/                           # React Native
│   ├── src/
│   │   ├── screens/
│   │   ├── components/
│   │   ├── navigation/
│   │   ├── stores/
│   │   └── services/
│   ├── app.json
│   ├── package.json
│   └── tsconfig.json
│
├── docs/                             # Documentación
│   ├── ANALISIS_CARTAGOS_DETALLADO.md
│   ├── ESPECIFICACIONES_TECNICAS.md
│   ├── API.md
│   ├── DATABASE.md
│   └── DEPLOYMENT.md
│
├── scripts/                          # Utilidades
│   ├── setup.sh
│   ├── migrate-db.sh
│   ├── seed-db.sh
│   └── docker-build.sh
│
├── docker-compose.yml                # Stack completo
├── .env.example
├── .gitignore
├── README.md
└── PROMPT_DESARROLLO.md              # Este archivo
```

---

## 🔧 SETUP INICIAL

### 1. Crear estructura base
```bash
cd /home/facu/BECKER/Gestor\ BeckerVisual/

# Backend
mkdir -p backend/src/{auth,products,pricing,customers,suppliers,sales,purchases,inventory,afip,reports,config,database} backend/tests

# Frontend
mkdir -p frontend/src/{components/{ui,layout,modules},pages,stores,hooks,services,types,styles} frontend/electron frontend/public frontend/tests

# Mobile
mkdir -p mobile/src/{screens,components,navigation,stores,services}
```

### 2. Inicializar proyectos
```bash
# Backend
cd backend
npm init -y
npm install express typescript ts-node @types/express dotenv pg
npm install --save-dev @types/node nodemon

# Frontend
cd ../frontend
npm create vite@latest . -- --template react-ts
npm install tailwindcss postcss autoprefixer zustand @tanstack/react-query axios electron

# Mobile
cd ../mobile
npx react-native init . --template typescript
```

### 3. Configurar PostgreSQL (Docker)
```bash
docker run --name gestor-becker-db \
  -e POSTGRES_USER=gestor_user \
  -e POSTGRES_PASSWORD=secure_password \
  -e POSTGRES_DB=gestor_becker \
  -p 5432:5432 \
  -d postgres:13
```

---

## 🗂️ ESPECIFICACIONES DETALLADAS

### 📦 Gestión de Productos

**Tabla: Products**
```sql
CREATE TABLE products (
  id UUID PRIMARY KEY,
  company_id UUID NOT NULL,
  sku VARCHAR(100) UNIQUE NOT NULL,
  barcode VARCHAR(50),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  category_id UUID,
  brand_id UUID,
  image_url TEXT,
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

**Funcionalidades**:
- CRUD completo
- SKU único y editable
- Códigos de barras generación automática (EAN-13)
- Categorías jerárquicas
- Marcas
- Imágenes (múltiples, upload a cloud)
- Búsqueda avanzada (por nombre, SKU, categoría, marca)
- Importación CSV/Excel
- Exportación de catálogo

---

### 💰 Gestión de Precios

**Tabla: Product_Pricing**
```sql
CREATE TABLE product_pricing (
  product_id UUID PRIMARY KEY REFERENCES products(id),
  cost_price DECIMAL(12,2) NOT NULL,
  margin_percent DECIMAL(5,2) DEFAULT 30,
  final_price DECIMAL(12,2) GENERATED,
  vat_rate DECIMAL(3,2) DEFAULT 21,
  vat_amount DECIMAL(12,2) GENERATED,
  price_with_vat DECIMAL(12,2) GENERATED,
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);
```

**Cálculo Automático**:
```
Precio Sin IVA = Costo × (1 + Margen%)
IVA = Precio Sin IVA × (Tasa IVA / 100)
Precio Final = Precio Sin IVA + IVA
```

**Validaciones**:
- ⚠️ Alerta si Precio Final < Costo
- ⚠️ Alerta si Margen < 5%
- Historial de cambios de precio

---

### 📄 Generación de Catálogos PDF

**Funcionalidades**:
- Seleccionar productos
- Diseño personalizable (logo, colores, fuente)
- Encabezado/pie de página
- Incluir/excluir información (código, descripción, precio)
- Ordenar por (nombre, código, categoría, precio)
- Filtros (categoría, marca, rango de precio)
- Tema claro/oscuro
- Generación en background (job queue)
- Descarga inmediata
- Historial de catálogos generados

**Integración**:
- Library: `pdfkit` o `puppeteer` (Node.js)
- Almacenamiento: S3/Google Cloud Storage

---

### 👥 Gestión de Clientes

**Tabla: Customers**
```sql
CREATE TABLE customers (
  id UUID PRIMARY KEY,
  company_id UUID NOT NULL,
  cuit VARCHAR(20) UNIQUE NOT NULL,
  business_name VARCHAR(255) NOT NULL,
  contact_name VARCHAR(255),
  address VARCHAR(255),
  city VARCHAR(100),
  province VARCHAR(100),
  postal_code VARCHAR(10),
  phone VARCHAR(20),
  email VARCHAR(100),
  tax_condition VARCHAR(50),
  credit_limit DECIMAL(12,2),
  payment_terms INT,
  zone_id UUID,
  salesman_id UUID,
  category VARCHAR(50),
  status VARCHAR(50) DEFAULT 'active',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

**Funcionalidades**:
- CRUD completo
- Validación de CUIT
- Historial de compras
- Límite de crédito configurable
- Descuentos especiales por cliente
- Contactos múltiples (teléfono, email, WhatsApp)
- Direcciones múltiples (envío, facturación)
- Estado (activo, inactivo, suspendido)

---

### 📋 Facturación AFIP

**Tabla: Invoice_Head**
```sql
CREATE TABLE invoice_head (
  id UUID PRIMARY KEY,
  company_id UUID NOT NULL,
  customer_id UUID NOT NULL,
  invoice_type VARCHAR(1) DEFAULT 'B',
  invoice_number BIGINT NOT NULL,
  invoice_date DATE NOT NULL,
  due_date DATE,
  subtotal DECIMAL(12,2),
  vat_amount DECIMAL(12,2),
  total_amount DECIMAL(12,2),
  cae VARCHAR(20),
  cae_expiry_date DATE,
  qr_code TEXT,
  status VARCHAR(50) DEFAULT 'draft',
  afip_response JSONB,
  created_at TIMESTAMP,
  created_by UUID
);
```

**Flujo de Facturación**:
1. Usuario crea factura (borrador)
2. Sistema valida datos (CUIT, cliente, stock)
3. Usuario autoriza
4. Sistema envía WebService AFIP
5. AFIP responde con CAE
6. Factura se marca como autorizada
7. Se genera QR
8. Se envía PDF a cliente por email

**Integración AFIP**:
- URL: `https://servicios1.afip.gov.ar/wsfev1`
- Métodos: `FEV1_GetToken`, `FEV1_GetLast_CMP`, `FEV1_GetCMP`, `FEV1_CreateBill`
- Tipos factura: A, B, C
- Tipos documentos: NC (Nota Crédito), ND (Nota Débito)

---

### 📦 Control de Inventario

**Tabla: Stock**
```sql
CREATE TABLE stock (
  warehouse_id UUID NOT NULL,
  product_id UUID NOT NULL,
  quantity DECIMAL(12,2) DEFAULT 0,
  min_level DECIMAL(12,2) DEFAULT 0,
  max_level DECIMAL(12,2) DEFAULT 0,
  PRIMARY KEY (warehouse_id, product_id)
);

CREATE TABLE stock_movement (
  id UUID PRIMARY KEY,
  product_id UUID NOT NULL,
  warehouse_id UUID NOT NULL,
  movement_type VARCHAR(50),
  quantity DECIMAL(12,2),
  reference_id UUID,
  reference_type VARCHAR(50),
  notes TEXT,
  created_at TIMESTAMP,
  created_by UUID
);
```

**Tipos de Movimiento**:
- PURCHASE: Compra a proveedor
- SALE: Venta a cliente
- ADJUSTMENT: Ajuste manual
- TRANSFER: Transferencia entre almacenes
- RETURN_CUSTOMER: Devolución de cliente
- RETURN_SUPPLIER: Devolución a proveedor

**Validaciones**:
- ⚠️ Alerta si stock < mínimo
- 🔴 Bloquear venta si stock insuficiente
- Permite backorder (venta anticipada) si configurado

---

### 📊 Reportes

**Reporte de Ventas**:
- Período customizable (día, semana, mes, año)
- Filtro por vendedor, cliente, producto
- Columnas: Producto, Cantidad, Precio Unit., Subtotal, IVA, Total
- Subtotales por cliente/vendedor
- Total general
- Gráfico: Tendencia de ventas

**Reporte de Rentabilidad**:
- Por producto: Costo total, Ingresos, Ganancia, %
- Por cliente: Ingreso total, Ganancia, %
- Ranking de mejores productos/clientes
- Gráfico: Top 10 productos

**Reporte de Inventario**:
- Stock actual por almacén
- Valor total (stock × costo)
- Productos con bajo stock
- Rotación (salidas últimos 90 días)
- ABC Analysis (20% productos = 80% valor)

**Reporte Financiero**:
- Flujo de caja diario/semanal/mensual
- Ingresos, Egresos, Saldo
- Proyección de flujo
- Balance (activos, pasivos, patrimonio)

---

## 🎨 INTERFAZ DE USUARIO

### Componentes Principales

**Header**:
- Logo + Nombre Empresa
- Búsqueda global (productos, clientes, facturas)
- Notificaciones (stock bajo, facturas vencidas)
- Usuario (foto, dropdown con perfil/logout)
- Tema claro/oscuro

**Sidebar**:
- Menú principal (collapsible)
- Ícono + Texto
- Indicador de módulo activo
- Submúes (si aplica)

**Dashboard**:
- 4 cards principales: Ventas (hoy/mes), Margen, Stock bajo, Facturas vencidas
- Gráfico: Ventas últimos 7/30 días
- Tabla: Últimas transacciones
- Quick actions: Nueva venta, Nuevo cliente, etc.

**Listados**:
- Tabla con paginación
- Búsqueda por texto
- Filtros avanzados (date range, rango de precio, etc.)
- Ordenamiento por columna
- Selección múltiple (checkbox)
- Acciones bulk (eliminar, cambiar estado)
- Exportar (PDF, Excel)

**Formularios**:
- Validación en tiempo real
- Mensajes de error inline
- Ayuda (tooltips)
- Guardado automático (draft)
- Historial de cambios

---

## 🔒 SEGURIDAD

### Autenticación
- JWT (JSON Web Tokens)
- Refresh tokens (7 días)
- 2FA opcional
- Sessions (cookie httpOnly)

### Autorización
- Role-Based Access Control (RBAC)
- Roles: Admin, Gerente, Vendedor, Contable, Viewer
- Permisos granulares por módulo

### Auditoría
- Tabla `audit_log`: quién, qué, cuándo, IP, cambios
- Retención: 1 año (configurable)
- Exportación de auditoría

### Encriptación
- Contraseñas: bcrypt (10 rounds)
- Datos sensibles en DB: AES-256
- HTTPS obligatorio
- CORS configurado

---

## 🚀 INTEGRACIÓN AFIP

### Autenticación AFIP
```
1. Obtener Token de AFIP (usuario + clave)
2. Usar token en request AFIP
3. Token expira cada 12 horas
```

### Tipos de Documento Aceptados
- 80: CUIT
- 86: CUIL
- 96: Sin identificar

### Tipos de Factura
- A: Destinado a IVA
- B: Consumidor final
- C: No gravado

### Respuesta AFIP
```json
{
  "CAE": "12345678901234",
  "CAE_Fch_Vto": "20240630",
  "Resultado": "A",
  "FechaFirmaQR": "2024-06-01T10:30:00Z",
  "CUIT": "20123456789"
}
```

---

## 📲 APP MÓVIL (React Native)

### Funcionalidades Principales
- Consulta de catálogo
- Carrito de compra
- Crear pedidos
- Ver historial de ventas
- Consultar estado de órdenes
- Reportes rápidos (últimas ventas, top productos)
- Notificaciones push
- Modo offline (caché local)

### Pantallas
- Login
- Dashboard
- Catálogo (búsqueda, categorías)
- Carrito
- Crear Pedido
- Órdenes
- Perfil

---

## 🧪 TESTING

### Backend
- Unitarios: Jest (>80% coverage)
- Integración: Supertest (API endpoints)
- Database: Transaction rollback en tests

### Frontend
- Unitarios: Vitest
- Componentes: React Testing Library
- E2E: Playwright

---

## 📦 DEPLOYMENT

### Docker
```dockerfile
# Backend Dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 3000
CMD ["node", "dist/main.js"]
```

### Docker Compose (local)
```yaml
services:
  postgres:
    image: postgres:13
    env_file: .env
    ports:
      - "5432:5432"

  backend:
    build: ./backend
    depends_on:
      - postgres
    ports:
      - "3000:3000"
    env_file: .env

  frontend:
    build: ./frontend
    ports:
      - "5173:5173"
```

### Producción
- AWS ECS (backend)
- CloudFront (CDN frontend)
- RDS PostgreSQL (DB)
- S3 (almacenamiento)
- GitHub Actions (CI/CD)

---

## ✅ CHECKLIST DE DESARROLLO

### FASE 1: CORE (Semanas 1-8)
- [ ] Setup inicial (estructura, Docker, DB)
- [ ] Autenticación (login, JWT, 2FA)
- [ ] Dashboard básico
- [ ] CRUD de Productos
- [ ] CRUD de Precios
- [ ] Generación de PDFs catálogo
- [ ] CRUD de Clientes
- [ ] Órdenes de venta (básico)
- [ ] Facturas básicas (sin AFIP)
- [ ] Reportes básicos

### FASE 2: INTEGRACIONES (Semanas 9-14)
- [ ] Integración AFIP completa
- [ ] Inventario completo (múltiples almacenes)
- [ ] Compras (órdenes, recepciones)
- [ ] Cobranzas (cuentas por cobrar)
- [ ] Cuentas por pagar
- [ ] Reportes avanzados
- [ ] Punto de venta (TPV)

### FASE 3: POLISH & MOBILE (Semanas 15-20)
- [ ] App móvil (React Native)
- [ ] Integraciones (email, SMS, pagos)
- [ ] Optimizaciones performance
- [ ] Tests completos
- [ ] Documentación
- [ ] Capacitación

---

## 📞 CONSIDERACIONES FINALES

### Clientes Tipo de Cartagos
- Restaurantes
- Comercios minoristas
- Distribuidoras
- Pymes comerciales
- Boutiques
- Farmacias
- Librerías

### Ventaja Competitiva de BeckerVisual
- ✅ UI/UX moderna (vs interfaz antigua)
- ✅ Cloud + Mobile (vs solo desktop)
- ✅ Mejor performance
- ✅ Más integraciones
- ✅ Open roadmap (vs legacy)
- ✅ Comunidad (vs soporte limitado)
- ✅ Precio competitivo

### Plan de Go-to-Market
1. Beta cerrada (10 clientes Cartagos)
2. Feedback loop (2-3 meses)
3. MVP público
4. Campaigns de migración
5. Expansión regional

---

## 🎓 DOCUMENTACIÓN PROPORCIONADA

Junto con este prompt, encontrarás:
1. **ANALISIS_CARTAGOS_DETALLADO.md** - Análisis competitivo completo
2. **ESPECIFICACIONES_TECNICAS.md** - Diseño técnico detallado

---

## 🚦 PRÓXIMOS PASOS

1. ✅ Leer este documento completamente
2. ✅ Revisar documentación técnica
3. ✅ Setup inicial del entorno
4. ✅ Crear estructura base de carpetas
5. ✅ Inicializar repositorio Git
6. ✅ Comenzar con FASE 1 (Core)

---

**¡Listo para construir Gestor BeckerVisual!** 🚀

