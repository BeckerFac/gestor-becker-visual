import { db } from '../../config/db';
import { sql } from 'drizzle-orm';
import { ApiError } from '../../middlewares/errorHandler';
import { v4 as uuid } from 'uuid';
import bcrypt from 'bcryptjs';
import { ROLE_TEMPLATES, ROLE_HIERARCHY } from '../../shared/permissions.constants';
import { auditService } from '../audit/audit.service';
import { env } from '../../config/env';
import { validatePasswordComplexity } from '../../middlewares/security';

export class UsersService {
  async getUsers(companyId: string) {
    const result = await db.execute(sql`
      SELECT id, email, name, role, active, created_at, last_login
      FROM users
      WHERE company_id = ${companyId}
      ORDER BY created_at DESC
    `);
    const rows = (result as any).rows || result || [];
    return rows;
  }

  async getUser(companyId: string, userId: string) {
    const result = await db.execute(sql`
      SELECT id, email, name, role, active, created_at, last_login
      FROM users
      WHERE id = ${userId} AND company_id = ${companyId}
    `);
    const rows = (result as any).rows || result || [];
    if (rows.length === 0) {
      throw new ApiError(404, 'Usuario no encontrado');
    }
    const user = rows[0];
    const permissions = await this.getUserPermissions(userId);
    return { ...user, permissions };
  }

  async createUser(companyId: string, data: { email: string; name: string; password: string; role: string }, requesterId?: string, ipAddress?: string) {
    // Cannot create an owner user
    if (data.role === 'owner') {
      throw new ApiError(400, 'No se puede crear un usuario con rol Owner');
    }

    // Check if email already exists
    const existing = await db.execute(sql`
      SELECT id FROM users WHERE email = ${data.email}
    `);
    const existingRows = (existing as any).rows || existing || [];
    if (existingRows.length > 0) {
      throw new ApiError(409, 'El email ya esta registrado');
    }

    // Validate password complexity for new users
    const passwordCheck = validatePasswordComplexity(data.password);
    if (!passwordCheck.valid) {
      throw new ApiError(400, passwordCheck.errors.join('. '));
    }

    const id = uuid();
    const hashedPassword = await bcrypt.hash(data.password, env.BCRYPT_ROUNDS);

    await db.execute(sql`
      INSERT INTO users (id, company_id, email, name, password_hash, role, active)
      VALUES (${id}, ${companyId}, ${data.email}, ${data.name}, ${hashedPassword}, ${data.role}, true)
    `);

    // Apply role template permissions if template exists
    if (data.role !== 'admin' && data.role !== 'owner' && ROLE_TEMPLATES[data.role]) {
      await this.applyTemplate(companyId, id, data.role);
    }

    if (requesterId) {
      await auditService.log({
        companyId,
        userId: requesterId,
        action: 'create_user',
        entityType: 'user',
        entityId: id,
        details: { email: data.email, role: data.role },
        ipAddress,
      });
    }

    return this.getUser(companyId, id);
  }

