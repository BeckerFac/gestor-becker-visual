import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { invitationsController } from './invitations.controller';
import { authMiddleware } from '../../middlewares/auth';
import { requireMinRole } from '../../middlewares/authorize';

export const invitationsRouter = Router();

// Rate limiter for public invitation endpoints (prevent token brute-force)
const invitationRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 attempts per 15 min per IP
  message: { error: 'Demasiados intentos. Intente de nuevo en 15 minutos.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Public endpoints (no auth) - for accepting invitations
invitationsRouter.get('/validate/:token', invitationRateLimiter, (req, res) => invitationsController.validateToken(req, res));
invitationsRouter.post('/accept/:token', invitationRateLimiter, (req, res) => invitationsController.acceptInvitation(req, res));

// Protected endpoints (auth + admin/owner only)
invitationsRouter.get('/', authMiddleware, requireMinRole('admin'), (req, res) => invitationsController.getInvitations(req, res));
invitationsRouter.post('/', authMiddleware, requireMinRole('admin'), (req, res) => invitationsController.createInvitation(req, res));
invitationsRouter.delete('/:id', authMiddleware, requireMinRole('admin'), (req, res) => invitationsController.cancelInvitation(req, res));
invitationsRouter.post('/:id/resend', authMiddleware, requireMinRole('admin'), (req, res) => invitationsController.resendInvitation(req, res));
