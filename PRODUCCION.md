# 🚀 Guía de Deployment a Producción - Gestor BeckerVisual

## Opción 1: HEROKU (Backend) + VERCEL (Frontend) - RECOMENDADO

### PASO 1: Preparar Backend para Heroku

**1.1 Crear cuenta Heroku**
```bash
# Instalar Heroku CLI
# https://devcenter.heroku.com/articles/heroku-cli

# Loguear en Heroku
heroku login
```

**1.2 Crear aplicación Heroku**
```bash
cd /home/facu/BECKER/Gestor\ BeckerVisual/backend

# Crear app
heroku create gestor-becker-api

# Agregar PostgreSQL
heroku addons:create heroku-postgresql:hobby-dev

# Ver variable de BD
heroku config
# Copiar DATABASE_URL
```

**1.3 Configurar variables de entorno en Heroku**
```bash
# JWT
heroku config:set JWT_SECRET="tu-secret-muy-largo-aleatorio-123456"
heroku config:set JWT_REFRESH_SECRET="otro-secret-muy-largo-aleatorio-789"

# AFIP (producción)
heroku config:set AFIP_ENV="homologacion"
heroku config:set AFIP_CUIT="20123456789"

# Email (Gmail)
heroku config:set SMTP_HOST="smtp.gmail.com"
heroku config:set SMTP_PORT="587"
heroku config:set SMTP_USER="tu-email@gmail.com"
heroku config:set SMTP_PASS="tu-app-password"
heroku config:set SMTP_FROM="noreply@gestorbecker.com"

# CORS
heroku config:set CORS_ORIGIN="https://gestor-becker.vercel.app"

# Ver todas
heroku config
```

**1.4 Inicializar Git en backend (si no existe)**
```bash
cd /home/facu/BECKER/Gestor\ BeckerVisual/backend

git init
git add .
git commit -m "Backend ready for production"

# Agregar remote de Heroku
heroku git:remote -a gestor-becker-api
```

**1.5 Deploy a Heroku**
```bash
git push heroku main
# o
git push heroku master

# Ver logs
heroku logs --tail
```

---

### PASO 2: Preparar Frontend para Vercel

**2.1 Actualizar API URL en producción**
```bash
cd /home/facu/BECKER/Gestor\ BeckerVisual/frontend

# Crear archivo .env.production
cat > .env.production << 'EOF'
VITE_API_URL=https://gestor-becker-api.herokuapp.com/api
EOF
```

**2.2 Actualizar vite.config.ts para leer variables**
En `frontend/vite.config.ts`, cambiar proxy a variable:
```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.VITE_API_URL || 'http://localhost:3000',
        changeOrigin: true,
      }
    }
  }
})
```

**2.3 Crear Vercel.json**
```bash
cat > vercel.json << 'EOF'
{
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "env": {
    "VITE_API_URL": "@api_url"
  }
}
EOF
```

**2.4 Push a GitHub**
```bash
cd /home/facu/BECKER/Gestor\ BeckerVisual

git add .
git commit -m "Prepare for production deployment"
git push origin main
```

**2.5 Deployar a Vercel**
- Ir a https://vercel.com
- Conectar GitHub
- Importar proyecto
- Seleccionar carpeta `frontend`
- Configurar variables de entorno
- Click Deploy

---

## Opción 2: RAILWAY (Backend) + VERCEL (Frontend)

### Railway Backend
```bash
# Instalar Railway CLI
npm i -g @railway/cli

# Loguear
railway login

# Crear proyecto
railway init

# Seleccionar Node.js
# Seleccionar carpeta /backend

# Agregar PostgreSQL desde dashboard Railway

# Setear variables
railway variables

# Deploy
railway up
```

---

## Opción 3: AWS EC2 (Backend) + Netlify (Frontend)

### EC2
1. Crear instancia Ubuntu
2. SSH al servidor
3. Clonar repo
4. Instalar Node.js, PostgreSQL
5. npm install && npm build
6. Usar PM2 para mantener app corriendo
7. Configurar NGINX como reverse proxy

---

## Checklist Pre-Producción

```
BACKEND:
☐ npm run build (verifica que compila)
☐ Todas las variables de entorno configuradas
☐ Database URL válida (PostgreSQL en la nube)
☐ JWT secrets seguros (mínimo 32 caracteres)
☐ AFIP certs listos (o usar homologación temporalmente)
☐ Email SMTP funcionando
☐ CORS_ORIGIN actualizado al dominio del frontend
☐ NODE_ENV = "production"

FRONTEND:
☐ npm run build (verifica que compila)
☐ API_URL apunta a backend producción
☐ No hay console.logs de debug
☐ Build optimizado (<2MB gzipped)

DATABASE:
☐ PostgreSQL en la nube (Heroku, Railway, AWS RDS)
☐ Backup automático habilitado
☐ Restricciones de acceso configuradas
☐ Migrations ejecutadas

SEGURIDAD:
☐ HTTPS habilitado (automático en Heroku/Vercel)
☐ CORS restringido a dominio correcto
☐ Rate limiting activo
☐ Helmet security headers activos
☐ No exponer variables sensibles
☐ JWT secrets rotados

MONITOREO:
☐ Logs centralizados (Heroku logs, Sentry, etc.)
☐ Alertas de errores configuradas
☐ Health check endpoint funcionando
```

---

## URLs Después de Deploy

```
Backend:  https://gestor-becker-api.herokuapp.com
Frontend: https://gestor-becker.vercel.app
API:      https://gestor-becker-api.herokuapp.com/api

Health:   https://gestor-becker-api.herokuapp.com/health
Login:    https://gestor-becker.vercel.app
```

---

## Troubleshooting

### Backend no inicia
```bash
heroku logs --tail
# Buscar el error

# Verificar vars
heroku config

# Rebuild
heroku rebuild
```

### Frontend no conecta a API
```bash
# Verificar CORS
curl -H "Origin: https://gestor-becker.vercel.app" \
     https://gestor-becker-api.herokuapp.com/health

# Verificar variables de entorno en Vercel
```

### Database connection error
```bash
# Resetear database
heroku pg:reset DATABASE

# Ejecutar migraciones
heroku run npm run migrate
```

---

## Soporte Post-Deployment

### Monitoreo Diario
- Verificar health endpoint: `/health`
- Revisar logs de errores
- Validar que AFIP está respondiendo

### Mantenimiento
- Backups automáticos de database
- Actualizar dependencias (npm audit)
- Renovar certificados SSL (automático)

### Escalabilidad Futura
- Si crece, upgradear dynos en Heroku
- Si tráfico aumenta, agregar CDN (Cloudflare)
- Si datos crecen, upgradear database

---

**¡Sistema listo para la vida real!** 🚀
