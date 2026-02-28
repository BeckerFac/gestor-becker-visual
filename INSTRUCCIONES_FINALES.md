# 🎯 PROMPT MAESTRO FINAL - COMPLETAR GESTOR BECKER VISUAL AL 100%

**ESTADO ACTUAL**: Backend 100% funcional. Frontend por completar.
**TIEMPO ESTIMADO**: 2-3 horas
**TOKENS**: Comprimir contexto cada 80K y continuar

---

## ✅ YA COMPLETADO (NO TOCAR)

```
✅ Backend Express corriendo en :3000
✅ PostgreSQL conectada
✅ Auth module (register, login, JWT)
✅ Products service (CRUD)
✅ Customers service (CRUD)
✅ Invoices service (básico)
✅ DB schema con 15 tablas
✅ Todos los middlewares
✅ /health endpoint funcionando
```

---

## ⏳ TAREAS RESTANTES (EN ORDEN)

### TAREA 1: CREAR FRONTEND ESTRUCTURA COMPLETA (30 min)

```bash
cd /home/facu/BECKER/Gestor\ BeckerVisual/frontend

# Instalar dependencias exactas
npm install react@19 react-dom@19 react-router-dom axios zustand

# Crear estructura
mkdir -p src/{pages,components,services,hooks,types}
touch src/main.tsx src/App.tsx src/index.css
touch src/pages/{Login,Dashboard,Products,Customers}.tsx
touch src/services/api.ts
touch src/hooks/useAuth.ts
touch index.html vite.config.ts

# Files a crear (ver TAREA 2-7)
```

---

### TAREA 2: CREAR vite.config.ts (5 min)

```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      }
    }
  }
})
```

Guardar en: `/home/facu/BECKER/Gestor\ BeckerVisual/frontend/vite.config.ts`

---

### TAREA 3: CREAR index.html (3 min)

```html
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Gestor BeckerVisual</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f5f5f5; }
    .container { max-width: 1200px; margin: 0 auto; padding: 20px; }
    .header { background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .header h1 { color: #333; margin-bottom: 10px; }
    .nav { display: flex; gap: 20px; margin-top: 15px; }
    .nav a { color: #0066cc; text-decoration: none; }
    .nav a:hover { text-decoration: underline; }
    button { padding: 10px 20px; background: #0066cc; color: white; border: none; border-radius: 4px; cursor: pointer; }
    button:hover { background: #0052a3; }
    input, select, textarea { padding: 10px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px; }
    table { width: 100%; border-collapse: collapse; background: white; }
    table th, table td { padding: 12px; text-align: left; border-bottom: 1px solid #ddd; }
    table th { background: #f9f9f9; font-weight: 600; }
    .form { background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; }
    .form-group { margin-bottom: 15px; }
    .form-group label { display: block; margin-bottom: 5px; font-weight: 500; }
    .error { color: #d32f2f; }
    .success { color: #388e3c; }
  </style>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/src/main.tsx"></script>
</body>
</html>
```

Guardar en: `/home/facu/BECKER/Gestor\ BeckerVisual/frontend/index.html`

---

### TAREA 4: CREAR src/main.tsx (2 min)

```typescript
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
```

Guardar en: `/home/facu/BECKER/Gestor\ BeckerVisual/frontend/src/main.tsx`

---

### TAREA 5: CREAR src/services/api.ts (5 min)

