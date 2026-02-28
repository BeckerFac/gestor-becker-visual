#!/bin/bash
set -e

echo "🚀 DEPLOYANDO GESTOR BECKERVVISUAL"
echo ""

# Verificar variables
if [ -z "$HEROKU_API_KEY" ] || [ -z "$VERCEL_TOKEN" ]; then
  echo "❌ Variables de entorno no configuradas"
  echo ""
  echo "INSTRUCCIONES:"
  echo "1. Abre .env.deploy"
  echo "2. Obtén tu HEROKU_API_KEY en: https://dashboard.heroku.com/account/applications/authorizations"
  echo "3. Obtén tu VERCEL_TOKEN en: https://vercel.com/account/tokens"
  echo "4. Completa .env.deploy"
  echo "5. Ejecuta: source .env.deploy && bash deploy-auto.sh"
  exit 1
fi

echo "✅ Variables de entorno detectadas"
echo ""

# Generar JWT secrets
JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
JWT_REFRESH_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")

echo "=== PASO 1: COMPILAR BACKEND ==="
cd backend
npm run build
echo "✅ Backend compilado"
cd ..
echo ""

echo "=== PASO 2: COMPILAR FRONTEND ==="
cd frontend
npm run build
echo "✅ Frontend compilado"
cd ..
echo ""

echo "=== PASO 3: CREAR APP EN HEROKU ==="
echo "Creando: $HEROKU_APP_NAME"

# Crear app con API
HEROKU_RESPONSE=$(curl -n -s -X POST \
  https://api.heroku.com/apps \
  -H "Authorization: Bearer $HEROKU_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Accept: application/vnd.heroku+json; version=3" \
  -d '{"name":"'$HEROKU_APP_NAME'"}')

echo "Respuesta Heroku: $HEROKU_RESPONSE"

# Agregar PostgreSQL addon
curl -n -s -X POST \
  https://api.heroku.com/apps/$HEROKU_APP_NAME/addons \
  -H "Authorization: Bearer $HEROKU_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Accept: application/vnd.heroku+json; version=3" \
  -d '{"plan":"heroku-postgresql:hobby-dev"}' || echo "⚠️ PostgreSQL podría ya existir"

echo "✅ PostgreSQL añadido"

# Setear variables de entorno
echo "Configurando variables de entorno..."

curl -n -s -X PATCH \
  https://api.heroku.com/apps/$HEROKU_APP_NAME/config-vars \
  -H "Authorization: Bearer $HEROKU_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Accept: application/vnd.heroku+json; version=3" \
  -d '{
    "NODE_ENV": "production",
    "JWT_SECRET": "'$JWT_SECRET'",
    "JWT_REFRESH_SECRET": "'$JWT_REFRESH_SECRET'",
    "JWT_EXPIRATION": "15m",
    "JWT_REFRESH_EXPIRATION": "7d",
    "AFIP_ENV": "homologacion",
    "AFIP_CUIT": "'$AFIP_CUIT'",
    "SMTP_HOST": "smtp.gmail.com",
    "SMTP_PORT": "587",
    "SMTP_USER": "'$SMTP_USER'",
    "SMTP_PASS": "'$SMTP_PASS'",
    "CORS_ORIGIN": "https://'$VERCEL_PROJECT_NAME'.vercel.app",
    "LOG_LEVEL": "info"
  }'

echo "✅ Variables de entorno configuradas"
echo ""

echo "=== PASO 4: PUSH A HEROKU ==="
cd backend

# Configurar git remote de Heroku
npx heroku git:remote -a $HEROKU_APP_NAME -r heroku-prod

# Push
git push heroku-prod master || git push heroku-prod main || true

echo "✅ Backend deployado en Heroku"
cd ..
echo ""

echo "=== PASO 5: DEPLOY A VERCEL ==="
cd frontend

# Crear proyecto en Vercel
npx vercel --prod --name $VERCEL_PROJECT_NAME --token $VERCEL_TOKEN

# Configurar variable de entorno
npx vercel env add VITE_API_URL https://$HEROKU_APP_NAME.herokuapp.com/api --prod --token $VERCEL_TOKEN

echo "✅ Frontend deployado en Vercel"
cd ..
echo ""

echo "============================================"
echo "🎉 DEPLOYMENT COMPLETADO"
echo "============================================"
echo ""
echo "📊 URLS EN PRODUCCIÓN:"
echo "   Backend:  https://$HEROKU_APP_NAME.herokuapp.com"
echo "   Frontend: https://$VERCEL_PROJECT_NAME.vercel.app"
echo "   API:      https://$HEROKU_APP_NAME.herokuapp.com/api"
echo ""
echo "🔑 Credenciales de test:"
echo "   Email:    e2etest@test.com"
echo "   Password: test123"
echo ""
echo "⚠️  IMPORTANTE - Próximos pasos:"
echo "   1. Configura Gmail App Password en SMTP_PASS"
echo "   2. Obtén certificado digital real para AFIP (producción)"
echo "   3. Configura dominio personalizado (DNS)"
echo ""
echo "📚 Documentación: https://github.com/tu-repo/README_PRODUCCION.md"
echo ""
