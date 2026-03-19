import { Response } from 'express';
import { AuthRequest } from '../../middlewares/auth';
import { apiKeysService, ApiKeyScope } from './apikeys.service';
import { ApiError } from '../../middlewares/errorHandler';
import { getClientIp } from '../../middlewares/security';

export class ApiKeysController {
  async create(req: AuthRequest, res: Response) {
    try {
      if (!req.user) {
        throw new ApiError(401, 'No autenticado');
      }

      const { name, scope } = req.body;
      if (!name) {
        throw new ApiError(400, 'Nombre requerido');
      }

      const validScope: ApiKeyScope = scope === 'full' ? 'full' : 'read';
      const ip = getClientIp(req);

      const result = await apiKeysService.createApiKey(
        req.user.company_id,
        name,
        validScope,
        req.user.id,
        ip,
      );

      res.status(201).json({
        message: 'API key creada. Guarde la key, no se mostrara de nuevo.',
        ...result,
      });
    } catch (error) {
      if (error instanceof ApiError) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      res.status(500).json({ error: 'Error al crear API key' });
    }
  }

  async list(req: AuthRequest, res: Response) {
    try {
      if (!req.user) {
        throw new ApiError(401, 'No autenticado');
      }

      const keys = await apiKeysService.listApiKeys(req.user.company_id);
      res.json({ api_keys: keys });
    } catch (error) {
      if (error instanceof ApiError) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      res.status(500).json({ error: 'Error al listar API keys' });
    }
  }

  async revoke(req: AuthRequest, res: Response) {
    try {
      if (!req.user) {
        throw new ApiError(401, 'No autenticado');
      }

      const { id } = req.params;
      if (!id) {
        throw new ApiError(400, 'API key ID requerido');
      }

      const ip = getClientIp(req);
      const result = await apiKeysService.revokeApiKey(
        req.user.company_id,
        id,
        req.user.id,
        ip,
      );

      res.json(result);
    } catch (error) {
      if (error instanceof ApiError) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      res.status(500).json({ error: 'Error al revocar API key' });
    }
  }
}

export const apiKeysController = new ApiKeysController();
