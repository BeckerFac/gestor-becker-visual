# Gestor BeckerVisual - Instrucciones para Claude Code

## CRITICO: Knowledge Base
Al inicio de CADA sesion, leer las notas del vault de Obsidian para tener contexto completo:
- `/home/facu/BECKER/Knowledge-Base/01-Proyectos/BeckerVisual/` (todas las notas)

Despues de CADA respuesta con conocimiento valioso, actualizar las notas relevantes en el vault.

## Proyecto
Sistema de gestion comercial cloud para PyMEs argentinas. Reemplazo de Cartagos.
- **Codigo**: `/home/facu/BECKER/Gestor BeckerVisual/`
- **Frontend LIVE**: https://frontend-sooty-six-91.vercel.app
- **Test login**: `e2etest@test.com` / `test123`

## Stack
- Frontend: React 19 + TypeScript + Tailwind v4 + Vite
- Backend: Node.js 18+ / Express + TypeScript + Drizzle ORM
- DB: PostgreSQL 15 (multi-tenant schema isolation)
- Auth: JWT + 2FA, AFIP: SOAP WebService
- Deploy: Vercel (frontend), Docker (backend)

## Comandos
```bash
# Backend
cd backend && npm run dev     # localhost:3000
# Frontend
cd frontend && npm run dev    # localhost:5173
# Docker
docker-compose up postgres
docker-compose -f docker-compose.production.yml up -d
```

## Estado: MVP COMPLETO (2026-02-28)
Features completas: Auth RBAC, Productos, Precios, Catalogo PDF, Clientes, Proveedores, Ventas (workflow completo), AFIP facturacion electronica, Inventario multi-warehouse, Compras, Cobranzas, Reportes, Dashboard, TPV, Multi-empresa.

## Testing (OBLIGATORIO)

### Regla: Correr tests DESPUES de cada cambio de codigo
Despues de CUALQUIER modificacion a archivos en `backend/src/` o `frontend/src/`:
```bash
cd "/home/facu/BECKER/Gestor BeckerVisual" && bash scripts/validate.sh
```
Esto corre: 131 backend tests + tsc backend + tsc frontend + vite build.
Si ALGO falla, arreglar ANTES de commitear. NUNCA pushear con tests rotos.

### Regla: Escribir tests para cada feature nueva
Cada servicio nuevo o metodo nuevo DEBE tener tests en `backend/tests/`.
Patron: `backend/tests/{module}.service.test.ts`
Minimo: happy path + edge case + error case + security case.

### Regla: Los tests corren sin base de datos
Todos los tests usan mocks de DB (`backend/tests/helpers/setup.ts`).
Son deterministas, sin network, sin estado externo.

### Test suites existentes (131 tests):
- orders.service.test.ts (22): CRUD, filtros, stock, status transitions
- invoices.service.test.ts (20): fiscal/no_fiscal/interno, AFIP, items
- receipts.service.test.ts (12): transacciones, multi-invoice, rollback
- products.service.test.ts (14): pricing, SKU duplicado, bulk update
- enterprises.service.test.ts (11): campos fiscales, CUIT, contacts
- cheques.service.test.ts (23): tipos, transiciones, vencimientos
- inventory.service.test.ts (17): ajustes, stock from purchase, warehouse
- security.test.ts (12): SQL injection, XSS, overflow, auth

## Preferencias
- Autonomo, no explicar, ejecutar directo
- Espanol argentino, codigo en ingles
- Immutabilidad, archivos pequenos
