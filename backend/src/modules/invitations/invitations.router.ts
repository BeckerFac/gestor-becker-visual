import { Router } from 'express';
import { invitationsController } from './invitations.controller';
import { authMiddleware } from '../../middlewares/auth';
import { requireMinRole } from '../../middlewares/authorize';

export const invitationsRouter = Router();

// Public endpoints (no auth) - for accepting invitations
invitationsRouter.get('/validate/:token', (req, res) => invitationsController.validateToken(req, res));
invitationsRouter.post('/accept/:token', (req, res) => invitationsController.acceptInvitation(req, res));

// Protected endpoints (auth + admin/owner only)
invitationsRouter.get('/', authMiddleware, requireMinRole('admin'), (req, res) => invitationsController.getInvitations(req, res));
invitationsRouter.post('/', authMiddleware, requireMinRole('admin'), (req, res) => invitationsController.createInvitation(req, res));
invitationsRouter.delete('/:id', authMiddleware, requireMinRole('admin'), (req, res) => invitationsController.cancelInvitation(req, res));
invitationsRouter.post('/:id/resend', authMiddleware, requireMinRole('admin'), (req, res) => invitationsController.resendInvitation(req, res));
