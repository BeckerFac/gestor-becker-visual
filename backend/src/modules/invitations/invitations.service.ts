import { db } from '../../config/db';
import { sql } from 'drizzle-orm';
import { ApiError } from '../../middlewares/errorHandler';
import { v4 as uuid } from 'uuid';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { ROLE_TEMPLATES } from '../../shared/permissions.constants';
import { auditService } from '../audit/audit.service';
import { emailService } from '../email/email.service';
import { env } from '../../config/env';
import { validatePasswordComplexity } from '../../middlewares/security';

export class InvitationsService {
  async createInvitation(companyId: string, invitedBy: string, data: {
    email: string;
    role: string;
    name?: string;
  }, ipAddress?: string) {
    // Check email not already registered in this company
    const existing = await db.execute(sql`
      SELECT id FROM users WHERE email = ${data.email} AND company_id = ${companyId}
    `);
    const existingRows = (existing as any).rows || existing || [];
    if (existingRows.length > 0) {
      throw new ApiError(409, 'Este email ya esta registrado en la empresa');
    }

    // Check no pending invitation for this email
    const pendingCheck = await db.execute(sql`
      SELECT id FROM pending_invitations
      WHERE email = ${data.email} AND company_id = ${companyId} AND status = 'pending'
    `);
    const pendingRows = (pendingCheck as any).rows || pendingCheck || [];
    if (pendingRows.length > 0) {
      throw new ApiError(409, 'Ya existe una invitacion pendiente para este email');
    }

    // Cannot invite as owner
    if (data.role === 'owner') {
      throw new ApiError(400, 'No se puede invitar con rol Owner. Use transferencia de propiedad.');
    }

    const id = uuid();
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // 7 days expiration

    await db.execute(sql`
      INSERT INTO pending_invitations (id, company_id, email, name, role, token, invited_by, expires_at, status)
      VALUES (${id}, ${companyId}, ${data.email}, ${data.name || null}, ${data.role}, ${token}, ${invitedBy}, ${expiresAt.toISOString()}, 'pending')
    `);

    await auditService.log({
      companyId,
      userId: invitedBy,
      action: 'invite_user',
      entityType: 'invitation',
      entityId: id,
      details: { email: data.email, role: data.role },
      ipAddress,
    });

    // Send invitation email (non-blocking, non-fatal)
    this.sendInvitationEmailAsync(companyId, invitedBy, data.email, data.role, token);

    return { id, email: data.email, role: data.role, token, expires_at: expiresAt };
  }

  async getInvitations(companyId: string) {
    const result = await db.execute(sql`
      SELECT pi.id, pi.email, pi.name, pi.role, pi.status, pi.token, pi.expires_at, pi.created_at,
             u.name as invited_by_name
      FROM pending_invitations pi
      LEFT JOIN users u ON u.id = pi.invited_by
      WHERE pi.company_id = ${companyId}
      ORDER BY pi.created_at DESC
    `);
    return (result as any).rows || result || [];
  }

  async cancelInvitation(companyId: string, invitationId: string, cancelledBy: string, ipAddress?: string) {
    const existing = await db.execute(sql`
      SELECT id, email FROM pending_invitations
      WHERE id = ${invitationId} AND company_id = ${companyId} AND status = 'pending'
    `);
    const existingRows = (existing as any).rows || existing || [];
    if (existingRows.length === 0) {
      throw new ApiError(404, 'Invitacion no encontrada');
    }

    await db.execute(sql`
      UPDATE pending_invitations SET status = 'cancelled' WHERE id = ${invitationId}
    `);

    await auditService.log({
      companyId,
      userId: cancelledBy,
      action: 'cancel_invitation',
      entityType: 'invitation',
      entityId: invitationId,
      details: { email: (existingRows[0] as any).email },
      ipAddress,
    });

    return { message: 'Invitacion cancelada' };
  }

  async resendInvitation(companyId: string, invitationId: string) {
    const existing = await db.execute(sql`
      SELECT pi.id, pi.email, pi.role, pi.invited_by
      FROM pending_invitations pi
      WHERE pi.id = ${invitationId} AND pi.company_id = ${companyId} AND pi.status = 'pending'
    `);
    const existingRows = (existing as any).rows || existing || [];
    if (existingRows.length === 0) {
      throw new ApiError(404, 'Invitacion no encontrada');
    }

    // Generate new token and extend expiration
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    await db.execute(sql`
      UPDATE pending_invitations SET token = ${token}, expires_at = ${expiresAt.toISOString()}
      WHERE id = ${invitationId}
    `);

    const invitation = existingRows[0] as { email: string; role: string; invited_by: string };

    // Re-send invitation email (non-blocking, non-fatal)
    this.sendInvitationEmailAsync(companyId, invitation.invited_by, invitation.email, invitation.role, token);

    return { token, expires_at: expiresAt };
  }

