import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { db } from '../../config/db';
import { users, sessions, companies } from '../../db/schema';
import { env } from '../../config/env';
import { eq } from 'drizzle-orm';
import { ApiError } from '../../middlewares/errorHandler';

export class AuthService {
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

      return {
        user: user[0],
        company: company[0],
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

      // Generate tokens
      const tokens = this.generateTokens(user.id, user.email, user.company_id, user.role!);

      return {
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          company_id: user.company_id,
        },
        ...tokens,
      };
    } catch (error) {
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
