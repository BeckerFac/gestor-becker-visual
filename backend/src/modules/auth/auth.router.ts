import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { authController } from './auth.controller';
import { authMiddleware } from '../../middlewares/auth';

const customerLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // max 10 attempts per IP
  message: { error: 'Demasiados intentos. Intenta de nuevo en 15 minutos.' },
  standardHeaders: true,
  legacyHeaders: false,
});

export const authRouter = Router();

authRouter.post('/register', (req, res) => authController.register(req, res));
authRouter.post('/login', (req, res) => authController.login(req, res));
authRouter.post('/refresh', (req, res) => authController.refreshToken(req, res));
authRouter.post('/customer-login', customerLoginLimiter, (req, res) => authController.customerLogin(req, res));
authRouter.post('/logout', authMiddleware, (req, res) => authController.logout(req, res));
authRouter.get('/me', authMiddleware, (req, res) => authController.getMe(req, res));

// Email verification (public - clicked from email)
authRouter.get('/verify-email/:token', (req, res) => authController.verifyEmail(req, res));

// Password reset (public)
authRouter.post('/forgot-password', (req, res) => authController.requestPasswordReset(req, res));
authRouter.post('/reset-password', (req, res) => authController.resetPassword(req, res));

// Resend verification (authenticated)
authRouter.post('/resend-verification', authMiddleware, (req, res) => authController.resendVerification(req, res));
