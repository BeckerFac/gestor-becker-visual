import { Response } from 'express';
import { AuthRequest } from '../../middlewares/auth';
import { usersService } from './users.service';
import { ApiError } from '../../middlewares/errorHandler';

export class UsersController {
  async getUsers(req: AuthRequest, res: Response) {
    try {
      const users = await usersService.getUsers(req.user!.company_id);
      res.json({ users });
    } catch (error) {
      if (error instanceof ApiError) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      res.status(500).json({ error: 'Error al obtener usuarios' });
    }
  }

  async getUser(req: AuthRequest, res: Response) {
    try {
      const user = await usersService.getUser(req.user!.company_id, req.params.id);
      res.json({ user });
    } catch (error) {
      if (error instanceof ApiError) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      res.status(500).json({ error: 'Error al obtener usuario' });
    }
  }

  async createUser(req: AuthRequest, res: Response) {
    try {
      const { email, name, password, role } = req.body;

      if (!email || !name || !password || !role) {
        throw new ApiError(400, 'Faltan campos requeridos: email, name, password, role');
      }

      if (!password || password.length < 8) {
        throw new ApiError(400, 'La contrasena debe tener al menos 8 caracteres');
      }

      const user = await usersService.createUser(req.user!.company_id, { email, name, password, role });
      res.status(201).json({ user });
    } catch (error) {
      if (error instanceof ApiError) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      res.status(500).json({ error: 'Error al crear usuario' });
    }
  }

  async updateUser(req: AuthRequest, res: Response) {
    try {
      const { name, email, role, active } = req.body;
      const user = await usersService.updateUser(req.user!.company_id, req.params.id, { name, email, role, active });
      res.json({ user });
    } catch (error) {
      if (error instanceof ApiError) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      res.status(500).json({ error: 'Error al actualizar usuario' });
    }
  }

  async deleteUser(req: AuthRequest, res: Response) {
    try {
      const result = await usersService.deleteUser(req.user!.company_id, req.user!.id, req.params.id);
      res.json(result);
    } catch (error) {
      if (error instanceof ApiError) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      res.status(500).json({ error: 'Error al desactivar usuario' });
    }
  }

  async getUserPermissions(req: AuthRequest, res: Response) {
    try {
      const permissions = await usersService.getUserPermissions(req.params.id);
      res.json({ permissions });
    } catch (error) {
      if (error instanceof ApiError) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      res.status(500).json({ error: 'Error al obtener permisos' });
    }
  }

  async setUserPermissions(req: AuthRequest, res: Response) {
    try {
      const { permissions } = req.body;

      if (!permissions || typeof permissions !== 'object') {
        throw new ApiError(400, 'Se requiere un objeto de permisos');
      }

      const result = await usersService.setUserPermissions(req.user!.company_id, req.params.id, permissions);
      res.json({ permissions: result });
    } catch (error) {
      if (error instanceof ApiError) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      res.status(500).json({ error: 'Error al establecer permisos' });
    }
  }

  async applyTemplate(req: AuthRequest, res: Response) {
    try {
      const { template } = req.body;

      if (!template) {
        throw new ApiError(400, 'Se requiere el nombre del template');
      }

      const permissions = await usersService.applyTemplate(req.user!.company_id, req.params.id, template);
      res.json({ permissions });
    } catch (error) {
      if (error instanceof ApiError) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      res.status(500).json({ error: 'Error al aplicar template' });
    }
  }

  async resetPassword(req: AuthRequest, res: Response) {
    try {
      const { password } = req.body;

      if (!password) {
        throw new ApiError(400, 'Se requiere la nueva contrasena');
      }

      if (password.length < 8) {
        throw new ApiError(400, 'La contrasena debe tener al menos 8 caracteres');
      }

      const result = await usersService.resetPassword(req.user!.company_id, req.params.id, password);
      res.json(result);
    } catch (error) {
      if (error instanceof ApiError) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      res.status(500).json({ error: 'Error al resetear contrasena' });
    }
  }
}

export const usersController = new UsersController();
