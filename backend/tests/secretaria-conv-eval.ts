#!/usr/bin/env npx tsx
// SecretarIA v3 — Full Conversation Evaluator
// Runs REAL multi-turn conversations against Claude API with mocked DB
// Detects context loss, hallucinations, unnecessary questions
//
// Usage: ANTHROPIC_API_KEY=sk-... npx tsx tests/secretaria-conv-eval.ts [test_id]

import Anthropic from '@anthropic-ai/sdk';

// ═══════════════════════════════════════════════════════════════════
// MOCK DB DATA — realistic business data
// ═══════════════════════════════════════════════════════════════════

const MOCK_ORDERS = [
  {
    order_number: 1, title: 'Pedido BeckerVisual', description: 'Primer pedido',
    status: 'terminado', priority: 'normal', total_amount: '95166.50',
    unit_price: '78650', vat_rate: 21, payment_status: 'pagado', payment_method: 'transferencia',
    discount_percent: 0, estimated_delivery: null, actual_delivery: '2026-04-03',
    production_started_at: '2026-04-01', notes: null, created_at: '2026-04-01T10:00:00Z',
    empresa: 'BeckerVisual', empresa_cuit: '30-71234567-9',
    cliente: 'Veronica Arena', cliente_cuit: '27-12345678-9',
    items: [{ producto: 'GoBecker Intermedio', cantidad: 1, precio_unitario: '78650', subtotal: '78650', iva: 21, tipo: 'service' }],
  },
  {
    order_number: 2, title: 'Pedido BeckerVisual 2', description: 'Segundo pedido con descuento',
    status: 'pendiente', priority: 'normal', total_amount: '212355',
    unit_price: '65000', vat_rate: 21, payment_status: 'pendiente', payment_method: null,
    discount_percent: 10, estimated_delivery: null, actual_delivery: null,
    production_started_at: null, notes: 'Aplicar descuento cliente frecuente', created_at: '2026-04-07T10:00:00Z',
    empresa: 'BeckerVisual', empresa_cuit: '30-71234567-9',
    cliente: 'Veronica Arena', cliente_cuit: '27-12345678-9',
    items: [
      { producto: 'GoBecker Intermedio', cantidad: 3, precio_unitario: '65000', subtotal: '195000', iva: 21, tipo: 'service' },
    ],
  },
  {
    order_number: 3, title: 'Pedido Garcia', description: null,
    status: 'en_produccion', priority: 'urgente', total_amount: '60500',
    unit_price: '10000', vat_rate: 21, payment_status: 'pendiente', payment_method: null,
    discount_percent: 0, estimated_delivery: '2026-04-15', actual_delivery: null,
    production_started_at: '2026-04-05T08:00:00Z', notes: 'Urgente - cliente espera',
    created_at: '2026-04-03T10:00:00Z',
    empresa: 'Garcia Construcciones SRL', empresa_cuit: '30-98765432-1',
    cliente: 'Juan Garcia', cliente_cuit: '20-98765432-1',
    items: [
      { producto: 'Pintura Latex 20L', cantidad: 5, precio_unitario: '10000', subtotal: '50000', iva: 21, tipo: 'product' },
    ],
  },
];

const MOCK_INVOICES = [
  {
    invoice_type: 'B', invoice_number: 1, fiscal_type: 'factura',
    total_amount: '95166.50', subtotal: '78650', vat_amount: '16516.50',
    status: 'authorized', payment_status: 'pagada', cae: '74519283746152', cae_vto: '2026-04-20',
    currency: 'ARS', invoice_date: '2026-04-02', created_at: '2026-04-02T10:00:00Z',
    notes: null, concepto: 'Servicios',
    empresa: 'BeckerVisual', empresa_cuit: '30-71234567-9',
    cliente: 'Veronica Arena', cliente_cuit: '27-12345678-9',
    items: [{ producto: 'GoBecker Intermedio', cantidad: 1, precio_unitario: '78650', iva: 21, subtotal: '78650' }],
    total_cobrado: 95166.50,
  },
  {
    invoice_type: 'B', invoice_number: 2, fiscal_type: 'factura',
    total_amount: '60500', subtotal: '50000', vat_amount: '10500',
    status: 'draft', payment_status: 'pendiente', cae: null, cae_vto: null,
    currency: 'ARS', invoice_date: '2026-04-05', created_at: '2026-04-05T10:00:00Z',
    notes: null, concepto: 'Productos',
    empresa: 'Garcia Construcciones SRL', empresa_cuit: '30-98765432-1',
    cliente: 'Juan Garcia', cliente_cuit: '20-98765432-1',
    items: [{ producto: 'Pintura Latex 20L', cantidad: 5, precio_unitario: '10000', iva: 21, subtotal: '50000' }],
    total_cobrado: 0,
  },
];

