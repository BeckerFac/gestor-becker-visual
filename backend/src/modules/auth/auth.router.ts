import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { authController } from './auth.controller';
import { authMiddleware } from '../../middlewares/auth';

// C1: VITEST env es mas confiable que NODE_ENV
// (Render puede no tener NODE_ENV=production seteado explicitamente).
// Vitest setea VITEST=true automaticamente durante el test run.
const isTest = !!process.env.VITEST || process.env.NODE_ENV === 'test';

const customerLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // max 10 attempts per IP
  message: { error: 'Demasiados intentos. Intenta de nuevo en 15 minutos.' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => isTest,
});

// PR1-T3: rate limit para password reset (5 req/hora por IP)
const passwordResetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hora
  max: 5,
  message: { error: 'Demasiadas solicitudes de reseteo. Intenta en 1 hora.' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => isTest,
});

// PR1-T3: rate limit para registro (5 registros/hora por IP) — previene spam
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hora
  max: 5,
  message: { error: 'Demasiados registros desde esta IP. Intenta en 1 hora.' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => isTest,
});

// PR1-T3: rate limit para login standard (15 intentos / 15min por IP)
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  message: { error: 'Demasiados intentos de login. Intenta de nuevo en 15 minutos.' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => isTest,
});

// PR1-T3: rate limit para email verification (10 intentos / hora)
const verifyEmailLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: { error: 'Demasiados intentos de verificacion. Intenta en 1 hora.' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => isTest,
});

export const authRouter = Router();

authRouter.post('/register', registerLimiter, (req, res) => authController.register(req, res));
authRouter.post('/login', loginLimiter, (req, res) => authController.login(req, res));
authRouter.post('/refresh', (req, res) => authController.refreshToken(req, res));
authRouter.post('/customer-login', customerLoginLimiter, (req, res) => authController.customerLogin(req, res));
authRouter.post('/logout', authMiddleware, (req, res) => authController.logout(req, res));
authRouter.get('/me', authMiddleware, (req, res) => authController.getMe(req, res));

// Email verification (public - clicked from email)
authRouter.get('/verify-email/:token', verifyEmailLimiter, (req, res) => authController.verifyEmail(req, res));

// Password reset (public) — PR1-T3: rate limited
authRouter.post('/forgot-password', passwordResetLimiter, (req, res) => authController.requestPasswordReset(req, res));
authRouter.post('/reset-password', passwordResetLimiter, (req, res) => authController.resetPassword(req, res));

// Resend verification (authenticated)
authRouter.post('/resend-verification', authMiddleware, (req, res) => authController.resendVerification(req, res));
