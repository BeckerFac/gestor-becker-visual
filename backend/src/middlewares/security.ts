import { Request, Response, NextFunction } from 'express';
import { env, isProduction } from '../config/env';
import { AuthRequest } from './auth';

// ============================================================
// Request Sanitization Middleware
// Trims strings and escapes basic HTML entities in request body
// ============================================================

const HTML_ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#x27;',
};

function escapeHtml(str: string): string {
  return str.replace(/[&<>"']/g, (char) => HTML_ESCAPE_MAP[char] || char);
}

function sanitizeValue(value: unknown): unknown {
  if (typeof value === 'string') {
    return escapeHtml(value.trim());
  }
  if (Array.isArray(value)) {
    return value.map(sanitizeValue);
  }
  if (value !== null && typeof value === 'object') {
    return sanitizeObject(value as Record<string, unknown>);
  }
  return value;
}

function sanitizeObject(obj: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    // Skip sanitization for password fields and base64 data
    if (key === 'password' || key === 'newPassword' || key === 'base64' || key === 'base64Data') {
      sanitized[key] = typeof value === 'string' ? value.trim() : value;
    } else {
      sanitized[key] = sanitizeValue(value);
    }
  }
  return sanitized;
}

export function requestSanitizer(req: Request, _res: Response, next: NextFunction): void {
  if (req.body && typeof req.body === 'object') {
    req.body = sanitizeObject(req.body);
  }
  next();
}

// ============================================================
// Audit Logger Middleware
// Logs all state-changing requests for security audit trail
// ============================================================

interface AuditEntry {
  timestamp: string;
  method: string;
  path: string;
  userId: string | undefined;
  companyId: string | undefined;
  ip: string | undefined;
  userAgent: string | undefined;
  statusCode?: number;
  duration?: number;
}

// In-memory ring buffer for recent audit entries (production should use a DB or log service)
const AUDIT_BUFFER_SIZE = 1000;
const auditBuffer: AuditEntry[] = [];

function addAuditEntry(entry: AuditEntry): void {
  auditBuffer.push(entry);
  if (auditBuffer.length > AUDIT_BUFFER_SIZE) {
    auditBuffer.shift();
  }
}

export function getAuditLog(): readonly AuditEntry[] {
  return auditBuffer;
}

export function auditLogger(req: Request, res: Response, next: NextFunction): void {
  const stateMethods = ['POST', 'PUT', 'PATCH', 'DELETE'];
  if (!stateMethods.includes(req.method)) {
    return next();
  }

  const start = Date.now();
  const authReq = req as AuthRequest;

  const entry: AuditEntry = {
    timestamp: new Date().toISOString(),
    method: req.method,
    path: req.path,
    userId: authReq.user?.id,
    companyId: authReq.user?.company_id,
    ip: req.ip || req.socket.remoteAddress,
    userAgent: req.get('user-agent'),
  };

  res.on('finish', () => {
    entry.statusCode = res.statusCode;
    entry.duration = Date.now() - start;
    addAuditEntry(entry);

    // Log sensitive operations
    if (req.path.includes('/auth/') || req.path.includes('/users/') || req.path.includes('/companies/')) {
      const safeLog = {
        ...entry,
        // Never log request body for auth endpoints
      };
      if (isProduction) {
        console.log(JSON.stringify({ audit: safeLog }));
      }
    }
  });

  next();
}

// ============================================================
// Suspicious Activity Detection
// Tracks failed auth attempts by IP and locks out after threshold
// ============================================================

interface LoginAttempt {
  count: number;
  lastAttempt: number;
  lockedUntil: number | null;
}

// IP-based tracking (in-memory; production should use Redis)
const loginAttempts = new Map<string, LoginAttempt>();

// Clean up old entries every 30 minutes
setInterval(() => {
  const now = Date.now();
  const cutoff = now - 60 * 60 * 1000; // 1 hour
  for (const [key, value] of loginAttempts.entries()) {
    if (value.lastAttempt < cutoff && (!value.lockedUntil || value.lockedUntil < now)) {
      loginAttempts.delete(key);
    }
  }
}, 30 * 60 * 1000);

export function getClientIp(req: Request): string {
  return (req.ip || req.socket.remoteAddress || 'unknown').replace('::ffff:', '');
}

export function recordFailedLogin(ip: string): void {
  const existing = loginAttempts.get(ip) || { count: 0, lastAttempt: 0, lockedUntil: null };
  existing.count += 1;
  existing.lastAttempt = Date.now();

  if (existing.count >= env.MAX_LOGIN_ATTEMPTS) {
    existing.lockedUntil = Date.now() + (env.LOGIN_LOCKOUT_MINUTES * 60 * 1000);
  }

  loginAttempts.set(ip, existing);
}

export function recordSuccessfulLogin(ip: string): void {
  loginAttempts.delete(ip);
}

export function isIpLocked(ip: string): { locked: boolean; remainingMinutes: number } {
  const attempt = loginAttempts.get(ip);
  if (!attempt || !attempt.lockedUntil) {
    return { locked: false, remainingMinutes: 0 };
  }

  const now = Date.now();
  if (attempt.lockedUntil > now) {
    const remainingMs = attempt.lockedUntil - now;
    return { locked: true, remainingMinutes: Math.ceil(remainingMs / 60000) };
  }

  // Lock expired, reset
  loginAttempts.delete(ip);
  return { locked: false, remainingMinutes: 0 };
}

export function getRemainingAttempts(ip: string): number {
  const attempt = loginAttempts.get(ip);
  if (!attempt) return env.MAX_LOGIN_ATTEMPTS;
  return Math.max(0, env.MAX_LOGIN_ATTEMPTS - attempt.count);
}

// Middleware to check if IP is locked before auth endpoints
export function bruteForceProtection(req: Request, res: Response, next: NextFunction): void {
  const ip = getClientIp(req);
  const lockStatus = isIpLocked(ip);

  if (lockStatus.locked) {
    res.status(429).json({
      error: `Demasiados intentos fallidos. Cuenta bloqueada por ${lockStatus.remainingMinutes} minutos.`,
    });
    return;
  }

  next();
}

// ============================================================
// Security Headers (supplements helmet)
// ============================================================

export function additionalSecurityHeaders(_req: Request, res: Response, next: NextFunction): void {
  // Prevent browsers from performing MIME type sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // Prevent clickjacking
  res.setHeader('X-Frame-Options', 'DENY');
  // Control referrer information
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  // Restrict browser features
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  // Prevent XSS in older browsers
  res.setHeader('X-XSS-Protection', '1; mode=block');
  // Prevent caching of sensitive API responses
  if (_req.path.startsWith('/api/')) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');
  }
  next();
}