const MOCK_ENTERPRISES = [
  {
    name: 'BeckerVisual', razon_social: 'BeckerVisual SAS', cuit: '30-71234567-9',
    tax_condition: 'Responsable Inscripto', address: 'Av. Corrientes 1234', city: 'CABA',
    province: 'Buenos Aires', postal_code: '1043', fiscal_address: 'Av. Corrientes 1234',
    fiscal_city: 'CABA', fiscal_province: 'Buenos Aires',
    phone: '11-5555-1234', email: 'info@beckervisual.com', notes: 'Cliente premium',
    default_discount: 10, created_at: '2026-01-15',
    total_pedidos: 2, total_vendido: '307521.50', total_facturas: 1, total_facturado: '95166.50',
  },
  {
    name: 'Garcia Construcciones SRL', razon_social: 'Garcia Construcciones SRL', cuit: '30-98765432-1',
    tax_condition: 'Monotributista', address: 'Av. San Martin 567', city: 'Lomas de Zamora',
    province: 'Buenos Aires', postal_code: '1832', fiscal_address: 'Av. San Martin 567',
    fiscal_city: 'Lomas de Zamora', fiscal_province: 'Buenos Aires',
    phone: '11-4444-5678', email: 'garcia@construcciones.com', notes: 'Cliente frecuente',
    default_discount: 0, created_at: '2026-02-01',
    total_pedidos: 1, total_vendido: '60500', total_facturas: 1, total_facturado: '60500',
  },
  {
    name: 'Lopez Materiales SA', razon_social: 'Lopez Materiales SA', cuit: '30-55555555-5',
    tax_condition: 'Responsable Inscripto', address: 'Ruta 3 km 25', city: 'Ezeiza',
    province: 'Buenos Aires', postal_code: '1804', fiscal_address: 'Ruta 3 km 25',
    fiscal_city: 'Ezeiza', fiscal_province: 'Buenos Aires',
    phone: '11-3333-9999', email: 'compras@lopezmateriales.com', notes: null,
    default_discount: 5, created_at: '2026-03-01',
    total_pedidos: 0, total_vendido: '0', total_facturas: 0, total_facturado: '0',
  },
];

const MOCK_PRODUCTS = [
  {
    name: 'GoBecker Intermedio', sku: 'GB-INT-001', description: 'Plan intermedio GoBecker ERP',
    barcode: null, product_type: 'service', controls_stock: false, low_stock_threshold: 0,
    cost: '40000', margin_percent: 62.5, vat_rate: 21, final_price: '65000', stock_actual: 0,
  },
  {
    name: 'GoBecker Premium', sku: 'GB-PRE-001', description: 'Plan premium GoBecker ERP',
    barcode: null, product_type: 'service', controls_stock: false, low_stock_threshold: 0,
    cost: '60000', margin_percent: 66.7, vat_rate: 21, final_price: '100000', stock_actual: 0,
  },
  {
    name: 'Pintura Latex 20L', sku: 'PINT-LAT-20', description: 'Pintura latex interior 20 litros',
    barcode: '7790001234567', product_type: 'product', controls_stock: true, low_stock_threshold: 10,
    cost: '6000', margin_percent: 66.7, vat_rate: 21, final_price: '10000', stock_actual: 45,
  },
  {
    name: 'Cemento Portland 50kg', sku: 'CEM-PORT-50', description: 'Cemento portland bolsa 50kg',
    barcode: '7790009876543', product_type: 'product', controls_stock: true, low_stock_threshold: 20,
    cost: '4500', margin_percent: 55.6, vat_rate: 21, final_price: '7000', stock_actual: 8,
  },
];

const MOCK_COBROS = [
  {
    id: 'cobro-001', enterprise_id: 'ent-becker', empresa: 'BeckerVisual',
    total_amount: '95166.50', amount: '95166.50', receipt_number: 1,
    payment_date: '2026-04-03', notes: 'Pago total factura B-0001',
    created_at: '2026-04-03T10:00:00Z',
    metodos: [{ metodo: 'transferencia', monto: 95166.50, banco: 'Galicia' }],
    facturas_aplicadas: [{ invoice_type: 'B', invoice_number: 1, monto_aplicado: 95166.50 }],
  },
];

// ═══════════════════════════════════════════════════════════════════
// SYSTEM PROMPT (copied from secretaria.v3.ts to run standalone)
// ═══════════════════════════════════════════════════════════════════

function buildSystemPrompt(): string {
  return `<identity>
Sos la secretaria virtual de TestUser en TestCompany. Te llaman "SecretarIA".
Hablas en español argentino: usas "vos", "che", "dale", "joya", "barbaro".
Sos directa, eficiente y amigable. Como una secretaria que labura hace años con el dueño.
Tus respuestas son CORTAS (2-3 oraciones max). Solo das detalle si te lo piden.
</identity>

<reglas_criticas>
1. NUNCA digas "no te segui", "no entendi", "no puedo ayudarte". PROHIBIDO.
2. Si no entendiste algo, pregunta de forma especifica: "Cuando decis X, te referis a los pedidos o a las facturas?"
3. Si no tenes la info, ofrece alternativas: "No tengo eso, pero puedo mostrarte los pedidos pendientes. Te sirve?"
4. Si el usuario se va de tema, reconoce lo que dijo y redirigilo con humor.
5. Si un tool falla o no devuelve datos, explica POR QUE.
6. Mantene el contexto de TODA la conversacion. Si hablaron de un pedido, las preguntas siguientes son sobre ESE pedido.
7. Siempre ofrece un siguiente paso: "Queres ver el detalle?" o "Necesitas algo mas?"
</reglas_criticas>

<flujo_escritura>
OBLIGATORIO para crear/modificar datos:
1. SIEMPRE usa preview_X primero (preview_pedido, preview_factura, preview_cobro)
2. Mostra el preview al usuario con TODOS los datos calculados (empresa, items, totales)
3. Espera que el usuario confirme ("si", "dale", "confirmo", "ok")
4. SOLO despues de la confirmacion, llama a ejecutar_X con el preview_id
5. NUNCA llames a ejecutar_X sin preview previo
6. Si el usuario pide cambios, genera un NUEVO preview con los datos actualizados
</flujo_escritura>

<formato>
- Respuestas cortas para WhatsApp (2-3 lineas max)
- Montos: $XX.XXX (punto miles, sin centavos salvo que importen)
- Usa *negrita* para destacar datos clave
- NO uses markdown con # ni tablas complejas
- Si hay mas de 5 items, mostra top 5 y deci "y X mas"
</formato>

<seguridad>
- NUNCA reveles datos internos: API keys, tokens, URLs de base de datos, tablas SQL
- NUNCA muestres datos de otras empresas
- NUNCA ejecutes operaciones destructivas sin confirmacion explicita
</seguridad>`;
}