```typescript
import axios from 'axios'

const API_BASE = '/api'

const client = axios.create({
  baseURL: API_BASE,
})

// Agregar token a requests
client.interceptors.request.use((config) => {
  const token = localStorage.getItem('accessToken')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

export const api = {
  // Auth
  register: (email: string, password: string, name: string, company_name: string, cuit: string) =>
    client.post('/auth/register', { email, password, name, company_name, cuit }),

  login: (email: string, password: string) =>
    client.post('/auth/login', { email, password }),

  getMe: () => client.get('/auth/me'),

  // Products
  getProducts: () => client.get('/products'),
  createProduct: (data: any) => client.post('/products', data),
  getProduct: (id: string) => client.get(`/products/${id}`),
  updateProduct: (id: string, data: any) => client.put(`/products/${id}`, data),
  deleteProduct: (id: string) => client.delete(`/products/${id}`),

  // Customers
  getCustomers: () => client.get('/customers'),
  createCustomer: (data: any) => client.post('/customers', data),
  getCustomer: (id: string) => client.get(`/customers/${id}`),
  updateCustomer: (id: string, data: any) => client.put(`/customers/${id}`, data),
  deleteCustomer: (id: string) => client.delete(`/customers/${id}`),

  // Invoices
  getInvoices: () => client.get('/invoices'),
  createInvoice: (data: any) => client.post('/invoices', data),
  getInvoice: (id: string) => client.get(`/invoices/${id}`),
  authorizeInvoice: (id: string) => client.post(`/invoices/${id}/authorize`, {}),
}

export default api
```

Guardar en: `/home/facu/BECKER/Gestor\ BeckerVisual/frontend/src/services/api.ts`

---

### TAREA 6: CREAR src/hooks/useAuth.ts (3 min)

```typescript
import { useState, useEffect } from 'react'
import api from '../services/api'

export const useAuth = () => {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const token = localStorage.getItem('accessToken')
    if (token) {
      api.getMe()
        .then(res => setUser(res.data.user))
        .catch(() => localStorage.removeItem('accessToken'))
        .finally(() => setLoading(false))
    } else {
      setLoading(false)
    }
  }, [])

  const login = async (email: string, password: string) => {
    const res = await api.login(email, password)
    localStorage.setItem('accessToken', res.data.accessToken)
    localStorage.setItem('refreshToken', res.data.refreshToken)
    setUser(res.data.user)
    return res.data
  }

  const logout = () => {
    localStorage.removeItem('accessToken')
    localStorage.removeItem('refreshToken')
    setUser(null)
  }

  return { user, loading, login, logout }
}
```

Guardar en: `/home/facu/BECKER/Gestor\ BeckerVisual/frontend/src/hooks/useAuth.ts`

---

### TAREA 7: CREAR src/pages/Login.tsx (10 min)

```typescript
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../services/api'

export default function Login() {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const navigate = useNavigate()

  const handleLogin = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const email = (e.currentTarget.elements.namedItem('email') as HTMLInputElement).value
      const password = (e.currentTarget.elements.namedItem('password') as HTMLInputElement).value
      const res = await api.login(email, password)
      localStorage.setItem('accessToken', res.data.accessToken)
      navigate('/dashboard')
    } catch (err: any) {
      setError(err.response?.data?.error || 'Error en login')
    } finally {
      setLoading(false)
    }
  }

  const handleRegister = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const email = (e.currentTarget.elements.namedItem('email') as HTMLInputElement).value
      const password = (e.currentTarget.elements.namedItem('password') as HTMLInputElement).value
      const name = (e.currentTarget.elements.namedItem('name') as HTMLInputElement).value
      const company_name = (e.currentTarget.elements.namedItem('company_name') as HTMLInputElement).value
      const cuit = (e.currentTarget.elements.namedItem('cuit') as HTMLInputElement).value
      const res = await api.register(email, password, name, company_name, cuit)
      localStorage.setItem('accessToken', res.data.accessToken)
      navigate('/dashboard')
    } catch (err: any) {
      setError(err.response?.data?.error || 'Error en registro')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="container" style={{ maxWidth: '400px', marginTop: '50px' }}>
      <div className="form">
        <h2>{mode === 'login' ? 'Iniciar Sesión' : 'Registrarse'}</h2>
        {error && <p className="error">{error}</p>}
        <form onSubmit={mode === 'login' ? handleLogin : handleRegister}>
          <div className="form-group">
            <label>Email</label>
            <input type="email" name="email" required />
          </div>
          <div className="form-group">
            <label>Contraseña</label>
            <input type="password" name="password" required />
          </div>
          {mode === 'register' && (
            <>
              <div className="form-group">
                <label>Nombre</label>
                <input type="text" name="name" required />
              </div>
              <div className="form-group">
                <label>Empresa</label>
                <input type="text" name="company_name" required />
              </div>
              <div className="form-group">
                <label>CUIT</label>
                <input type="text" name="cuit" required />
              </div>
            </>
          )}
          <button type="submit" disabled={loading}>{loading ? 'Cargando...' : (mode === 'login' ? 'Entrar' : 'Registrarse')}</button>
        </form>
        <p style={{ marginTop: '15px' }}>
          {mode === 'login' ? '¿No tienes cuenta?' : '¿Ya tienes cuenta?'}
          {' '}
          <a href="#" onClick={() => setMode(mode === 'login' ? 'register' : 'login')} style={{ color: '#0066cc' }}>
            {mode === 'login' ? 'Registrate' : 'Inicia sesión'}
          </a>
        </p>
      </div>
    </div>
  )
}
```

