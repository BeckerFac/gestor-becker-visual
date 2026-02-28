# 🚀 DEPLOYMENT A PRODUCCIÓN - GUÍA RÁPIDA

## ⏱️ Tiempo Total: ~5 minutos

---

## 📋 PASO 1: Preparar Credenciales (2 min)

### 1.1 Obtener Heroku API Key
1. Ve a: https://dashboard.heroku.com/account/applications/authorizations
2. Click en "Create authorization"
3. Dale nombre (ej: "Gestor Becker Deploy")
4. Copia el token generado

### 1.2 Obtener Vercel Token
1. Ve a: https://vercel.com/account/tokens
2. Click en "Create token"
3. Dale nombre (ej: "Gestor Becker Deploy")
4. Copia el token

### 1.3 Actualizar archivo .env.deploy

Edita `/home/facu/BECKER/Gestor BeckerVisual/.env.deploy` y reemplaza:
```bash
HEROKU_API_KEY=your_heroku_api_key_here
VERCEL_TOKEN=your_vercel_token_here
```

Con tus tokens reales.

---

## 🚀 PASO 2: Ejecutar Deployment (3 min)

```bash
cd /home/facu/BECKER/Gestor\ BeckerVisual

# Cargar credenciales
source .env.deploy

# Ejecutar deployment
bash deploy-auto.sh
```

El script hará automáticamente:
- ✅ Compilar backend
- ✅ Compilar frontend
- ✅ Crear app en Heroku
- ✅ Agregar PostgreSQL
- ✅ Configurar variables de entorno
- ✅ Deploy a Heroku
- ✅ Deploy a Vercel

---

## 📝 Personalizar Nombres de Apps

Si quieres nombres diferentes, edita `.env.deploy`:
```bash
HEROKU_APP_NAME=tu-nombre-api
VERCEL_PROJECT_NAME=tu-nombre-web
```

---

## 🔑 Credenciales de Test

Una vez deployado, puedes loguear con:
```
Email:    e2etest@test.com
Password: test123
```

---

## ✅ Lo Que Está Listo

- ✅ Backend compilado y optimizado
- ✅ Frontend compilado y optimizado (263KB gzipped)
- ✅ Database schema preparado
- ✅ Todo compilado y testeado localmente
- ✅ Scripts de deployment automático
- ✅ Documentación de producción completa

---

## 🚨 Importante Después del Deploy

1. **Gmail App Password**: Si usas Gmail para enviar facturas
   - Ve a Google Account → Security
   - Enable 2FA
   - Crear "App Password"
   - Copiar en Heroku dashboard → Config Vars → `SMTP_PASS`

2. **Certificado AFIP Real**: Para pasar a producción
   - Obtener certificado digital de AFIP
   - Subir certificado a Heroku
   - Cambiar `AFIP_ENV` a `produccion`

3. **Dominio Personalizado**: Para URL profesional
   - Heroku: Settings → Domains
   - Vercel: Domains

---

## 📱 URLs Después del Deploy

Se mostrarán al final del script:
```
Backend:  https://[HEROKU_APP_NAME].herokuapp.com
Frontend: https://[VERCEL_PROJECT_NAME].vercel.app
API:      https://[HEROKU_APP_NAME].herokuapp.com/api
```

---

## ❌ Troubleshooting

### Error: "Faltan variables de entorno"
→ Asegúrate de haber editado `.env.deploy` y ejecutado `source .env.deploy`

### Error: "Heroku app ya existe"
→ Usa un nombre diferente o borra la app anterior en el dashboard

### Error: "CORS error en frontend"
→ Automático, pero verifica que CORS_ORIGIN esté correcto en Heroku Config Vars

---

## 📞 Soporte

Si algo falla:
1. Revisa los logs: `heroku logs --tail -a [HEROKU_APP_NAME]`
2. Verifica variables: `heroku config -a [HEROKU_APP_NAME]`
3. Chequea Vercel deployment: https://vercel.com/dashboard

---

## 🎉 Listo!

Tu Gestor BeckerVisual estará en producción en 5 minutos.

¿Necesitas más detalles? Ve a [README_PRODUCCION.md](./README_PRODUCCION.md)