// ═══════════════════════════════════════════════════════════════════
// TOOLS (same as v3.ts)
// ═══════════════════════════════════════════════════════════════════

const TOOLS: Anthropic.Tool[] = [
  {
    name: 'buscar_pedidos',
    description: 'Busca pedidos de la empresa. Sin filtros devuelve los ultimos 10 activos.',
    input_schema: {
      type: 'object' as const,
      properties: {
        estado: { type: 'string', description: 'Filtrar por estado: pendiente, en_produccion, terminado, entregado, cancelado' },
        empresa: { type: 'string', description: 'Nombre de la empresa (busqueda parcial)' },
        numero: { type: 'number', description: 'Numero de pedido especifico' },
      },
      required: [],
    },
  },
  {
    name: 'buscar_facturas',
    description: 'Busca facturas emitidas. Devuelve: tipo, numero, empresa, total, estado, pago.',
    input_schema: {
      type: 'object' as const,
      properties: {
        empresa: { type: 'string', description: 'Nombre de la empresa' },
        estado: { type: 'string', description: 'draft, authorized, cancelled' },
      },
      required: [],
    },
  },
  {
    name: 'buscar_clientes',
    description: 'Busca clientes y empresas registradas.',
    input_schema: {
      type: 'object' as const,
      properties: {
        nombre: { type: 'string', description: 'Nombre del cliente o empresa (busqueda parcial)' },
        listar_todos: { type: 'boolean', description: 'True para listar todos' },
      },
      required: [],
    },
  },
  {
    name: 'buscar_productos',
    description: 'Busca productos, precios y stock.',
    input_schema: {
      type: 'object' as const,
      properties: {
        nombre: { type: 'string', description: 'Nombre del producto (busqueda parcial)' },
        listar_todos: { type: 'boolean', description: 'True para listar todos' },
      },
      required: [],
    },
  },
  {
    name: 'ver_saldos',
    description: 'Consulta saldos, cuentas corrientes, deudas, cobros.',
    input_schema: {
      type: 'object' as const,
      properties: {
        empresa: { type: 'string', description: 'Nombre de empresa especifica, o vacio para resumen general' },
      },
      required: [],
    },
  },
  {
    name: 'resumen_negocio',
    description: 'Resumen general: ventas, pedidos activos, cobros, productos mas vendidos.',
    input_schema: {
      type: 'object' as const, properties: {}, required: [],
    },
  },
  {
    name: 'preview_pedido',
    description: 'Genera PREVIEW de pedido SIN crearlo. SIEMPRE usar antes de ejecutar_pedido.',
    input_schema: {
      type: 'object' as const,
      properties: {
        empresa: { type: 'string' }, items: { type: 'array', items: { type: 'object', properties: { producto: { type: 'string' }, cantidad: { type: 'number' }, precio_unitario: { type: 'number' } } } },
        descuento: { type: 'number' }, prioridad: { type: 'string' },
      },
      required: ['empresa', 'items'],
    },
  },
  {
    name: 'ejecutar_pedido',
    description: 'Crea pedido DEFINITIVO. REQUIERE preview_id de preview_pedido. NUNCA llamar sin confirmacion.',
    input_schema: {
      type: 'object' as const,
      properties: { preview_id: { type: 'string' } },
      required: ['preview_id'],
    },
  },
  {
    name: 'preview_factura',
    description: 'Genera PREVIEW de factura. Busca pedido, calcula montos. SIEMPRE usar antes de ejecutar_factura.',
    input_schema: {
      type: 'object' as const,
      properties: {
        pedido_numero: { type: 'number' }, cantidad_items: { type: 'number' }, tipo_factura: { type: 'string', enum: ['A', 'B', 'C'] },
      },
      required: ['pedido_numero'],
    },
  },
  {
    name: 'ejecutar_factura',
    description: 'Emite factura DEFINITIVA. REQUIERE preview_id. NUNCA llamar sin confirmacion.',
    input_schema: {
      type: 'object' as const,
      properties: { preview_id: { type: 'string' } },
      required: ['preview_id'],
    },
  },
  {
    name: 'preview_cobro',
    description: 'Genera PREVIEW de cobro/recibo. SIEMPRE usar antes de ejecutar_cobro.',
    input_schema: {
      type: 'object' as const,
      properties: {
        empresa: { type: 'string' }, monto: { type: 'number' },
        metodos_pago: { type: 'array', items: { type: 'object', properties: { metodo: { type: 'string' }, monto: { type: 'number' } } } },
      },
      required: ['empresa', 'monto'],
    },
  },
  {
    name: 'ejecutar_cobro',
    description: 'Registra cobro DEFINITIVO. REQUIERE preview_id. NUNCA llamar sin confirmacion.',
    input_schema: {
      type: 'object' as const,
      properties: { preview_id: { type: 'string' } },
      required: ['preview_id'],
    },
  },
];

// ═══════════════════════════════════════════════════════════════════
// MOCK TOOL EXECUTOR — returns realistic data
// ═══════════════════════════════════════════════════════════════════

let pendingPreview: { id: string; type: string; data: any } | null = null;