  // Helper: resolve inviter name + company name and send the invitation email
  private sendInvitationEmailAsync(companyId: string, invitedBy: string, email: string, role: string, token: string) {
    (async () => {
      try {
        const inviterResult = await db.execute(sql`SELECT name FROM users WHERE id = ${invitedBy}`);
        const inviterRows = (inviterResult as any).rows || inviterResult || [];
        const inviterName = inviterRows.length > 0 ? (inviterRows[0] as { name: string }).name : 'Un miembro del equipo';

        const companyResult = await db.execute(sql`SELECT name FROM companies WHERE id = ${companyId}`);
        const companyRows = (companyResult as any).rows || companyResult || [];
        const companyName = companyRows.length > 0 ? (companyRows[0] as { name: string }).name : 'tu empresa';

        await emailService.sendInvitationEmail(email, inviterName, companyName, role, token);
      } catch (err) {
        console.error('[Invitations] Invitation email failed (non-fatal):', err);
      }
    })();
  }

  async validateToken(token: string) {
    const result = await db.execute(sql`
      SELECT pi.*, c.name as company_name
      FROM pending_invitations pi
      JOIN companies c ON c.id = pi.company_id
      WHERE pi.token = ${token} AND pi.status = 'pending'
    `);
    const rows = (result as any).rows || result || [];
    if (rows.length === 0) {
      throw new ApiError(404, 'Invitacion no encontrada o ya fue utilizada');
    }

    const invitation = rows[0] as any;
    if (new Date(invitation.expires_at) < new Date()) {
      throw new ApiError(410, 'La invitacion ha expirado');
    }

    return {
      id: invitation.id,
      email: invitation.email,
      name: invitation.name,
      role: invitation.role,
      company_id: invitation.company_id,
      company_name: invitation.company_name,
    };
  }

  async acceptInvitation(token: string, data: { name: string; password: string }) {
    const invitation = await this.validateToken(token);

    if (!data.password || data.password.length < 8) {
      throw new ApiError(400, 'La contrasena debe tener al menos 8 caracteres');
    }

    // Validate password complexity (same rules as registration)
    const passwordCheck = validatePasswordComplexity(data.password);
    if (!passwordCheck.valid) {
      throw new ApiError(400, passwordCheck.errors.join('. '));
    }

    // Create user
    const userId = uuid();
    const hashedPassword = await bcrypt.hash(data.password, env.BCRYPT_ROUNDS);

    await db.execute(sql`
      INSERT INTO users (id, company_id, email, name, password_hash, role, active)
      VALUES (${userId}, ${invitation.company_id}, ${invitation.email}, ${data.name || invitation.name || 'Usuario'}, ${hashedPassword}, ${invitation.role}, true)
    `);

    // Apply role template permissions if template exists
    if (invitation.role !== 'admin' && invitation.role !== 'owner' && ROLE_TEMPLATES[invitation.role]) {
      // Delete existing perms first (safety)
      await db.execute(sql`DELETE FROM permissions WHERE user_id = ${userId}`);
      const template = ROLE_TEMPLATES[invitation.role];
      for (const [module, actions] of Object.entries(template)) {
        for (const action of actions) {
          const permId = uuid();
          await db.execute(sql`
            INSERT INTO permissions (id, user_id, module, action, allowed)
            VALUES (${permId}, ${userId}, ${module}, ${action}, true)
          `);
        }
      }
    }

    // Mark invitation as accepted
    await db.execute(sql`
      UPDATE pending_invitations SET status = 'accepted' WHERE token = ${token}
    `);

    await auditService.log({
      companyId: invitation.company_id,
      userId,
      action: 'accept_invitation',
      entityType: 'user',
      entityId: userId,
      details: { email: invitation.email, role: invitation.role },
    });

    return {
      user_id: userId,
      email: invitation.email,
      company_id: invitation.company_id,
    };
  }
}

export const invitationsService = new InvitationsService();
