import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { db } from '../../config/db';
import { users, sessions, companies } from '../../db/schema';
import { env } from '../../config/env';
import { eq, sql } from 'drizzle-orm';
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
      };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(401, 'Token refresh failed');
    }
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
