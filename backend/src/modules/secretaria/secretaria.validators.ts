// SecretarIA Constitutional Validator — 7-layer business rule enforcement
// HARD BLOCKS that can NEVER be bypassed, even by the LLM

import { pool } from '../../config/db';
import { resolveEnterprise, resolveProduct, resolveOrder, resolveInvoice } from './secretaria.resolver';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  suggestions: string[];
  resolvedData?: Record<string, any>; // IDs resolved from names
  preview?: Record<string, any>; // Calculated totals for preview
}

// ═══════════════════════════════════════════════════════════════════
// MASTER VALIDATOR — runs all 7 layers
// ═══════════════════════════════════════════════════════════════════

export async function validateAction(
  companyId: string,
  userId: string,
  intent: string,
  entities: Record<string, any>,
): Promise<ValidationResult> {
  const errors: string[] = [];
  const suggestions: string[] = [];
  const resolvedData: Record<string, any> = {};

  // Layer 1: IMMUTABILITY — cannot modify completed/authorized records
  if (intent === 'authorize_invoice') {
    const inv = entities.invoice_id ? await pool.query(
      'SELECT status FROM invoices WHERE id = $1 AND company_id = $2', [entities.invoice_id, companyId]
    ).then(r => r.rows[0]).catch(() => null) : null;
    if (inv && inv.status === 'authorized') {
      errors.push('Esa factura ya esta autorizada. No se puede volver a autorizar.');
    }
  }

  // Layer 2: REFERENTIAL INTEGRITY — resolve names to IDs
  if (entities.enterprise_name) {
    const res = await resolveEnterprise(companyId, entities.enterprise_name);
    if (res.resolved && res.entity) {
      resolvedData.enterprise_id = res.entity.id;
      resolvedData.enterprise_name = res.entity.name;
      resolvedData.enterprise_cuit = res.entity.extra?.cuit;
    } else if (res.ambiguous) {
      errors.push(`Encontre ${res.ambiguous.length} empresas que matchean "${entities.enterprise_name}":`);
      suggestions.push(res.ambiguous.map((e, i) => `${i + 1}. ${e.name}${e.extra?.cuit ? ` (${e.extra.cuit})` : ''}`).join('\n'));
      suggestions.push('Decime cual es.');
    } else {
      errors.push(res.error || `No encontre la empresa "${entities.enterprise_name}"`);
      suggestions.push('Podes darme el nombre completo o el CUIT?');
    }
  }

  if (entities.order_number || entities.order_ref) {
    const ref = entities.order_number || entities.order_ref;
    const res = await resolveOrder(companyId, String(ref));
    if (res.resolved && res.entity) {
      resolvedData.order_id = res.entity.id;
      resolvedData.order_number = res.entity.extra?.order_number;
      resolvedData.order_enterprise_id = res.entity.extra?.enterprise_id;
      resolvedData.order_total = res.entity.extra?.total;
      resolvedData.order_status = res.entity.extra?.status;
    } else if (res.ambiguous) {
      errors.push(`Encontre ${res.ambiguous.length} pedidos. Cual?`);
      suggestions.push(res.ambiguous.map(o => `- ${o.name}`).join('\n'));
    } else {
      errors.push(res.error || `No encontre el pedido "${ref}"`);
    }
  }

  // Resolve items products
  if (entities.items && Array.isArray(entities.items)) {
    const resolvedItems: any[] = [];
    for (const item of entities.items) {
      if (item.product_name) {
        const res = await resolveProduct(companyId, item.product_name);
        if (res.resolved && res.entity) {
          resolvedItems.push({
            ...item,
            product_id: res.entity.id,
            product_name: res.entity.name,
            unit_price: item.unit_price || res.entity.extra?.price || 0,
          });
        } else {
          // Allow custom products (not in DB)
          resolvedItems.push({ ...item, product_id: null });
        }
      } else {
        resolvedItems.push(item);
      }
    }
    resolvedData.items = resolvedItems;
  }

  // Layer 3: BUSINESS RULES
  if (intent === 'create_invoice' || intent === 'create_invoice_partial') {
    // Rule: all items must be from the same enterprise
    if (resolvedData.order_id) {
      const orderEnterprise = resolvedData.order_enterprise_id;
      // If also have items from another order, check enterprises match
      if (entities.additional_order_ref) {
        const additionalOrder = await resolveOrder(companyId, String(entities.additional_order_ref));
        if (additionalOrder.resolved && additionalOrder.entity) {
          const additionalEnterpriseId = additionalOrder.entity.extra?.enterprise_id;
          if (additionalEnterpriseId && orderEnterprise && additionalEnterpriseId !== orderEnterprise) {
            errors.push('No puedo facturar items de 2 empresas distintas en una sola factura.');
            suggestions.push('Puedo crear 2 facturas separadas, una por cada empresa. Queres?');
          }
        }
      }
    }
  }

  // Layer 4: AUTHORITY — check user permissions
  try {
    const userPerms = await pool.query(
      'SELECT role FROM users WHERE id = $1 AND company_id = $2', [userId, companyId]
    );
    const role = userPerms.rows[0]?.role || 'viewer';
    if (role === 'viewer' && intent.startsWith('create_')) {
      errors.push('Tu rol (viewer) no tiene permisos para crear registros.');
      suggestions.push('Pedile a un administrador que te de permisos de editor.');
    }
  } catch { /* non-blocking */ }

  // Layer 5: DEDUPLICATION — prevent accidental duplicates
  if (intent === 'create_order' && resolvedData.enterprise_id && resolvedData.items?.length) {
    const recentDup = await pool.query(
      `SELECT id, order_number FROM orders
       WHERE company_id = $1 AND enterprise_id = $2
       AND created_at > NOW() - INTERVAL '5 minutes'
       ORDER BY created_at DESC LIMIT 1`,
      [companyId, resolvedData.enterprise_id],
    ).catch(() => ({ rows: [] }));
    if (recentDup.rows.length > 0) {
      const dup = recentDup.rows[0];
      suggestions.push(`Ojo: ya creaste el pedido #${String(dup.order_number).padStart(4, '0')} para esa empresa hace menos de 5 minutos. Seguro queres crear otro?`);
    }
  }

  // Layer 6: AMOUNT SANITY
  const items = resolvedData.items || entities.items || [];
  if (items.length > 0) {
    for (const item of items) {
      const qty = Number(item.quantity || 0);
      const price = Number(item.unit_price || 0);
      if (qty <= 0) errors.push(`Cantidad invalida para "${item.product_name}": ${qty}`);
      if (price < 0) errors.push(`Precio invalido para "${item.product_name}": $${price}`);
      if (qty > 100000) errors.push(`Cantidad sospechosamente alta: ${qty}. Seguro?`);
      if (price > 100000000) errors.push(`Precio sospechosamente alto: $${price}. Seguro?`);
    }
  }

  if (entities.amount) {
    const amt = Number(entities.amount);
    if (amt <= 0) errors.push('El monto debe ser mayor a $0');
    if (amt > 10000000) errors.push(`Monto de $${amt.toLocaleString('es-AR')} es muy alto. Seguro?`);
  }

  // Layer 7: CALCULATE PREVIEW
  if (errors.length === 0) {
    const preview = calculatePreview(intent, { ...entities, ...resolvedData });
    resolvedData.preview = preview;
  }

  return {
    valid: errors.length === 0,
    errors,
    suggestions,
    resolvedData: errors.length === 0 ? resolvedData : undefined,
    preview: errors.length === 0 ? resolvedData.preview : undefined,
  };
}