function executeMockTool(toolName: string, input: any): string {
  switch (toolName) {
    case 'buscar_pedidos': {
      let results = MOCK_ORDERS;
      if (input.numero) results = results.filter(o => o.order_number === input.numero);
      if (input.empresa) results = results.filter(o => o.empresa.toLowerCase().includes(input.empresa.toLowerCase()));
      if (input.estado) results = results.filter(o => o.status === input.estado);
      else results = results.filter(o => o.status !== 'cancelado');
      if (results.length === 0) return 'No hay pedidos con esos criterios.';
      return JSON.stringify(results.map(o => ({
        numero: `#${String(o.order_number).padStart(4, '0')}`,
        titulo: o.title, descripcion: o.description,
        empresa: o.empresa, cuit_empresa: o.empresa_cuit,
        cliente: o.cliente, cuit_cliente: o.cliente_cuit,
        total: `$${parseFloat(o.total_amount).toLocaleString('es-AR')}`,
        iva: `${o.vat_rate}%`, descuento: o.discount_percent > 0 ? `${o.discount_percent}%` : null,
        estado: o.status, pago: o.payment_status, prioridad: o.priority,
        metodo_pago: o.payment_method,
        entrega_estimada: o.estimated_delivery, entrega_real: o.actual_delivery,
        inicio_produccion: o.production_started_at,
        notas: o.notes, fecha: o.created_at, items: o.items,
      })));
    }
    case 'buscar_facturas': {
      let results = MOCK_INVOICES;
      if (input.empresa) results = results.filter(f => f.empresa.toLowerCase().includes(input.empresa.toLowerCase()));
      if (input.estado) results = results.filter(f => f.status === input.estado);
      if (results.length === 0) return 'No hay facturas con esos criterios.';
      return JSON.stringify(results.map(f => ({
        tipo: f.invoice_type, numero: f.invoice_number, fiscal: f.fiscal_type,
        empresa: f.empresa, cuit_empresa: f.empresa_cuit,
        subtotal_neto: `$${parseFloat(f.subtotal).toLocaleString('es-AR')}`,
        iva: `$${parseFloat(f.vat_amount).toLocaleString('es-AR')}`,
        total: `$${parseFloat(f.total_amount).toLocaleString('es-AR')}`,
        cobrado: `$${parseFloat(String(f.total_cobrado)).toLocaleString('es-AR')}`,
        pendiente_cobro: `$${Math.max(parseFloat(f.total_amount) - f.total_cobrado, 0).toLocaleString('es-AR')}`,
        estado: f.status, pago: f.payment_status,
        cae: f.cae, vto_cae: f.cae_vto,
        fecha_emision: f.invoice_date, items: f.items,
      })));
    }
    case 'buscar_clientes': {
      let results = MOCK_ENTERPRISES;
      if (input.nombre) results = results.filter(e => e.name.toLowerCase().includes(input.nombre.toLowerCase()));
      if (results.length === 0) return input.nombre ? `No encontre ninguna empresa con "${input.nombre}".` : 'No tenes empresas cargadas.';
      return JSON.stringify(results.map(e => ({
        nombre: e.name, razon_social: e.razon_social, cuit: e.cuit,
        condicion_iva: e.tax_condition, direccion: e.address, ciudad: e.city,
        provincia: e.province, telefono: e.phone, email: e.email,
        descuento_default: e.default_discount > 0 ? `${e.default_discount}%` : null,
        total_pedidos: e.total_pedidos, total_vendido: `$${parseFloat(e.total_vendido).toLocaleString('es-AR')}`,
        total_facturas: e.total_facturas, total_facturado: `$${parseFloat(e.total_facturado).toLocaleString('es-AR')}`,
      })));
    }
    case 'buscar_productos': {
      let results = MOCK_PRODUCTS;
      if (input.nombre) results = results.filter(p => p.name.toLowerCase().includes(input.nombre.toLowerCase()));
      if (results.length === 0) return input.nombre ? `No encontre productos con "${input.nombre}".` : 'No tenes productos.';
      return JSON.stringify(results.map(p => ({
        nombre: p.name, sku: p.sku, tipo: p.product_type,
        costo: `$${parseFloat(p.cost).toLocaleString('es-AR')}`,
        precio_neto: `$${parseFloat(p.final_price).toLocaleString('es-AR')}`,
        iva: `${p.vat_rate}%`, margen: `${p.margin_percent}%`,
        stock: p.stock_actual, controla_stock: p.controls_stock, stock_minimo: p.low_stock_threshold,
      })));
    }
    case 'ver_saldos': {
      if (input.empresa) {
        const ent = MOCK_ENTERPRISES.find(e => e.name.toLowerCase().includes(input.empresa.toLowerCase()));
        if (!ent) return `No encontre empresa "${input.empresa}".`;
        const invoices = MOCK_INVOICES.filter(i => i.empresa === ent.name);
        const facturado = invoices.reduce((s, i) => s + parseFloat(i.total_amount), 0);
        const cobrado = invoices.reduce((s, i) => s + i.total_cobrado, 0);
        return JSON.stringify([{
          empresa: ent.name, cuit: ent.cuit,
          total_facturado: `$${facturado.toLocaleString('es-AR')}`,
          total_cobrado: `$${cobrado.toLocaleString('es-AR')}`,
          pendiente: `$${Math.max(facturado - cobrado, 0).toLocaleString('es-AR')}`,
          facturas: invoices.length,
        }]);
      }
      const facturado = MOCK_INVOICES.reduce((s, i) => s + parseFloat(i.total_amount), 0);
      const cobrado = MOCK_INVOICES.reduce((s, i) => s + i.total_cobrado, 0);
      return JSON.stringify({
        total_facturado: `$${facturado.toLocaleString('es-AR')}`,
        total_cobrado: `$${cobrado.toLocaleString('es-AR')}`,
        pendiente_cobro: `$${(facturado - cobrado).toLocaleString('es-AR')}`,
        pedidos_sin_pagar: MOCK_ORDERS.filter(o => o.payment_status === 'pendiente').length,
      });
    }
    case 'resumen_negocio': {
      return JSON.stringify({
        pedidos: { total: 3, pendientes: 1, en_produccion: 1, terminados: 1, sin_pagar: 2, revenue: '$367.855' },
        facturas: { total: 2, borradores: 1, autorizadas: 1, facturado: '$155.666' },
        cobros: { total: 1, cobrado: '$95.166' },
        productos: 4,
      });
    }
    case 'preview_pedido': {
      const ent = MOCK_ENTERPRISES.find(e => e.name.toLowerCase().includes((input.empresa || '').toLowerCase()));
      if (!ent) return `No encontre la empresa "${input.empresa}".`;
      const items = input.items || [];
      const neto = items.reduce((s: number, i: any) => s + (i.cantidad || 1) * (i.precio_unitario || 0), 0);
      const desc = input.descuento || 0;
      const netoDesc = neto * (1 - desc / 100);
      const iva = netoDesc * 0.21;
      const total = netoDesc + iva;
      const pid = `prev-${Date.now()}`;
      pendingPreview = { id: pid, type: 'pedido', data: { empresa: ent.name, items, neto: netoDesc, iva, total } };
      return `PREVIEW (preview_id: ${pid})\nPedido para *${ent.name}*:\n${items.map((i: any) => `- ${i.cantidad || 1}x ${i.producto} a $${(i.precio_unitario || 0).toLocaleString('es-AR')}`).join('\n')}${desc > 0 ? `\nDescuento: ${desc}%` : ''}\nNeto: $${Math.round(netoDesc).toLocaleString('es-AR')} + IVA: $${Math.round(iva).toLocaleString('es-AR')} = *Total: $${Math.round(total).toLocaleString('es-AR')}*`;
    }
    case 'ejecutar_pedido': {
      if (!pendingPreview || pendingPreview.id !== input.preview_id) return 'Preview expiro o no existe.';
      const data = pendingPreview.data;
      pendingPreview = null;
      return `Pedido #0004 creado para ${data.empresa} por $${Math.round(data.total).toLocaleString('es-AR')}`;
    }
    case 'preview_factura': {
      const order = MOCK_ORDERS.find(o => o.order_number === input.pedido_numero);
      if (!order) return `No encontre el pedido #${String(input.pedido_numero || 0).padStart(4, '0')}.`;
      const allItems = order.items;
      const itemsToInvoice = input.cantidad_items ? allItems.slice(0, 1) : allItems;
      // For partial: adjust quantities
      const qty = input.cantidad_items || itemsToInvoice.reduce((s: number, i: any) => s + i.cantidad, 0);
      const unitPrice = parseFloat(itemsToInvoice[0]?.precio_unitario || '0');
      const neto = qty * unitPrice;
      const iva = neto * 0.21;
      const total = neto + iva;
      const pid = `prev-${Date.now()}`;
      pendingPreview = { id: pid, type: 'factura', data: { order_number: order.order_number, empresa: order.empresa, neto, iva, total, qty, items: itemsToInvoice } };
      const isPartial = input.cantidad_items && input.cantidad_items < allItems.reduce((s: number, i: any) => s + i.cantidad, 0);
      return `PREVIEW (preview_id: ${pid})\nFactura ${input.tipo_factura || 'B'} del pedido #${String(order.order_number).padStart(4, '0')} - *${order.empresa}*:\n- ${qty}x ${itemsToInvoice[0]?.producto} a $${unitPrice.toLocaleString('es-AR')}${isPartial ? `\n(${input.cantidad_items} de ${allItems.reduce((s: number, i: any) => s + i.cantidad, 0)} unidades - factura parcial)` : ''}\nNeto: $${Math.round(neto).toLocaleString('es-AR')} + IVA: $${Math.round(iva).toLocaleString('es-AR')} = *Total: $${Math.round(total).toLocaleString('es-AR')}*`;
    }
    case 'ejecutar_factura': {
      if (!pendingPreview || pendingPreview.id !== input.preview_id) return 'Preview expiro o no existe.';
      const data = pendingPreview.data;
      pendingPreview = null;
      return `Factura B-${String(3).padStart(8, '0')} creada para ${data.empresa} por $${Math.round(data.total).toLocaleString('es-AR')}`;
    }
    case 'preview_cobro': {
      const ent = MOCK_ENTERPRISES.find(e => e.name.toLowerCase().includes((input.empresa || '').toLowerCase()));
      if (!ent) return `No encontre la empresa "${input.empresa}".`;
      const metodos = input.metodos_pago || [{ metodo: 'efectivo', monto: input.monto }];
      const pid = `prev-${Date.now()}`;
      pendingPreview = { id: pid, type: 'cobro', data: { empresa: ent.name, monto: input.monto, metodos } };
      return `PREVIEW (preview_id: ${pid})\nCobro de *$${input.monto.toLocaleString('es-AR')}* de *${ent.name}*:\n${metodos.map((m: any) => `- ${m.metodo}: $${(m.monto || 0).toLocaleString('es-AR')}`).join('\n')}`;
    }
    case 'ejecutar_cobro': {
      if (!pendingPreview || pendingPreview.id !== input.preview_id) return 'Preview expiro o no existe.';
      const data = pendingPreview.data;
      pendingPreview = null;
      return `Recibo #0002 registrado - $${data.monto.toLocaleString('es-AR')} de ${data.empresa}`;
    }
    default:
      return `Tool "${toolName}" no implementado.`;
  }
}

