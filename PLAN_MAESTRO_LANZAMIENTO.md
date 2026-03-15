# PLAN MAESTRO: Lanzamiento Gestor BeckerVisual + CEO.AI
## De producto terminado a PyMEs argentinas pagando mensualmente

**Fecha**: 2026-03-06
**Objetivo**: Conseguir los primeros 50 clientes PyME pagos en 90 dias, escalar a 500 en 12 meses
**Modelo**: SaaS (MRR) con trial gratuito + onboarding asistido por IA

---

## FASE 0: PREPARACION DEL PRODUCTO (Semanas 1-3)
### "Nadie compra algo que no puede probar"

### 0.1 - Entorno Demo Funcional
- [ ] Levantar instancia demo publica con datos ficticios realistas (empresa "Distribuidora San Martin SRL")
- [ ] Precargada con: 200 productos, 50 clientes, 30 proveedores, facturas del ultimo mes, stock con alertas
- [ ] URL: demo.beckervisual.com.ar (o similar)
- [ ] Login automatico sin registro (boton "Probar Ahora")
- [ ] Banner superior: "Esto es una demo - Tus datos reales estaran protegidos"
- [ ] Watermark sutil en PDFs generados: "Demo - beckervisual.com.ar"
- [ ] La demo se resetea cada 24hs automaticamente

### 0.2 - Landing Page de Conversion
- [ ] Dominio: beckervisual.com.ar (o gestionbecker.com.ar)
- [ ] Hero: "Deja de usar software de los 90. Tu PyME merece mas." + CTA "Probar Gratis 30 Dias"
- [ ] Video de 90 segundos: screencast del sistema facturando en AFIP, generando PDF, mostrando dashboard
- [ ] Secciones: Funcionalidades (con screenshots), Precios, Comparativa vs Cartagos, Testimonios, FAQ
- [ ] Formulario de registro: solo Email + Nombre empresa + Rubro (3 campos)
- [ ] Chat widget (Tidio/Crisp) con bot que responde FAQ basicas
- [ ] Certificado SSL, meta tags SEO, Google Analytics, Meta Pixel, Hotjar

### 0.3 - Pricing Strategy
- [ ] Plan STARTER (gratis 30 dias, despues $15.000 ARS/mes):
  - 1 usuario, 1 punto de venta, 50 facturas/mes, soporte por email
- [ ] Plan PROFESIONAL ($35.000 ARS/mes):
  - 3 usuarios, 2 puntos de venta, facturas ilimitadas, soporte prioritario, reportes avanzados
- [ ] Plan EMPRESA ($65.000 ARS/mes):
  - Usuarios ilimitados, multi-sucursal, API abierta, soporte telefonico, backup dedicado
- [ ] Descuento 20% pago anual
- [ ] Descuento 50% primeros 3 meses para early adopters (primeros 50 clientes)
- [ ] Precio en ARS, factura A o B segun corresponda
- [ ] Cobro: Mercado Pago recurrente (tarjeta/debito/transferencia)

### 0.4 - Onboarding Automatizado
- [ ] Wizard de configuracion inicial (5 pasos):
  1. Datos de la empresa (CUIT, razon social, domicilio fiscal)
  2. Configuracion AFIP (subir certificado digital o guia paso a paso)
  3. Importar productos (CSV/Excel o carga manual)
  4. Importar clientes (CSV/Excel o carga manual)
  5. Primera factura de prueba (en homologacion AFIP)
- [ ] Tooltips y guias contextuales en cada pantalla
- [ ] Base de conocimiento: docs.beckervisual.com.ar (GitBook o Docusaurus)
- [ ] Videos tutoriales cortos (2-5 min cada uno) para cada modulo

### 0.5 - Infraestructura de Produccion
- [ ] Backend en Railway/Render (auto-scaling, $25-50 USD/mes inicial)
- [ ] PostgreSQL managed (Supabase o Railway, con backups diarios)
- [ ] Frontend en Vercel (ya deployado, gratis)
- [ ] CDN para assets estaticos (Cloudflare gratis)
- [ ] Monitoreo: Sentry (errores), UptimeRobot (disponibilidad), LogDNA (logs)
- [ ] Multi-tenancy: cada empresa = schema separado en PostgreSQL
- [ ] Dominio + email profesional: soporte@beckervisual.com.ar

