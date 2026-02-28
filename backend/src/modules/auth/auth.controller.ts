import { Request, Response } from 'express';
import { authService } from './auth.service';
import { AuthRequest } from '../../middlewares/auth';
import { ApiError } from '../../middlewares/errorHandler';

export class AuthController {
  async register(req: Request, res: Response) {
    try {
      const { email, password, name, company_name, cuit } = req.body;

      if (!email || !password || !name || !company_name || !cuit) {
        throw new ApiError(400, 'Missing required fields');
      }

      const result = await authService.register(email, password, name, company_name, cuit);

      res.status(201).json({
        message: 'Registration successful',
        ...result,
      });
    } catch (error) {
      if (error instanceof ApiError) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      res.status(500).json({ error: 'Registration failed' });
    }
  }

  async login(req: Request, res: Response) {
    try {
      const { email, password } = req.body;

      if (!email || !password) {
        throw new ApiError(400, 'Email and password required');
      }

      const result = await authService.login(email, password);

      res.json({
        message: 'Login successful',
        ...result,
      });
    } catch (error) {
      if (error instanceof ApiError) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      res.status(500).json({ error: 'Login failed' });
    }
  }

  async refreshToken(req: AuthRequest, res: Response) {
    try {
      const { refreshToken } = req.body;

      if (!refreshToken || !req.user?.id) {
        throw new ApiError(400, 'Refresh token and user ID required');
      }

      const tokens = await authService.refreshToken(req.user.id, refreshToken);

      res.json({
        message: 'Token refreshed',
        ...tokens,
      });
    } catch (error) {
      if (error instanceof ApiError) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      res.status(500).json({ error: 'Token refresh failed' });
    }
  }

  logout(req: Request, res: Response) {
    // JWT is stateless, so logout just returns success
    res.json({ message: 'Logout successful' });
  }

  async getMe(req: AuthRequest, res: Response) {
    try {
      if (!req.user) {
        throw new ApiError(401, 'Not authenticated');
      }

      res.json({
        user: req.user,
      });
    } catch (error) {
      if (error instanceof ApiError) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      res.status(500).json({ error: 'Failed to get user info' });
    }
  }
}

export const authController = new AuthController();
