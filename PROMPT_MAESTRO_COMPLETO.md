# 🎯 PROMPT MAESTRO DEFINITIVO - Construcción Gestor BeckerVisual Completo

**Estado**: Construcción en progreso (Backend core iniciado, Frontend por comenzar)
**Objetivo Final**: Sistema de gestión comercial funcional, testeado y deployable
**Fecha**: 2026-02-28
**Stack**: Node.js + Express + PostgreSQL + React + Tailwind CSS

---

## ⚡ ESTADO ACTUAL DE LA CONSTRUCCIÓN

### ✅ COMPLETADO
- Docker Compose setup (PostgreSQL + services)
- Backend package.json + tsconfig
- Database schema (Drizzle ORM) con 15 tablas
- Middlewares (auth, error handling, cors, rate limiting)
- Auth module COMPLETO (register, login, refresh token)
- All router stubs para los 9 módulos principales
- Environment variables (.env.example)
- Express app setup

### 🔄 EN PROGRESO
- npm install del backend (running)
- Setup de Frontend (por comenzar)

### ⏳ PENDIENTE
- Completar servicios de cada módulo (Products, Customers, Invoices, etc.)
- Frontend React completo
- Integración AFIP real
- Generación de PDFs
- Tests (unitarios + integración)
- Verificación end-to-end

---

## 🚀 PLAN ACTUAL DE ACCIÓN

### FASE 1: Backend Funcional (NEXT)
1. ✅ npm install termina
2. ⏳ Crear Drizzle migrations
3. ⏳ Implementar Products service (CRUD real)
4. ⏳ Implementar Customers service
5. ⏳ Implementar Invoices service (sin AFIP aún)
6. ⏳ Implementar Inventory service
7. ⏳ Implement Reports service (agregaciones)
8. ⏳ Tests del backend
9. ⏳ Levantar servidor y verificar /api/health

### FASE 2: Frontend Básico (AFTER BACKEND)
1. ⏳ Vite setup
2. ⏳ Tailwind CSS setup
3. ⏳ Login page funcional
4. ⏳ Dashboard básico
5. ⏳ Products CRUD page
6. ⏳ Customers CRUD page
7. ⏳ Invoice creation wizard
8. ⏳ Tests del frontend

### FASE 3: Integraciones & Pulido (FINAL)
1. ⏳ Integración AFIP (WebService real)
2. ⏳ Generación de PDFs (Puppeteer)
3. ⏳ Email (Nodemailer)
4. ⏳ Reportes avanzados
5. ⏳ Tests E2E
6. ⏳ Documentación final

---

## 📋 MÓDULOS A IMPLEMENTAR (SERVIC IOS)

### 1. **Products Module** (CRÍTICO)
```typescript
// CRUD completo
GET /api/products          → List all with pagination/filters
POST /api/products         → Create with validation
GET /api/products/:id      → Get single
PUT /api/products/:id      → Update
DELETE /api/products/:id   → Delete

// Funcionalidades
- SKU unique per company
- Auto-generate barcode
- Category management
- Bulk import (CSV)
- Image upload
- Search + filters
```

### 2. **Pricing Module** (CRÍTICO)
```typescript
// Precio automático: Costo → Margen% → Precio Final + IVA
POST /api/pricing/{product_id}    → Set pricing
GET /api/pricing/{product_id}     → Get pricing

// Cálculo:
final_price = (cost × (1 + margin_percent/100)) × (1 + vat_rate/100)

// Validaciones:
- Alert si final_price < cost
- Alert si margin < 5%
- Historial de cambios
```

### 3. **Customers Module** (CRÍTICO)
```typescript
GET /api/customers         → List with pagination
POST /api/customers        → Create (CUIT validation)
GET /api/customers/:id     → Get single + purchase history
PUT /api/customers/:id     → Update
DELETE /api/customers/:id  → Delete

// Campos:
- CUIT (unique per company)
- name, contact_name, address
- email, phone
- tax_condition (IVA, Monotributo, etc.)
- credit_limit, payment_terms
```

### 4. **Invoices Module** (CRÍTICO)
```typescript
GET /api/invoices          → List with filters
POST /api/invoices         → Create draft
GET /api/invoices/:id      → Get single
PUT /api/invoices/:id      → Update draft
DELETE /api/invoices/:id   → Delete draft
POST /api/invoices/:id/authorize  → Send to AFIP

// Workflow:
1. Create invoice (draft)
2. Add items (products)
3. Calculate totals (auto)
4. Authorize with AFIP
5. Receive CAE + QR
6. Send to customer (email + PDF)

// Invoice Types:
- A (IVA empresas)
- B (Consumidor final)
- C (No gravado)
```

