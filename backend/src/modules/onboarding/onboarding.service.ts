import { pool } from '../../config/db';
import { ApiError } from '../../middlewares/errorHandler';

export class OnboardingService {
  async getStatus(companyId: string) {
    const result = await pool.query(
      `SELECT onboarding_completed, onboarding_current_step, enabled_modules,
              name, cuit, razon_social, condicion_iva, address, city, province,
              phone, email, punto_venta, logo_url
       FROM companies WHERE id = $1`,
      [companyId]
    );

    if (result.rows.length === 0) {
      throw new ApiError(404, 'Company not found');
    }

    const company = result.rows[0];

    // Check if company already has data (existing company that got the migration)
    // If they have products or invoices, auto-complete onboarding
    if (!company.onboarding_completed) {
      const dataCheck = await pool.query(
        `SELECT
          (SELECT COUNT(*) FROM products WHERE company_id = $1)::int as products_count,
          (SELECT COUNT(*) FROM invoices WHERE company_id = $1)::int as invoices_count,
          (SELECT COUNT(*) FROM orders WHERE company_id = $1)::int as orders_count`,
        [companyId]
      );
      const counts = dataCheck.rows[0];
      if (counts.products_count > 0 || counts.invoices_count > 0 || counts.orders_count > 0) {
        // Auto-complete onboarding for existing companies
        await pool.query(
          `UPDATE companies SET onboarding_completed = true, onboarding_completed_at = NOW() WHERE id = $1`,
          [companyId]
        );
        return {
          completed: true,
          currentStep: 5,
          company: { ...company, onboarding_completed: true },
        };
      }
    }

    return {
      completed: company.onboarding_completed || false,
      currentStep: company.onboarding_current_step || 0,
      company,
    };
  }

  async completeStep(companyId: string, step: number, data: Record<string, unknown>) {
    switch (step) {
      case 1:
        return this.saveCompanyData(companyId, data);
      case 2:
        return this.saveModules(companyId, data);
      case 3:
        return this.saveProduct(companyId, data);
      case 4:
        return this.saveCustomer(companyId, data);
      default:
        throw new ApiError(400, 'Invalid step number');
    }
  }

  private async saveCompanyData(companyId: string, data: Record<string, unknown>) {
    const fields: Record<string, unknown> = {};
    const allowedFields = [
      'name', 'cuit', 'razon_social', 'condicion_iva', 'address',
      'city', 'province', 'phone', 'email', 'punto_venta', 'logo_url',
    ];

    for (const field of allowedFields) {
      if (data[field] !== undefined) {
        fields[field] = data[field];
      }
    }

    if (Object.keys(fields).length > 0) {
      const setClauses = Object.keys(fields).map((key, i) => `${key} = $${i + 2}`);
      const values = Object.values(fields);
      await pool.query(
        `UPDATE companies SET ${setClauses.join(', ')}, onboarding_current_step = GREATEST(onboarding_current_step, 1)
         WHERE id = $1`,
        [companyId, ...values]
      );
    }

    return { success: true, step: 1 };
  }

  private async saveModules(companyId: string, data: Record<string, unknown>) {
    const modules = data.enabled_modules;
    if (!Array.isArray(modules)) {
      throw new ApiError(400, 'enabled_modules must be an array');
    }

    await pool.query(
      `UPDATE companies SET enabled_modules = $2, onboarding_current_step = GREATEST(onboarding_current_step, 2)
       WHERE id = $1`,
      [companyId, modules]
    );

    return { success: true, step: 2 };
  }

