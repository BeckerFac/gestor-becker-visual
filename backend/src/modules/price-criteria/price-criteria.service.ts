import { pool } from '../../config/db';

export class PriceCriteriaService {
  private migrationsRun = false;

  async ensureMigrations() {
    if (this.migrationsRun) return;
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS price_criteria (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
          name VARCHAR(100) NOT NULL,
          sort_order INTEGER DEFAULT 0,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          UNIQUE(company_id, name)
        )
      `);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_price_criteria_company ON price_criteria(company_id)`);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS product_prices (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
          product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
          criteria_name VARCHAR(100) NOT NULL,
          price DECIMAL(12,2) NOT NULL,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          UNIQUE(company_id, product_id, criteria_name)
        )
      `);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_product_prices_product ON product_prices(product_id)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_product_prices_company ON product_prices(company_id)`);

      this.migrationsRun = true;
    } catch (error) {
      console.error('Price criteria migrations error:', error);
    }
  }

  async getCriteria(companyId: string) {
    await this.ensureMigrations();
    const result = await pool.query(
      'SELECT id, name, sort_order, created_at FROM price_criteria WHERE company_id = $1 ORDER BY sort_order ASC, name ASC',
      [companyId]
    );
    return result.rows;
  }

  async createCriteria(companyId: string, name: string) {
    await this.ensureMigrations();
    const trimmed = name.trim();
    if (!trimmed) throw new Error('Name is required');

    // Get max sort_order
    const maxRes = await pool.query(
      'SELECT COALESCE(MAX(sort_order), -1) + 1 as next_order FROM price_criteria WHERE company_id = $1',
      [companyId]
    );
    const sortOrder = maxRes.rows[0].next_order;

    const result = await pool.query(
      'INSERT INTO price_criteria (company_id, name, sort_order) VALUES ($1, $2, $3) RETURNING id, name, sort_order, created_at',
      [companyId, trimmed, sortOrder]
    );
    return result.rows[0];
  }

  async deleteCriteria(companyId: string, criteriaId: string) {
    await this.ensureMigrations();
    // Get criteria name first to clean up product_prices
    const criteria = await pool.query(
      'SELECT name FROM price_criteria WHERE id = $1 AND company_id = $2',
      [criteriaId, companyId]
    );
    if (criteria.rows.length === 0) throw new Error('Criteria not found');

    const criteriaName = criteria.rows[0].name;

    // Delete product prices for this criteria
    await pool.query(
      'DELETE FROM product_prices WHERE company_id = $1 AND criteria_name = $2',
      [companyId, criteriaName]
    );

    // Delete the criteria
    await pool.query(
      'DELETE FROM price_criteria WHERE id = $1 AND company_id = $2',
      [criteriaId, companyId]
    );

    return { deleted: true };
  }

  async getProductPrices(companyId: string, productId: string) {
    await this.ensureMigrations();
    const result = await pool.query(
      'SELECT id, criteria_name, price FROM product_prices WHERE company_id = $1 AND product_id = $2 ORDER BY criteria_name ASC',
      [companyId, productId]
    );
    return result.rows;
  }

  async setProductPrices(companyId: string, productId: string, prices: Record<string, number>) {
    await this.ensureMigrations();

    // Delete existing prices for this product
    await pool.query(
      'DELETE FROM product_prices WHERE company_id = $1 AND product_id = $2',
      [companyId, productId]
    );

    // Insert new prices
    const entries = Object.entries(prices).filter(([_, price]) => price !== null && price !== undefined);
    for (const [criteriaName, price] of entries) {
      await pool.query(
        'INSERT INTO product_prices (company_id, product_id, criteria_name, price) VALUES ($1, $2, $3, $4)',
        [companyId, productId, criteriaName, price]
      );
    }

    return await this.getProductPrices(companyId, productId);
  }
}

export const priceCriteriaService = new PriceCriteriaService();