### 5. **Inventory Module**
```typescript
GET /api/inventory         → Get stock by warehouse
PUT /api/inventory/:id     → Adjust stock
POST /api/inventory/movements  → Record movement

// Movement types:
- purchase (compra)
- sale (venta)
- adjustment (ajuste)
- transfer (transferencia)
- return_customer (devolución cliente)

// Auto-trigger on invoice create:
- Decrease stock by item quantities
```

### 6. **Reports Module**
```typescript
GET /api/reports/sales     → Sales by period/customer/product
GET /api/reports/inventory → Stock status + valuation
GET /api/reports/profitability → Margin by product/customer
GET /api/reports/accounts-receivable → Cuentas por cobrar

// Exports:
- PDF download
- Excel download
- CSV download
```

### 7. **AFIP Module** (Integración Real)
```typescript
POST /api/afip/authorize   → Authorize invoice with AFIP
GET /api/afip/status       → Get authorization status
POST /api/afip/credit-note → Create credit note

// WebService:
- URL: https://servicios1.afip.gov.ar/wsfev1
- Métodos: FEV1_GetToken, FEV1_CreateBill
- Retorna: CAE, Expiry Date, QR Code

// Certificado:
- AFIP digital certificate (.pem + .key)
- Stored in env or DB encrypted
```

### 8. **Catalog Module** (PDF)
```typescript
POST /api/catalog/generate → Create PDF from products
GET /api/catalog/templates → List templates
POST /api/catalog/templates → Create template

// PDF Includes:
- Company logo + data
- Product list with prices
- Professional styling
- QR codes (optional)
```

---

## 🗄️ Base de Datos - TABLAS CRÍTICAS

```sql
-- Ya creadas en schema.ts:
companies
users
sessions
categories
brands
products
product_pricing
price_lists
price_list_items
customers
suppliers
invoices
invoice_items
warehouses
stock
stock_movements
payments
audit_log
```

**Migrations Strategy**:
- Drizzle ORM handle schema management
- Run: `npm run migrate`
- Cada deploy auto-migra

---

## 🎯 ARQUITECTURA APIS REST

### Authentication
```
POST /api/auth/register    → Create user + company
POST /api/auth/login       → Get access + refresh tokens
POST /api/auth/refresh     → Refresh access token
POST /api/auth/logout      → Invalidate session
GET /api/auth/me           → Get current user info
```

### Multi-tenant
```
All endpoints require:
- JWT token with company_id
- Middleware filters by company_id
- No data leakage between companies
```

### Error Handling
```
{
  "error": "Error message",
  "code": "ERROR_CODE",
  "statusCode": 400
}

Codes:
- VALIDATION_ERROR (400)
- NOT_FOUND (404)
- DUPLICATE (409)
- UNAUTHORIZED (401)
- SERVER_ERROR (500)
```

---

## 🎨 Frontend Architecture

### Stack
```
- React 19 + TypeScript
- Vite (bundler)
- Tailwind CSS v4
- Zustand (state management)
- React Query (data fetching)
- Axios (HTTP client)
```

### Layout
```
Sidebar (Navigation)
├── Dashboard
├── Productos
├── Precios
├── Catálogos PDF
├── Clientes
├── Facturas
├── Inventario
├── Reportes
└── Configuración

Header
├── Company selector
├── Search bar
├── Notifications
└── User dropdown

Main Content Area
└── Page content
```

### Critical Pages
```
/login                    → Auth
/dashboard                → KPIs + graphs
/productos                → CRUD list
/productos/new            → Create form
/productos/:id/edit       → Edit form
/precios                  → Price management
/catalogs/new             → PDF builder
/clientes                 → CRUD list
/facturas                 → List + filters
/facturas/new             → Invoice wizard
/reportes                 → Various reports
/configuracion            → Settings
```

---

## 🧪 Testing Strategy

