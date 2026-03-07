import { db } from '../../config/db';
import { sql } from 'drizzle-orm';
import { ApiError } from '../../middlewares/errorHandler';
import { v4 as uuid } from 'uuid';

export class ProductComponentsService {
  async getComponents(companyId: string, productId: string) {
    try {
      const result = await db.execute(sql`
        SELECT pc.*,
          p.name as component_name,
          p.sku as component_sku,
          pp.cost as component_cost,
          COALESCE(
            (SELECT SUM(CAST(s.quantity AS decimal)) FROM stock s WHERE s.product_id = pc.component_product_id),
            0
          ) as stock_available
        FROM product_components pc
        JOIN products p ON pc.component_product_id = p.id
        LEFT JOIN product_pricing pp ON pp.product_id = pc.component_product_id
        WHERE pc.product_id = ${productId} AND pc.company_id = ${companyId}
        ORDER BY p.name ASC
      `);
      return (result as any).rows || result || [];
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Failed to get product components');
    }
  }

  async addComponent(companyId: string, productId: string, data: { component_product_id: string; quantity_required: number; unit?: string; notes?: string }) {
    try {
      if (!data.component_product_id) {
        throw new ApiError(400, 'El componente es requerido');
      }
      if (!data.quantity_required || data.quantity_required <= 0) {
        throw new ApiError(400, 'La cantidad requerida debe ser mayor a 0');
      }

      // Validate parent product exists and belongs to company
      const parentCheck = await db.execute(sql`
        SELECT id FROM products WHERE id = ${productId} AND company_id = ${companyId}
      `);
      const parentRows = (parentCheck as any).rows || parentCheck || [];
      if (parentRows.length === 0) {
        throw new ApiError(404, 'Producto no encontrado');
      }

      // Validate component product exists
      const componentCheck = await db.execute(sql`
        SELECT id FROM products WHERE id = ${data.component_product_id} AND company_id = ${companyId}
      `);
      const componentRows = (componentCheck as any).rows || componentCheck || [];
      if (componentRows.length === 0) {
        throw new ApiError(404, 'Producto componente no encontrado');
      }

      // Validate no self-reference
      if (productId === data.component_product_id) {
        throw new ApiError(400, 'Un producto no puede ser componente de si mismo');
      }

      // Validate no circular reference
      await this.validateNoCycle(productId, data.component_product_id);

      // Insert component
      const componentId = uuid();
      await db.execute(sql`
        INSERT INTO product_components (id, product_id, component_product_id, quantity_required, unit, notes, company_id)
        VALUES (
          ${componentId},
          ${productId},
          ${data.component_product_id},
          ${data.quantity_required.toString()},
          ${data.unit || 'unidad'},
          ${data.notes || null},
          ${companyId}
        )
      `);

      // Return the new component with joined data
      const result = await db.execute(sql`
        SELECT pc.*,
          p.name as component_name,
          p.sku as component_sku,
          pp.cost as component_cost,
          COALESCE(
            (SELECT SUM(CAST(s.quantity AS decimal)) FROM stock s WHERE s.product_id = pc.component_product_id),
            0
          ) as stock_available
        FROM product_components pc
        JOIN products p ON pc.component_product_id = p.id
        LEFT JOIN product_pricing pp ON pp.product_id = pc.component_product_id
        WHERE pc.id = ${componentId}
      `);
      const rows = (result as any).rows || result || [];
      return rows[0];
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if ((error as any)?.message?.includes('duplicate key')) {
        throw new ApiError(409, 'Este componente ya esta asignado al producto');
      }
      throw new ApiError(500, 'Failed to add product component');
    }
  }

  async updateComponent(companyId: string, componentId: string, data: { quantity_required?: number; unit?: string; notes?: string }) {
    try {
      const check = await db.execute(sql`
        SELECT id FROM product_components WHERE id = ${componentId} AND company_id = ${companyId}
      `);
      const rows = (check as any).rows || check || [];
      if (rows.length === 0) {
        throw new ApiError(404, 'Componente no encontrado');
      }

      if (data.quantity_required !== undefined && data.quantity_required <= 0) {
        throw new ApiError(400, 'La cantidad requerida debe ser mayor a 0');
      }

      await db.execute(sql`
        UPDATE product_components SET
          quantity_required = COALESCE(${data.quantity_required !== undefined ? data.quantity_required.toString() : null}, quantity_required),
          unit = COALESCE(${data.unit || null}, unit),
          notes = COALESCE(${data.notes !== undefined ? data.notes : null}, notes)
        WHERE id = ${componentId} AND company_id = ${companyId}
      `);

      const result = await db.execute(sql`
        SELECT pc.*,
          p.name as component_name,
          p.sku as component_sku,
          pp.cost as component_cost
        FROM product_components pc
        JOIN products p ON pc.component_product_id = p.id
        LEFT JOIN product_pricing pp ON pp.product_id = pc.component_product_id
        WHERE pc.id = ${componentId}
      `);
      return ((result as any).rows || result || [])[0];
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Failed to update product component');
    }
  }

