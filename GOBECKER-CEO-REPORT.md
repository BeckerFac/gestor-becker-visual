# GoBecker - CEO Strategic Report
## Estado Completo de la Plataforma | 2026-04-06

**Dominio**: gobecker.com.ar / gobecker.online / gobecker.store
**Stack**: React 19 + Express + PostgreSQL (Neon) + Render
**Modelo**: SaaS Multi-tenant B2B para PyMEs argentinas

---

## Executive Summary

GoBecker tiene una base tecnica solida (seguridad, multi-tenancy, AI, facturacion AFIP) pero le faltan las capas necesarias para un lanzamiento comercial profesional. El producto esta al 65% de readiness para produccion.

**Score Global: 65/100**

---

## Scorecard por Area

| # | Area | Score | Estado | Riesgo |
|---|------|-------|--------|--------|
| 1 | Core Product (ERP) | 85/100 | Funcional | Bajo |
| 2 | Seguridad Tecnica | 78/100 | Fuerte con gaps | Medio |
| 3 | Multi-tenancy / Datos | 95/100 | Excelente (RLS) | Bajo |
| 4 | Pagos / Billing | 40/100 | Parcial (solo MP) | Alto |
| 5 | Landing Page / Marketing | 5/100 | No existe | Critico |
| 6 | SEO / Blog | 0/100 | Nada | Critico |
| 7 | Analytics / Tracking | 5/100 | Solo audit log | Alto |
| 8 | Email / Comunicaciones | 60/100 | Transaccional OK | Medio |
| 9 | AI / Agente Inteligente | 80/100 | Muy avanzado | Bajo |
| 10 | Portal Clientes | 70/100 | Funcional | Bajo |
| 11 | Monitoring / Observabilidad | 45/100 | Logging OK, sin alertas | Alto |
| 12 | Dominio / DNS / SSL | 10/100 | Dominio comprado, sin config | Critico |
| 13 | Onboarding / UX | 65/100 | Basico funcional | Medio |
| 14 | Documentacion / Help Center | 10/100 | Minimo | Alto |
| 15 | Branding | 95/100 | Rebranding completo | Bajo |

---

## 1. CORE PRODUCT (ERP) - 85/100

### Lo que funciona
- Pedidos con descuento %, items con IVA individual, listas de precios
- Facturacion electronica AFIP (homologacion, pendiente produccion)
- Recibos multi-metodo con retenciones sufridas
- Ordenes de pago a proveedores
- Cuenta corriente cronologica con 5 conceptos
- Cheques (cartera, endosados, depositados)
- Cotizaciones con conversion a pedido
- Productos con costo/margen/precio neto, BOM, stock
- Remitos de entrega
- CRM pipeline auto-gestionado (7 etapas, auto-sync)
- Reportes: ventas, rentabilidad, clientes, cobranzas, inventario, libro IVA
- Conciliacion bancaria

### Gaps
- AFIP en homologacion (necesita certificado de produccion para operar)
- Facturacion de compra basica
- Sin integraciones con otros sistemas (Contabilium, Xubio, etc)

### Recomendacion
Obtener certificado AFIP de produccion y hacer smoke test completo antes de primer cliente.

---

## 2. SEGURIDAD TECNICA - 78/100

### Lo que esta bien (fuerte)
- JWT HS256 con token refresh, lockout por brute force
- Rate limiting global + auth-specific + auto-block IP
- Helmet con CSP, HSTS, X-Frame-Options, Permissions-Policy
- Input sanitization (HTML escape, size guards)
- Password: bcrypt 12 rounds, validacion de complejidad
- RLS (Row Level Security) en PostgreSQL - aislamiento por tenant
- Audit logging de todas las operaciones CRUD
- Encriptacion AES-256-GCM disponible para campos sensibles

### Gaps criticos
| Gap | Riesgo | Accion |
|-----|--------|--------|
| Sentry no instalado | Error tracking ciego en produccion | Instalar @sentry/node |
| 2FA no integrado | Cuentas con facturacion vulnerables | Wiring two-factor.ts al auth flow |
| ENCRYPTION_KEY opcional | Datos sensibles en plaintext si no se configura | Hacerlo obligatorio en produccion |
| Rate limits in-memory | Se resetean al reiniciar, no escalan | Migrar a Redis |

---

## 3. MULTI-TENANCY / DATOS - 95/100

### Excelente
- **Doble capa de aislamiento**: RLS en PostgreSQL + filtro por company_id en cada query
- Un bug que olvide WHERE company_id no puede leakear datos (RLS lo bloquea)
- Neon PostgreSQL con PITR 6h (free) o 7d (paid)
- Data export completo (Ley 25.326 compliance)
- Delete account con grace period 30 dias

### Gap unico
- Backups no documentados formalmente (Neon los hace, pero no hay runbook)

---

## 4. PAGOS / BILLING - 40/100

### Lo que existe
- MercadoPago integration (subscripciones recurrentes)
- 3 planes: Trial (14d), Estandar ($28.999/mes), Premium ($73.999/mes)
- Webhook handling para status updates
- Feature gates por plan (parcial)

