import { Router } from 'express';
import { authController } from './auth.controller';
import { authMiddleware } from '../../middlewares/auth';

export const authRouter = Router();

authRouter.post('/register', (req, res) => authController.register(req, res));
authRouter.post('/login', (req, res) => authController.login(req, res));
authRouter.post('/refresh', (req, res) => authController.refreshToken(req, res));
authRouter.post('/customer-login', (req, res) => authController.customerLogin(req, res));
authRouter.post('/logout', authMiddleware, (req, res) => authController.logout(req, res));
authRouter.get('/me', authMiddleware, (req, res) => authController.getMe(req, res));

// Email verification (public - clicked from email)
authRouter.get('/verify-email/:token', (req, res) => authController.verifyEmail(req, res));

// Password reset (public)
authRouter.post('/forgot-password', (req, res) => authController.requestPasswordReset(req, res));
authRouter.post('/reset-password', (req, res) => authController.resetPassword(req, res));

// Resend verification (authenticated)
authRouter.post('/resend-verification', authMiddleware, (req, res) => authController.resendVerification(req, res));