  async updateUser(companyId: string, userId: string, data: { name?: string; email?: string; role?: string; active?: boolean }, requesterId?: string, requesterRole?: string, ipAddress?: string) {
    // Verify user exists and belongs to company
    const existing = await db.execute(sql`
      SELECT id, role, active, email FROM users WHERE id = ${userId} AND company_id = ${companyId}
    `);
    const existingRows = (existing as any).rows || existing || [];
    if (existingRows.length === 0) {
      throw new ApiError(404, 'Usuario no encontrado');
    }

    const currentUser = existingRows[0] as { id: string; role: string; active: boolean; email: string };

    // Cannot change the Owner's role
    if (currentUser.role === 'owner' && data.role && data.role !== 'owner') {
      throw new ApiError(400, 'No se puede cambiar el rol del Owner. Use transferencia de propiedad.');
    }

    // Cannot deactivate the Owner
    if (currentUser.role === 'owner' && data.active === false) {
      throw new ApiError(400, 'No se puede desactivar al Owner');
    }

    // Cannot assign owner role via update
    if (data.role === 'owner' && currentUser.role !== 'owner') {
      throw new ApiError(400, 'No se puede asignar rol Owner via edicion. Use transferencia de propiedad.');
    }

    // Cannot change own role
    if (requesterId === userId && data.role && data.role !== currentUser.role) {
      throw new ApiError(400, 'No puede cambiar su propio rol');
    }

    // A non-owner cannot modify an owner
    if (currentUser.role === 'owner' && requesterRole !== 'owner') {
      throw new ApiError(403, 'Solo el Owner puede modificar su propia cuenta');
    }

    // Lower-privilege users cannot modify higher-privilege users
    if (requesterRole && requesterId !== userId) {
      const requesterLevel = ROLE_HIERARCHY[requesterRole] ?? 0;
      const targetLevel = ROLE_HIERARCHY[currentUser.role] ?? 0;
      if (requesterLevel <= targetLevel && requesterRole !== 'owner') {
        throw new ApiError(403, 'No puede modificar un usuario de mayor o igual jerarquia');
      }
    }

    // Check if deactivating or removing admin role from last admin
    if (data.active === false || (data.role && data.role !== 'admin' && currentUser.role === 'admin')) {
      const adminCount = await db.execute(sql`
        SELECT COUNT(*) as count FROM users
        WHERE company_id = ${companyId} AND role IN ('admin', 'owner') AND active = true
      `);
      const adminRows = (adminCount as any).rows || adminCount || [];
      const count = parseInt(String(adminRows[0]?.count || '0'), 10);

      if (count <= 1 && (currentUser.role === 'admin' || currentUser.role === 'owner')) {
        throw new ApiError(400, 'No se puede desactivar o cambiar el rol del ultimo administrador');
      }
    }

    // Check email uniqueness if changing email
    if (data.email) {
      const emailCheck = await db.execute(sql`
        SELECT id FROM users WHERE email = ${data.email} AND id != ${userId}
      `);
      const emailRows = (emailCheck as any).rows || emailCheck || [];
      if (emailRows.length > 0) {
        throw new ApiError(409, 'El email ya esta en uso');
      }
    }

    // Build update dynamically
    const updates: string[] = [];

    if (data.name !== undefined) {
      updates.push('name');
    }
    if (data.email !== undefined) {
      updates.push('email');
    }
    if (data.role !== undefined) {
      updates.push('role');
    }
    if (data.active !== undefined) {
      updates.push('active');
    }

    if (updates.length === 0) {
      return this.getUser(companyId, userId);
    }

    // Use individual update queries since drizzle sql template is simpler this way
    if (data.name !== undefined) {
      await db.execute(sql`UPDATE users SET name = ${data.name} WHERE id = ${userId}`);
    }
    if (data.email !== undefined) {
      await db.execute(sql`UPDATE users SET email = ${data.email} WHERE id = ${userId}`);
    }
    if (data.role !== undefined) {
      await db.execute(sql`UPDATE users SET role = ${data.role} WHERE id = ${userId}`);
      // Re-apply template if role changed and template exists
      if (data.role !== 'admin' && data.role !== 'owner' && ROLE_TEMPLATES[data.role]) {
        await this.applyTemplate(companyId, userId, data.role);
      }
    }
    if (data.active !== undefined) {
      await db.execute(sql`UPDATE users SET active = ${data.active} WHERE id = ${userId}`);
    }

    if (requesterId) {
      await auditService.log({
        companyId,
        userId: requesterId,
        action: 'update_user',
        entityType: 'user',
        entityId: userId,
        details: { changes: data, previous_role: currentUser.role },
        ipAddress,
      });
    }

    return this.getUser(companyId, userId);
  }