### Lo que falta
| Gap | Impacto | Prioridad |
|-----|---------|-----------|
| Sin Stripe | No acepta USD/tarjetas internacionales | Alta |
| Sin dunning | Pagos fallidos se pierden sin reintentos | Alta |
| Sin facturacion propia | GoBecker no puede emitir sus propias facturas como SaaS | Critica |
| Feature gates incompletos | Usuarios free pueden acceder a features premium | Alta |
| Sin grace period emails | Usuario no sabe que su pago fallo | Alta |
| Precios desactualizados | $28.999 puede no reflejar el mercado actual | Media |

---

## 5. LANDING PAGE / MARKETING - 5/100

### Estado actual: NO EXISTE
- No hay landing page separada
- No hay pagina de precios publica
- No hay formulario de registro visible desde marketing
- El dominio gobecker.com.ar **no esta configurado** (solo comprado)

### Que se necesita
1. Landing page en gobecker.com.ar (Astro/Next.js, separate repo)
   - Hero con propuesta de valor
   - Features showcase con screenshots
   - Pricing con planes y CTA
   - Testimonios (cuando haya clientes)
   - FAQ
   - Footer con legal links
2. DNS configurado apuntando a Vercel/Netlify
3. SSL automatico
4. La app en app.gobecker.com.ar (subdominio)

---

## 6. SEO / BLOG - 0/100

### Estado actual: NADA
- No hay blog
- No hay contenido indexable
- No hay sitemap
- No hay schema markup
- Keywords objetivo no definidos

### Que se necesita
1. Blog integrado en la landing (Astro content collections)
2. Articulos target:
   - "como facturar electronicamente en argentina"
   - "sistema de gestion para pymes gratis"
   - "alternativa a aconpy/colppy/xubio"
   - "como conectar afip a mi sistema"
3. Sitemap + robots.txt
4. OpenGraph images por pagina
5. Google Search Console + Bing Webmaster

---

## 7. ANALYTICS / TRACKING - 5/100

### Estado actual: solo audit log interno
- Existe activity_log en DB (todas las operaciones CRUD)
- No hay analytics de producto (PostHog, Mixpanel)
- No hay funnel tracking (signup -> activation -> retention)
- No hay session replay
- No hay tracking de landing page

### Que se necesita
1. PostHog (gratis, self-hosted friendly, GDPR)
   - En landing: pageviews, signup conversion
   - En app: feature adoption, retention, churn signals
2. Eventos criticos a trackear:
   - `signup_completed`
   - `first_enterprise_created`
   - `first_order_created`
   - `first_invoice_authorized`
   - `afip_connected`
   - `plan_upgraded`
   - `plan_cancelled`
3. Metricas North Star:
   - Activation: usuario emite primera factura en <7 dias
   - Retention: usuario vuelve a facturar en semana 2
   - Conversion: trial -> pago

---

## 8. EMAIL / COMUNICACIONES - 60/100

### Lo que funciona
- Resend como provider primario + SMTP fallback
- Templates HTML para: welcome, verification, password-reset, invitation, invoice
- Emails de factura con PDF adjunto

### Lo que falta
| Gap | Impacto |
|-----|---------|
| SPF/DKIM/DMARC no verificados | Emails pueden ir a spam |
| Sin email marketing | No se puede enviar newsletter/updates |
| Sin rate limit por email | Abuso posible en reset/invite |
| Sin trial expiry emails | Usuario no sabe que su trial vence |
| Sin welcome sequence | Perdida de activacion |

### Secuencia ideal post-signup
1. Dia 0: Bienvenida + "conecta AFIP en 3 pasos"
2. Dia 2: "Cargaste tu primer cliente?"
3. Dia 5: "Tu primera factura en 30 segundos"
4. Dia 10: "Tu trial vence en 4 dias"
5. Dia 13: "Ultimo dia de trial - upgrade ahora"
6. Dia 14: Trial vence -> downgrade a read-only

---

## 9. AI / AGENTE INTELIGENTE - 80/100

### Capacidades actuales (muy avanzadas)
- **Chat IA**: consultas en lenguaje natural sobre datos del negocio
- **SecretarIA (WhatsApp)**: bot completo con clasificacion de intents
  - Consultar clientes, productos, facturas, saldos, pedidos
  - Enviar documentos (PDF facturas, cotizaciones, remitos)
  - Morning brief automatico
  - Procesamiento de audio (Deepgram STT)
- Multi-LLM: Claude Haiku/Sonnet + GPT-4o-mini (cost-optimized)
- Rate limiting por empresa (50 queries/dia)

### Gaps para "mejor agente posible"
| Gap | Impacto |
|-----|---------|
| No puede CREAR datos (solo leer) | Usuarios quieren "crea un pedido para X" desde WhatsApp |
| Sin embeddings/RAG | No puede buscar en documentos subidos |
| Sin cost tracking | No se sabe cuanto cuesta el AI por tenant |
| Sin fine-tuning | Respuestas genericas, no personalizadas por industria |
| Sin historial persistente | Cada conversacion empieza de 0 |

