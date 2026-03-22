import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { db } from '../../config/db';
import { users, sessions, companies } from '../../db/schema';
import { env } from '../../config/env';
import { eq, and, sql } from 'drizzle-orm';
import { ApiError } from '../../middlewares/errorHandler';
import { validatePasswordComplexity, validateEmail } from '../../middlewares/security';
import { FULL_ACCESS_ROLES } from '../../shared/permissions.constants';
import { auditService } from '../audit/audit.service';
import { billingService } from '../billing/billing.service';
import { emailService } from '../email/email.service';

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
      // Validate email format
      if (!validateEmail(email)) {
        throw new ApiError(400, 'Formato de email invalido');
      }

      // Validate password complexity
      const passwordCheck = validatePasswordComplexity(password);
      if (!passwordCheck.valid) {
        throw new ApiError(400, passwordCheck.errors.join('. '));
      }

      // Check if user exists
      const existingUser = await db.query.users.findFirst({
        where: eq(users.email, email),
      });

      if (existingUser) {
        throw new ApiError(409, 'Email already registered');
      }

      // Check if CUIT already registered
      const existingCompany = await db.query.companies.findFirst({
        where: eq(companies.cuit, cuit),
      });
      if (existingCompany) {
        throw new ApiError(409, 'Este CUIT ya esta registrado');
      }

      // Calculate trial end date
      const trialEndsAt = new Date();
      trialEndsAt.setDate(trialEndsAt.getDate() + env.TRIAL_DAYS);

      // Create company with trial period
      const company = await db.insert(companies).values({
        name: company_name,
        cuit,
        subscription_status: 'trial',
        trial_ends_at: trialEndsAt,
      }).returning();

      if (!company[0]) {
        throw new ApiError(500, 'Failed to create company');
      }

      // Hash password with configurable rounds (default 12)
      const hashedPassword = await bcrypt.hash(password, env.BCRYPT_ROUNDS);

      // Generate email verification token
      const verificationToken = crypto.randomBytes(32).toString('hex');
      const verificationExpires = new Date();
      verificationExpires.setHours(verificationExpires.getHours() + 24);

      // Create user (company creator is always the owner)
      const user = await db.insert(users).values({
        company_id: company[0].id,
        email,
        password_hash: hashedPassword,
        name,
        role: 'owner',
        email_verified: false,
        email_verification_token: verificationToken,
        email_verification_expires: verificationExpires,
      }).returning({
        id: users.id,
        email: users.email,
        name: users.name,
        role: users.role,
      });

      if (!user[0]) {
        throw new ApiError(500, 'Failed to create user');
      }

      // Create trial subscription via billing service
      try {
        await billingService.createTrialSubscription(company[0].id);
      } catch (billingErr) {
        // Non-fatal: subscription will be auto-created on first check
        console.error('Billing trial creation non-fatal error:', billingErr);
      }

      // Generate tokens (user can use app immediately; email verification is tracked)
      const tokens = this.generateTokens(user[0].id, email, company[0].id, user[0].role!);

      // Store refresh token in sessions table
      await this.storeSession(user[0].id, tokens.refreshToken);

      // Send verification email (non-blocking, non-fatal)
      emailService.sendVerificationEmail(email, name, verificationToken).catch(err => {
        console.error('[Registration] Verification email failed (non-fatal):', err);
      });

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
        trial_ends_at: trialEndsAt.toISOString(),
        email_verification_required: true,
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
        // Constant-time comparison to prevent user enumeration timing attacks
        await bcrypt.hash('dummy-password-for-timing', 10);
        throw new ApiError(401, 'Invalid credentials');
      }

      // Check if user is active
      if (user.active === false) {
        throw new ApiError(403, 'User deactivated');
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

      // Load permissions for non-full-access users
      const permissions = FULL_ACCESS_ROLES.includes(user.role as any) ? null : await this.getUserPermissions(user.id);

      // Check superadmin flag (added via migration, not in Drizzle schema)
      const saResult = await db.execute(sql`SELECT is_superadmin FROM users WHERE id = ${user.id}`);
      const saRows = (saResult as any).rows || saResult || [];
      const is_superadmin = saRows.length > 0 ? (saRows[0].is_superadmin === true) : false;

      return {
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          company_id: user.company_id,
          is_superadmin,
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
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Login failed');
    }
  }

  async refreshToken(userId: string, refreshToken: string) {
    try {
      // Verify refresh token with algorithm restriction
      const decoded = jwt.verify(refreshToken, env.JWT_REFRESH_SECRET, {
        algorithms: ['HS256'],
      }) as {
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

      if (user.active === false) {
        throw new ApiError(403, 'User deactivated');
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
      const decoded = jwt.verify(refreshToken, env.JWT_REFRESH_SECRET, {
        algorithms: ['HS256'],
      }) as {
        id: string;
      };

      // Verify refresh token exists in sessions table (rotation check)
      const sessionResult = await db.select().from(sessions).where(eq(sessions.refresh_token, refreshToken));
      if (sessionResult.length === 0) {
        // Token was already used or revoked - possible token replay attack
        // Invalidate all sessions for this user as a precaution
        await db.delete(sessions).where(eq(sessions.user_id, decoded.id));
        throw new ApiError(401, 'Refresh token has been revoked');
      }

      const user = await db.query.users.findFirst({
        where: eq(users.id, decoded.id),
      });

      if (!user) {
        throw new ApiError(404, 'User not found');
      }

      if (user.active === false) {
        throw new ApiError(403, 'User deactivated');
      }

      const company = await db.query.companies.findFirst({
        where: eq(companies.id, user.company_id),
      });

      const tokens = this.generateTokens(user.id, user.email, user.company_id, user.role!);

      // Rotate: delete old session, store new refresh token
      await db.delete(sessions).where(eq(sessions.refresh_token, refreshToken));
      await this.storeSession(user.id, tokens.refreshToken);

      // Load permissions for non-full-access users
      const permissions = FULL_ACCESS_ROLES.includes(user.role as any) ? null : await this.getUserPermissions(user.id);

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
             u.is_superadmin, u.email_verified,
             c.onboarding_completed, c.enabled_modules,
             c.subscription_status, c.trial_ends_at, c.grace_ends_at
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
      is_superadmin: boolean; email_verified: boolean;
      onboarding_completed: boolean; enabled_modules: string[];
      subscription_status: string; trial_ends_at: string | null; grace_ends_at: string | null;
    };
    if (user.active === false) {
      throw new ApiError(403, 'User deactivated');
    }
    const permissions = FULL_ACCESS_ROLES.includes(user.role as any) ? null : await this.getUserPermissions(userId);

    // Calculate subscription days remaining
    let subscription_days_remaining: number | null = null;
    let subscription_is_read_only = false;
    const now = new Date();

    if (user.subscription_status === 'trial' && user.trial_ends_at) {
      const trialEnd = new Date(user.trial_ends_at);
      subscription_days_remaining = Math.max(0, Math.ceil((trialEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
    } else if (user.subscription_status === 'grace' && user.grace_ends_at) {
      const graceEnd = new Date(user.grace_ends_at);
      subscription_days_remaining = Math.max(0, Math.ceil((graceEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
      subscription_is_read_only = true;
    } else if (user.subscription_status === 'expired' || user.subscription_status === 'cancelled') {
      subscription_days_remaining = 0;
      subscription_is_read_only = true;
    } else if (user.subscription_status === 'active') {
      subscription_days_remaining = -1; // unlimited
    }

    return {
      ...user,
      permissions,
      subscription_days_remaining,
      subscription_is_read_only,
    };
  }

  async customerLogin(accessCode: string) {
    try {
      const result = await db.execute(sql`
        SELECT e.*, comp.name as company_name, comp.cuit as company_cuit
        FROM enterprises e
        JOIN companies comp ON e.company_id = comp.id
        WHERE e.access_code = ${accessCode} AND e.status = 'active'
        LIMIT 1
      `);
      const rows = (result as any).rows || result || [];

      if (rows.length === 0) {
        throw new ApiError(401, 'Codigo de acceso invalido');
      }

      const enterprise = rows[0];

      const accessToken = jwt.sign(
        { id: enterprise.id, role: 'customer', company_id: enterprise.company_id, enterprise_id: enterprise.id },
        env.JWT_SECRET,
        { expiresIn: '24h', algorithm: 'HS256' } as any
      );

      const refreshTokenJwt = jwt.sign(
        { id: enterprise.id, role: 'customer' },
        env.JWT_REFRESH_SECRET,
        { expiresIn: '30d', algorithm: 'HS256' } as any
      );

      return {
        enterprise: {
          id: enterprise.id,
          name: enterprise.name,
          cuit: enterprise.cuit,
        },
        company: {
          name: enterprise.company_name,
          cuit: enterprise.company_cuit,
        },
        accessToken,
        refreshToken: refreshTokenJwt,
      };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Customer login failed');
    }
  }

  async generatePortalPreviewToken(companyId: string, userId: string): Promise<string> {
    return jwt.sign(
      {
        id: userId,
        enterprise_id: '__preview__',
        company_id: companyId,
        role: 'customer_preview',
      },
      env.JWT_SECRET,
      { expiresIn: '15m', algorithm: 'HS256' } as any
    );
  }

  private async storeSession(userId: string, refreshToken: string) {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // 7 days matching JWT_REFRESH_EXPIRATION

    // Clean up expired sessions for this user
    await db.execute(sql`
      DELETE FROM sessions WHERE user_id = ${userId} AND expires_at < NOW()
    `);

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

  async verifyEmail(token: string) {
    const result = await db.execute(sql`
      SELECT id, email, email_verification_expires
      FROM users
      WHERE email_verification_token = ${token}
    `);
    const rows = (result as any).rows || result || [];
    if (rows.length === 0) {
      throw new ApiError(404, 'Token de verificacion invalido');
    }

    const user = rows[0] as { id: string; email: string; email_verification_expires: string };

    if (new Date(user.email_verification_expires) < new Date()) {
      throw new ApiError(410, 'El token de verificacion ha expirado');
    }

    await db.execute(sql`
      UPDATE users
      SET email_verified = true,
          email_verification_token = NULL,
          email_verification_expires = NULL
      WHERE id = ${user.id}
    `);

    return { message: 'Email verificado exitosamente', email: user.email };
  }

  async requestPasswordReset(email: string) {
    // Always return success to prevent user enumeration
    const user = await db.query.users.findFirst({
      where: eq(users.email, email),
    });

    if (!user) {
      // Don't reveal that email doesn't exist
      return { message: 'Si el email existe, recibiras un enlace para restablecer tu contrasena' };
    }

    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetExpires = new Date();
    resetExpires.setHours(resetExpires.getHours() + 1); // 1 hour to reset

    await db.execute(sql`
      UPDATE users
      SET password_reset_token = ${resetToken},
          password_reset_expires = ${resetExpires.toISOString()}
      WHERE id = ${user.id}
    `);

    // Send password reset email (non-blocking, non-fatal)
    emailService.sendPasswordResetEmail(email, user.name!, resetToken).catch(err => {
      console.error('[Password Reset] Email failed (non-fatal):', err);
    });

    return { message: 'Si el email existe, recibiras un enlace para restablecer tu contrasena' };
  }

  async resetPassword(token: string, newPassword: string) {
    // Validate password complexity
    const passwordCheck = validatePasswordComplexity(newPassword);
    if (!passwordCheck.valid) {
      throw new ApiError(400, passwordCheck.errors.join('. '));
    }

    const result = await db.execute(sql`
      SELECT id, email, password_reset_expires
      FROM users
      WHERE password_reset_token = ${token}
    `);
    const rows = (result as any).rows || result || [];
    if (rows.length === 0) {
      throw new ApiError(404, 'Token de restablecimiento invalido');
    }

    const user = rows[0] as { id: string; email: string; password_reset_expires: string };

    if (new Date(user.password_reset_expires) < new Date()) {
      throw new ApiError(410, 'El token de restablecimiento ha expirado');
    }

    const hashedPassword = await bcrypt.hash(newPassword, env.BCRYPT_ROUNDS);

    await db.execute(sql`
      UPDATE users
      SET password_hash = ${hashedPassword},
          password_reset_token = NULL,
          password_reset_expires = NULL
      WHERE id = ${user.id}
    `);

    // Invalidate all sessions for security
    await db.execute(sql`DELETE FROM sessions WHERE user_id = ${user.id}`);

    return { message: 'Contrasena restablecida exitosamente' };
  }

  async resendVerificationEmail(userId: string) {
    const user = await db.query.users.findFirst({
      where: eq(users.id, userId),
    });

    if (!user) {
      throw new ApiError(404, 'User not found');
    }

    if (user.email_verified) {
      throw new ApiError(400, 'El email ya esta verificado');
    }

    const verificationToken = crypto.randomBytes(32).toString('hex');
    const verificationExpires = new Date();
    verificationExpires.setHours(verificationExpires.getHours() + 24);

    await db.execute(sql`
      UPDATE users
      SET email_verification_token = ${verificationToken},
          email_verification_expires = ${verificationExpires.toISOString()}
      WHERE id = ${userId}
    `);

    // Send verification email (non-blocking, non-fatal)
    emailService.sendVerificationEmail(user.email, user.name!, verificationToken).catch(err => {
      console.error('[Verification] Resend email failed (non-fatal):', err);
    });

    return { message: 'Email de verificacion reenviado' };
  }

  private generateTokens(userId: string, email: string, companyId: string, role: string) {
    const accessToken = jwt.sign(
      { id: userId, email, company_id: companyId, role },
      env.JWT_SECRET,
      { expiresIn: env.JWT_EXPIRATION, algorithm: 'HS256' } as any
    );

    const refreshToken = jwt.sign(
      { id: userId },
      env.JWT_REFRESH_SECRET,
      { expiresIn: env.JWT_REFRESH_EXPIRATION, algorithm: 'HS256' } as any
    );

    return {
      accessToken,
      refreshToken,
      expiresIn: env.JWT_EXPIRATION,
    };
  }
}

export const authService = new AuthService();
