import { db } from '../../config/db';
import { sql } from 'drizzle-orm';
import { ApiError } from '../../middlewares/errorHandler';
import { v4 as uuid } from 'uuid';

export class IntegrationsService {
  private migrationsRun = false;

  async ensureMigrations() {
    if (this.migrationsRun) return;
    try {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS integration_connections (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
          provider VARCHAR(50) NOT NULL,
          access_token TEXT,
          refresh_token TEXT,
          status VARCHAR(20) NOT NULL DEFAULT 'disconnected',
          metadata JSONB,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
      `);
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS integration_sync_log (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          connection_id UUID NOT NULL REFERENCES integration_connections(id) ON DELETE CASCADE,
          action VARCHAR(100) NOT NULL,
          status VARCHAR(20) NOT NULL DEFAULT 'pending',
          details JSONB,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
      `);
      this.migrationsRun = true;
    } catch (error) {
      console.error('Integrations migrations error:', error);
    }
  }

  async listConnections(companyId: string) {
    await this.ensureMigrations();
    try {
      const result = await db.execute(sql`
        SELECT id, company_id, provider, status, metadata, created_at, updated_at
        FROM integration_connections
        WHERE company_id = ${companyId}
        ORDER BY provider ASC
      `);
      return (result as any).rows || result || [];
    } catch (error) {
      console.error('List integrations error:', error);
      throw new ApiError(500, 'Error al obtener integraciones');
    }
  }

  async getConnection(companyId: string, id: string) {
    await this.ensureMigrations();
    try {
      const result = await db.execute(sql`
        SELECT id, company_id, provider, status, metadata, created_at, updated_at
        FROM integration_connections
        WHERE id = ${id} AND company_id = ${companyId}
      `);
      const rows = (result as any).rows || result || [];
      if (rows.length === 0) throw new ApiError(404, 'Integracion no encontrada');
      return rows[0];
    } catch (error) {
      if (error instanceof ApiError) throw error;
      console.error('Get integration error:', error);
      throw new ApiError(500, 'Error al obtener integracion');
    }
  }

  async createConnection(companyId: string, data: any) {
    await this.ensureMigrations();
    try {
      const { provider, metadata } = data;
      if (!provider) throw new ApiError(400, 'Provider requerido');

      const validProviders = ['mercadolibre', 'tiendanube', 'mercadopago'];
      if (!validProviders.includes(provider)) {
        throw new ApiError(400, `Provider invalido. Opciones: ${validProviders.join(', ')}`);
      }

      // Check for existing connection with same provider
      const existing = await db.execute(sql`
        SELECT id FROM integration_connections
        WHERE company_id = ${companyId} AND provider = ${provider}
      `);
      const existingRows = (existing as any).rows || existing || [];
      if (existingRows.length > 0) {
        throw new ApiError(409, `Ya existe una conexion con ${provider}`);
      }

      const id = uuid();
      await db.execute(sql`
        INSERT INTO integration_connections (id, company_id, provider, status, metadata, created_at, updated_at)
        VALUES (${id}, ${companyId}, ${provider}, 'disconnected', ${metadata ? JSON.stringify(metadata) : null}::jsonb, NOW(), NOW())
      `);

      return { id, message: 'Conexion creada' };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      console.error('Create integration error:', error);
      throw new ApiError(500, 'Error al crear integracion');
    }
  }

  async updateConnection(companyId: string, id: string, data: any) {
    await this.ensureMigrations();
    try {
      const check = await db.execute(sql`
        SELECT id FROM integration_connections WHERE id = ${id} AND company_id = ${companyId}
      `);
      const rows = (check as any).rows || check || [];
      if (rows.length === 0) throw new ApiError(404, 'Integracion no encontrada');

      const { status, metadata } = data;
      await db.execute(sql`
        UPDATE integration_connections SET
          status = COALESCE(${status ?? null}, status),
          metadata = COALESCE(${metadata ? JSON.stringify(metadata) : null}::jsonb, metadata),
          updated_at = NOW()
        WHERE id = ${id} AND company_id = ${companyId}
      `);

      return { id, message: 'Integracion actualizada' };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      console.error('Update integration error:', error);
      throw new ApiError(500, 'Error al actualizar integracion');
    }
  }

  async deleteConnection(companyId: string, id: string) {
    await this.ensureMigrations();
    try {
      const check = await db.execute(sql`
        SELECT id FROM integration_connections WHERE id = ${id} AND company_id = ${companyId}
      `);
      const rows = (check as any).rows || check || [];
      if (rows.length === 0) throw new ApiError(404, 'Integracion no encontrada');

      await db.execute(sql`
        DELETE FROM integration_connections WHERE id = ${id} AND company_id = ${companyId}
      `);

      return { deleted: true };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      console.error('Delete integration error:', error);
      throw new ApiError(500, 'Error al eliminar integracion');
    }
  }

  async getSyncLog(companyId: string, connectionId: string) {
    await this.ensureMigrations();
    try {
      // Verify ownership
      const check = await db.execute(sql`
        SELECT id FROM integration_connections WHERE id = ${connectionId} AND company_id = ${companyId}
      `);
      const checkRows = (check as any).rows || check || [];
      if (checkRows.length === 0) throw new ApiError(404, 'Integracion no encontrada');

      const result = await db.execute(sql`
        SELECT * FROM integration_sync_log
        WHERE connection_id = ${connectionId}
        ORDER BY created_at DESC
        LIMIT 50
      `);
      return (result as any).rows || result || [];
    } catch (error) {
      if (error instanceof ApiError) throw error;
      console.error('Get sync log error:', error);
      throw new ApiError(500, 'Error al obtener log de sincronizacion');
    }
  }
}

export const integrationsService = new IntegrationsService();