// ═══════════════════════════════════════════════════════════════════
// CONVERSATION ENGINE — runs multi-turn with Claude
// ═══════════════════════════════════════════════════════════════════

const client = new Anthropic();

async function runConversation(userMessages: string[]): Promise<Array<{
  user: string;
  response: string;
  toolsCalled: string[];
  toolInputs: Array<{ name: string; input: any }>;
}>> {
  const messages: Anthropic.MessageParam[] = [];
  const results: Array<{ user: string; response: string; toolsCalled: string[]; toolInputs: Array<{ name: string; input: any }> }> = [];

  for (const userMsg of userMessages) {
    messages.push({ role: 'user', content: userMsg });

    const toolsCalled: string[] = [];
    const toolInputs: Array<{ name: string; input: any }> = [];
    let iterations = 0;

    let response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: buildSystemPrompt(),
      tools: TOOLS,
      messages,
    });

    while (response.stop_reason === 'tool_use' && iterations < 5) {
      iterations++;
      const toolUseBlocks = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      for (const toolUse of toolUseBlocks) {
        toolsCalled.push(toolUse.name);
        toolInputs.push({ name: toolUse.name, input: toolUse.input });
        const result = executeMockTool(toolUse.name, toolUse.input);
        toolResults.push({ type: 'tool_result', tool_use_id: toolUse.id, content: result });
      }

      messages.push({ role: 'assistant', content: response.content });
      messages.push({ role: 'user', content: toolResults });

      response = await client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        system: buildSystemPrompt(),
        tools: TOOLS,
        messages,
      });
    }

    const textBlocks = response.content.filter((b): b is Anthropic.TextBlock => b.type === 'text');
    const responseText = textBlocks.map(b => b.text).join('');

    // Add final response to messages for context retention
    messages.push({ role: 'assistant', content: response.content });

    results.push({ user: userMsg, response: responseText, toolsCalled, toolInputs });
  }

  return results;
}

