## Stage 1: Build frontend
FROM node:20-alpine AS frontend-build
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ .
RUN npm run build

## Stage 2: Build and run backend (serves frontend too)
FROM node:20-alpine

# Install Chromium for Puppeteer PDF generation
RUN apk add --no-cache \
  chromium \
  nss \
  freetype \
  harfbuzz \
  ca-certificates \
  ttf-freefont \
  font-noto \
  font-noto-emoji

# Tell Puppeteer to use installed Chromium instead of downloading its own
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

WORKDIR /app

# Install ALL dependencies (need devDeps for tsc build)
COPY backend/package*.json ./
RUN npm install

# Copy source and compile
COPY backend/ .
RUN npm run build

# Copy frontend build output
COPY --from=frontend-build /app/frontend/dist ./public

# Do NOT prune devDependencies - drizzle-kit needs them at runtime for push
# RUN npm prune --production

# Expose port (Render uses PORT env var, default 10000)
EXPOSE 10000

# Health check using PORT env var
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD node -e "const p=process.env.PORT||10000;require('http').get('http://localhost:'+p+'/health', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)})"

# start.sh is already copied via COPY backend/ above
RUN chmod +x start.sh
CMD ["./start.sh"]
