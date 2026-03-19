import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { db } from '../../config/db';
import { users, sessions, companies } from '../../db/schema';
import { env } from '../../config/env';
import { eq, and, sql } from 'drizzle-orm';
import { ApiError } from '../../middlewares/errorHandler';

export class AuthService {
  async getUserPermissions(userId: string): Promise<Record<string, string[]> | null> {
    const result = await db.execute(sql`
      SELECT module, action FROM permissions WHERE user_id = ${userId} AND allowed = true
    `);
    const rows = (result as any).rows || result || [];
    if (rows.length === 0) return null;
    const perms: Record<string, string[]> = {};
    for (const row of rows) {
      const r = row as { module: string; action: string };
      if (!perms[r.module]) perms[r.module] = [];
      perms[r.module].push(r.action);
    }
    return perms;
  }

  async register(email: string, password: string, name: string, company_name: string, cuit: string) {
    try {
      // Check if user exists
      const existingUser = await db.query.users.findFirst({
        where: eq(users.email, email),
      });

      if (existingUser) {
        throw new ApiError(409, 'Email already registered');
      }

      // Create company
      const company = await db.insert(companies).values({
        name: company_name,
        cuit,
      }).returning();

      if (!company[0]) {
        throw new ApiError(500, 'Failed to create company');
      }

      // Hash password
      const hashedPassword = await bcrypt.hash(password, 10);

      // Create user
      const user = await db.insert(users).values({
        company_id: company[0].id,
        email,
        password_hash: hashedPassword,
        name,
        role: 'admin',
      }).returning({
        id: users.id,
        email: users.email,
        name: users.name,
        role: users.role,
      });

      if (!user[0]) {
        throw new ApiError(500, 'Failed to create user');
      }

      // Generate tokens
      const tokens = this.generateTokens(user[0].id, email, company[0].id, user[0].role!);

      // Store refresh token in sessions table
      await this.storeSession(user[0].id, tokens.refreshToken);

      return {
        user: {
          id: user[0].id,
          email: user[0].email,
          name: user[0].name,
          role: user[0].role,
          company_id: company[0].id,
        },
        company: {
          id: company[0].id,
          name: company[0].name,
          cuit: company[0].cuit,
        },
        ...tokens,
      };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Registration failed');
    }
  }