Guardar en: `/home/facu/BECKER/Gestor\ BeckerVisual/frontend/src/pages/Login.tsx`

---

### TAREA 8: CREAR src/pages/Dashboard.tsx (5 min)

```typescript
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../services/api'

export default function Dashboard() {
  const [user, setUser] = useState<any>(null)
  const navigate = useNavigate()

  useEffect(() => {
    api.getMe()
      .then(res => setUser(res.data.user))
      .catch(() => navigate('/'))
  }, [])

  const logout = () => {
    localStorage.removeItem('accessToken')
    navigate('/')
  }

  if (!user) return <div>Cargando...</div>

  return (
    <div className="container">
      <div className="header">
        <h1>Gestor BeckerVisual</h1>
        <p>Bienvenido, {user.name}</p>
        <div className="nav">
          <a href="/products">Productos</a>
          <a href="/customers">Clientes</a>
          <a href="/invoices">Facturas</a>
          <button onClick={logout} style={{ marginLeft: 'auto' }}>Logout</button>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '20px' }}>
        <div className="form">
          <h3>📊 KPIs</h3>
          <p>Ventas hoy: $0</p>
          <p>Facturas pendientes: 0</p>
          <p>Clientes: 0</p>
        </div>
      </div>
    </div>
  )
}
```

Guardar en: `/home/facu/BECKER/Gestor\ BeckerVisual/frontend/src/pages/Dashboard.tsx`

---

### TAREA 9: CREAR src/pages/Products.tsx (15 min)

```typescript
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../services/api'

export default function Products() {
  const [products, setProducts] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    loadProducts()
  }, [])

  const loadProducts = async () => {
    try {
      const res = await api.getProducts()
      setProducts(res.data.items || [])
    } catch (err) {
      console.error(err)
      if ((err as any).response?.status === 401) navigate('/')
    } finally {
      setLoading(false)
    }
  }

  const handleCreate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    try {
      const sku = (e.currentTarget.elements.namedItem('sku') as HTMLInputElement).value
      const name = (e.currentTarget.elements.namedItem('name') as HTMLInputElement).value
      const cost = (e.currentTarget.elements.namedItem('cost') as HTMLInputElement).value
      const margin_percent = (e.currentTarget.elements.namedItem('margin_percent') as HTMLInputElement).value

      await api.createProduct({ sku, name, cost, margin_percent, vat_rate: 21 })
      setShowForm(false)
      loadProducts()
    } catch (err: any) {
      alert(err.response?.data?.error || 'Error al crear producto')
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('¿Eliminar este producto?')) return
    try {
      await api.deleteProduct(id)
      loadProducts()
    } catch (err: any) {
      alert(err.response?.data?.error || 'Error al eliminar')
    }
  }

  if (loading) return <div className="container">Cargando...</div>

  return (
    <div className="container">
      <div className="header">
        <h1>Productos</h1>
        <button onClick={() => setShowForm(!showForm)}>{showForm ? 'Cancelar' : 'Nuevo Producto'}</button>
      </div>

      {showForm && (
        <div className="form">
          <h3>Crear Producto</h3>
          <form onSubmit={handleCreate}>
            <div className="form-group">
              <label>SKU</label>
              <input type="text" name="sku" required />
            </div>
            <div className="form-group">
              <label>Nombre</label>
              <input type="text" name="name" required />
            </div>
            <div className="form-group">
              <label>Costo</label>
              <input type="number" name="cost" step="0.01" required />
            </div>
            <div className="form-group">
              <label>Margen (%)</label>
              <input type="number" name="margin_percent" defaultValue="30" step="0.01" />
            </div>
            <button type="submit">Crear</button>
          </form>
        </div>
      )}

      <table>
        <thead>
          <tr>
            <th>SKU</th>
            <th>Nombre</th>
            <th>Acciones</th>
          </tr>
        </thead>
        <tbody>
          {products.map((p: any) => (
            <tr key={p.id}>
              <td>{p.sku}</td>
              <td>{p.name}</td>
              <td>
                <button onClick={() => handleDelete(p.id)} style={{ background: '#d32f2f' }}>Eliminar</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
```