---

## FASE 1: GENERACION DE LEADS (Semanas 2-6)
### "Llenar el pipeline antes de vender"

### 1.1 - SEO y Contenido Organico

**Blog** (beckervisual.com.ar/blog):
- [ ] "Como facturar electronicamente con AFIP en 2026: Guia completa"
- [ ] "Cartagos vs alternativas modernas: Comparativa 2026"
- [ ] "5 senales de que tu PyME necesita un sistema de gestion"
- [ ] "Como elegir un sistema de facturacion para tu comercio"
- [ ] "Gestion de stock para principiantes: errores que cuestan plata"
- [ ] "Monotributo vs Responsable Inscripto: que sistema de facturacion necesitas"
- [ ] "Como generar catalogos PDF profesionales sin disenador"
- [ ] "Control de cuentas corrientes: deja de perder plata con morosos"
- [ ] Publicar 2 articulos por semana (generados con IA, revisados manualmente)
- [ ] Cada articulo termina con CTA: "Proba BeckerVisual gratis 30 dias"

**SEO Tecnico**:
- [ ] Keywords target: "sistema de gestion pymes argentina", "facturacion electronica afip", "alternativa a cartagos", "software de gestion comercial", "sistema de facturacion argentina"
- [ ] Schema markup en landing page (Software Application)
- [ ] Google My Business (si aplica)
- [ ] Backlinks: directorios de software argentino, foros de contadores

### 1.2 - Campana de Google Ads
- [ ] Budget inicial: $200 USD/mes
- [ ] Keywords exactas:
  - "sistema de gestion pymes" / "software gestion comercial"
  - "facturacion electronica afip" / "facturar con afip"
  - "alternativa cartagos" / "reemplazar cartagos"
  - "sistema de stock y facturacion"
  - "software para comercio argentina"
- [ ] Ads con extension de precio y de llamada
- [ ] Landing page especifica por grupo de keywords
- [ ] Remarketing a visitantes que no convirtieron
- [ ] Objetivo: CPA < $5 USD por trial registrado

### 1.3 - Campana de Meta Ads (Facebook + Instagram)
- [ ] Budget inicial: $150 USD/mes
- [ ] Audiencia: Duenos de PyMEs, comerciantes, contadores en Argentina
- [ ] Intereses: Emprendimiento, gestion empresarial, AFIP, Monotributo, MercadoLibre
- [ ] Formato: Video corto (15-30 seg) mostrando la app en accion
- [ ] Retargeting: Visitantes del sitio, miradores de video >50%
- [ ] Lead magnet: "Descarga gratis: Checklist de facturacion AFIP para PyMEs"

### 1.4 - LinkedIn
- [ ] Perfil de empresa BeckerVisual
- [ ] Publicar contenido 3x/semana: tips de gestion, novedades AFIP, product updates
- [ ] Conectar con contadores, asesores impositivos, duenos de PyMEs
- [ ] LinkedIn Ads (cuando budget lo permita): $100 USD/mes
- [ ] Target: Decision makers en empresas de 2-50 empleados en Argentina

### 1.5 - Alianzas Estrategicas con Contadores
- [ ] Identificar 50 estudios contables en CABA, GBA, Cordoba, Rosario, Mendoza
- [ ] Propuesta: "Recomenda BeckerVisual a tus clientes y gana 20% de comision recurrente"
- [ ] Kit para contadores: presentacion PDF, video demo, link de referido con tracking
- [ ] Webinar mensual para contadores: "Como simplificar la gestion de tus clientes PyME"
- [ ] Los contadores son el canal #1 de recomendacion de software de gestion en Argentina

### 1.6 - Partnerships con Integradores
- [ ] Contactar empresas que implementan Cartagos/Tango/Colppy
- [ ] Propuesta: fee de implementacion + comision recurrente
- [ ] Proporcionar documentacion tecnica de la API para integraciones custom
- [ ] Certificacion "Partner BeckerVisual" con badge y listado en el sitio

---

## FASE 2: CAMPANA DE EMAIL MARKETING (Semanas 3-indefinido)
### "El email es el canal con mejor ROI. Punto."

