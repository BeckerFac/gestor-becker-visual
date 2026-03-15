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

## Preferencias
- Autonomo, no explicar, ejecutar directo
- Espanol argentino, codigo en ingles
- Immutabilidad, archivos pequenos
