import { db } from '../../config/db';
import { sql } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';

export interface AuditEntry {
  companyId: string;
  userId: string;
  action: string;
  entityType: string;
  entityId?: string;
  details?: Record<string, any>;
  ipAddress?: string;
}

export class AuditService {
  async log(entry: AuditEntry): Promise<void> {
    try {
      const id = uuid();
      const detailsJson = entry.details ? JSON.stringify(entry.details) : null;
      await db.execute(sql`
        INSERT INTO audit_log (id, company_id, user_id, action, resource, resource_id, new_values, ip_address)
        VALUES (${id}, ${entry.companyId}, ${entry.userId}, ${entry.action}, ${entry.entityType}, ${entry.entityId || null}, ${detailsJson}::jsonb, ${entry.ipAddress || null})
      `);
    } catch (error) {
      // Audit logging should never break the main flow
      console.error('Audit log failed:', error);
    }
  }

  async getAuditLog(companyId: string, filters?: {
    userId?: string;
    action?: string;
    entityType?: string;
    dateFrom?: string;
    dateTo?: string;
    limit?: number;
    offset?: number;
  }) {
    const limit = filters?.limit ?? 50;
    const offset = filters?.offset ?? 0;

    let query = sql`
      SELECT al.id, al.action, al.resource, al.resource_id, al.new_values as details,
             al.ip_address, al.created_at,
             u.name as user_name, u.email as user_email
      FROM audit_log al
      LEFT JOIN users u ON u.id = al.user_id
      WHERE al.company_id = ${companyId}
    `;

    if (filters?.userId) {
      query = sql`${query} AND al.user_id = ${filters.userId}`;
    }
    if (filters?.action) {
      query = sql`${query} AND al.action = ${filters.action}`;
    }
    if (filters?.entityType) {
      query = sql`${query} AND al.resource = ${filters.entityType}`;
    }
    if (filters?.dateFrom) {
      query = sql`${query} AND al.created_at >= ${filters.dateFrom}::timestamptz`;
    }
    if (filters?.dateTo) {
      query = sql`${query} AND al.created_at <= ${filters.dateTo}::timestamptz`;
    }

    query = sql`${query} ORDER BY al.created_at DESC LIMIT ${limit} OFFSET ${offset}`;

    const result = await db.execute(query);
    const rows = (result as any).rows || result || [];
    return rows;
  }

  async getAuditLogCount(companyId: string, filters?: {
    userId?: string;
    action?: string;
    entityType?: string;
    dateFrom?: string;
    dateTo?: string;
  }) {
    let query = sql`SELECT COUNT(*) as count FROM audit_log WHERE company_id = ${companyId}`;

    if (filters?.userId) {
      query = sql`${query} AND user_id = ${filters.userId}`;
    }
    if (filters?.action) {
      query = sql`${query} AND action = ${filters.action}`;
    }
    if (filters?.entityType) {
      query = sql`${query} AND resource = ${filters.entityType}`;
    }
    if (filters?.dateFrom) {
      query = sql`${query} AND created_at >= ${filters.dateFrom}::timestamptz`;
    }
    if (filters?.dateTo) {
      query = sql`${query} AND created_at <= ${filters.dateTo}::timestamptz`;
    }

    const result = await db.execute(query);
    const rows = (result as any).rows || result || [];
    return parseInt(String(rows[0]?.count || '0'), 10);
  }
}

export const auditService = new AuditService();