### 2.1 - Stack de Email
- [ ] Plataforma: Brevo (ex-Sendinblue) - plan gratis hasta 300 emails/dia
- [ ] Dominio verificado: @beckervisual.com.ar (DKIM, SPF, DMARC)
- [ ] Templates responsive, branding consistente
- [ ] Tracking: opens, clicks, conversiones

### 2.2 - Construccion de Lista
- [ ] Lead magnet #1: "Checklist de facturacion AFIP 2026" (PDF descargable)
- [ ] Lead magnet #2: "Plantilla Excel de control de stock gratis"
- [ ] Lead magnet #3: "Guia: Como migrar de Cartagos a un sistema moderno"
- [ ] Pop-up de salida en landing page: "Antes de irte, lleva esta guia gratis"
- [ ] Formulario en blog posts
- [ ] LinkedIn lead gen forms
- [ ] Webinars (registrantes)
- [ ] Foros de contadores y PyMEs

### 2.3 - Secuencia de Nurturing (Automatica, 14 emails en 45 dias)

**Dia 0 - Bienvenida**:
- Asunto: "[Nombre], tu cuenta en BeckerVisual esta lista"
- Contenido: Bienvenida + link a la demo + primeros pasos + video de 2 min

**Dia 1 - Valor inmediato**:
- Asunto: "Tu primera factura electronica en 3 minutos"
- Contenido: Tutorial paso a paso para emitir factura en AFIP

**Dia 3 - Pain point**:
- Asunto: "Cuanto tiempo perdas facturando a mano?"
- Contenido: Calculadora de tiempo ahorrado + caso de uso real

**Dia 5 - Feature highlight**:
- Asunto: "Tus clientes morosos? Asi los controlas automaticamente"
- Contenido: Demo de cuentas corrientes y alertas de vencimiento

**Dia 7 - Social proof**:
- Asunto: "Como [Empresa X] dejo de perder ventas por falta de stock"
- Contenido: Caso de exito (inicialmente simulado, despues real)

**Dia 10 - Comparativa**:
- Asunto: "BeckerVisual vs tu sistema actual (comparativa honesta)"
- Contenido: Tabla comparativa vs Cartagos/Tango/Excel/nada

**Dia 14 - Urgencia suave**:
- Asunto: "Te quedan 16 dias de prueba gratis"
- Contenido: Recap de funcionalidades que no probo + invitacion a llamada

**Dia 18 - Feature avanzado**:
- Asunto: "Generaste un catalogo PDF para tus clientes?"
- Contenido: Video tutorial de catalogos + ejemplo PDF profesional

**Dia 21 - Medio camino**:
- Asunto: "[Nombre], ya llevas 3 semanas. Que te parecio?"
- Contenido: Encuesta rapida (3 preguntas) + oferta de llamada personal

**Dia 25 - Objecion handling**:
- Asunto: "Es muy caro? Miremos los numeros juntos"
- Contenido: ROI calculator: "Si facturas X por mes, BeckerVisual se paga solo"

**Dia 28 - Exclusividad**:
- Asunto: "Solo para vos: 50% en los primeros 3 meses"
- Contenido: Oferta early adopter con countdown

**Dia 30 - Trial expira**:
- Asunto: "Tu prueba gratis termina manana"
- Contenido: Resumen de todo lo que pierde si no suscribe + CTA fuerte

**Dia 35 - Win-back**:
- Asunto: "Te extraniamos. Tu cuenta sigue ahi."
- Contenido: Extension de 7 dias gratis si responde

**Dia 45 - Ultimo intento**:
- Asunto: "Ultima oportunidad: 60% off por 6 meses"
- Contenido: Oferta agresiva final + link directo a checkout

### 2.4 - Emails de Producto (Post-conversion)
- [ ] Onboarding drip (7 emails en 14 dias): un modulo por email
- [ ] Newsletter quincenal: nuevas funcionalidades, tips, novedades AFIP
- [ ] Emails transaccionales: factura de suscripcion, cambio de plan, ticket de soporte
- [ ] NPS trimestral: "Del 1 al 10, recomendarias BeckerVisual?"
- [ ] Emails de reactivacion si el usuario no entra hace 7 dias

### 2.5 - Campana de Cold Email (Outbound)

**Fuentes de datos**:
- [ ] Scraping de guias de comercios (Paginas Amarillas, Google Maps)
- [ ] Base de monotributistas/RI en registros publicos
- [ ] LinkedIn Sales Navigator (si budget permite)
- [ ] Listados de camaras de comercio

