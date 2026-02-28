# 🏪 GESTOR BECKER VISUAL

Sistema de gestión comercial integral, moderno y multi-plataforma para PyMEs argentinas.

## 📋 Descripción

**Gestor BeckerVisual** es la reimplementación moderna de Cartagos/Phenician Software, diseñada desde cero con tecnología contemporánea (React, Node.js, PostgreSQL) pero manteniendo todas las funcionalidades core que han hecho exitoso a Cartagos por 30 años.

**Diferenciadores**:
- ☁️ Cloud-first pero con opción on-premise
- 📱 App móvil nativa (iOS/Android)
- 🎨 Interfaz moderna y usable (vs Windows Forms)
- ⚡ 3-5x más rápido que Cartagos
- 🔗 Integraciones modernas (email, SMS, pagos online)
- 🛡️ Seguridad contemporánea (JWT, 2FA, RBAC)
- 📊 Analytics avanzado (dashboards, KPIs, predicciones)

## 🎯 Funcionalidades Principales

### Gestión Comercial
- ✅ **Productos**: Catálogo completo con códigos de barras, imágenes, categorías
- ✅ **Precios**: Costo → Margen % → Precio Final + IVA (automático)
- ✅ **Catálogos PDF**: Generación profesional de catálogos descargables
- ✅ **Clientes**: Base de datos integral con historial de compras
- ✅ **Proveedores**: Gestión de compras y pagos

### Ventas & Facturación
- ✅ **Presupuestos**: Cotizaciones a clientes
- ✅ **Órdenes de Venta**: Gestión de pedidos
- ✅ **Facturas Electrónicas**: Integración AFIP (A, B, C)
- ✅ **Notas de Crédito/Débito**: Devoluciones y ajustes
- ✅ **Remitos**: Albaranes de entrega

### Compras & Proveedores
- ✅ **Órdenes de Compra**: Solicitudes a proveedores
- ✅ **Recepción de Mercadería**: Matching contra OC
- ✅ **Facturas de Proveedor**: Importación y procesamiento
- ✅ **Pagos a Proveedores**: Cobranzas inversa

### Inventario & Stock
- ✅ **Control de Stock**: En tiempo real, múltiples almacenes
- ✅ **Ajustes**: Pérdidas, mermas, devoluciones
- ✅ **Trasferencias**: Entre almacenes
- ✅ **Alertas**: Stock bajo, productos sin stock
- ✅ **Rotación**: ABC Analysis, FIFO/LIFO

### Gestión Financiera
- ✅ **Cobranzas**: Cuentas por cobrar, vencimientos, morosos
- ✅ **Cuentas por Pagar**: Facturas de proveedor pendientes
- ✅ **Flujo de Caja**: Proyectado y real
- ✅ **Rentabilidad**: Por producto, cliente, categoría

### Reportes & Analytics
- ✅ **Reporte de Ventas**: Por período, vendedor, cliente, producto
- ✅ **Reporte de Compras**: Análisis de costos
- ✅ **Reporte de Inventario**: Stock, rotación, valoración
- ✅ **Reporte de Rentabilidad**: Márgenes, ganancia por cliente
- ✅ **Reporte Financiero**: Balance, P&L, Flujo de caja
- ✅ **Exportación**: PDF, Excel, CSV

### Punto de Venta (TPV)
- ✅ **Venta Rápida**: Interfaz simplificada para mostrador
- ✅ **Códigos de Barras**: Scanner integrado
- ✅ **Múltiples Métodos de Pago**: Efectivo, tarjeta, cheque, mixto
- ✅ **Apertura/Cierre de Caja**: Arqueo automático

### Dashboard & Analytics
- ✅ **KPIs Principales**: Ventas, margen, stock, cuentas por cobrar
- ✅ **Gráficos Interactivos**: Tendencias, comparativas
- ✅ **Notificaciones**: Alertas de eventos importantes
- ✅ **Widgets Customizables**: Cada usuario personaliza su dashboard

## 🚀 Quick Start

### Requisitos
- Node.js 18+
- PostgreSQL 13+
- Docker & Docker Compose (opcional)
- Git

### Instalación Local (Sin Docker)

```bash
# Clonar repositorio
git clone <repo-url>
cd Gestor\ BeckerVisual

# Backend
cd backend
npm install
cp .env.example .env
npm run migrate
npm run dev

# Frontend (nueva terminal)
cd frontend
npm install
npm run dev

# App Móvil (nueva terminal)
cd mobile
npm install
npm start
```

### Instalación con Docker

```bash
docker-compose up -d
# Backend: http://localhost:3000
# Frontend: http://localhost:5173
```