  async login(email: string, password: string) {
    try {
      const user = await db.query.users.findFirst({
        where: eq(users.email, email),
      });

      if (!user) {
        throw new ApiError(401, 'Invalid credentials');
      }

      const passwordMatch = await bcrypt.compare(password, user.password_hash);
      if (!passwordMatch) {
        throw new ApiError(401, 'Invalid credentials');
      }

      // Update last login
      await db.update(users).set({ last_login: new Date() }).where(eq(users.id, user.id));

      // Get company info
      const company = await db.query.companies.findFirst({
        where: eq(companies.id, user.company_id),
      });

      // Generate tokens
      const tokens = this.generateTokens(user.id, user.email, user.company_id, user.role!);

      // Store refresh token in sessions table
      await this.storeSession(user.id, tokens.refreshToken);

      // Load permissions for non-admin users
      const permissions = user.role === 'admin' ? null : await this.getUserPermissions(user.id);

      return {
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          company_id: user.company_id,
        },
        company: company ? {
          id: company.id,
          name: company.name,
          cuit: company.cuit,
        } : null,
        permissions,
        ...tokens,
      };
    } catch (error) {
      console.error('Auth service login - actual error:', error);
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Login failed');
    }
  }

  async refreshToken(userId: string, refreshToken: string) {
    try {
      // Verify refresh token
      const decoded = jwt.verify(refreshToken, env.JWT_REFRESH_SECRET) as {
        id: string;
      };

      if (decoded.id !== userId) {
        throw new ApiError(401, 'Invalid refresh token');
      }

      const user = await db.query.users.findFirst({
        where: eq(users.id, userId),
      });

      if (!user) {
        throw new ApiError(404, 'User not found');
      }

      const tokens = this.generateTokens(user.id, user.email, user.company_id, user.role!);

      return tokens;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(401, 'Token refresh failed');
    }
  }

  async refreshTokenDirect(refreshToken: string) {
    try {
      const decoded = jwt.verify(refreshToken, env.JWT_REFRESH_SECRET) as {
        id: string;
      };

      // Verify refresh token exists in sessions table
      const sessionResult = await db.select().from(sessions).where(eq(sessions.refresh_token, refreshToken));
      if (sessionResult.length === 0) {
        throw new ApiError(401, 'Refresh token has been revoked');
      }

      const user = await db.query.users.findFirst({
        where: eq(users.id, decoded.id),
      });

      if (!user) {
        throw new ApiError(404, 'User not found');
      }

      const company = await db.query.companies.findFirst({
        where: eq(companies.id, user.company_id),
      });

      const tokens = this.generateTokens(user.id, user.email, user.company_id, user.role!);

      // Replace old session with new refresh token
      await db.delete(sessions).where(eq(sessions.refresh_token, refreshToken));
      await this.storeSession(user.id, tokens.refreshToken);

      // Load permissions for non-admin users
      const permissions = user.role === 'admin' ? null : await this.getUserPermissions(user.id);

      return {
        ...tokens,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          company_id: user.company_id,
        },
        company: company ? {
          id: company.id,
          name: company.name,
          cuit: company.cuit,
        } : null,
        permissions,
      };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(401, 'Token refresh failed');
    }
  }

  async me(userId: string) {
    const result = await db.execute(sql`
      SELECT u.id, u.email, u.name, u.role, u.company_id, u.active,
             c.onboarding_completed, c.enabled_modules
      FROM users u
      JOIN companies c ON c.id = u.company_id
      WHERE u.id = ${userId}
    `);
    const rows = (result as any).rows || result || [];
    if (rows.length === 0) {
      throw new ApiError(404, 'User not found');
    }
    const user = rows[0] as {
      id: string; email: string; name: string; role: string; company_id: string; active: boolean;
      onboarding_completed: boolean; enabled_modules: string[];
    };
    if (user.active === false) {
      throw new ApiError(403, 'User deactivated');
    }
    const permissions = user.role === 'admin' ? null : await this.getUserPermissions(userId);
    return { ...user, permissions };
  }

  async customerLogin(accessCode: string) {
    try {
      const result = await db.execute(sql`
        SELECT c.*, comp.name as company_name, comp.cuit as company_cuit
        FROM customers c
        JOIN companies comp ON c.company_id = comp.id
        WHERE c.access_code = ${accessCode} AND c.status = 'active'
        LIMIT 1
      `);
      const rows = (result as any).rows || result || [];

      if (rows.length === 0) {
        throw new ApiError(401, 'Código de acceso inválido');
      }

      const customer = rows[0];

      const accessToken = jwt.sign(
        { id: customer.id, role: 'customer', company_id: customer.company_id, customer_id: customer.id },
        env.JWT_SECRET,
        { expiresIn: '24h' } as any
      );

      const refreshTokenJwt = jwt.sign(
        { id: customer.id, role: 'customer' },
        env.JWT_REFRESH_SECRET,
        { expiresIn: '30d' } as any
      );

      return {
        customer: {
          id: customer.id,
          name: customer.name,
          cuit: customer.cuit,
          email: customer.email,
          phone: customer.phone,
        },
        company: {
          name: customer.company_name,
          cuit: customer.company_cuit,
        },
        accessToken,
        refreshToken: refreshTokenJwt,
      };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Customer login failed');
    }
  }

  private async storeSession(userId: string, refreshToken: string) {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // 7 days matching JWT_REFRESH_EXPIRATION
    await db.insert(sessions).values({
      user_id: userId,
      refresh_token: refreshToken,
      expires_at: expiresAt,
    });
  }

  async logout(userId: string, refreshToken: string) {
    if (refreshToken) {
      await db.delete(sessions).where(
        and(eq(sessions.user_id, userId), eq(sessions.refresh_token, refreshToken))
      );
    }
  }

  async logoutAll(userId: string) {
    await db.delete(sessions).where(eq(sessions.user_id, userId));
  }

  private generateTokens(userId: string, email: string, companyId: string, role: string) {
    const accessToken = jwt.sign(
      { id: userId, email, company_id: companyId, role },
      env.JWT_SECRET,
      { expiresIn: env.JWT_EXPIRATION } as any
    );

    const refreshToken = jwt.sign(
      { id: userId },
      env.JWT_REFRESH_SECRET,
      { expiresIn: env.JWT_REFRESH_EXPIRATION } as any
    );

    return {
      accessToken,
      refreshToken,
      expiresIn: env.JWT_EXPIRATION,
    };
  }
}

export const authService = new AuthService();
