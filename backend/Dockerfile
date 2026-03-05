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
COPY package*.json ./
RUN npm install

# Copy source and compile
COPY . .
RUN npm run build

# Remove devDependencies after build
RUN npm prune --production

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)})"

# Start application
CMD ["npm", "start"]