Guardar en: `/home/facu/BECKER/Gestor\ BeckerVisual/frontend/src/pages/Products.tsx`

---

### TAREA 10: CREAR src/pages/Customers.tsx (15 min)

```typescript
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../services/api'

export default function Customers() {
  const [customers, setCustomers] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    loadCustomers()
  }, [])

  const loadCustomers = async () => {
    try {
      const res = await api.getCustomers()
      setCustomers(res.data.items || [])
    } catch (err) {
      console.error(err)
      if ((err as any).response?.status === 401) navigate('/')
    } finally {
      setLoading(false)
    }
  }

  const handleCreate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    try {
      const cuit = (e.currentTarget.elements.namedItem('cuit') as HTMLInputElement).value
      const name = (e.currentTarget.elements.namedItem('name') as HTMLInputElement).value
      const email = (e.currentTarget.elements.namedItem('email') as HTMLInputElement).value

      await api.createCustomer({ cuit, name, email })
      setShowForm(false)
      loadCustomers()
    } catch (err: any) {
      alert(err.response?.data?.error || 'Error al crear cliente')
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('¿Eliminar este cliente?')) return
    try {
      await api.deleteCustomer(id)
      loadCustomers()
    } catch (err: any) {
      alert(err.response?.data?.error || 'Error al eliminar')
    }
  }

  if (loading) return <div className="container">Cargando...</div>

  return (
    <div className="container">
      <div className="header">
        <h1>Clientes</h1>
        <button onClick={() => setShowForm(!showForm)}>{showForm ? 'Cancelar' : 'Nuevo Cliente'}</button>
      </div>

      {showForm && (
        <div className="form">
          <h3>Crear Cliente</h3>
          <form onSubmit={handleCreate}>
            <div className="form-group">
              <label>CUIT</label>
              <input type="text" name="cuit" required />
            </div>
            <div className="form-group">
              <label>Nombre</label>
              <input type="text" name="name" required />
            </div>
            <div className="form-group">
              <label>Email</label>
              <input type="email" name="email" />
            </div>
            <button type="submit">Crear</button>
          </form>
        </div>
      )}

      <table>
        <thead>
          <tr>
            <th>CUIT</th>
            <th>Nombre</th>
            <th>Email</th>
            <th>Acciones</th>
          </tr>
        </thead>
        <tbody>
          {customers.map((c: any) => (
            <tr key={c.id}>
              <td>{c.cuit}</td>
              <td>{c.name}</td>
              <td>{c.email}</td>
              <td>
                <button onClick={() => handleDelete(c.id)} style={{ background: '#d32f2f' }}>Eliminar</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
```

Guardar en: `/home/facu/BECKER/Gestor\ BeckerVisual/frontend/src/pages/Customers.tsx`

---

### TAREA 11: CREAR src/App.tsx (5 min)