**Template cold email #1 - Pain**:
```
Asunto: [Nombre empresa], seguis facturando como en 2010?

Hola [Nombre],

Vi que [Empresa] esta en [Rubro] en [Ciudad]. Te pregunto algo rapido:

- Facturas con AFIP desde un sistema de escritorio?
- Tu stock lo controlas en Excel?
- Tus cobranzas las seguis en la cabeza?

Arme un sistema que resuelve todo esto en una sola pantalla.
Se llama BeckerVisual, y ya lo estan usando comercios como el tuyo.

Si queres verlo funcionando, tarda 2 minutos:
[LINK A DEMO]

Facu - Fundador de BeckerVisual
PD: Los primeros 50 clientes tienen 50% de descuento permanente.
```

**Template cold email #2 - Referencia**:
```
Asunto: Le arme un sistema de gestion a [empresa similar]

Hola [Nombre],

Trabajo con [empresa/rubro similar al target] y les arme un sistema
que les ahorra 15 horas por semana en facturacion, stock y cobranzas.

Me gustaria mostrartelo. Son 15 minutos de tu tiempo.

Podes verlo aca: [LINK A DEMO]
O agendamos una llamada: [LINK CALENDLY]

Facu
```

**Reglas de outbound**:
- [ ] Maximo 50 cold emails por dia (para no quemar el dominio)
- [ ] Usar dominio separado para cold email (ej: hola.beckervisual.com.ar)
- [ ] Warm up del dominio 2 semanas antes de enviar
- [ ] Follow-up automatico: 3 dias, 7 dias, 14 dias
- [ ] Personalizar cada email con dato real del negocio
- [ ] Herramienta: Instantly.ai o Lemlist ($30 USD/mes)

---

## FASE 3: CONVERSION Y VENTAS (Semanas 4-12)
### "Un trial sin seguimiento es un trial perdido"

### 3.1 - Sales Process
- [ ] Cada trial registrado recibe notificacion interna (Slack/Telegram/email)
- [ ] Dentro de 2 horas: email personal de bienvenida del fundador
- [ ] Dia 3: llamada/WhatsApp para ofrecer ayuda con onboarding
- [ ] Dia 7: check-in sobre uso ("Pudiste cargar tus productos?")
- [ ] Dia 14: demo personalizada 1:1 si no convirtio aun
- [ ] Dia 21: llamada de cierre con oferta especial
- [ ] Dia 30: ultimo intento antes de expiracion

### 3.2 - WhatsApp Business
- [ ] Numero dedicado: +54 9 11 XXXX-XXXX
- [ ] Catalogo de WhatsApp Business con info del producto
- [ ] Respuestas rapidas para FAQ
- [ ] Broadcast semanal con tips (a quienes optin)
- [ ] Boton "Chatear por WhatsApp" en landing + dentro de la app
- [ ] Bot de WhatsApp (Dialogflow/Botpress) para responder 24/7

### 3.3 - Calendly para Demos
- [ ] Link publico: calendly.com/beckervisual/demo
- [ ] Slots: Lunes a Viernes 10-18hs
- [ ] Duracion: 20 minutos
- [ ] Reminder automatico 1h antes
- [ ] Post-demo: email con grabacion + pricing + CTA
- [ ] Embebido en landing page y emails

### 3.4 - Metricas de Conversion
- [ ] Visitante -> Trial: target 5-8%
- [ ] Trial -> Usuario activo: target 60%
- [ ] Trial -> Pago: target 15-25%
- [ ] Churn mensual: target < 5%
- [ ] LTV/CAC ratio: target > 3:1
- [ ] Tiempo promedio a conversion: target 14 dias

---

## FASE 4: RETENCION Y GROWTH (Mes 2-6)
### "Retener 1 cliente cuesta 5x menos que adquirir uno nuevo"

### 4.1 - Customer Success
- [ ] Check-in mensual automatizado (email + NPS)
- [ ] Soporte por ticket (Freshdesk/Zendesk, plan gratis)
- [ ] SLA: respuesta en < 4 horas (horario laboral)
- [ ] Base de conocimiento publica con busqueda
- [ ] Comunidad de usuarios (grupo privado de WhatsApp o Discord)
- [ ] Webinar mensual: "Novedades + Q&A"