### Roadmap AI
1. **Fase 1**: Write operations (crear pedido, registrar cobro desde WhatsApp)
2. **Fase 2**: Historial de conversaciones persistente
3. **Fase 3**: Cost tracking por tenant (metering)
4. **Fase 4**: RAG sobre documentos del negocio

---

## 10. PORTAL CLIENTES - 70/100

### Funcional
- Portal separado con JWT de cliente (no admin)
- Ver pedidos, facturas, cotizaciones, remitos
- Aceptar/rechazar cotizaciones
- Configuracion de portal por empresa (que mostrar/ocultar)

### Gaps
- Sin link de pago desde portal
- Sin chat de soporte
- Sin notificaciones push

---

## 11. MONITORING / OBSERVABILIDAD - 45/100

### Lo que hay
- Pino structured logging con JSON
- Health checks (public + admin)
- Request ID tracing
- Performance monitoring (request duration)
- Security event ring buffer

### Lo que falta
- Sentry (no instalado en dependencias)
- Uptime monitoring externo (UptimeRobot)
- Alerting (Slack/email cuando algo falla)
- APM (Application Performance Monitoring)

---

## 12. DOMINIO / DNS / SSL - 10/100

### Estado
- Dominios comprados: gobecker.com.ar, gobecker.online, gobecker.store
- **NINGUN dominio configurado** con DNS records
- App sirve desde gestor-becker-backend.onrender.com (URL de Render)
- Sin SSL custom (usa el de Render)

### Plan de accion DNS
1. gobecker.com.ar -> Landing page (Vercel/Netlify)
2. app.gobecker.com.ar -> CNAME a gestor-becker-backend.onrender.com
3. api.gobecker.com.ar -> CNAME a gestor-becker-backend.onrender.com (opcional)
4. SSL automatico via Render custom domain

---

## 13. ONBOARDING / UX - 65/100

### Lo que hay
- Wizard de 5 pasos: empresa, modulos, producto, empresa cliente, listo
- Empty states con CTAs en todas las paginas
- Context menu (click derecho) en pedidos/facturas
- Skeleton loading states

### Lo que falta
- Video tour / tutorial interactivo
- Tooltips de primera vez
- Checklist de activacion persistente en dashboard
- NPS / feedback widget

---

## 14. DOCUMENTACION / HELP CENTER - 10/100

### Lo que hay
- HelpTip tooltips en campos complejos
- Instrucciones de AFIP en Settings
- Legal (terminos, privacidad)

### Lo que falta
- Knowledge base / Help Center
- FAQ
- Video tutoriales
- Guia "como empezar"
- Documentacion de API (si se abre)

---

## 15. BRANDING - 95/100

### Completado
- 48 archivos actualizados de GESTIA/BeckerVisual -> GoBecker
- 0 referencias restantes al branding viejo
- Emails, legal, AI prompts, UI, PDFs, exports: todo dice GoBecker

### Pendiente
- Logo/isotipo (actualmente muestra "G" generico)
- Favicon actualizado
- Paleta de colores oficial documentada

---

## Roadmap Recomendado

### Semana 1: Foundation
- [ ] Configurar DNS gobecker.com.ar -> app
- [ ] Instalar Sentry
- [ ] Configurar ENCRYPTION_KEY obligatorio
- [ ] Obtener certificado AFIP produccion
- [ ] Smoke test E2E completo en produccion

### Semana 2-3: Landing + Analytics
- [ ] Landing page en gobecker.com.ar (Astro)
- [ ] PostHog instalado en landing + app
- [ ] Google Search Console + sitemap
- [ ] Primer articulo de blog

### Semana 4: Billing + Email
- [ ] Feature gates completos por plan
- [ ] Trial expiry emails (3d, 1d, vencido)
- [ ] Welcome email sequence (5 emails)
- [ ] Dunning para pagos fallidos

### Mes 2: Growth
- [ ] 5 articulos de blog (SEO long-tail)
- [ ] Stripe integration (internacional)
- [ ] AI write operations (crear desde WhatsApp)
- [ ] Uptime monitoring + alerting
- [ ] 10 beta testers con feedback activo

### Mes 3: Scale
- [ ] 2FA integrado
- [ ] Redis para rate limits
- [ ] CDN para assets
- [ ] Help center basico
- [ ] Video onboarding

---

## Conclusion

GoBecker tiene un **core product solido** (ERP con AFIP, AI, CRM, multi-tenancy con RLS) pero le faltan las **capas comerciales** para lanzar: landing page, analytics, email sequences, y configuracion de dominio. La seguridad es fuerte pero tiene gaps criticos (Sentry, 2FA). El AI es un diferenciador competitivo real pero necesita write operations para maximizar valor.

**Prioridad absoluta**: DNS + landing + certificado AFIP produccion. Sin esto, no hay negocio.
