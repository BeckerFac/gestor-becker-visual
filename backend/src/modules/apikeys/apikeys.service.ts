import crypto from 'crypto';
import { db } from '../../config/db';
import { sql } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';
import { ApiError } from '../../middlewares/errorHandler';
import { auditService } from '../audit/audit.service';

// Scopes define what operations an API key can perform
export type ApiKeyScope = 'read' | 'full';

export interface ApiKeyCreateResult {
  id: string;
  name: string;
  key: string; // Only returned once at creation
  prefix: string;
  scope: ApiKeyScope;
  created_at: string;
}

export interface ApiKeyInfo {
  id: string;
  company_id: string;
  name: string;
  prefix: string;
  scope: ApiKeyScope;
  last_used: string | null;
  created_at: string;
  revoked_at: string | null;
}

export class ApiKeysService {
  /**
   * Generate a new API key for a company.
   * The raw key is returned ONCE. Only the SHA-256 hash is stored.
   * Key format: bv_live_{random_hex} (prefix "bv_live_" for identification)
   */
  async createApiKey(
    companyId: string,
    name: string,
    scope: ApiKeyScope,
    createdBy: string,
    ipAddress?: string,
  ): Promise<ApiKeyCreateResult> {
    // Validate name
    if (!name || name.length < 2 || name.length > 100) {
      throw new ApiError(400, 'El nombre de la API key debe tener entre 2 y 100 caracteres');
    }

    // Validate scope
    if (!['read', 'full'].includes(scope)) {
      throw new ApiError(400, 'Scope invalido. Usar "read" o "full"');
    }

    // Limit: max 10 active API keys per company
    const countResult = await db.execute(sql`
      SELECT COUNT(*)::int AS count
      FROM api_keys
      WHERE company_id = ${companyId} AND revoked_at IS NULL
    `);
    const countRows = (countResult as any).rows || countResult || [];
    const activeCount = parseInt(String(countRows[0]?.count || '0'), 10);
    if (activeCount >= 10) {
      throw new ApiError(400, 'Limite de 10 API keys activas por empresa alcanzado');
    }

    // Generate cryptographically secure random key
    const randomPart = crypto.randomBytes(32).toString('hex');
    const rawKey = `bv_live_${randomPart}`;
    const prefix = rawKey.substring(0, 12); // "bv_live_XXXX" for display

    // Hash key for storage (SHA-256 is sufficient for high-entropy keys)
    const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');

    const id = uuid();
    const now = new Date().toISOString();

    await db.execute(sql`
      INSERT INTO api_keys (id, company_id, name, key_hash, key_prefix, scope, created_by, created_at)
      VALUES (${id}, ${companyId}, ${name}, ${keyHash}, ${prefix}, ${scope}, ${createdBy}, ${now})
    `);

    await auditService.log({
      companyId,
      userId: createdBy,
      action: 'create_api_key',
      entityType: 'api_key',
      entityId: id,
      details: { name, scope, prefix },
      ipAddress,
    });

    return {
      id,
      name,
      key: rawKey,
      prefix,
      scope,
      created_at: now,
    };
  }

  /**
   * List all API keys for a company (never returns the hash).
   */
  async listApiKeys(companyId: string): Promise<ApiKeyInfo[]> {
    const result = await db.execute(sql`
      SELECT id, company_id, name, key_prefix AS prefix, scope, last_used, created_at, revoked_at
      FROM api_keys
      WHERE company_id = ${companyId}
      ORDER BY created_at DESC
    `);
    const rows = (result as any).rows || result || [];
    return rows as ApiKeyInfo[];
  }

  /**
   * Revoke an API key (soft delete).
   */
  async revokeApiKey(
    companyId: string,
    apiKeyId: string,
    revokedBy: string,
    ipAddress?: string,
  ): Promise<{ message: string }> {
    const existing = await db.execute(sql`
      SELECT id, name, key_prefix FROM api_keys
      WHERE id = ${apiKeyId} AND company_id = ${companyId} AND revoked_at IS NULL
    `);
    const rows = (existing as any).rows || existing || [];
    if (rows.length === 0) {
      throw new ApiError(404, 'API key no encontrada o ya revocada');
    }

    const keyInfo = rows[0] as { id: string; name: string; key_prefix: string };

    await db.execute(sql`
      UPDATE api_keys SET revoked_at = NOW() WHERE id = ${apiKeyId}
    `);

    await auditService.log({
      companyId,
      userId: revokedBy,
      action: 'revoke_api_key',
      entityType: 'api_key',
      entityId: apiKeyId,
      details: { name: keyInfo.name, prefix: keyInfo.key_prefix },
      ipAddress,
    });

    return { message: 'API key revocada exitosamente' };
  }

  /**
   * Authenticate a request using a raw API key.
   * Returns the company_id and scope if valid, null otherwise.
   */
  async authenticateByApiKey(rawKey: string): Promise<{
    company_id: string;
    scope: ApiKeyScope;
    api_key_id: string;
  } | null> {
    if (!rawKey || !rawKey.startsWith('bv_live_')) {
      return null;
    }

    const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');

    const result = await db.execute(sql`
      SELECT id, company_id, scope
      FROM api_keys
      WHERE key_hash = ${keyHash} AND revoked_at IS NULL
    `);
    const rows = (result as any).rows || result || [];
    if (rows.length === 0) {
      return null;
    }

    const apiKey = rows[0] as { id: string; company_id: string; scope: string };

    // Update last_used timestamp (fire-and-forget, don't block the request)
    db.execute(sql`
      UPDATE api_keys SET last_used = NOW() WHERE id = ${apiKey.id}
    `).catch(() => {
      // Non-critical: don't fail the request if update fails
    });

    return {
      company_id: apiKey.company_id,
      scope: apiKey.scope as ApiKeyScope,
      api_key_id: apiKey.id,
    };
  }
}

export const apiKeysService = new ApiKeysService();