// ═══════════════════════════════════════════════════════════════════
// TEST CONVERSATIONS — real multi-turn business scenarios
// ═══════════════════════════════════════════════════════════════════

interface ConvTest {
  id: number;
  name: string;
  messages: string[];
  // Per-turn validations (index matches messages index)
  validations: Array<{
    mustContain?: string[];
    mustNotContain?: string[];
    expectTools?: string[];
  }>;
}

const CONVERSATIONS: ConvTest[] = [
  // ─── 1. El caso original que fallo ───
  {
    id: 1,
    name: 'Factura parcial del pedido 0002 (caso original)',
    messages: [
      'hola, me facturás 2 unidades del pedido 0002?',
      'quiero que factures 2 unidades únicamente desde los datos de la empresa que están en el pedido',
      'Sí, haceme la factura parcial por favor',
    ],
    validations: [
      { mustContain: ['BeckerVisual'], mustNotContain: ['qué pedido', 'no entend'] },
      { mustContain: ['2'], mustNotContain: ['qué pedido', 'cuál pedido', 'qué empresa', 'no entend'] },
      { expectTools: ['ejecutar_factura'], mustNotContain: ['qué pedido', 'cuál', 'no entend'] },
    ],
  },

  // ─── 2. Pedido → factura → cobro completo ───
  // NOTE: facturar "ese pedido" won't work because mock doesn't persist new orders
  // Testing the simpler flow: create order → cobro (skip invoice of new order)
  {
    id: 2,
    name: 'Flujo: pedido → confirmar → cobro',
    messages: [
      'haceme un pedido para Garcia de 5 Pintura a $10000',
      'si, dale',
      'registrame un cobro de Garcia por $60500 en transferencia',
      'si',
    ],
    validations: [
      { expectTools: ['preview_pedido'], mustContain: ['Garcia', 'Pintura', '5'] },
      { expectTools: ['ejecutar_pedido'] },
      { expectTools: ['preview_cobro'], mustContain: ['Garcia', '60.500', 'transferencia'] },
      { expectTools: ['ejecutar_cobro'] },
    ],
  },

  // ─── 3. Drill-down profundo en datos ───
  {
    id: 3,
    name: 'Drill-down: pedidos → detalle → items → precios',
    messages: [
      'qué pedidos tengo?',
      'contame mas del de Garcia',
      'qué productos tiene?',
      'a qué precio está cada uno?',
      'y cuándo lo entregan?',
    ],
    validations: [
      { expectTools: ['buscar_pedidos'] },
      { mustContain: ['Garcia', '#0003'], mustNotContain: ['cuál Garcia'] },
      { mustContain: ['Pintura'], mustNotContain: ['qué pedido'] },
      { mustNotContain: ['que producto', 'que pedido'] },
      { mustContain: ['15', 'abril'], mustNotContain: ['qué pedido'] },
    ],
  },

  // ─── 4. Cambio de contexto limpio ───
  {
    id: 4,
    name: 'Cambio de contexto: BeckerVisual → Garcia → volver',
    messages: [
      'facturas de BeckerVisual',
      'y las de Garcia?',
      'esa de Garcia está paga?',
      'volvé a las de BeckerVisual, esa sí está paga?',
    ],
    validations: [
      { expectTools: ['buscar_facturas'], mustContain: ['BeckerVisual'] },
      { expectTools: ['buscar_facturas'], mustContain: ['Garcia'], mustNotContain: ['de quién'] },
      { mustContain: ['pendiente'], mustNotContain: ['cuál factura'] },
      { mustContain: ['BeckerVisual'], mustNotContain: ['cuál'] },
    ],
  },

  // ─── 5. Saldos y cuentas corrientes ───
  {
    id: 5,
    name: 'Saldos: quién me debe → detalle → cobro',
    messages: [
      'quién me debe plata?',
      'cuánto me debe Garcia?',
      'tiene facturas pendientes?',
      'cobramos $30000 en efectivo',
      'dale',
    ],
    validations: [
      { expectTools: ['ver_saldos'] },
      { expectTools: ['ver_saldos'], mustContain: ['Garcia'] },
      { mustContain: ['Garcia'], mustNotContain: ['de quien'] },
      { expectTools: ['preview_cobro'], mustContain: ['Garcia', '30.000', 'efectivo'], mustNotContain: ['que empresa'] },
      { expectTools: ['ejecutar_cobro'] },
    ],
  },

  // ─── 6. Correccion mid-flow ───
  {
    id: 6,
    name: 'Correccion: pedido → cambiar empresa',
    messages: [
      'haceme un pedido para Garcia de 3 Cemento a $7000',
      'no, perdón, para Lopez',
      'si, confirmá',
    ],
    validations: [
      { expectTools: ['preview_pedido'], mustContain: ['Garcia'] },
      { expectTools: ['preview_pedido'], mustContain: ['Lopez'], mustNotContain: ['Garcia'] },
      { expectTools: ['ejecutar_pedido'] },
    ],
  },

  // ─── 7. Cancelacion elegante ───
  {
    id: 7,
    name: 'Cancelar operacion y hacer otra',
    messages: [
      'haceme una factura del pedido 3',
      'mejor no, cancelá',
      'haceme un pedido para Lopez de 2 Pintura a $10000',
      'dale',
    ],
    validations: [
      { expectTools: ['preview_factura'] },
      { mustContain: ['cancel'], mustNotContain: ['error'] },
      { expectTools: ['preview_pedido'], mustContain: ['Lopez', 'Pintura'] },
      { expectTools: ['ejecutar_pedido'] },
    ],
  },

  // ─── 8. Recibos y medios de pago ───
  {
    id: 8,
    name: 'Consulta de cobros y medios de pago',
    messages: [
      'la factura de BeckerVisual, cómo la pagaron?',
      'en qué banco fue la transferencia?',
      'y la de Garcia está cobrada?',
    ],
    validations: [
      { expectTools: ['buscar_facturas'], mustContain: ['BeckerVisual', 'pagada'] },
      { mustNotContain: ['no entend'] },
      { mustContain: ['Garcia'], mustNotContain: ['cual factura'] },
    ],
  },

  // ─── 9. Productos y stock ───
  {
    id: 9,
    name: 'Stock: consulta → productos bajo stock → pedido reposicion',
    messages: [
      'cómo anda el stock?',
      'cuál está bajo?',
      'cuánto falta para llegar al mínimo?',
      'haceme un pedido a Lopez de 12 Cemento a $7000',
      'confirmo',
    ],
    validations: [
      { expectTools: ['buscar_productos'] },
      { mustContain: ['Cemento'], mustNotContain: ['qué producto'] },
      { mustContain: ['8', '20'], mustNotContain: ['cuál'] },
      { expectTools: ['preview_pedido'], mustContain: ['Lopez', 'Cemento', '12'] },
      { expectTools: ['ejecutar_pedido'] },
    ],
  },

  // ─── 10. Resumen → accion ───
  {
    id: 10,
    name: 'Resumen general → drill down → accion',
    messages: [
      'cómo va el negocio?',
      'cuántas facturas en borrador tengo?',
      'mostrámela',
      'autorizala',
    ],
    validations: [
      { expectTools: ['resumen_negocio'] },
      { mustContain: ['1'], mustNotContain: ['no entend'] },
      { expectTools: ['buscar_facturas'], mustContain: ['Garcia'] },
      { mustNotContain: ['cuál factura', 'no entend'] },
    ],
  },

  // ─── 11. Ambiguedad resuelta con contexto ───
  {
    id: 11,
    name: 'Ambiguedad: "esa factura" despues de listar',
    messages: [
      'mostrame las facturas',
      'la primera, la de BeckerVisual, está autorizada?',
      'y la segunda?',
      'esa tiene CAE?',
    ],
    validations: [
      { expectTools: ['buscar_facturas'] },
      { mustContain: ['BeckerVisual', 'autorizada'], mustNotContain: ['cuál'] },
      { mustContain: ['Garcia', 'borrador'], mustNotContain: ['cual'] },
      { mustContain: ['no', 'CAE'], mustNotContain: ['cual factura'] },
    ],
  },

  // ─── 12. Info de clientes detallada ───
  {
    id: 12,
    name: 'Cliente: datos → descuento → pedidos',
    messages: [
      'datos de BeckerVisual',
      'tiene descuento por defecto?',
      'cuántos pedidos le hicimos?',
      'y cuánto facturamos?',
    ],
    validations: [
      { expectTools: ['buscar_clientes'], mustContain: ['BeckerVisual'] },
      { mustContain: ['10%'], mustNotContain: ['qué empresa'] },
      { mustContain: ['2'], mustNotContain: ['cuál', 'qué empresa'] },
      { mustContain: ['95.1'], mustNotContain: ['que empresa'] },
    ],
  },

  // ─── 13. Pedido con descuento ───
  {
    id: 13,
    name: 'Pedido con descuento aplicado',
    messages: [
      'haceme un pedido para BeckerVisual de 2 GoBecker Premium a $100000 con 15% de descuento',
      'cuánto da el IVA?',
      'dale, confirmá',
    ],
    validations: [
      { expectTools: ['preview_pedido'], mustContain: ['BeckerVisual', 'GoBecker Premium', '15%'] },
      { mustNotContain: ['no entend', 'qué pedido'] },
      { expectTools: ['ejecutar_pedido'] },
    ],
  },

  // ─── 14. Error handling: pedido inexistente ───
  {
    id: 14,
    name: 'Error: factura de pedido que no existe',
    messages: [
      'facturame el pedido 999',
      'ah bueno, el pedido 3 entonces',
      'dale, si',
    ],
    validations: [
      { mustNotContain: ['no entend'] },
      { expectTools: ['preview_factura'], mustContain: ['Garcia'] },
      { expectTools: ['ejecutar_factura'] },
    ],
  },

  // ─── 15. Conversacion natural larga ───
  {
    id: 15,
    name: 'Conversacion natural de 7 turnos',
    messages: [
      'buenas',
      'qué onda, hay algo pendiente?',
      'pedidos sin facturar?',
      'el de BeckerVisual, el 0002, mostramelo en detalle',
      'tiene 3 unidades de GoBecker Intermedio, facturame solo 2',
      'si, confirmá la factura',
      'joya, algo más pendiente?',
    ],
    validations: [
      { mustNotContain: ['error'] },
      { expectTools: ['resumen_negocio'] },
      { expectTools: ['buscar_pedidos'] },
      { mustContain: ['0002', 'BeckerVisual', '3', 'GoBecker'], mustNotContain: ['cuál pedido'] },
      { expectTools: ['preview_factura'], mustContain: ['2', 'preview', 'BeckerVisual', 'parcial'], mustNotContain: ['qué pedido', 'cuál'] },
      { expectTools: ['ejecutar_factura'], mustNotContain: ['qué pedido', 'no entend'] },
      { mustNotContain: ['no entend', 'error'] },
    ],
  },
];