  async deleteUser(companyId: string, requesterId: string, userId: string, requesterRole?: string, ipAddress?: string) {
    // Cannot delete self
    if (requesterId === userId) {
      throw new ApiError(400, 'No puede desactivar su propio usuario');
    }

    // Verify user exists and belongs to company
    const existing = await db.execute(sql`
      SELECT id, role, email FROM users WHERE id = ${userId} AND company_id = ${companyId}
    `);
    const existingRows = (existing as any).rows || existing || [];
    if (existingRows.length === 0) {
      throw new ApiError(404, 'Usuario no encontrado');
    }

    const targetUser = existingRows[0] as { id: string; role: string; email: string };

    // Cannot delete the Owner
    if (targetUser.role === 'owner') {
      throw new ApiError(400, 'No se puede desactivar al Owner');
    }

    // Cannot delete last admin
    if (targetUser.role === 'admin') {
      const adminCount = await db.execute(sql`
        SELECT COUNT(*) as count FROM users
        WHERE company_id = ${companyId} AND role IN ('admin', 'owner') AND active = true
      `);
      const adminRows = (adminCount as any).rows || adminCount || [];
      const count = parseInt(String(adminRows[0]?.count || '0'), 10);
      if (count <= 1) {
        throw new ApiError(400, 'No se puede desactivar al ultimo administrador');
      }
    }

    // Soft delete
    await db.execute(sql`UPDATE users SET active = false WHERE id = ${userId}`);

    // Invalidate all sessions for the deactivated user
    await db.execute(sql`DELETE FROM sessions WHERE user_id = ${userId}`);

    await auditService.log({
      companyId,
      userId: requesterId,
      action: 'deactivate_user',
      entityType: 'user',
      entityId: userId,
      details: { email: targetUser.email, role: targetUser.role },
      ipAddress,
    });

    return { message: 'Usuario desactivado' };
  }

  async transferOwnership(companyId: string, currentOwnerId: string, newOwnerId: string, ipAddress?: string) {
    // Verify current user is the owner
    const ownerCheck = await db.execute(sql`
      SELECT id, role FROM users WHERE id = ${currentOwnerId} AND company_id = ${companyId}
    `);
    const ownerRows = (ownerCheck as any).rows || ownerCheck || [];
    if (ownerRows.length === 0 || (ownerRows[0] as any).role !== 'owner') {
      throw new ApiError(403, 'Solo el Owner puede transferir la propiedad');
    }

    // Verify new owner exists and is admin
    const newOwnerCheck = await db.execute(sql`
      SELECT id, role, email, name FROM users WHERE id = ${newOwnerId} AND company_id = ${companyId} AND active = true
    `);
    const newOwnerRows = (newOwnerCheck as any).rows || newOwnerCheck || [];
    if (newOwnerRows.length === 0) {
      throw new ApiError(404, 'Usuario destino no encontrado');
    }
    const targetUser = newOwnerRows[0] as { id: string; role: string; email: string; name: string };
    if (targetUser.role !== 'admin') {
      throw new ApiError(400, 'Solo se puede transferir la propiedad a un Admin');
    }

    // Transfer: set new owner and demote old owner to admin
    await db.execute(sql`UPDATE users SET role = 'admin' WHERE id = ${currentOwnerId}`);
    await db.execute(sql`UPDATE users SET role = 'owner' WHERE id = ${newOwnerId}`);

    await auditService.log({
      companyId,
      userId: currentOwnerId,
      action: 'transfer_ownership',
      entityType: 'company',
      entityId: companyId,
      details: { new_owner_id: newOwnerId, new_owner_email: targetUser.email },
      ipAddress,
    });

    return { message: 'Propiedad transferida exitosamente', new_owner: { id: newOwnerId, email: targetUser.email, name: targetUser.name } };
  }

  async getUserPermissions(userId: string): Promise<Record<string, string[]>> {
    const result = await db.execute(sql`
      SELECT module, action FROM permissions WHERE user_id = ${userId} AND allowed = true
    `);
    const rows = (result as any).rows || result || [];
    const perms: Record<string, string[]> = {};
    for (const row of rows) {
      const r = row as { module: string; action: string };
      if (!perms[r.module]) perms[r.module] = [];
      perms[r.module].push(r.action);
    }
    return perms;
  }

