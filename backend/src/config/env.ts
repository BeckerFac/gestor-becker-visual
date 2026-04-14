import dotenv from 'dotenv';

dotenv.config();

/**
 * Require an env var to be set and non-empty.
 * Throws at import time if missing (fail-fast).
 */
export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === '') {
    throw new Error(
      `Missing required env var: ${name}. Set it in Render dashboard > Environment (or your local .env).`
    );
  }
  return v;
}

/**
 * Require a secret env var with minimum length and entropy checks.
 * - In NODE_ENV=test, allows 16 chars (to keep legacy test fixtures working).
 * - In all other envs, requires >= minLength (default 32) chars.
 * - Rejects low-entropy secrets (all same char, known defaults).
 */
export function requireSecret(name: string, minLength = 32): string {
  const v = requireEnv(name);
  const testMode = process.env.NODE_ENV === 'test';
  const effectiveMin = testMode ? 16 : minLength;

  // Reject known-default/placeholder values FIRST (before length) so callers
  // get the most informative error message regardless of length.
  const KNOWN_DEFAULTS = new Set([
    'secret',
    'changeme',
    'change-me',
    'default',
    'default-secret',
    'test',
    'password',
    'tokensecret',
  ]);
  if (KNOWN_DEFAULTS.has(v.toLowerCase())) {
    throw new Error(
      `${name} is a well-known default value. Use a random string: openssl rand -base64 48`
    );
  }

  if (v.length < effectiveMin) {
    throw new Error(
      `${name} must be at least ${effectiveMin} characters long (current: ${v.length}). Generate one with: openssl rand -base64 48`
    );
  }

  // Reject single-character repeats (e.g. "xxxxxxxx...")
  if (/^(.)\1+$/.test(v)) {
    throw new Error(
      `${name} has low entropy (all identical characters). Use a random string: openssl rand -base64 48`
    );
  }

  return v;
}

export const env = {
  // Server
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: parseInt(process.env.PORT || '3000', 10),

  // Database — NO fallback: must be explicitly set.
  DATABASE_URL: requireEnv('DATABASE_URL'),

  // JWT — fail-fast: no predictable fallbacks. Must be >= 32 chars (>=16 in tests).
  JWT_SECRET: requireSecret('JWT_SECRET'),
  JWT_REFRESH_SECRET: requireSecret('JWT_REFRESH_SECRET'),
  JWT_EXPIRATION: process.env.JWT_EXPIRATION || '15m',
  JWT_REFRESH_EXPIRATION: process.env.JWT_REFRESH_EXPIRATION || '7d',

  // AFIP
  AFIP_ENV: (process.env.AFIP_ENV || 'homologacion') as 'homologacion' | 'produccion',
  AFIP_CUIT: process.env.AFIP_CUIT || '20123456789',
  AFIP_CERT_PATH: process.env.AFIP_CERT_PATH || './certs/test.pem',
  AFIP_KEY_PATH: process.env.AFIP_KEY_PATH || './certs/test.key',

  // Email - Resend (preferred) or SMTP fallback
  RESEND_API_KEY: process.env.RESEND_API_KEY || '',
  RESEND_FROM: process.env.RESEND_FROM || '',
  SMTP_HOST: process.env.SMTP_HOST || 'smtp.gmail.com',
  SMTP_PORT: parseInt(process.env.SMTP_PORT || '587', 10),
  SMTP_USER: process.env.SMTP_USER || '',
  SMTP_PASS: process.env.SMTP_PASS || '',
  SMTP_FROM: process.env.SMTP_FROM || 'noreply@gobecker.com.ar',

  // App URL (for email links)
  FRONTEND_URL: process.env.FRONTEND_URL || 'http://localhost:5173',

  // Trial
  TRIAL_DAYS: parseInt(process.env.TRIAL_DAYS || '15', 10),
  GRACE_DAYS: parseInt(process.env.GRACE_DAYS || '3', 10),

  // Logging
  LOG_LEVEL: process.env.LOG_LEVEL || 'info',

  // Rate Limiting
  RATE_LIMIT_WINDOW_MS: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10),
  RATE_LIMIT_MAX_REQUESTS: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100', 10),

  // AI (optional - features degrade gracefully if not set)
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || '',

  // SecretarIA — WhatsApp integration (optional)
  WHATSAPP_VERIFY_TOKEN: process.env.WHATSAPP_VERIFY_TOKEN || '',
  WHATSAPP_ACCESS_TOKEN: process.env.WHATSAPP_ACCESS_TOKEN || '',
  WHATSAPP_PHONE_NUMBER_ID: process.env.WHATSAPP_PHONE_NUMBER_ID || '',
  WHATSAPP_APP_SECRET: process.env.WHATSAPP_APP_SECRET || '',

  // SecretarIA — LLM & STT providers (optional)
  OPENAI_API_KEY: process.env.OPENAI_API_KEY || '',
  DEEPGRAM_API_KEY: process.env.DEEPGRAM_API_KEY || '',

  // Security
  BCRYPT_ROUNDS: parseInt(process.env.BCRYPT_ROUNDS || '12', 10),
  MAX_LOGIN_ATTEMPTS: parseInt(process.env.MAX_LOGIN_ATTEMPTS || '5', 10),
  LOGIN_LOCKOUT_MINUTES: parseInt(process.env.LOGIN_LOCKOUT_MINUTES || '15', 10),
  REQUEST_BODY_LIMIT: process.env.REQUEST_BODY_LIMIT || '2mb',
  FILE_UPLOAD_LIMIT: process.env.FILE_UPLOAD_LIMIT || '5mb',

  // Encryption (for sensitive field encryption at rest)
  // Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  ENCRYPTION_KEY: process.env.ENCRYPTION_KEY || '',
};

export const isDevelopment = env.NODE_ENV === 'development';
export const isProduction = env.NODE_ENV === 'production';

// Kept for backwards compat (index.ts calls it). Now that critical secrets
// are validated at import time via requireSecret(), this only performs the
// remaining "soft" checks (CORS_ORIGIN in prod, ENCRYPTION_KEY warning).
export function validateSecrets(): boolean {
  const errors: string[] = [];

  if (isProduction) {
    if (!process.env.CORS_ORIGIN) {
      errors.push('CORS_ORIGIN must be set in production');
    }
    if (!env.ENCRYPTION_KEY) {
      // Warning, not fatal - encryption is optional but recommended.
      console.warn(
        'SECURITY WARNING: ENCRYPTION_KEY not set in production. Sensitive fields will be stored in plaintext.'
      );
    }
  }

  if (errors.length > 0) {
    for (const err of errors) {
      console.error(`SECURITY: ${err}`);
    }
    return false;
  }

  return true;
}