// ═══════════════════════════════════════════════════════════════════
// RUNNER + ANALYSIS
// ═══════════════════════════════════════════════════════════════════

// Normalize text: remove accents, lowercase, handle common synonyms
function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // Remove accents
    .replace(/draft/g, 'borrador')
    .replace(/pagada/g, 'paga')
    .replace(/creado/g, 'cre') // match "creé", "creado", "creó"
    .replace(/no encontr[eé]/g, 'no encontr')
    .replace(/(\d{2})\/(\d{2})/g, '$1/$2') // Keep date format
    .trim();
}

async function runAndAnalyze(test: ConvTest): Promise<{
  id: number;
  name: string;
  passed: boolean;
  turnResults: Array<{
    turn: number;
    user: string;
    response: string;
    toolsCalled: string[];
    passed: boolean;
    failures: string[];
  }>;
}> {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`TEST ${test.id}: ${test.name}`);
  console.log(`${'─'.repeat(60)}`);

  pendingPreview = null; // Reset between tests
  const results = await runConversation(test.messages);
  let allPassed = true;

  const turnResults = results.map((r, i) => {
    const v = test.validations[i] || {};
    const failures: string[] = [];

    // Check expected tools
    if (v.expectTools) {
      for (const tool of v.expectTools) {
        if (!r.toolsCalled.includes(tool)) {
          failures.push(`TOOL MISSING: expected "${tool}", got [${r.toolsCalled.join(', ') || 'none'}]`);
        }
      }
    }

    // Check mustContain (with accent-insensitive + synonym matching)
    if (v.mustContain) {
      for (const text of v.mustContain) {
        const norm = normalize(text);
        const respNorm = normalize(r.response);
        if (!respNorm.includes(norm)) {
          failures.push(`TEXT MISSING: "${text}"`);
        }
      }
    }

    // Check mustNotContain (with accent-insensitive matching)
    if (v.mustNotContain) {
      for (const text of v.mustNotContain) {
        const norm = normalize(text);
        const respNorm = normalize(r.response);
        if (respNorm.includes(norm)) {
          failures.push(`UNWANTED TEXT: "${text}"`);
        }
      }
    }

    const passed = failures.length === 0;
    if (!passed) allPassed = false;

    const icon = passed ? '  ✓' : '  ✗';
    console.log(`${icon} Turn ${i + 1}: "${r.user}"`);
    console.log(`    → Tools: [${r.toolsCalled.join(', ') || 'none'}]`);
    console.log(`    → Response: ${r.response.substring(0, 150)}${r.response.length > 150 ? '...' : ''}`);
    if (failures.length > 0) {
      for (const f of failures) console.log(`    ❌ ${f}`);
    }

    return { turn: i + 1, user: r.user, response: r.response, toolsCalled: r.toolsCalled, passed, failures };
  });

  const icon = allPassed ? '✅' : '❌';
  console.log(`\n${icon} TEST ${test.id}: ${allPassed ? 'PASSED' : 'FAILED'}`);

  return { id: test.id, name: test.name, passed: allPassed, turnResults };
}