// ============================================================
// Password Validation Utilities
// ============================================================

export interface PasswordValidationResult {
  valid: boolean;
  errors: string[];
}

export function validatePasswordComplexity(password: string): PasswordValidationResult {
  const errors: string[] = [];

  if (password.length < 8) {
    errors.push('La contrasena debe tener al menos 8 caracteres');
  }
  if (password.length > 128) {
    errors.push('La contrasena no puede tener mas de 128 caracteres');
  }
  if (!/[A-Z]/.test(password)) {
    errors.push('La contrasena debe contener al menos una letra mayuscula');
  }
  if (!/[a-z]/.test(password)) {
    errors.push('La contrasena debe contener al menos una letra minuscula');
  }
  if (!/[0-9]/.test(password)) {
    errors.push('La contrasena debe contener al menos un numero');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

// ============================================================
// Email Validation Utility
// ============================================================

export function validateEmail(email: string): boolean {
  const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  return emailRegex.test(email) && email.length <= 254;
}

// ============================================================
// CUIT Validation Utility (Argentine tax ID)
// ============================================================

export function validateCuit(cuit: string): boolean {
  // Remove dashes
  const clean = cuit.replace(/-/g, '');
  // Must be exactly 11 digits
  return /^\d{11}$/.test(clean);
}

// ============================================================
// Request Size Guard (extra layer on top of express.json limit)
// ============================================================

export function requestSizeGuard(maxSizeBytes: number) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const contentLength = parseInt(req.get('content-length') || '0', 10);
    if (contentLength > maxSizeBytes) {
      res.status(413).json({ error: 'Request body too large' });
      return;
    }
    next();
  };
}
