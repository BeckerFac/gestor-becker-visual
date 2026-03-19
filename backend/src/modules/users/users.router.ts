import { Router } from 'express';
import { usersController } from './users.controller';
import { authorize, requireRole, requireMinRole } from '../../middlewares/authorize';

export const usersRouter = Router();

usersRouter.get('/', authorize('users', 'view'), (req, res) => usersController.getUsers(req, res));
usersRouter.get('/:id', authorize('users', 'view'), (req, res) => usersController.getUser(req, res));
usersRouter.post('/', authorize('users', 'create'), (req, res) => usersController.createUser(req, res));
usersRouter.put('/:id', authorize('users', 'edit'), (req, res) => usersController.updateUser(req, res));
usersRouter.delete('/:id', authorize('users', 'delete'), (req, res) => usersController.deleteUser(req, res));
usersRouter.get('/:id/permissions', authorize('users', 'view'), (req, res) => usersController.getUserPermissions(req, res));
usersRouter.put('/:id/permissions', authorize('users', 'edit'), (req, res) => usersController.setUserPermissions(req, res));
usersRouter.post('/:id/apply-template', authorize('users', 'edit'), (req, res) => usersController.applyTemplate(req, res));
usersRouter.post('/:id/reset-password', authorize('users', 'edit'), (req, res) => usersController.resetPassword(req, res));

// Transfer ownership (owner only)
usersRouter.post('/transfer-ownership', requireRole('owner'), (req, res) => usersController.transferOwnership(req, res));

// Session management (admin/owner only)
usersRouter.get('/:id/sessions', requireMinRole('admin'), (req, res) => usersController.getUserSessions(req, res));
usersRouter.delete('/:id/sessions/:sessionId', requireMinRole('admin'), (req, res) => usersController.revokeSession(req, res));
usersRouter.post('/:id/revoke-all-sessions', requireMinRole('admin'), (req, res) => usersController.revokeAllSessions(req, res));
