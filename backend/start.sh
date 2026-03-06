#!/bin/sh
echo "Running drizzle-kit push:pg to sync database schema..."
npx drizzle-kit push:pg \
  --schema=./src/db/schema.ts \
  --driver=pg \
  --connectionString="$DATABASE_URL" \
  2>&1 || echo "Warning: drizzle-kit push had issues, continuing..."
echo "Starting application..."
exec node dist/index.js