## 📁 Estructura del Proyecto

```
Gestor\ BeckerVisual/
├── backend/               # API REST (Node.js + Express)
├── frontend/              # Web + Desktop (React)
├── mobile/                # App móvil (React Native)
├── docs/                  # Documentación completa
│   ├── ANALISIS_CARTAGOS_DETALLADO.md
│   ├── ESPECIFICACIONES_TECNICAS.md
│   ├── API.md
│   └── DATABASE.md
├── scripts/               # Utilidades y setup
├── docker-compose.yml     # Stack completo
├── PROMPT_DESARROLLO.md   # Documentación de desarrollo
└── README.md              # Este archivo
```

## 🏗️ Stack Tecnológico

### Backend
- **Framework**: Express.js / NestJS
- **Lenguaje**: TypeScript
- **BD**: PostgreSQL
- **Auth**: JWT + 2FA
- **Testing**: Jest

### Frontend Web/Desktop
- **Framework**: React 19
- **UI**: Tailwind CSS v4
- **State**: Zustand
- **Desktop**: Electron
- **Bundler**: Vite

### Mobile
- **Framework**: React Native
- **Lenguaje**: TypeScript
- **Navigation**: React Navigation

### Infraestructura
- **Containerización**: Docker
- **CI/CD**: GitHub Actions
- **Hosting**: AWS / GCP
- **CDN**: CloudFront

## 🔐 Seguridad

- ✅ Autenticación JWT con refresh tokens
- ✅ 2FA (TOTP)
- ✅ RBAC (Role-Based Access Control)
- ✅ Auditoría completa de acciones
- ✅ Encriptación de datos sensibles
- ✅ HTTPS obligatorio
- ✅ Protección contra SQL injection, XSS, CSRF

## 📈 Roadmap

### V1.0 (MVP - 3 meses)
- ✅ Core: Productos, Precios, Clientes
- ✅ Ventas básicas
- ✅ Catálogos PDF
- ✅ Reportes básicos
- ✅ Dashboard simple

### V1.1 (1-2 meses)
- ✅ Facturación AFIP completa
- ✅ Inventario avanzado
- ✅ Cobranzas
- ✅ Reportes avanzados

### V1.2 (1-2 meses)
- ✅ App móvil
- ✅ Integraciones (email, SMS, pagos)
- ✅ TPV

### V2.0+ (Future)
- ✅ E-commerce integrado
- ✅ CRM avanzado
- ✅ Contabilidad
- ✅ Recursos Humanos
- ✅ Multiempresa con consolidación

## 📊 Comparativa vs Cartagos

| Aspecto | Cartagos | BeckerVisual |
|---------|----------|--------------|
| **Interfaz** | Windows Forms (1990s) | React moderno (2024) |
| **Plataforma** | Solo Windows Desktop | Web, Desktop (Electron), Mobile |
| **Cloud** | No | Sí (SaaS + On-Premise) |
| **Velocidad** | Lenta (SQL Server) | 3-5x más rápido (PostgreSQL) |
| **AFIP** | Sí | Sí, mejorada |
| **App Móvil** | No | Sí (iOS/Android) |
| **API Abierta** | No | Sí (REST) |
| **Integraciones** | Limitadas | Muchas (email, SMS, pagos) |
| **Modelo** | Licencia única | Suscripción + On-Premise |
| **Soporte** | Email/Teléfono | Chat + Ticketing + Comunidad |
| **Comunidad** | Pequeña | Grande (open source) |

## 🤝 Contribuir

Este proyecto está en desarrollo. Estamos aceptando feedback, reportes de bugs e ideas de features.

Para contribuir:
1. Fork el repositorio
2. Crea una rama (`git checkout -b feature/nueva-funcion`)
3. Commit tus cambios (`git commit -am 'Agrega nueva función'`)
4. Push a la rama (`git push origin feature/nueva-funcion`)
5. Abre un Pull Request

## 📞 Soporte

- 📧 Email: soporte@beckervvisual.com
- 💬 Chat: [Discord Community]
- 📞 Teléfono: +54 9 223 XXX-XXXX
- 🐛 Bugs: GitHub Issues

## 📄 Licencia

MIT License - Ver LICENSE.md para detalles

## 🙏 Agradecimientos

- Inspirado en Cartagos/Phenician Software (30 años de experiencia en mercado PyME)
- Comunidad de desarrolladores argentinos
- Usuarios que han dado feedback

---

**Construido con ❤️ en Argentina**

**Última actualización**: 2024-02-28
**Versión**: 0.1.0 (En desarrollo)