  async removeComponent(companyId: string, componentId: string) {
    try {
      const check = await db.execute(sql`
        SELECT id FROM product_components WHERE id = ${componentId} AND company_id = ${companyId}
      `);
      const rows = (check as any).rows || check || [];
      if (rows.length === 0) {
        throw new ApiError(404, 'Componente no encontrado');
      }

      await db.execute(sql`
        DELETE FROM product_components WHERE id = ${componentId} AND company_id = ${companyId}
      `);
      return { success: true };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Failed to remove product component');
    }
  }

  async getBOMCost(companyId: string, productId: string) {
    try {
      const result = await db.execute(sql`
        SELECT
          COALESCE(SUM(pc.quantity_required * COALESCE(CAST(pp.cost AS decimal), 0)), 0) as bom_cost,
          COUNT(pc.id) as component_count
        FROM product_components pc
        LEFT JOIN product_pricing pp ON pp.product_id = pc.component_product_id
        WHERE pc.product_id = ${productId} AND pc.company_id = ${companyId}
      `);
      const rows = (result as any).rows || result || [];
      const row = rows[0] || { bom_cost: 0, component_count: 0 };
      return {
        bom_cost: parseFloat(row.bom_cost) || 0,
        component_count: parseInt(row.component_count) || 0,
      };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Failed to calculate BOM cost');
    }
  }

  async checkBOMAvailability(companyId: string, productId: string, quantity: number) {
    try {
      if (!quantity || quantity <= 0) {
        throw new ApiError(400, 'La cantidad debe ser mayor a 0');
      }

      const result = await db.execute(sql`
        SELECT
          pc.id,
          pc.component_product_id,
          p.name as component_name,
          p.sku as component_sku,
          pc.quantity_required,
          pc.unit,
          COALESCE(
            (SELECT SUM(CAST(s.quantity AS decimal)) FROM stock s WHERE s.product_id = pc.component_product_id),
            0
          ) as stock_available
        FROM product_components pc
        JOIN products p ON pc.component_product_id = p.id
        WHERE pc.product_id = ${productId} AND pc.company_id = ${companyId}
        ORDER BY p.name ASC
      `);
      const rows = (result as any).rows || result || [];

      let allSufficient = true;
      const components = rows.map((row: any) => {
        const needed = parseFloat(row.quantity_required) * quantity;
        const available = parseFloat(row.stock_available) || 0;
        const sufficient = available >= needed;
        if (!sufficient) allSufficient = false;
        return {
          id: row.id,
          component_product_id: row.component_product_id,
          component_name: row.component_name,
          component_sku: row.component_sku,
          quantity_required: parseFloat(row.quantity_required),
          unit: row.unit,
          needed,
          available,
          sufficient,
        };
      });

      return {
        sufficient: allSufficient,
        quantity_requested: quantity,
        components,
      };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Failed to check BOM availability');
    }
  }

  async getProductsUsingComponent(companyId: string, componentProductId: string) {
    try {
      const result = await db.execute(sql`
        SELECT p.id, p.name, p.sku, pc.quantity_required, pc.unit
        FROM product_components pc
        JOIN products p ON pc.product_id = p.id
        WHERE pc.component_product_id = ${componentProductId} AND pc.company_id = ${companyId}
        ORDER BY p.name ASC
      `);
      return (result as any).rows || result || [];
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Failed to get products using component');
    }
  }

  private async validateNoCycle(productId: string, componentProductId: string) {
    try {
      const result = await db.execute(sql`
        WITH RECURSIVE bom_tree AS (
          SELECT component_product_id
          FROM product_components
          WHERE product_id = ${componentProductId}
          UNION ALL
          SELECT pc.component_product_id
          FROM product_components pc
          JOIN bom_tree bt ON pc.product_id = bt.component_product_id
        )
        SELECT 1 FROM bom_tree WHERE component_product_id = ${productId} LIMIT 1
      `);
      const rows = (result as any).rows || result || [];
      if (rows.length > 0) {
        throw new ApiError(400, 'Referencia circular detectada en la composicion del producto');
      }
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Failed to validate component hierarchy');
    }
  }
}

export const productComponentsService = new ProductComponentsService();