### 4.2 - Feature Development Driven by Users
- [ ] Board publico de feature requests (Canny.io gratis)
- [ ] Votar features: los clientes deciden prioridades
- [ ] Changelog publico: beckervisual.com.ar/changelog
- [ ] Release notes por email a todos los usuarios
- [ ] Beta testers: clientes activos prueban features antes del release

### 4.3 - Programa de Referidos
- [ ] "Referi a un colega, ambos ganan 1 mes gratis"
- [ ] Dashboard de referidos dentro de la app
- [ ] Link unico por usuario con tracking
- [ ] Email automatico: "Conoces a alguien que necesite esto?"
- [ ] Bonus para super-referidores: 3 referidos = plan upgrade gratis 3 meses

### 4.4 - Upselling
- [ ] Modulos premium: API abierta, integraciones (MercadoLibre, Tienda Nube)
- [ ] Servicio de migracion de datos desde otro sistema: $50.000 ARS one-time
- [ ] Personalizacion de reportes: $25.000 ARS one-time
- [ ] Capacitacion presencial/virtual para equipos: $40.000 ARS/sesion
- [ ] Soporte premium 24/7: add-on $15.000 ARS/mes

### 4.5 - Expansion Geografica
- [ ] Mes 1-3: CABA + GBA (50% del mercado PyME)
- [ ] Mes 4-6: Cordoba, Rosario, Mendoza
- [ ] Mes 7-12: Resto del pais
- [ ] Adaptar testimonios y casos de exito por region
- [ ] Representantes locales / partners por zona

---

## FASE 5: AUTOMATIZACION CON CEO.AI (Mes 3-6)
### "La IA maneja el marketing, vos manejas el producto"

### 5.1 - Agentes Especializados para BeckerVisual

**Agente: Lead Generator**
- Scraping automatizado de comercios en Google Maps por zona
- Enriquecimiento de datos (CUIT, email, telefono, rubro)
- Scoring de leads por probabilidad de conversion
- Alimenta la base de cold email y ads targeting

**Agente: Email Campaign Manager**
- Genera y A/B testea asuntos de email
- Personaliza contenido segun rubro del lead
- Optimiza tiempos de envio por engagement historico
- Reporta metricas diarias (opens, clicks, replies, unsubs)

**Agente: Content Creator**
- Genera 2 blog posts SEO por semana
- Crea posts para LinkedIn/Instagram/Facebook
- Genera scripts para videos cortos de producto
- Adapta contenido por plataforma y formato

**Agente: Customer Success Bot**
- Responde tickets de soporte nivel 1 automaticamente
- Detecta usuarios en riesgo de churn (baja actividad)
- Envia emails proactivos de reengagement
- Escala issues complejos a humano

**Agente: Analytics & Reporting**
- Dashboard diario: nuevos trials, conversiones, churn, MRR
- Alertas automaticas: "Trial X no entro hace 5 dias"
- Reporte semanal al fundador con KPIs y recomendaciones
- Analisis de cohortes: que fuente de leads convierte mejor

**Agente: Ad Optimizer**
- Gestiona campanas de Google Ads y Meta Ads
- Ajusta bids y budgets automaticamente segun ROAS
- Crea nuevas variaciones de ads basado en performance
- Pausa ads underperforming, escala winners

**Agente: Competitor Monitor**
- Monitorea precios y features de competidores (Colppy, Xubio, Tango, Alegra)
- Alerta sobre cambios de pricing o nuevas features
- Sugiere respuestas competitivas
- Rastrea reviews de competidores en Google/Trustpilot

**Agente: AFIP & Regulatory Monitor**
- Monitorea cambios en normativas de AFIP
- Alerta sobre nuevas resoluciones que afecten facturacion
- Genera contenido informativo sobre cambios regulatorios
- Actualiza la base de conocimiento automaticamente

### 5.2 - Integracion CEO.AI <-> BeckerVisual
- [ ] API interna entre CEO.AI y el dashboard de metricas de BeckerVisual
- [ ] CEO.AI lee: nuevos registros, uso por usuario, tickets, churn signals
- [ ] CEO.AI ejecuta: envio de emails, creacion de ads, actualizacion de contenido
- [ ] Dashboard unificado: metricas de producto + metricas de marketing en un lugar
- [ ] Approval queue: acciones criticas (> $50 USD gasto) requieren aprobacion humana

