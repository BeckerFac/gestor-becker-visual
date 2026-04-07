// SecretarIA Executor — Executes confirmed write operations by calling existing services
// CRITICAL: Never reimplements business logic. Always delegates to the service layer.

import { ordersService } from '../orders/orders.service';
import { invoicesService } from '../invoices/invoices.service';
import { cobrosService } from '../cobros/cobros.service';
import { quotesService } from '../quotes/quotes.service';
import { remitosService } from '../remitos/remitos.service';
import { enterprisesService } from '../enterprises/enterprises.service';
import { pool } from '../../config/db';

interface ExecutionResult {
  success: boolean;
  formatted: string; // Human-readable result for WhatsApp/chat
  data?: any; // Raw result data
  error?: string;
}

function fmt(n: number): string {
  return '$' + n.toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

// ═══════════════════════════════════════════════════════════════════
// EXECUTE BY INTENT — main dispatcher
// ═══════════════════════════════════════════════════════════════════

export async function executeWriteAction(
  companyId: string,
  userId: string,
  intent: string,
  resolvedData: Record<string, any>,
): Promise<ExecutionResult> {
  try {
    switch (intent) {
      case 'create_order': return await executeCreateOrder(companyId, userId, resolvedData);
      case 'create_invoice':
      case 'create_invoice_partial': return await executeCreateInvoice(companyId, userId, resolvedData);
      case 'create_cobro': return await executeCreateCobro(companyId, userId, resolvedData);
      case 'create_quote': return await executeCreateQuote(companyId, userId, resolvedData);
      case 'create_remito': return await executeCreateRemito(companyId, userId, resolvedData);
      case 'create_enterprise': return await executeCreateEnterprise(companyId, resolvedData);
      case 'update_order_status': return await executeUpdateOrderStatus(companyId, userId, resolvedData);
      default:
        return { success: false, formatted: `Operacion "${intent}" no esta implementada todavia.` };
    }
  } catch (error: any) {
    return {
      success: false,
      formatted: `Error al ejecutar: ${error.message?.substring(0, 100) || 'error desconocido'}`,
      error: error.message,
    };
  }
}

// ═══════════════════════════════════════════════════════════════════
// CREATE ORDER
// ═══════════════════════════════════════════════════════════════════

async function executeCreateOrder(companyId: string, userId: string, data: Record<string, any>): Promise<ExecutionResult> {
  const payload = {
    title: data.title || `Pedido - ${data.enterprise_name || 'Sin empresa'}`,
    enterprise_id: data.enterprise_id || null,
    customer_id: data.customer_id || null,
    items: (data.items || []).map((i: any) => ({
      product_id: i.product_id || null,
      product_name: i.product_name,
      quantity: Number(i.quantity) || 1,
      unit_price: Number(i.unit_price) || 0,
      vat_rate: Number(i.vat_rate) || 21,
    })),
    discount_percent: Number(data.discount_percent) || 0,
    priority: data.priority || 'normal',
    notes: data.notes || null,
  };

  const result: any = await ordersService.createOrder(companyId, userId, payload);
  const num = String(result.order_number).padStart(4, '0');
  const total = parseFloat(result.total_amount || '0');

  return {
    success: true,
    formatted: `Pedido #${num} creado por ${fmt(total)} para ${data.enterprise_name || 'sin empresa'}`,
    data: result,
  };
}

// ═══════════════════════════════════════════════════════════════════
// CREATE INVOICE (from order items)
// ═══════════════════════════════════════════════════════════════════

async function executeCreateInvoice(companyId: string, userId: string, data: Record<string, any>): Promise<ExecutionResult> {
  // Get order items if we have an order_id
  let invoiceItems = data.items || [];

  if (data.order_id && invoiceItems.length === 0) {
    // Load all uninvoiced items from the order
    const orderDetail = await ordersService.getOrderInvoicingDetail(companyId, data.order_id);
    if (orderDetail?.items) {
      invoiceItems = orderDetail.items
        .filter((i: any) => parseFloat(i.qty_remaining || '0') > 0)
        .map((i: any) => ({
          product_name: i.product_name,
          quantity: data.item_count ? Math.min(parseFloat(i.qty_remaining), data.item_count) : parseFloat(i.qty_remaining),
          unit_price: parseFloat(i.unit_price || '0'),
          vat_rate: parseFloat(i.vat_rate || '21'),
          order_item_id: i.order_item_id,
        }));
    }
  }

  const payload = {
    enterprise_id: data.enterprise_id || data.order_enterprise_id || null,
    customer_id: data.customer_id || null,
    fiscal_type: data.fiscal_type || 'no_fiscal',
    invoice_type: data.invoice_type || 'B',
    items: invoiceItems.map((i: any) => ({
      product_name: i.product_name,
      quantity: Number(i.quantity) || 1,
      unit_price: Number(i.unit_price) || 0,
      vat_rate: Number(i.vat_rate) || 21,
      order_item_id: i.order_item_id || null,
    })),
  };

  const result: any = await invoicesService.createInvoice(companyId, userId, payload);
  const num = result.invoice_number;
  const total = parseFloat(result.total_amount || '0');

  return {
    success: true,
    formatted: `Factura ${result.invoice_type || 'B'} ${num} creada por ${fmt(total)} (borrador). Queres que la autorice con AFIP?`,
    data: result,
  };
}

// ═══════════════════════════════════════════════════════════════════
// CREATE COBRO (receipt)
// ═══════════════════════════════════════════════════════════════════

async function executeCreateCobro(companyId: string, userId: string, data: Record<string, any>): Promise<ExecutionResult> {
  const paymentMethods = data.payment_methods || [
    { method: data.payment_method || 'efectivo', amount: Number(data.amount) || 0 },
  ];

  const payload: any = {
    enterprise_id: data.enterprise_id || null,
    amount: paymentMethods.reduce((s: number, pm: any) => s + Number(pm.amount || 0), 0),
    payment_methods: paymentMethods,
    payment_date: data.payment_date || new Date().toISOString(),
    notes: data.notes || null,
  };

  // Link to invoices if specified
  if (data.invoice_items && data.invoice_items.length > 0) {
    payload.invoice_items = data.invoice_items;
  }

  const result: any = await cobrosService.createCobro(companyId, userId, payload);
  const num = String(result.receipt_number).padStart(4, '0');
  const total = parseFloat(result.total_amount || result.amount || '0');

  return {
    success: true,
    formatted: `Recibo #${num} registrado por ${fmt(total)}`,
    data: result,
  };
}

// ═══════════════════════════════════════════════════════════════════
// CREATE QUOTE
// ═══════════════════════════════════════════════════════════════════

async function executeCreateQuote(companyId: string, userId: string, data: Record<string, any>): Promise<ExecutionResult> {
  const payload = {
    title: data.title || `Cotizacion - ${data.enterprise_name || ''}`,
    enterprise_id: data.enterprise_id || null,
    customer_id: data.customer_id || null,
    valid_until: data.valid_until || null,
    items: (data.items || []).map((i: any) => ({
      product_name: i.product_name,
      quantity: Number(i.quantity) || 1,
      unit_price: Number(i.unit_price) || 0,
      vat_rate: Number(i.vat_rate) || 21,
    })),
    notes: data.notes || null,
  };

  const result: any = await quotesService.createQuote(companyId, userId, payload);
  const num = String(result.quote_number).padStart(4, '0');

  return {
    success: true,
    formatted: `Cotizacion #${num} creada. Queres que la envie al cliente?`,
    data: result,
  };
}

// ═══════════════════════════════════════════════════════════════════
// CREATE REMITO
// ═══════════════════════════════════════════════════════════════════

async function executeCreateRemito(companyId: string, userId: string, data: Record<string, any>): Promise<ExecutionResult> {
  const payload = {
    enterprise_id: data.enterprise_id || null,
    customer_id: data.customer_id || null,
    order_id: data.order_id || null,
    delivery_address: data.delivery_address || null,
    receiver_name: data.receiver_name || null,
    transport: data.transport || null,
    tipo: 'entrega',
    items: (data.items || []).map((i: any) => ({
      product_name: i.product_name,
      quantity: Number(i.quantity) || 1,
      unit: i.unit || 'unidades',
    })),
  };

  const result: any = await remitosService.createRemito(companyId, userId, payload);
  const num = String(result.remito_number).padStart(4, '0');

  return {
    success: true,
    formatted: `Remito #${num} creado. Listo para entregar.`,
    data: result,
  };
}

// ═══════════════════════════════════════════════════════════════════
// CREATE ENTERPRISE
// ═══════════════════════════════════════════════════════════════════

async function executeCreateEnterprise(companyId: string, data: Record<string, any>): Promise<ExecutionResult> {
  const payload = {
    name: data.name,
    cuit: data.cuit || null,
    tax_condition: data.tax_condition || null,
    phone: data.phone || null,
    email: data.email || null,
  };

  const result: any = await enterprisesService.createEnterprise(companyId, payload);

  return {
    success: true,
    formatted: `Empresa "${result.name}" creada${result.cuit ? ` (CUIT: ${result.cuit})` : ''}`,
    data: result,
  };
}

// ═══════════════════════════════════════════════════════════════════
// UPDATE ORDER STATUS
// ═══════════════════════════════════════════════════════════════════

async function executeUpdateOrderStatus(companyId: string, userId: string, data: Record<string, any>): Promise<ExecutionResult> {
  const result: any = await ordersService.updateOrderStatus(companyId, userId, data.order_id, {
    status: data.new_status,
    notes: data.notes || null,
  });

  const num = String(data.order_number || '?').padStart(4, '0');
  const statusLabels: Record<string, string> = {
    pendiente: 'Pendiente',
    en_produccion: 'En Produccion',
    terminado: 'Terminado',
    entregado: 'Entregado',
    cancelado: 'Cancelado',
  };

  return {
    success: true,
    formatted: `Pedido #${num} actualizado a "${statusLabels[data.new_status] || data.new_status}"`,
    data: result,
  };
}
