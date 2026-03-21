// DEPRECATED: Thin wrapper around activityService for backward compatibility.
// All new code should import { activityService } from '../activity/activity.service' directly.
import { activityService } from '../activity/activity.service';

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
    const description = entry.details?.description
      || entry.details?.reason
      || `${entry.action} ${entry.entityType}`;

    await activityService.log({
      companyId: entry.companyId,
      userId: entry.userId,
      action: entry.action,
      module: entry.entityType,
      entityType: entry.entityType,
      entityId: entry.entityId,
      description: typeof description === 'string' ? description : JSON.stringify(description),
      ipAddress: entry.ipAddress,
      metadata: entry.details,
    });
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
    const result = await activityService.getLogs(companyId, {
      userId: filters?.userId,
      action: filters?.action,
      module: filters?.entityType,
      dateFrom: filters?.dateFrom,
      dateTo: filters?.dateTo,
      page: filters?.offset && filters?.limit ? Math.floor(filters.offset / filters.limit) + 1 : 1,
      limit: filters?.limit ?? 50,
    });

    // Map back to legacy format
    return result.items.map((item: any) => ({
      id: item.id,
      action: item.action,
      resource: item.entityType,
      resource_id: item.entityId,
      details: item.description,
      ip_address: item.ipAddress,
      created_at: item.createdAt,
      user_name: item.userName,
      user_email: item.userName,
    }));
  }

  async getAuditLogCount(companyId: string, filters?: {
    userId?: string;
    action?: string;
    entityType?: string;
    dateFrom?: string;
    dateTo?: string;
  }) {
    const result = await activityService.getLogs(companyId, {
      userId: filters?.userId,
      action: filters?.action,
      module: filters?.entityType,
      dateFrom: filters?.dateFrom,
      dateTo: filters?.dateTo,
      page: 1,
      limit: 1,
    });
    return result.total;
  }
}

export const auditService = new AuditService();
