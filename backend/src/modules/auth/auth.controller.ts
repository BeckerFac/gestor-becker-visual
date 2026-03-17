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

      if (!password || password.length < 8) {
        throw new ApiError(400, 'La contrasena debe tener al menos 8 caracteres');
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
      console.error('Login error:', error);
      if (error instanceof ApiError) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      res.status(500).json({ error: 'Login failed' });
    }
  }

  async refreshToken(req: Request, res: Response) {
    try {
      const { refreshToken } = req.body;

      if (!refreshToken) {
        throw new ApiError(400, 'Refresh token required');
      }

      const tokens = await authService.refreshTokenDirect(refreshToken);

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

  async customerLogin(req: Request, res: Response) {
    try {
      const { access_code } = req.body;

      if (!access_code) {
        throw new ApiError(400, 'Código de acceso requerido');
      }

      const result = await authService.customerLogin(access_code);
      res.json({ message: 'Login successful', ...result });
    } catch (error) {
      if (error instanceof ApiError) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      res.status(500).json({ error: 'Customer login failed' });
    }
  }

  async logout(req: AuthRequest, res: Response) {
    try {
      const userId = req.user?.id;
      const refreshToken = req.body?.refreshToken;

      if (userId) {
        await authService.logout(userId, refreshToken);
      }

      res.json({ message: 'Logout successful' });
    } catch (error) {
      if (error instanceof ApiError) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      res.status(500).json({ error: 'Logout failed' });
    }
  }

  async getMe(req: AuthRequest, res: Response) {
    try {
      if (!req.user) {
        throw new ApiError(401, 'Not authenticated');
      }

      const result = await authService.me(req.user.id);

      res.json({
        user: result,
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
