import { db } from '../../config/db';
import { sql } from 'drizzle-orm';
import { ApiError } from '../../middlewares/errorHandler';
import { v4 as uuid } from 'uuid';
import bcrypt from 'bcryptjs';
import { ROLE_TEMPLATES } from '../../shared/permissions.constants';

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

  async createUser(companyId: string, data: { email: string; name: string; password: string; role: string }) {
    // Check if email already exists
    const existing = await db.execute(sql`
      SELECT id FROM users WHERE email = ${data.email}
    `);
    const existingRows = (existing as any).rows || existing || [];
    if (existingRows.length > 0) {
      throw new ApiError(409, 'El email ya esta registrado');
    }

    const id = uuid();
    const hashedPassword = await bcrypt.hash(data.password, 10);

    await db.execute(sql`
      INSERT INTO users (id, company_id, email, name, password_hash, role, active)
      VALUES (${id}, ${companyId}, ${data.email}, ${data.name}, ${hashedPassword}, ${data.role}, true)
    `);

    // Apply role template permissions if template exists
    if (data.role !== 'admin' && ROLE_TEMPLATES[data.role]) {
      await this.applyTemplate(companyId, id, data.role);
    }

    return this.getUser(companyId, id);
  }

  async updateUser(companyId: string, userId: string, data: { name?: string; email?: string; role?: string; active?: boolean }) {
    // Verify user exists and belongs to company
    const existing = await db.execute(sql`
      SELECT id, role, active FROM users WHERE id = ${userId} AND company_id = ${companyId}
    `);
    const existingRows = (existing as any).rows || existing || [];
    if (existingRows.length === 0) {
      throw new ApiError(404, 'Usuario no encontrado');
    }

    const currentUser = existingRows[0] as { id: string; role: string; active: boolean };

    // Check if deactivating or removing admin role from last admin
    if (data.active === false || (data.role && data.role !== 'admin' && currentUser.role === 'admin')) {
      const adminCount = await db.execute(sql`
        SELECT COUNT(*) as count FROM users
        WHERE company_id = ${companyId} AND role = 'admin' AND active = true
      `);
      const adminRows = (adminCount as any).rows || adminCount || [];
      const count = parseInt(String(adminRows[0]?.count || '0'), 10);

      if (count <= 1 && currentUser.role === 'admin') {
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
    const values: any[] = [];

    if (data.name !== undefined) {
      updates.push('name');
      values.push(data.name);
    }
    if (data.email !== undefined) {
      updates.push('email');
      values.push(data.email);
    }
    if (data.role !== undefined) {
      updates.push('role');
      values.push(data.role);
    }
    if (data.active !== undefined) {
      updates.push('active');
      values.push(data.active);
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
      if (data.role !== 'admin' && ROLE_TEMPLATES[data.role]) {
        await this.applyTemplate(companyId, userId, data.role);
      }
    }
    if (data.active !== undefined) {
      await db.execute(sql`UPDATE users SET active = ${data.active} WHERE id = ${userId}`);
    }

    return this.getUser(companyId, userId);
  }

  async deleteUser(companyId: string, requesterId: string, userId: string) {
    // Cannot delete self
    if (requesterId === userId) {
      throw new ApiError(400, 'No puede desactivar su propio usuario');
    }

    // Verify user exists and belongs to company
    const existing = await db.execute(sql`
      SELECT id, role FROM users WHERE id = ${userId} AND company_id = ${companyId}
    `);
    const existingRows = (existing as any).rows || existing || [];
    if (existingRows.length === 0) {
      throw new ApiError(404, 'Usuario no encontrado');
    }

    const targetUser = existingRows[0] as { id: string; role: string };

    // Cannot delete last admin
    if (targetUser.role === 'admin') {
      const adminCount = await db.execute(sql`
        SELECT COUNT(*) as count FROM users
        WHERE company_id = ${companyId} AND role = 'admin' AND active = true
      `);
      const adminRows = (adminCount as any).rows || adminCount || [];
      const count = parseInt(String(adminRows[0]?.count || '0'), 10);
      if (count <= 1) {
        throw new ApiError(400, 'No se puede desactivar al ultimo administrador');
      }
    }

    // Soft delete
    await db.execute(sql`UPDATE users SET active = false WHERE id = ${userId}`);

    return { message: 'Usuario desactivado' };
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

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await db.execute(sql`UPDATE users SET password_hash = ${hashedPassword} WHERE id = ${userId}`);

    return { message: 'Contrasena actualizada' };
  }
}

export const usersService = new UsersService();
