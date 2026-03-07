import { db } from '../../config/db';
import { sql } from 'drizzle-orm';
import { ApiError } from '../../middlewares/errorHandler';
import { v4 as uuid } from 'uuid';

export class TagsService {
  async getTags(companyId: string) {
    try {
      const result = await db.execute(sql`
        SELECT t.*,
          (SELECT COUNT(*) FROM entity_tags et WHERE et.tag_id = t.id) as usage_count
        FROM tags t
        WHERE t.company_id = ${companyId}
        ORDER BY t.name
      `);
      return (result as any).rows || result || [];
    } catch (error) {
      throw new ApiError(500, 'Failed to get tags');
    }
  }

  async createTag(companyId: string, data: { name: string; color?: string }) {
    try {
      if (!data.name || data.name.trim().length === 0) {
        throw new ApiError(400, 'El nombre de la etiqueta es requerido');
      }
      const tagId = uuid();
      await db.execute(sql`
        INSERT INTO tags (id, company_id, name, color)
        VALUES (${tagId}, ${companyId}, ${data.name.trim()}, ${data.color || '#6B7280'})
      `);
      const result = await db.execute(sql`SELECT * FROM tags WHERE id = ${tagId}`);
      const rows = (result as any).rows || result || [];
      return rows[0];
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Failed to create tag');
    }
  }

  async updateTag(companyId: string, tagId: string, data: { name?: string; color?: string }) {
    try {
      const check = await db.execute(sql`SELECT id FROM tags WHERE id = ${tagId} AND company_id = ${companyId}`);
      const rows = (check as any).rows || check || [];
      if (rows.length === 0) throw new ApiError(404, 'Tag not found');

      await db.execute(sql`
        UPDATE tags SET
          name = COALESCE(${data.name || null}, name),
          color = COALESCE(${data.color || null}, color)
        WHERE id = ${tagId} AND company_id = ${companyId}
      `);
      const result = await db.execute(sql`SELECT * FROM tags WHERE id = ${tagId}`);
      return ((result as any).rows || result || [])[0];
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Failed to update tag');
    }
  }

  async deleteTag(companyId: string, tagId: string) {
    try {
      const check = await db.execute(sql`SELECT id FROM tags WHERE id = ${tagId} AND company_id = ${companyId}`);
      const rows = (check as any).rows || check || [];
      if (rows.length === 0) throw new ApiError(404, 'Tag not found');
      await db.execute(sql`DELETE FROM tags WHERE id = ${tagId} AND company_id = ${companyId}`);
      return { success: true };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Failed to delete tag');
    }
  }

  async assignTag(entityId: string, entityType: string, tagId: string) {
    try {
      if (!['enterprise', 'customer'].includes(entityType)) {
        throw new ApiError(400, 'Invalid entity type');
      }
      await db.execute(sql`
        INSERT INTO entity_tags (id, entity_id, entity_type, tag_id)
        VALUES (${uuid()}, ${entityId}, ${entityType}, ${tagId})
        ON CONFLICT (entity_id, tag_id) DO NOTHING
      `);
      return { success: true };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Failed to assign tag');
    }
  }

  async removeTag(entityId: string, entityType: string, tagId: string) {
    try {
      await db.execute(sql`
        DELETE FROM entity_tags
        WHERE entity_id = ${entityId} AND entity_type = ${entityType} AND tag_id = ${tagId}
      `);
      return { success: true };
    } catch (error) {
      throw new ApiError(500, 'Failed to remove tag');
    }
  }

  async getEntityTags(entityId: string, entityType: string) {
    try {
      const result = await db.execute(sql`
        SELECT t.id, t.name, t.color
        FROM entity_tags et JOIN tags t ON et.tag_id = t.id
        WHERE et.entity_id = ${entityId} AND et.entity_type = ${entityType}
        ORDER BY t.name
      `);
      return (result as any).rows || result || [];
    } catch (error) {
      throw new ApiError(500, 'Failed to get entity tags');
    }
  }
}

export const tagsService = new TagsService();
