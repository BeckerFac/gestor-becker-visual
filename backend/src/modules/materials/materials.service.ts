import { pool } from '../../config/db';
import { ApiError } from '../../middlewares/errorHandler';
import { v4 as uuid } from 'uuid';

export class MaterialsService {
  async getMaterials(companyId: string, search?: string) {
    try {
      const conditions: string[] = ['m.company_id = $1', 'm.active = true'];
      const params: any[] = [companyId];
      let paramIdx = 2;

      if (search) {
        conditions.push(`(m.name ILIKE $${paramIdx} OR m.sku ILIKE $${paramIdx})`);
        params.push(`%${search}%`);
        paramIdx++;
      }

      const whereClause = conditions.join(' AND ');

      const result = await pool.query(`
        SELECT m.*,
          CASE
            WHEN CAST(m.stock AS decimal) <= 0 THEN 'sin_stock'
            WHEN CAST(m.stock AS decimal) <= CAST(m.min_stock AS decimal) AND CAST(m.min_stock AS decimal) > 0 THEN 'bajo'
            ELSE 'ok'
          END as stock_status
        FROM materials m
        WHERE ${whereClause}
        ORDER BY m.name ASC
      `, params);

      const rows = result.rows || [];

      // Summary stats
      const totalMaterials = rows.length;
      const lowStock = rows.filter((r: any) => r.stock_status === 'bajo').length;
      const outOfStock = rows.filter((r: any) => r.stock_status === 'sin_stock').length;

      return {
        items: rows,
        total: totalMaterials,
        low_stock: lowStock,
        out_of_stock: outOfStock,
      };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      console.error('Get materials error:', error);
      throw new ApiError(500, 'Error al obtener materiales');
    }
  }

  async getMaterial(companyId: string, materialId: string) {
    try {
      const result = await pool.query(
        'SELECT * FROM materials WHERE id = $1 AND company_id = $2 AND active = true',
        [materialId, companyId]
      );
      if (!result.rows || result.rows.length === 0) {
        throw new ApiError(404, 'Material no encontrado');
      }
      return result.rows[0];
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Error al obtener material');
    }
  }

  async createMaterial(companyId: string, data: any) {
    try {
      if (!data.name?.trim()) {
        throw new ApiError(400, 'El nombre del material es requerido');
      }

      const id = uuid();
      const sku = data.sku || this.generateSKU(data.name);

      // Check SKU uniqueness
      const existing = await pool.query(
        'SELECT id FROM materials WHERE company_id = $1 AND sku = $2 AND active = true',
        [companyId, sku]
      );
      if (existing.rows && existing.rows.length > 0) {
        throw new ApiError(409, 'Ya existe un material con ese SKU');
      }

      const result = await pool.query(`
        INSERT INTO materials (id, company_id, name, sku, unit, cost, stock, min_stock, description)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING *
      `, [
        id,
        companyId,
        data.name.trim(),
        sku,
        data.unit || 'unidad',
        parseFloat(data.cost) || 0,
        parseFloat(data.stock) || 0,
        parseFloat(data.min_stock) || 0,
        data.description || null,
      ]);

      return result.rows[0];
    } catch (error) {
      if (error instanceof ApiError) throw error;
      console.error('Create material error:', error);
      throw new ApiError(500, 'Error al crear material');
    }
  }

  async updateMaterial(companyId: string, materialId: string, data: any) {
    try {
      // Verify exists
      await this.getMaterial(companyId, materialId);

      const sets: string[] = [];
      const params: any[] = [];
      let paramIdx = 1;

      if (data.name !== undefined) {
        sets.push(`name = $${paramIdx}`);
        params.push(data.name.trim());
        paramIdx++;
      }
      if (data.sku !== undefined) {
        sets.push(`sku = $${paramIdx}`);
        params.push(data.sku);
        paramIdx++;
      }
      if (data.unit !== undefined) {
        sets.push(`unit = $${paramIdx}`);
        params.push(data.unit);
        paramIdx++;
      }
      if (data.cost !== undefined) {
        sets.push(`cost = $${paramIdx}`);
        params.push(parseFloat(data.cost) || 0);
        paramIdx++;
      }
      if (data.min_stock !== undefined) {
        sets.push(`min_stock = $${paramIdx}`);
        params.push(parseFloat(data.min_stock) || 0);
        paramIdx++;
      }
      if (data.description !== undefined) {
        sets.push(`description = $${paramIdx}`);
        params.push(data.description || null);
        paramIdx++;
      }

      sets.push('updated_at = NOW()');

      if (sets.length > 1) {
        params.push(materialId, companyId);
        await pool.query(
          `UPDATE materials SET ${sets.join(', ')} WHERE id = $${paramIdx} AND company_id = $${paramIdx + 1}`,
          params
        );
      }

      return this.getMaterial(companyId, materialId);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Error al actualizar material');
    }
  }