  async setUserPermissions(companyId: string, userId: string, permissions: Record<string, string[]>) {
    // Verify target user belongs to the same company
    const existing = await db.execute(sql`
      SELECT id FROM users WHERE id = ${userId} AND company_id = ${companyId}
    `);
    const existingRows = (existing as any).rows || existing || [];
    if (existingRows.length === 0) {
      throw new ApiError(404, 'Usuario no encontrado en esta empresa');
    }

    // Delete all existing permissions
    await db.execute(sql`DELETE FROM permissions WHERE user_id = ${userId}`);

    // Insert new permissions
    for (const [module, actions] of Object.entries(permissions)) {
      for (const action of actions) {
        const id = uuid();
        await db.execute(sql`
          INSERT INTO permissions (id, user_id, module, action, allowed)
          VALUES (${id}, ${userId}, ${module}, ${action}, true)
        `);
      }
    }

    return this.getUserPermissions(userId);
  }

  async applyTemplate(companyId: string, userId: string, templateName: string) {
    // Verify target user belongs to the same company
    const existing = await db.execute(sql`
      SELECT id FROM users WHERE id = ${userId} AND company_id = ${companyId}
    `);
    const existingRows = (existing as any).rows || existing || [];
    if (existingRows.length === 0) {
      throw new ApiError(404, 'Usuario no encontrado en esta empresa');
    }

    const template = ROLE_TEMPLATES[templateName];
    if (!template) {
      throw new ApiError(400, `Template '${templateName}' no encontrado`);
    }
    return this.setUserPermissions(companyId, userId, template);
  }

  async resetPassword(companyId: string, userId: string, newPassword: string) {
    // Verify user belongs to company
    const existing = await db.execute(sql`
      SELECT id FROM users WHERE id = ${userId} AND company_id = ${companyId}
    `);
    const existingRows = (existing as any).rows || existing || [];
    if (existingRows.length === 0) {
      throw new ApiError(404, 'Usuario no encontrado');
    }

    // Validate password complexity
    const passwordCheck = validatePasswordComplexity(newPassword);
    if (!passwordCheck.valid) {
      throw new ApiError(400, passwordCheck.errors.join('. '));
    }

    const hashedPassword = await bcrypt.hash(newPassword, env.BCRYPT_ROUNDS);
    await db.execute(sql`UPDATE users SET password_hash = ${hashedPassword} WHERE id = ${userId}`);

    // Invalidate all sessions for user after password reset
    await db.execute(sql`DELETE FROM sessions WHERE user_id = ${userId}`);

    return { message: 'Contrasena actualizada' };
  }

  // Session management
  async getUserSessions(companyId: string, userId: string) {
    // Verify user belongs to company
    const existing = await db.execute(sql`
      SELECT id FROM users WHERE id = ${userId} AND company_id = ${companyId}
    `);
    const existingRows = (existing as any).rows || existing || [];
    if (existingRows.length === 0) {
      throw new ApiError(404, 'Usuario no encontrado');
    }

    const result = await db.execute(sql`
      SELECT id, created_at, expires_at
      FROM sessions
      WHERE user_id = ${userId} AND expires_at > NOW()
      ORDER BY created_at DESC
    `);
    return (result as any).rows || result || [];
  }

  async revokeSession(companyId: string, userId: string, sessionId: string) {
    // Verify user belongs to company
    const existing = await db.execute(sql`
      SELECT id FROM users WHERE id = ${userId} AND company_id = ${companyId}
    `);
    const existingRows = (existing as any).rows || existing || [];
    if (existingRows.length === 0) {
      throw new ApiError(404, 'Usuario no encontrado');
    }

    await db.execute(sql`DELETE FROM sessions WHERE id = ${sessionId} AND user_id = ${userId}`);
    return { message: 'Sesion revocada' };
  }

  async revokeAllSessions(companyId: string, userId: string, requesterId: string, ipAddress?: string) {
    // Verify user belongs to company
    const existing = await db.execute(sql`
      SELECT id FROM users WHERE id = ${userId} AND company_id = ${companyId}
    `);
    const existingRows = (existing as any).rows || existing || [];
    if (existingRows.length === 0) {
      throw new ApiError(404, 'Usuario no encontrado');
    }

    await db.execute(sql`DELETE FROM sessions WHERE user_id = ${userId}`);

    await auditService.log({
      companyId,
      userId: requesterId,
      action: 'revoke_all_sessions',
      entityType: 'user',
      entityId: userId,
      ipAddress,
    });

    return { message: 'Todas las sesiones revocadas' };
  }
}

export const usersService = new UsersService();