// ═══════════════════════════════════════════════════════════════════
// PREVIEW CALCULATOR — compute totals before execution
// ═══════════════════════════════════════════════════════════════════

function calculatePreview(intent: string, data: Record<string, any>): Record<string, any> {
  const items = data.items || [];
  const discount = Number(data.discount_percent || 0);

  if (intent.startsWith('create_order') || intent.startsWith('create_invoice') || intent.startsWith('create_quote')) {
    const neto = items.reduce((s: number, i: any) => s + (Number(i.quantity || 0) * Number(i.unit_price || 0)), 0);
    const discountAmount = neto * discount / 100;
    const netoConDescuento = neto - discountAmount;
    const iva = items.reduce((s: number, i: any) => {
      const itemNeto = Number(i.quantity || 0) * Number(i.unit_price || 0) * (1 - discount / 100);
      return s + itemNeto * (Number(i.vat_rate || 21) / 100);
    }, 0);
    const total = netoConDescuento + iva;

    return {
      items_count: items.length,
      neto: Math.round(neto * 100) / 100,
      discount_percent: discount,
      discount_amount: Math.round(discountAmount * 100) / 100,
      iva: Math.round(iva * 100) / 100,
      total: Math.round(total * 100) / 100,
      enterprise_name: data.enterprise_name,
    };
  }

  if (intent === 'create_cobro') {
    return {
      enterprise_name: data.enterprise_name,
      amount: Number(data.amount || 0),
      payment_methods: data.payment_methods || [{ method: data.payment_method || 'efectivo', amount: Number(data.amount || 0) }],
    };
  }

  return {};
}