  async deleteMaterial(companyId: string, materialId: string) {
    try {
      // Check if used in any BOM
      const usageResult = await pool.query(
        `SELECT COUNT(*) as count FROM product_materials pm
         JOIN products p ON p.id = pm.product_id
         WHERE pm.material_id = $1 AND p.company_id = $2`,
        [materialId, companyId]
      );
      const usageCount = parseInt(usageResult.rows?.[0]?.count || '0', 10);
      if (usageCount > 0) {
        throw new ApiError(409, `Este material se usa en ${usageCount} producto${usageCount > 1 ? 's' : ''}. Eliminalo de la composicion antes de borrarlo.`);
      }

      // Soft delete
      await pool.query(
        'UPDATE materials SET active = false, updated_at = NOW() WHERE id = $1 AND company_id = $2',
        [materialId, companyId]
      );
      return { success: true };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Error al eliminar material');
    }
  }

  async adjustMaterialStock(companyId: string, materialId: string, quantityChange: number, reason: string, userId: string) {
    try {
      const material = await this.getMaterial(companyId, materialId);
      const currentStock = parseFloat(material.stock) || 0;
      const newStock = currentStock + quantityChange;

      // Allow negative stock but log warning
      if (newStock < 0) {
        console.warn(`Material ${material.name} (${materialId}) stock going negative: ${newStock}`);
      }

      await pool.query(
        'UPDATE materials SET stock = $1, updated_at = NOW() WHERE id = $2 AND company_id = $3',
        [newStock, materialId, companyId]
      );

      // Record movement
      await pool.query(`
        INSERT INTO material_stock_movements (id, material_id, company_id, quantity_change, reason, created_by)
        VALUES ($1, $2, $3, $4, $5, $6)
      `, [uuid(), materialId, companyId, quantityChange, reason || 'Ajuste manual', userId]);

      return {
        material_id: materialId,
        previous_stock: currentStock,
        quantity_change: quantityChange,
        new_stock: newStock,
      };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Error al ajustar stock de material');
    }
  }

  async getMaterialMovements(companyId: string, materialId: string) {
    try {
      const result = await pool.query(`
        SELECT msm.*, m.name as material_name, m.unit as material_unit
        FROM material_stock_movements msm
        JOIN materials m ON m.id = msm.material_id
        WHERE msm.material_id = $1 AND msm.company_id = $2
        ORDER BY msm.created_at DESC
        LIMIT 50
      `, [materialId, companyId]);
      return result.rows || [];
    } catch (error) {
      throw new ApiError(500, 'Error al obtener movimientos del material');
    }
  }

  // --- Product Materials (BOM) ---

  async getProductMaterials(productId: string) {
    try {
      const result = await pool.query(`
        SELECT pm.*, m.name as material_name, m.sku as material_sku,
               m.unit as material_unit, m.cost as material_cost, m.stock as material_stock
        FROM product_materials pm
        JOIN materials m ON m.id = pm.material_id AND m.active = true
        WHERE pm.product_id = $1
        ORDER BY m.name ASC
      `, [productId]);
      return result.rows || [];
    } catch (error) {
      console.error('Get product materials error:', error);
      return [];
    }
  }

  async setProductMaterials(productId: string, materials: { material_id: string; quantity: number; unit?: string; notes?: string }[]) {
    try {
      // Delete existing
      await pool.query('DELETE FROM product_materials WHERE product_id = $1', [productId]);

      // Insert new
      for (const mat of materials) {
        if (!mat.material_id || !mat.quantity || mat.quantity <= 0) continue;
        await pool.query(`
          INSERT INTO product_materials (id, product_id, material_id, quantity, unit, notes)
          VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT (product_id, material_id) DO UPDATE SET quantity = $4, unit = $5, notes = $6
        `, [uuid(), productId, mat.material_id, mat.quantity, mat.unit || 'unidad', mat.notes || null]);
      }

      return this.getProductMaterials(productId);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      console.error('Set product materials error:', error);
      throw new ApiError(500, 'Error al guardar materiales del producto');
    }
  }