---

## FASE 6: ESCALAMIENTO (Mes 6-12)
### "De 50 a 500 clientes"

### 6.1 - Product-Led Growth
- [ ] Freemium tier: plan gratis permanente con limites (10 facturas/mes, 1 usuario)
- [ ] Invitaciones in-app: "Invita a tu contador a ver tus reportes" (nuevo lead)
- [ ] PDFs generados con "Creado con BeckerVisual" (branding gratuito)
- [ ] Portal de clientes (el cliente de tu cliente ve sus facturas -> boca a boca)
- [ ] Marketplace de integraciones: MercadoLibre, WooCommerce, Tienda Nube

### 6.2 - Presencia en Eventos
- [ ] Expo EFI (Exposicion de Finanzas e Inversiones) - Buenos Aires
- [ ] Congresos de contadores provinciales
- [ ] Meetups de emprendedores (NXTP Labs, Endeavor, ASEA)
- [ ] Workshop presencial: "Digitaliza tu PyME en 2 horas" (gratis, genera leads)
- [ ] Stand en ferias de comercio (costo: $50-100K ARS por evento)

### 6.3 - PR y Medios
- [ ] Nota en iProfesional, Infobae Economia, El Cronista
- [ ] Podcast appearances: Startupeable, Cafe y Negocios, Posta Digital
- [ ] Caso de exito publicado en medio de negocios
- [ ] LinkedIn del fundador como canal de thought leadership
- [ ] YouTube channel: tutoriales, novedades AFIP, tips de gestion

### 6.4 - Programa de Partners Formal
- [ ] Estudios contables: certificacion + comision 20% recurrente
- [ ] Consultoras de IT: fee de implementacion + soporte conjunto
- [ ] Camaras de comercio: acuerdo de descuento para asociados
- [ ] Universidades: licencia educativa gratuita (futuros contadores/administradores)

### 6.5 - Internacionalizacion (Mes 12+)
- [ ] Uruguay (misma cultura, mercado chico pero facil de penetrar)
- [ ] Chile (regulacion similar, SII en vez de AFIP)
- [ ] Colombia (Facturacion electronica obligatoria desde 2020)
- [ ] Adaptar modulo de facturacion al ente fiscal de cada pais

---

## FASE 7: METRICAS Y KPIs POR PERIODO

### Mes 1
| Metrica | Target |
|---------|--------|
| Visitantes landing | 2,000 |
| Trials registrados | 100 |
| Conversiones a pago | 10 |
| MRR | $250.000 ARS |
| CAC | $5.000 ARS |

### Mes 3
| Metrica | Target |
|---------|--------|
| Visitantes landing | 8,000 |
| Trials registrados | 500 |
| Conversiones a pago | 50 |
| MRR | $1.500.000 ARS |
| Churn | < 5% |

### Mes 6
| Metrica | Target |
|---------|--------|
| Visitantes landing | 20,000 |
| Trials acumulados | 2,000 |
| Clientes pagos | 150 |
| MRR | $4.500.000 ARS |
| Churn | < 4% |
| NPS | > 50 |

### Mes 12
| Metrica | Target |
|---------|--------|
| Visitantes landing | 50,000 |
| Trials acumulados | 8,000 |
| Clientes pagos | 500 |
| MRR | $15.000.000 ARS |
| ARR | $180.000.000 ARS |
| Churn | < 3% |
| NPS | > 60 |
| Empleados | 3-5 (soporte, dev, ventas) |

---

## FASE 8: PRESUPUESTO OPERATIVO MENSUAL

### Mes 1-3 (Bootstrap)
| Item | Costo/mes |
|------|-----------|
| Hosting (Railway + Vercel + DB) | $50 USD |
| Dominio + Email | $10 USD |
| Brevo (email marketing) | $0 (plan gratis) |
| Google Ads | $200 USD |
| Meta Ads | $150 USD |
| Instantly.ai (cold email) | $30 USD |
| Herramientas varias | $60 USD |
| **TOTAL** | **$500 USD/mes** |