  private async saveProduct(companyId: string, data: Record<string, unknown>) {
    const products = data.products;
    if (!Array.isArray(products)) {
      throw new ApiError(400, 'products must be an array');
    }

    const createdProducts = [];
    for (const product of products) {
      const p = product as Record<string, unknown>;
      const name = p.name as string;
      const cost = parseFloat(String(p.cost || 0));
      const price = parseFloat(String(p.price || 0));
      const vatRate = parseFloat(String(p.vat_rate || 21));
      const sku = (p.sku as string) || `SKU-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

      // Create product
      const productResult = await pool.query(
        `INSERT INTO products (company_id, name, sku, active)
         VALUES ($1, $2, $3, true) RETURNING id`,
        [companyId, name, sku]
      );

      const productId = productResult.rows[0].id;

      // Create pricing
      await pool.query(
        `INSERT INTO product_pricing (product_id, cost, final_price, vat_rate)
         VALUES ($1, $2, $3, $4)`,
        [productId, cost, price, vatRate]
      );

      createdProducts.push({ id: productId, name, sku });
    }

    await pool.query(
      `UPDATE companies SET onboarding_current_step = GREATEST(onboarding_current_step, 3) WHERE id = $1`,
      [companyId]
    );

    return { success: true, step: 3, products: createdProducts };
  }

  private async saveCustomer(companyId: string, data: Record<string, unknown>) {
    const customer = data.customer as Record<string, unknown> | undefined;
    if (!customer) {
      // Skipped
      await pool.query(
        `UPDATE companies SET onboarding_current_step = GREATEST(onboarding_current_step, 4) WHERE id = $1`,
        [companyId]
      );
      return { success: true, step: 4, skipped: true };
    }

    const name = customer.name as string;
    const cuit = customer.cuit as string;
    const condicionIva = customer.condicion_iva as string | undefined;
    const contactName = customer.contact_name as string | undefined;
    const email = customer.email as string | undefined;
    const phone = customer.phone as string | undefined;

    const result = await pool.query(
      `INSERT INTO customers (company_id, name, cuit, tax_condition, contact_name, email, phone)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (company_id, cuit) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [companyId, name, cuit, condicionIva || null, contactName || null, email || null, phone || null]
    );

    await pool.query(
      `UPDATE companies SET onboarding_current_step = GREATEST(onboarding_current_step, 4) WHERE id = $1`,
      [companyId]
    );

    return { success: true, step: 4, customer: { id: result.rows[0].id, name } };
  }

  async completeOnboarding(companyId: string) {
    await pool.query(
      `UPDATE companies
       SET onboarding_completed = true, onboarding_completed_at = NOW(), onboarding_current_step = 5
       WHERE id = $1`,
      [companyId]
    );

    return { success: true, completed: true };
  }

  async resetOnboarding(companyId: string) {
    await pool.query(
      `UPDATE companies
       SET onboarding_completed = false, onboarding_completed_at = NULL, onboarding_current_step = 0
       WHERE id = $1`,
      [companyId]
    );

    return { success: true, reset: true };
  }

  async updateModules(companyId: string, modules: string[]) {
    await pool.query(
      `UPDATE companies SET enabled_modules = $2 WHERE id = $1`,
      [companyId, modules]
    );

    return { success: true, enabled_modules: modules };
  }

  async lookupCUIT(cuit: string) {
    // Use a free CUIT lookup API
    // Primary: cuitonline.com API (free, no auth required)
    try {
      const cleanCuit = cuit.replace(/[^0-9]/g, '');
      if (cleanCuit.length !== 11) {
        return { found: false, error: 'CUIT must be 11 digits' };
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(
        `https://afip.tangofactura.com/Rest/GetContribuyenteFull?cuit=${cleanCuit}`,
        { signal: controller.signal }
      );
      clearTimeout(timeout);

      if (!response.ok) {
        return { found: false, error: 'AFIP_UNAVAILABLE' };
      }

      const data = await response.json() as any;

      if (!data || data.errorGetData) {
        return { found: false, error: 'CUIT_NOT_FOUND' };
      }

      const contribuyente = data.Contribuyente || {};
      const domicilio = contribuyente.domicilioFiscal || {};

      return {
        found: true,
        data: {
          razonSocial: contribuyente.nombre || data.razonSocial || data.nombre || null,
          condicionIVA: this.mapCondicionIVA(data),
          domicilioFiscal: domicilio.direccion || data.domicilioFiscal || null,
          provincia: domicilio.descripcionProvincia || null,
          localidad: domicilio.localidad || null,
        },
      };
    } catch (error: unknown) {
      const errorName = error instanceof Error ? error.name : 'Unknown';
      if (errorName === 'AbortError') {
        return { found: false, error: 'AFIP_TIMEOUT' };
      }
      return { found: false, error: 'AFIP_UNAVAILABLE' };
    }
  }

  private mapCondicionIVA(data: any): string | null {
    // Try to extract condicion IVA from different API response formats
    const contribuyente = data.Contribuyente;
    if (contribuyente) {
      const impuestos = contribuyente.impuestos;
      if (Array.isArray(impuestos)) {
        const ivaImpuesto = impuestos.find(
          (i: any) => i.idImpuesto === 30 || i.idImpuesto === 32 || i.idImpuesto === 20
        );
        if (ivaImpuesto) {
          const id = ivaImpuesto.idImpuesto;
          if (id === 30) return 'IVA Responsable Inscripto';
          if (id === 32) return 'IVA Sujeto Exento';
          if (id === 20) return 'Monotributo';
        }
      }
      // Check tipoPersona or other fields
      if (contribuyente.tipoClave === 'CUIL') return 'Consumidor Final';
    }

    // Fallback: check flat structure
    if (data.condicionIVA) return data.condicionIVA;

    return null;
  }
}

export const onboardingService = new OnboardingService();
