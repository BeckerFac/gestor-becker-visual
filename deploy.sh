#!/bin/bash
set -e

echo "🚀 DEPLOYANDO GESTOR BECKERVVISUAL A PRODUCCIÓN"
echo ""
echo "=== PASO 1: Autenticación ==="
echo ""
echo "1.1 Auténtica en Heroku:"
npx heroku login

echo ""
echo "1.2 Auténtica en Vercel:"
npx vercel login

echo ""
echo "=== PASO 2: Backend - Heroku ==="
echo ""
read -p "Ingresa el nombre de la app Heroku (ej: gestor-becker-api): " HEROKU_APP
echo "📍 Creando app Heroku: $HEROKU_APP"

cd backend

# Crear app en Heroku
npx heroku create $HEROKU_APP --remote heroku-prod

# Agregar PostgreSQL
echo "📦 Agregando PostgreSQL..."
npx heroku addons:create heroku-postgresql:hobby-dev --app=$HEROKU_APP

# Configurar variables de entorno
echo "🔑 Configurando variables de entorno..."

# Generar JWT secrets seguros
JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
JWT_REFRESH_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")

npx heroku config:set \
  NODE_ENV="production" \
  JWT_SECRET="$JWT_SECRET" \
  JWT_REFRESH_SECRET="$JWT_REFRESH_SECRET" \
  JWT_EXPIRATION="15m" \
  JWT_REFRESH_EXPIRATION="7d" \
  AFIP_ENV="homologacion" \
  AFIP_CUIT="20123456789" \
  SMTP_HOST="smtp.gmail.com" \
  SMTP_PORT="587" \
  SMTP_USER="noreply@gestorbecker.com" \
  SMTP_PASS="your-app-password" \
  CORS_ORIGIN="https://${VERCEL_APP}.vercel.app" \
  LOG_LEVEL="info" \
  --app=$HEROKU_APP

echo "✅ Variables configuradas en Heroku"

# Hacer git push
echo "📤 Haciendo push a Heroku..."
git push heroku-prod master || git push heroku-prod main

echo "✅ Backend deployado!"
echo "📍 URL: https://${HEROKU_APP}.herokuapp.com"

cd ..

echo ""
echo "=== PASO 3: Frontend - Vercel ==="
echo ""
read -p "Ingresa el nombre del proyecto Vercel (ej: gestor-becker): " VERCEL_APP

cd frontend

# Deploy a Vercel
npx vercel --prod --name $VERCEL_APP

# Setear variables de entorno
npx vercel env add VITE_API_URL https://${HEROKU_APP}.herokuapp.com/api --prod

echo "✅ Frontend deployado!"
echo "📍 URL: https://${VERCEL_APP}.vercel.app"

echo ""
echo "=== RESUMEN ==="
echo ""
echo "✅ Backend (Heroku): https://${HEROKU_APP}.herokuapp.com"
echo "✅ Frontend (Vercel): https://${VERCEL_APP}.vercel.app"
echo ""
echo "🔑 Credenciales de test:"
echo "   Email: e2etest@test.com"
echo "   Password: test123"
echo ""
echo "📚 Siguientes pasos:"
echo "   1. Cambiar credenciales SMTP (Google App Password)"
echo "   2. Cambiar JWT_SECRET en Heroku (ya está randomizado)"
echo "   3. Actualizar AFIP a certificado real cuando esté listo"
echo ""
echo "¡Sistema en producción! 🚀"
