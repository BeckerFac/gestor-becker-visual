import { Router } from 'express';
import { usersController } from './users.controller';
import { authorize } from '../../middlewares/authorize';

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
