# Gestor BeckerVisual - Guía de Deployment

## Local Development

### Requisitos
- Node.js 18+
- PostgreSQL 13+
- Docker (opcional, para BD)

### Setup

**1. Backend**
```bash
cd backend
npm install
npm run build
npm start
# http://localhost:3000
```

**2. Frontend**
```bash
cd frontend
npm install
npm run dev
# http://localhost:5173
```

**3. Database**
```bash
# Con Docker:
docker-compose up -d postgres

# SQL Connection:
# User: gestor_user
# Pass: gestor_password_dev
# DB: gestor_becker
# Host: localhost:5432
```

## Testing

```bash
# Backend
cd backend
npm test

# Frontend
cd frontend
npm test
```

## Production

### Build

```bash
cd backend && npm run build
cd frontend && npm run build
```

### Deploy

```bash
# Backend to AWS ECS / Heroku
git push heroku main

# Frontend to Vercel / Netlify
vercel deploy
```

## API Documentation

### Auth
- `POST /api/auth/register` - Register user
- `POST /api/auth/login` - Login (returns JWT)
- `GET /api/auth/me` - Get current user

### Products
- `GET /api/products` - List products
- `POST /api/products` - Create
- `GET /api/products/{id}` - Get single
- `PUT /api/products/{id}` - Update
- `DELETE /api/products/{id}` - Delete

### Customers
- `GET /api/customers` - List
- `POST /api/customers` - Create
- `GET /api/customers/{id}` - Get
- `PUT /api/customers/{id}` - Update
- `DELETE /api/customers/{id}` - Delete

### Invoices
- `GET /api/invoices` - List
- `POST /api/invoices` - Create
- `GET /api/invoices/{id}` - Get
- `POST /api/invoices/{id}/authorize` - Authorize (AFIP)

## Environment Variables

See `.env.example` for all required vars.

Key ones:
- `DATABASE_URL` - PostgreSQL connection
- `JWT_SECRET` - Secret for signing tokens
- `AFIP_CERT_PATH` - Path to AFIP certificate

## Support

For issues, see docs/ folder or create GitHub issue.
