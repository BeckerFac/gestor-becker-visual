import dotenv from 'dotenv';

dotenv.config();

export const env = {
  // Server
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: parseInt(process.env.PORT || '3000', 10),

  // Database
  DATABASE_URL: process.env.DATABASE_URL || 'postgresql://gestor_user:gestor_password_dev@localhost:5432/gestor_becker',

  // JWT - secure defaults (15m access, 7d refresh)
  JWT_SECRET: process.env.JWT_SECRET || '',
  JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET || '',
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
  SMTP_FROM: process.env.SMTP_FROM || 'noreply@gestorbecker.com',

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

// Validate critical secrets on import (non-fatal for test environments)
export function validateSecrets(): boolean {
  const errors: string[] = [];

  if (!env.JWT_SECRET || env.JWT_SECRET.length < 16) {
    errors.push('JWT_SECRET must be set and at least 16 characters');
  }
  if (!env.JWT_REFRESH_SECRET || env.JWT_REFRESH_SECRET.length < 16) {
    errors.push('JWT_REFRESH_SECRET must be set and at least 16 characters');
  }
  if (!env.DATABASE_URL) {
    errors.push('DATABASE_URL must be set');
  }

  // Warn about weak secrets in production
  if (isProduction) {
    if (env.JWT_SECRET.includes('test') || env.JWT_SECRET.includes('secret')) {
      errors.push('JWT_SECRET appears to be a test/default value - use a strong random secret in production');
    }
    if (!process.env.CORS_ORIGIN) {
      errors.push('CORS_ORIGIN must be set in production');
    }
    if (!env.ENCRYPTION_KEY) {
      // Warning, not fatal - encryption is optional but recommended
      console.warn('SECURITY WARNING: ENCRYPTION_KEY not set in production. Sensitive fields will be stored in plaintext.');
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