### Mes 4-6 (Growth)
| Item | Costo/mes |
|------|-----------|
| Hosting (scaling) | $150 USD |
| Email marketing (plan pago) | $25 USD |
| Google Ads | $500 USD |
| Meta Ads | $400 USD |
| LinkedIn Ads | $200 USD |
| Cold email tools | $50 USD |
| Soporte (Freshdesk) | $15 USD |
| CEO.AI infra (VPS + APIs) | $100 USD |
| **TOTAL** | **$1,440 USD/mes** |

### Mes 7-12 (Scale)
| Item | Costo/mes |
|------|-----------|
| Hosting (production) | $300 USD |
| Ads (total) | $2,000 USD |
| Tools & infra | $300 USD |
| Primer empleado soporte | $800 USD |
| CEO.AI infra | $200 USD |
| **TOTAL** | **$3,600 USD/mes** |

---

## FASE 9: STACK LEGAL Y COMPLIANCE

### 9.1 - Estructura Legal
- [ ] Monotributo categoria H o I (o SAS si los numeros lo justifican)
- [ ] Registrar marca "BeckerVisual" en INPI ($15.000 ARS aprox)
- [ ] Terminos y Condiciones del servicio (TyC) - redactar con abogado
- [ ] Politica de Privacidad (cumplir Ley 25.326 de Proteccion de Datos Personales)
- [ ] Acuerdo de procesamiento de datos (los datos de AFIP de los clientes son sensibles)
- [ ] Seguro de responsabilidad civil (opcional pero recomendado)

### 9.2 - Compliance AFIP
- [ ] Cada cliente usa SU propio certificado digital AFIP (no el nuestro)
- [ ] Documentar que BeckerVisual es un intermediario tecnologico, no un agente fiscal
- [ ] Backup de CAEs emitidos por 10 anios (obligacion legal)
- [ ] Audit trail de todas las operaciones de facturacion

### 9.3 - Seguridad de Datos
- [ ] Encriptacion at rest (AES-256) para datos sensibles
- [ ] Encriptacion in transit (TLS 1.3)
- [ ] Backups diarios con retencion de 30 dias
- [ ] Plan de recuperacion ante desastres (DR) documentado
- [ ] Penetration testing anual (cuando budget lo permita)
- [ ] 2FA obligatorio para acceso a datos de AFIP

---

## FASE 10: PLAYBOOK DE PRIMERAS 2 SEMANAS (Dia a Dia)

### Semana 1
| Dia | Tarea Principal |
|-----|-----------------|
| L | Comprar dominio, configurar DNS, SSL, email profesional |
| M | Levantar landing page en Vercel (puede ser con template + customizacion) |
| X | Configurar Brevo, crear templates de email, verificar dominio |
| J | Grabar video demo de 90 seg (screencast con Loom) |
| V | Levantar instancia demo publica con datos ficticios |
| S | Configurar Google Analytics, Meta Pixel, Hotjar |

### Semana 2
| Dia | Tarea Principal |
|-----|-----------------|
| L | Escribir 3 blog posts SEO + publicar |
| M | Configurar Google Ads (campana de busqueda) |
| X | Configurar Meta Ads (campana de awareness) |
| J | Preparar secuencia de 14 emails en Brevo |
| V | Enviar primeros 20 cold emails a comercios locales |
| S | Crear perfiles en LinkedIn, Instagram, configurar WhatsApp Business |

---

## RESUMEN EJECUTIVO

**Producto**: Gestor BeckerVisual - Sistema de gestion integral para PyMEs argentinas
**Diferencial**: Alternativa moderna a Cartagos, cloud-native, con facturacion AFIP automatica
**Modelo**: SaaS con trial gratis 30 dias, desde $15.000 ARS/mes
**Canales de adquisicion**: SEO, Google Ads, Meta Ads, cold email, alianzas con contadores, referidos
**Automatizacion**: CEO.AI maneja marketing, leads, contenido y soporte nivel 1
**Meta 12 meses**: 500 clientes pagos, $15M ARS MRR, equipo de 3-5 personas
**Inversion inicial**: $500 USD/mes (bootstrap), escalando con revenue

---

*Este plan fue disenado para ser ejecutado por una persona + CEO.AI.
Cada fase se activa progresivamente a medida que el revenue lo permite.
No hace falta inversion externa. Se autofinancia desde el mes 2-3.*