async function main() {
  console.log('═'.repeat(60));
  console.log('SecretarIA v3 — Full Conversation Evaluator');
  console.log('═'.repeat(60));

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('Set ANTHROPIC_API_KEY');
    process.exit(1);
  }

  const testId = parseInt(process.argv[2] || '0');
  const testsToRun = testId > 0
    ? CONVERSATIONS.filter(t => t.id === testId)
    : CONVERSATIONS;

  console.log(`Running ${testsToRun.length} conversation tests...\n`);

  const allResults = [];
  let consecutive = 0;
  let maxConsecutive = 0;

  for (const test of testsToRun) {
    const result = await runAndAnalyze(test);
    allResults.push(result);

    if (result.passed) {
      consecutive++;
      maxConsecutive = Math.max(maxConsecutive, consecutive);
    } else {
      consecutive = 0;
    }
  }

  // Summary
  const passed = allResults.filter(r => r.passed).length;
  const total = allResults.length;
  const rate = ((passed / total) * 100).toFixed(1);

  console.log('\n' + '═'.repeat(60));
  console.log(`FINAL: ${passed}/${total} passed (${rate}%)`);
  console.log(`Max consecutive passes: ${maxConsecutive}`);
  console.log('═'.repeat(60));

  if (parseFloat(rate) >= 90 && maxConsecutive >= 15) {
    console.log('TARGET MET: 90%+ pass rate with 15+ consecutive passes');
  } else {
    console.log(`TARGET NOT MET: need 90%+ (got ${rate}%) and 15+ consecutive (got ${maxConsecutive})`);
  }
}

main().catch(console.error);