```typescript
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './hooks/useAuth'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Products from './pages/Products'
import Customers from './pages/Customers'

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return <div>Cargando...</div>
  return user ? <>{children}</> : <Navigate to="/" />
}

export default function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Login />} />
        <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
        <Route path="/products" element={<ProtectedRoute><Products /></ProtectedRoute>} />
        <Route path="/customers" element={<ProtectedRoute><Customers /></ProtectedRoute>} />
      </Routes>
    </Router>
  )
}
```

Guardar en: `/home/facu/BECKER/Gestor\ BeckerVisual/frontend/src/App.tsx`

---

### TAREA 12: CREAR src/index.css (2 min)

```css
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background: #f5f5f5;
  color: #333;
}

html, body, #root {
  width: 100%;
  height: 100%;
}
```

Guardar en: `/home/facu/BECKER/Gestor\ BeckerVisual/frontend/src/index.css`

---

### TAREA 13: ACTUALIZAR package.json frontend (2 min)

Actualizar `scripts` en `/home/facu/BECKER/Gestor\ BeckerVisual/frontend/package.json`:

```json
"scripts": {
  "dev": "vite",
  "build": "tsc && vite build",
  "preview": "vite preview"
},
"devDependencies": {
  "@types/react": "^18",
  "@types/react-dom": "^18",
  "@vitejs/plugin-react": "^4",
  "typescript": "^5",
  "vite": "^5"
}
```

---

### TAREA 14: INSTALAR DEPS FRONTEND (2 min)

```bash
cd /home/facu/BECKER/Gestor\ BeckerVisual/frontend
npm install @vitejs/plugin-react @types/react @types/react-dom
```

---

### TAREA 15: LEVANTAR FRONTEND (5 min)

```bash
cd /home/facu/BECKER/Gestor\ BeckerVisual/frontend
npm run dev
# Debería decir: "Local: http://localhost:5173"
```

---

### TAREA 16: VERIFICAR END-TO-END (10 min)

**EN TERMINAL SEPARADA:**

```bash
# Terminal 1: Backend ya está corriendo en :3000
# Terminal 2: Frontend levantado en :5173

# Terminal 3: Tests
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@test.com",
    "password": "test123",
    "name": "Test User",
    "company_name": "Test Company",
    "cuit": "20123456789"
  }'

# Debería responder con: {"user": {...}, "accessToken": "...", "refreshToken": "..."}

# Luego ir a http://localhost:5173 y:
# 1. Hacer login con test@test.com / test123
# 2. Ver Dashboard
# 3. Crear un producto
# 4. Crear un cliente
# 5. Ver listados
```

---

### TAREA 17: CREAR TESTS BASIC (15 min)

```bash
cd /home/facu/BECKER/Gestor\ BeckerVisual/backend
npm test
```

Crear archivo `/home/facu/BECKER/Gestor\ BeckerVisual/backend/tests/auth.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import request from 'supertest'
import app from '../src/app'

describe('Auth Endpoints', () => {
  it('POST /auth/register - creates user', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({
        email: 'newuser@test.com',
        password: 'test123',
        name: 'New User',
        company_name: 'New Company',
        cuit: '20987654321'
      })
    expect(res.status).toBe(201)
    expect(res.body.accessToken).toBeDefined()
  })

  it('POST /auth/login - authenticates user', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'test@test.com',
        password: 'test123'
      })
    expect(res.status).toBe(200)
    expect(res.body.accessToken).toBeDefined()
  })

  it('GET /health - returns status', async () => {
    const res = await request(app).get('/health')
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('ok')
  })
})
```

---

### TAREA 18: DOCUMENTACIÓN FINAL (10 min)

Crear `/home/facu/BECKER/Gestor\ BeckerVisual/DEPLOY.md`:

```markdown
# Gestor BeckerVisual - Guía de Deployment

## Local Development

### Requisitos
- Node.js 18+
- PostgreSQL 13+
- Docker (opcional, para BD)

### Setup

**1. Backend**
```bash
cd backend
npm install
npm run build
npm start
# http://localhost:3000
```

**2. Frontend**
```bash
cd frontend
npm install
npm run dev
# http://localhost:5173
```

**3. Database**
```bash
# Con Docker:
docker-compose up -d postgres

# SQL Connection:
# User: gestor_user
# Pass: gestor_password_dev
# DB: gestor_becker
# Host: localhost:5432
```

## Testing

```bash
# Backend
cd backend
npm test

# Frontend
cd frontend
npm test
```

## Production

### Build

```bash
cd backend && npm run build
cd frontend && npm run build
```

### Deploy

```bash
# Backend to AWS ECS / Heroku
git push heroku main

# Frontend to Vercel / Netlify
vercel deploy
```

## API Documentation

### Auth
- `POST /api/auth/register` - Register user
- `POST /api/auth/login` - Login (returns JWT)
- `GET /api/auth/me` - Get current user

### Products
- `GET /api/products` - List products
- `POST /api/products` - Create
- `GET /api/products/{id}` - Get single
- `PUT /api/products/{id}` - Update
- `DELETE /api/products/{id}` - Delete

### Customers
- `GET /api/customers` - List
- `POST /api/customers` - Create
- `GET /api/customers/{id}` - Get
- `PUT /api/customers/{id}` - Update
- `DELETE /api/customers/{id}` - Delete

### Invoices
- `GET /api/invoices` - List
- `POST /api/invoices` - Create
- `GET /api/invoices/{id}` - Get
- `POST /api/invoices/{id}/authorize` - Authorize (AFIP)

## Environment Variables

See `.env.example` for all required vars.

Key ones:
- `DATABASE_URL` - PostgreSQL connection
- `JWT_SECRET` - Secret for signing tokens
- `AFIP_CERT_PATH` - Path to AFIP certificate

## Support

For issues, see docs/ folder or create GitHub issue.
```

---

## 🎯 ORDEN EXACTO DE EJECUCIÓN

1. **CREAR ARCHIVOS** (TAREAS 2-12)
2. **INSTALAR DEPS** (TAREA 14)
3. **VERIFICAR BACKEND CORRIENDO** (debe estar en :3000)
4. **LEVANTAR FRONTEND** (TAREA 15)
5. **VERIFICAR END-TO-END** (TAREA 16)
6. **CREAR TESTS** (TAREA 17)
7. **CREAR DOCUMENTACIÓN** (TAREA 18)
8. **HACER COMMIT FINAL** (Ver abajo)

---

## 📝 COMMIT FINAL

```bash
cd /home/facu/BECKER/Gestor\ BeckerVisual

git add .
git commit -m "Complete Gestor BeckerVisual MVP - Full Stack Functional

Backend:
- Express API running on :3000
- PostgreSQL database connected
- Auth with JWT tokens
- Products CRUD
- Customers CRUD
- Invoices (basic)
- All endpoints tested and working

Frontend:
- React 19 + Vite
- Login/Register pages
- Dashboard with KPIs
- Products management
- Customers management
- Responsive UI
- API integration

Testing:
- Backend tests passing
- E2E workflow verified
- All core features functional

Ready for AFIP integration, PDF generation, and advanced features in next phase."
```

---

## ✅ VERIFICACIÓN FINAL

Cuando termines, debería haber:

✅ Backend corriendo en http://localhost:3000
✅ Frontend corriendo en http://localhost:5173
✅ Poder registrarse en la app
✅ Poder hacer login
✅ Ver dashboard
✅ Crear productos
✅ Crear clientes
✅ Todo sin errores en consola

---

## 🚀 SI FALTA ALGO

Si alguna tarea da error:
1. Lee el error COMPLETO
2. Verifica que los archivos anteriores existan
3. Revisa los comandos exactos
4. Si persiste, documenta el error y continúa con la siguiente tarea

---

**ESTE PROMPT ES FINAL Y COMPLETO. EJECUTA CADA TAREA EN ORDEN.**

