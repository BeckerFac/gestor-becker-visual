import { Request, Response } from 'express';
import { authService } from './auth.service';
import { AuthRequest } from '../../middlewares/auth';
import { ApiError } from '../../middlewares/errorHandler';
import {
  getClientIp,
  recordFailedLogin,
  recordSuccessfulLogin,
  getRemainingAttempts,
  validatePasswordComplexity,
  validateCuit,
} from '../../middlewares/security';

export class AuthController {
  async register(req: Request, res: Response) {
    try {
      const { email, password, name, company_name, cuit } = req.body;

      if (!email || !password || !name || !company_name || !cuit) {
        throw new ApiError(400, 'Missing required fields');
      }

      // Password complexity validation
      const passwordCheck = validatePasswordComplexity(password);
      if (!passwordCheck.valid) {
        throw new ApiError(400, passwordCheck.errors.join('. '));
      }

      // CUIT format validation
      if (!validateCuit(cuit)) {
        throw new ApiError(400, 'Formato de CUIT invalido. Debe ser 11 digitos');
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

      const ip = getClientIp(req);

      try {
        const result = await authService.login(email, password);

        // Successful login - clear failed attempts
        recordSuccessfulLogin(ip);

        res.json({
          message: 'Login successful',
          ...result,
        });
      } catch (authError) {
        // Failed login - record attempt
        if (authError instanceof ApiError && authError.statusCode === 401) {
          recordFailedLogin(ip);
          const remaining = getRemainingAttempts(ip);
          if (remaining > 0 && remaining <= 3) {
            return res.status(401).json({
              error: 'Invalid credentials',
              remainingAttempts: remaining,
            });
          }
        }
        throw authError;
      }
    } catch (error) {
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

      // Basic format validation
      if (typeof refreshToken !== 'string' || refreshToken.length > 2048) {
        throw new ApiError(400, 'Invalid refresh token format');
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
        throw new ApiError(400, 'Codigo de acceso requerido');
      }

      // Validate access code format (basic length check)
      if (typeof access_code !== 'string' || access_code.length < 6 || access_code.length > 64) {
        throw new ApiError(400, 'Formato de codigo de acceso invalido');
      }

      const ip = getClientIp(req);

      try {
        const result = await authService.customerLogin(access_code);
        recordSuccessfulLogin(ip);
        res.json({ message: 'Login successful', ...result });
      } catch (authError) {
        if (authError instanceof ApiError && authError.statusCode === 401) {
          recordFailedLogin(ip);
        }
        throw authError;
      }
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
  async verifyEmail(req: Request, res: Response) {
    try {
      const { token } = req.params;
      if (!token) {
        throw new ApiError(400, 'Token requerido');
      }
      const result = await authService.verifyEmail(token);
      res.json(result);
    } catch (error) {
      if (error instanceof ApiError) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      res.status(500).json({ error: 'Error al verificar email' });
    }
  }

  async requestPasswordReset(req: Request, res: Response) {
    try {
      const { email } = req.body;
      if (!email) {
        throw new ApiError(400, 'Email requerido');
      }
      const result = await authService.requestPasswordReset(email);
      res.json(result);
    } catch (error) {
      if (error instanceof ApiError) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      // Always return 200 to prevent user enumeration
      res.json({ message: 'Si el email existe, recibiras un enlace para restablecer tu contrasena' });
    }
  }

  async resetPassword(req: Request, res: Response) {
    try {
      const { token, password } = req.body;
      if (!token || !password) {
        throw new ApiError(400, 'Token y contrasena requeridos');
      }
      const result = await authService.resetPassword(token, password);
      res.json(result);
    } catch (error) {
      if (error instanceof ApiError) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      res.status(500).json({ error: 'Error al restablecer contrasena' });
    }
  }

  async resendVerification(req: AuthRequest, res: Response) {
    try {
      if (!req.user) {
        throw new ApiError(401, 'Not authenticated');
      }
      const result = await authService.resendVerificationEmail(req.user.id);
      res.json(result);
    } catch (error) {
      if (error instanceof ApiError) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      res.status(500).json({ error: 'Error al reenviar verificacion' });
    }
  }
}

export const authController = new AuthController();