  async getProductBOMCost(productId: string) {
    try {
      const result = await pool.query(`
        SELECT
          COALESCE(SUM(pm.quantity * COALESCE(CAST(m.cost AS decimal), 0)), 0) as bom_cost,
          COUNT(pm.id) as material_count
        FROM product_materials pm
        JOIN materials m ON m.id = pm.material_id AND m.active = true
        WHERE pm.product_id = $1
      `, [productId]);
      const row = result.rows?.[0] || { bom_cost: 0, material_count: 0 };
      return {
        bom_cost: parseFloat(row.bom_cost) || 0,
        material_count: parseInt(row.material_count) || 0,
      };
    } catch (error) {
      console.error('Get product BOM cost error:', error);
      return { bom_cost: 0, material_count: 0 };
    }
  }

  async consumeMaterialsForProduction(companyId: string, productId: string, quantity: number, userId: string) {
    try {
      // Get product materials
      const materials = await this.getProductMaterials(productId);
      if (materials.length === 0) {
        return { consumed: false, message: 'Producto sin materiales en BOM', warnings: [] };
      }

      // Get product name for notes
      const productResult = await pool.query('SELECT name FROM products WHERE id = $1', [productId]);
      const productName = productResult.rows?.[0]?.name || 'Desconocido';

      const warnings: string[] = [];
      const consumed: { material_id: string; material_name: string; quantity_consumed: number; new_stock: number }[] = [];

      for (const mat of materials) {
        const materialId = mat.material_id;
        const materialName = mat.material_name;
        const quantityNeeded = parseFloat(mat.quantity) * quantity;
        const currentStock = parseFloat(mat.material_stock) || 0;
        const newStock = currentStock - quantityNeeded;

        // Update material stock
        await pool.query(
          'UPDATE materials SET stock = $1, updated_at = NOW() WHERE id = $2',
          [newStock, materialId]
        );

        // Record movement
        const reason = `Consumo por produccion de ${quantity} unidad(es) de ${productName}`;
        await pool.query(`
          INSERT INTO material_stock_movements (id, material_id, company_id, quantity_change, reason, created_by)
          VALUES ($1, $2, $3, $4, $5, $6)
        `, [uuid(), materialId, companyId, -quantityNeeded, reason, userId]);

        if (newStock < 0) {
          warnings.push(`${materialName}: stock negativo (${newStock})`);
        } else if (newStock === 0) {
          warnings.push(`${materialName}: stock agotado`);
        }

        consumed.push({
          material_id: materialId,
          material_name: materialName,
          quantity_consumed: quantityNeeded,
          new_stock: newStock,
        });
      }

      return {
        consumed: true,
        product_name: productName,
        units_produced: quantity,
        materials_consumed: consumed,
        warnings,
      };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      console.error('Consume materials error:', error);
      throw new ApiError(500, 'Error al consumir materiales para produccion');
    }
  }

  async checkMaterialAvailability(productId: string, quantity: number) {
    try {
      const materials = await this.getProductMaterials(productId);
      if (materials.length === 0) {
        return { has_bom: false, sufficient: true, materials: [] };
      }

      let allSufficient = true;
      const availability = materials.map((mat: any) => {
        const needed = parseFloat(mat.quantity) * quantity;
        const available = parseFloat(mat.material_stock) || 0;
        const sufficient = available >= needed;
        if (!sufficient) allSufficient = false;
        return {
          material_id: mat.material_id,
          material_name: mat.material_name,
          material_sku: mat.material_sku,
          needed,
          available,
          sufficient,
          unit: mat.material_unit || mat.unit,
        };
      });

      return {
        has_bom: true,
        sufficient: allSufficient,
        materials: availability,
      };
    } catch (error) {
      console.error('Check material availability error:', error);
      return { has_bom: false, sufficient: true, materials: [] };
    }
  }

  private generateSKU(name: string): string {
    const prefix = 'MAT';
    const namePart = name.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').substring(0, 4);
    const random = Math.floor(Math.random() * 9000 + 1000);
    return `${prefix}-${namePart}-${random}`;
  }
}

export const materialsService = new MaterialsService();