### Backend Tests (Vitest + Supertest)
```typescript
// Test auth
test('POST /auth/login - valid credentials', async () => {
  const res = await request(app)
    .post('/api/auth/login')
    .send({ email: 'test@test.com', password: 'pass123' })
    .expect(200)
  expect(res.body.accessToken).toBeDefined()
})

// Test products CRUD
test('GET /products - returns list', async () => {
  const res = await request(app)
    .get('/api/products')
    .set('Authorization', `Bearer ${token}`)
    .expect(200)
  expect(Array.isArray(res.body)).toBe(true)
})

// Test invoice creation
test('POST /invoices - creates invoice', async () => {
  const res = await request(app)
    .post('/api/invoices')
    .set('Authorization', `Bearer ${token}`)
    .send({ customer_id: '...', items: [...] })
    .expect(201)
  expect(res.body.id).toBeDefined()
})
```

### Frontend Tests (Vitest + React Testing Library)
```typescript
// Test login form
test('Login form submits with credentials', async () => {
  render(<LoginPage />)
  fireEvent.change(screen.getByPlaceholderText('Email'), { target: { value: 'test@test.com' } })
  fireEvent.change(screen.getByPlaceholderText('Password'), { target: { value: 'pass123' } })
  fireEvent.click(screen.getByText('Login'))
  await waitFor(() => expect(mockLogin).toHaveBeenCalled())
})

// Test products list
test('Products list renders with data', async () => {
  render(<ProductsList />)
  await waitFor(() => {
    expect(screen.getByText('Product 1')).toBeInTheDocument()
  })
})
```

---

## 🚨 PRIORIDADES CRÍTICAS

1. **Auth funciona** → Todos los tests pasan
2. **Products CRUD funciona** → Create, read, update, delete
3. **Customers funciona** → Creación y listado
4. **Invoices funciona** → Crear factura y guardar en DB
5. **Frontend Login funciona** → Puede logearse
6. **Frontend Products page** → Puede listar y crear
7. **AFIP integration** → Autorizar factura contra AFIP
8. **PDF generation** → Generar PDF de factura

**NO hacer ahora**: Multi-language, Analytics avanzado, Mobile app, Reporting complex

---

## ✅ VERIFICACIÓN FINAL (End-to-End)

### Backend Health
```bash
curl http://localhost:3000/health
# Esperado: { "status": "ok" }
```

### Auth Flow
```bash
POST /api/auth/register          # Crear usuario
POST /api/auth/login             # Logearse
GET /api/auth/me                 # Ver datos
POST /api/auth/refresh           # Refresh token
```

### Products Flow
```bash
POST /api/products               # Crear producto
GET /api/products                # Listar
GET /api/products/:id            # Ver detalles
PUT /api/products/:id            # Editar
DELETE /api/products/:id         # Eliminar
```

### Invoice Flow
```bash
POST /api/invoices               # Crear factura (draft)
POST /api/invoices/:id/items     # Agregar items
POST /api/invoices/:id/authorize # Autorizar con AFIP
GET /api/invoices/:id/pdf        # Descargar PDF
```

### Frontend Smoke Tests
```
✅ Login page loads
✅ Dashboard shows KPIs
✅ Products page loads + lista productos
✅ Can create new product
✅ Can create invoice
✅ Invoice appears in list
```

---

## 🎓 NOTAS IMPORTANTES

### Ambiente AFIP
- **Homologación** (testing): Sin certificado real
- **Producción**: Require certificado digital de AFIP
- Cambio en `.env` (AFIP_ENV)

### Database
- PostgreSQL 15 Alpine (Docker)
- Drizzle ORM (migrations auto)
- Backup automático en S3 (future)

### Error Handling
- Todas las promesas deben usar try-catch
- Express async errors handler activado
- Errores loguean a console en dev, cloudwatch en prod

### Security
- Contraseñas hasheadas con bcrypt
- JWT tokens con expiración
- CORS restrictivo
- Rate limiting en todos los endpoints
- Validación en todos los inputs

---

## 📞 PRÓXIMOS PASOS (INMEDIATOS)

1. ✅ npm install termina
2. ⏳ Implementar Products service (TODAY)
3. ⏳ Implementar Customers service (TODAY)
4. ⏳ Basic Invoices sin AFIP (TODAY)
5. ⏳ Levantar servidor y probar (TODAY)
6. ⏳ Frontend básico (MAÑANA)
7. ⏳ Integración AFIP (MAÑANA)
8. ⏳ Tests completos (PASADO MAÑANA)
9. ⏳ Verificación E2E (FINAL)

---

**ESTADO**: 🟡 EN CONSTRUCCIÓN ACTIVA
**SIGUIENTES 4 HORAS**: Completar backend core
**SIGUIENTES 8 HORAS**: Frontend funcional
**FINAL**: Testing + AFIP + Pulido

