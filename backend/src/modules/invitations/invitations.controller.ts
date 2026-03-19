import { Request, Response } from 'express';
import { AuthRequest } from '../../middlewares/auth';
import { invitationsService } from './invitations.service';
import { ApiError } from '../../middlewares/errorHandler';

export class InvitationsController {
  async createInvitation(req: AuthRequest, res: Response) {
    try {
      const { email, role, name } = req.body;

      if (!email || !role) {
        throw new ApiError(400, 'Se requiere email y rol');
      }

      const result = await invitationsService.createInvitation(
        req.user!.company_id,
        req.user!.id,
        { email, role, name },
        req.ip || undefined,
      );
      res.status(201).json(result);
    } catch (error) {
      if (error instanceof ApiError) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      res.status(500).json({ error: 'Error al crear invitacion' });
    }
  }

  async getInvitations(req: AuthRequest, res: Response) {
    try {
      const invitations = await invitationsService.getInvitations(req.user!.company_id);
      res.json({ invitations });
    } catch (error) {
      if (error instanceof ApiError) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      res.status(500).json({ error: 'Error al obtener invitaciones' });
    }
  }

  async cancelInvitation(req: AuthRequest, res: Response) {
    try {
      const result = await invitationsService.cancelInvitation(
        req.user!.company_id,
        req.params.id,
        req.user!.id,
        req.ip || undefined,
      );
      res.json(result);
    } catch (error) {
      if (error instanceof ApiError) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      res.status(500).json({ error: 'Error al cancelar invitacion' });
    }
  }

  async resendInvitation(req: AuthRequest, res: Response) {
    try {
      const result = await invitationsService.resendInvitation(
        req.user!.company_id,
        req.params.id,
      );
      res.json(result);
    } catch (error) {
      if (error instanceof ApiError) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      res.status(500).json({ error: 'Error al reenviar invitacion' });
    }
  }

  // Public endpoints (no auth required)
  async validateToken(req: Request, res: Response) {
    try {
      const { token } = req.params;
      if (!token) {
        throw new ApiError(400, 'Token requerido');
      }
      const result = await invitationsService.validateToken(token);
      res.json(result);
    } catch (error) {
      if (error instanceof ApiError) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      res.status(500).json({ error: 'Error al validar invitacion' });
    }
  }

  async acceptInvitation(req: Request, res: Response) {
    try {
      const { token } = req.params;
      const { name, password } = req.body;

      if (!token || !password) {
        throw new ApiError(400, 'Se requiere token y contrasena');
      }

      const result = await invitationsService.acceptInvitation(token, { name, password });
      res.status(201).json(result);
    } catch (error) {
      if (error instanceof ApiError) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      res.status(500).json({ error: 'Error al aceptar invitacion' });
    }
  }
}

export const invitationsController = new InvitationsController();
