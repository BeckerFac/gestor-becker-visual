# Rebranding Report: GESTIA/BeckerVisual -> GoBecker

**Fecha**: 2026-04-06
**Dominio adquirido**: gobecker.com.ar + gobecker.online + gobecker.store
**Objetivo**: Unificar toda la identidad bajo "GoBecker"

---

## 1. Estado Actual - Audit Score por Area

| Area | Score | Estado | Descripcion |
|------|-------|--------|-------------|
| **UI Auth (Login/Register/Reset)** | 0/10 | Dice "GESTIA" | 5 paginas con branding viejo |
| **Sidebar/Layout** | 0/10 | Dice "BeckerVisual" | Header del sidebar |
| **PWA Manifest** | 0/10 | Dice "GESTIA" | Name + short_name en vite.config.ts |
| **index.html Meta** | 0/10 | Dice "GESTIA" | Title, OG, Apple |
| **Offline Page** | 0/10 | Dice "GESTIA" | 3 instancias |
| **Legal: Terminos** | 0/10 | Dice "BeckerVisual" | 17+ instancias |
| **Legal: Privacidad** | 0/10 | Dice "BeckerVisual" | 12+ instancias |
| **Email Templates** | 0/10 | Dice "Gestor BeckerVisual" | 5 templates |
| **AI System Prompts** | 0/10 | Dice "GESTIA" | 15+ instancias en ai.config, secretaria |
| **PDF Footer** | 0/10 | Dice "GESTIA" | 1 instancia |
| **Data Export** | 0/10 | Dice "gestia" | Filename |
| **Onboarding** | 0/10 | Dice "GESTIA" | Wizard header |
| **Reportes** | 0/10 | Dice "BeckerVisual" | Print header |
| **Settings AFIP** | 0/10 | Dice "BeckerVisual" | Instrucciones |
| **Package.json** | 0/10 | Dice "gestor-beckervisual" | Root + backend |
| **Docker/Deploy** | 0/10 | Dice "gestor-becker" | Containers |
| **.env.example** | 0/10 | Dice "GESTIA" | Comments + defaults |
| **Env defaults** | 0/10 | Dice "gestorbecker" | SMTP, DB name |
| **Documentation** | 0/10 | Dice "GESTIA/BeckerVisual" | CLAUDE.md, README |
| **E2E Tests** | 0/10 | Dice "Gestor Comercial" | Test assertions |
| **security.txt** | 0/10 | Dice "gestia.com.ar" | Contact |
| **PWA Install Prompt** | 0/10 | Dice "GESTIA" | Install message |
| **AI Chat Panel** | 0/10 | Dice "GESTIA" | Title + prompts |

**Score Global: 0/230** (23 areas, todas en branding viejo)

---

## 2. Plan de Accion - Prioridad de Ejecucion

### FASE 1: User-Facing Critico (lo que ve el usuario)
1. Login, Register, ForgotPassword, ResetPassword, VerifyEmail, AcceptInvite -> "GoBecker"
2. Sidebar header -> "GoBecker"
3. index.html title + meta tags -> "GoBecker"
4. PWA manifest (vite.config.ts) -> "GoBecker"
5. Offline page -> "GoBecker"
6. Onboarding wizard -> "GoBecker"
7. PWA install prompt -> "GoBecker"
8. AI Chat panel title -> "GoBecker"

### FASE 2: Comunicaciones
9. Email base template BRAND_NAME -> "GoBecker"
10. Welcome email -> "GoBecker"
11. Verification email -> "GoBecker"
12. Password reset email -> "GoBecker"
13. AI system prompts -> "GoBecker"

### FASE 3: Legal
14. Terminos y Condiciones -> "GoBecker" (17+ reemplazos)
15. Politica de Privacidad -> "GoBecker" (12+ reemplazos)

### FASE 4: Internal/Config
16. Package.json names
17. .env.example
18. security.txt
19. Data export filename
20. PDF footer
21. Reportes print header
22. Settings AFIP instructions
23. Docker/deploy scripts
24. Documentation

---

## 3. Reglas de Reemplazo

| Viejo | Nuevo |
|-------|-------|
| GESTIA | GoBecker |
| gestia | gobecker |
| BeckerVisual | GoBecker |
| beckervisual | gobecker |
| Gestor BeckerVisual | GoBecker |
| Gestor Comercial | Gestion Comercial Inteligente |
| Gestion empresarial inteligente | Gestion comercial inteligente |
| gestia.com.ar | gobecker.com.ar |
| gestorbecker.com | gobecker.com.ar |
| beckervisual.com | gobecker.com.ar |
| gestor-beckervisual | gobecker |
| gestor-becker-backend | gobecker-api |
| gestor_becker | gobecker |

**NO cambiar**:
- Repository URL en GitHub (requiere rename del repo)
- Render service names (requiere recrear)
- Neon DB name (cosmetic)
- Variables de codigo interno (no user-facing)
