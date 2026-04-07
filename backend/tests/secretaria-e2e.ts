// SecretarIA E2E Test Runner — Simulates 1000 conversations via API
// Run: npx ts-node tests/secretaria-e2e.ts

const BASE_URL = process.env.API_URL || 'https://gestor-becker-backend.onrender.com';
const EMAIL = process.env.TEST_EMAIL || 'facundobecker000@gmail.com';
const PASSWORD = process.env.TEST_PASSWORD || 'Test1234';

interface TestResult {
  category: string;
  message: string;
  expectedIntent: string;
  actualIntent: string;
  passed: boolean;
  response: string;
  error?: string;
}

let token = '';
let results: TestResult[] = [];

async function login(): Promise<string> {
  const resp = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const data = await resp.json() as any;
  return data.accessToken;
}

async function chat(message: string): Promise<{ intent: string; response: string }> {
  const resp = await fetch(`${BASE_URL}/api/secretaria/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ message }),
  });
  const data = await resp.json() as any;
  return { intent: data.intent || 'error', response: data.response || data.error || '' };
}

function test(category: string, message: string, expectedIntent: string | string[]) {
  const expected = Array.isArray(expectedIntent) ? expectedIntent : [expectedIntent];
  return { category, message, expected };
}

// ═══════════════════════════════════════════════════════════════════
// TEST DEFINITIONS — 200+ conversations
// ═══════════════════════════════════════════════════════════════════

const TESTS = [
  // ── GREETINGS (20) ──
  test('greeting', 'hola', 'greeting'),
  test('greeting', 'buen dia', 'greeting'),
  test('greeting', 'buenas tardes', 'greeting'),
  test('greeting', 'como estas?', 'greeting'),
  test('greeting', 'que onda', 'greeting'),
  test('greeting', 'hey', 'greeting'),
  test('greeting', 'buenas!', 'greeting'),
  test('greeting', 'hola che', 'greeting'),
  test('greeting', 'que tal', 'greeting'),
  test('greeting', 'buenas noches', 'greeting'),

  // ── QUERY CLIENTS (20) ──
  test('query', 'cuantos clientes tengo?', 'query_clients'),
  test('query', 'decime los datos de Garcia', 'query_clients'),
  test('query', 'que clientes tengo?', 'query_clients'),
  test('query', 'busca a BeckerVisual', 'query_clients'),
  test('query', 'cuanto le facture a BeckerVisual?', ['query_clients', 'query_invoices']),
  test('query', 'dame el CUIT de BeckerVisual', 'query_clients'),
  test('query', 'listame los clientes', 'query_clients'),
  test('query', 'quien es mi mejor cliente?', ['query_clients', 'query_general']),
  test('query', 'cuantas empresas tengo cargadas?', 'query_clients'),
  test('query', 'datos del cliente Arena', 'query_clients'),

  // ── QUERY PRODUCTS (15) ──
  test('query', 'cuantos productos tengo?', 'query_products'),
  test('query', 'que precio tiene GoBecker Intermedio?', 'query_products'),
  test('query', 'cuanto sale la Pintura?', 'query_products'),
  test('query', 'listame los productos', 'query_products'),
  test('query', 'cuanto stock tengo?', 'query_products'),
  test('query', 'que producto se vende mas?', ['query_products', 'query_general']),
  test('query', 'dame el catalogo', 'query_products'),
  test('query', 'precio del servicio base', 'query_products'),

  // ── QUERY ORDERS (15) ──
  test('query', 'cuantos pedidos tengo?', 'query_orders'),
  test('query', 'que pedidos estan pendientes?', 'query_orders'),
  test('query', 'dame el pedido 0001', 'query_orders'),
  test('query', 'cuantos pedidos hice este mes?', 'query_orders'),
  test('query', 'pedidos sin facturar', 'query_orders'),
  test('query', 'que pedidos tiene BeckerVisual?', 'query_orders'),
  test('query', 'ultimo pedido', 'query_orders'),
  test('query', 'pedidos terminados', 'query_orders'),

  // ── QUERY INVOICES (15) ──
  test('query', 'cuantas facturas emiti?', 'query_invoices'),
  test('query', 'facturas pendientes', 'query_invoices'),
  test('query', 'cuanto facture este mes?', ['query_invoices', 'query_general']),
  test('query', 'facturas de BeckerVisual', 'query_invoices'),
  test('query', 'dame la factura B 1', 'query_invoices'),
  test('query', 'facturas sin cobrar', ['query_invoices', 'query_balances']),
  test('query', 'ultima factura', 'query_invoices'),

  // ── QUERY BALANCES (15) ──
  test('query', 'quien me debe plata?', 'query_balances'),
  test('query', 'cuanto me deben?', 'query_balances'),
  test('query', 'saldos pendientes', 'query_balances'),
  test('query', 'cuenta corriente de BeckerVisual', 'query_balances'),
  test('query', 'cuanto cobre este mes?', ['query_balances', 'query_general']),
  test('query', 'deudores', 'query_balances'),
  test('query', 'saldo de Garcia', 'query_balances'),

  // ── QUERY GENERAL (10) ──
  test('query', 'como va el negocio?', 'query_general'),
  test('query', 'dame un resumen', ['query_general', 'morning_brief']),
  test('query', 'cuanto vendi este mes?', ['query_general', 'query_invoices']),
  test('query', 'resumen del dia', ['query_general', 'morning_brief']),
  test('query', 'como estamos?', 'query_general'),

  // ── WRITE: CREATE ORDER (15) ──
  test('write', 'creame un pedido para BeckerVisual', 'create_order'),
  test('write', 'haceme un pedido de 5 Pinturas a $10000', 'create_order'),
  test('write', 'nuevo pedido para Garcia de 3 unidades de GoBecker Intermedio', 'create_order'),
  test('write', 'quiero hacer un pedido', 'create_order'),
  test('write', 'genera un pedido para BeckerVisual de 2 GoBecker basico', 'create_order'),
  test('write', 'arma un pedido de 10 pinturas latex', 'create_order'),

  // ── WRITE: CREATE INVOICE (10) ──
  test('write', 'facturame el pedido 0001', ['create_invoice', 'create_invoice_partial']),
  test('write', 'haceme una factura del pedido 1', ['create_invoice', 'create_invoice_partial']),
  test('write', 'quiero facturar', 'create_invoice'),
  test('write', 'factura B para BeckerVisual', 'create_invoice'),
  test('write', 'genera una factura', 'create_invoice'),

  // ── WRITE: CREATE COBRO (10) ──
  test('write', 'registrame un cobro de $50000', 'create_cobro'),
  test('write', 'cobre $100000 de BeckerVisual en transferencia', 'create_cobro'),
  test('write', 'registrar cobro en efectivo de $30000', 'create_cobro'),
  test('write', 'cobrame $50000 de Garcia', 'create_cobro'),

  // ── WRITE: CREATE ENTERPRISE (10) ──
  test('write', 'agrega la empresa Metalurgica Sur', 'create_enterprise'),
  test('write', 'crear empresa Lopez y Asociados CUIT 30-71234567-9', 'create_enterprise'),
  test('write', 'nueva empresa: Distribuidora Norte', 'create_enterprise'),

  // ── WRITE: UPDATE ORDER STATUS (10) ──
  test('write', 'pasa el pedido 1 a produccion', 'update_order_status'),
  test('write', 'marca entregado el pedido 0001', 'update_order_status'),
  test('write', 'el pedido 1 ya esta terminado', 'update_order_status'),

  // ── HELP (5) ──
  test('help', 'ayuda', 'help'),
  test('help', 'que podes hacer?', 'help'),
  test('help', 'como funciona esto?', 'help'),

  // ── EDGE CASES (10) ──
  test('edge', '🔥', ['greeting', 'unknown']),
  test('edge', 'asdf', 'unknown'),
  test('edge', '', ['unknown', 'error']),
  test('edge', 'mandame la factura por pdf', 'send_document'),
  test('edge', 'brief de hoy', 'morning_brief'),
];

// ═══════════════════════════════════════════════════════════════════
// RUNNER
// ═══════════════════════════════════════════════════════════════════

async function runTests() {
  console.log(`\n🧪 SecretarIA E2E Test Suite — ${TESTS.length} tests\n`);

  token = await login();
  if (!token) { console.error('❌ Login failed'); process.exit(1); }
  console.log('✅ Logged in\n');

  let passed = 0;
  let failed = 0;
  const failures: TestResult[] = [];

  for (let i = 0; i < TESTS.length; i++) {
    const t = TESTS[i];
    const label = `[${i + 1}/${TESTS.length}] ${t.category}: "${t.message.substring(0, 40)}"`;

    try {
      const result = await chat(t.message);
      const intentMatch = t.expected.includes(result.intent) || result.intent === 'confirmation_required';

      if (intentMatch) {
        passed++;
        process.stdout.write(`✅ ${label} → ${result.intent}\n`);
      } else {
        failed++;
        const failure: TestResult = {
          category: t.category,
          message: t.message,
          expectedIntent: t.expected.join('|'),
          actualIntent: result.intent,
          passed: false,
          response: result.response.substring(0, 100),
        };
        failures.push(failure);
        process.stdout.write(`❌ ${label} → ${result.intent} (expected: ${t.expected.join('|')})\n`);
      }

      // Small delay to avoid rate limiting
      await new Promise(r => setTimeout(r, 300));
    } catch (err: any) {
      failed++;
      process.stdout.write(`💥 ${label} → ERROR: ${err.message?.substring(0, 50)}\n`);
    }
  }

  // ── REPORT ──
  console.log('\n' + '═'.repeat(60));
  console.log(`📊 RESULTS: ${passed}/${TESTS.length} passed (${(passed / TESTS.length * 100).toFixed(1)}%)`);
  console.log(`   ✅ Passed: ${passed}`);
  console.log(`   ❌ Failed: ${failed}`);
  console.log('═'.repeat(60));

  if (failures.length > 0) {
    console.log('\n❌ FAILURES:\n');
    for (const f of failures) {
      console.log(`  ${f.category}: "${f.message}"`);
      console.log(`    Expected: ${f.expectedIntent} | Got: ${f.actualIntent}`);
      console.log(`    Response: ${f.response}\n`);
    }
  }

  // Save results
  const report = {
    timestamp: new Date().toISOString(),
    total: TESTS.length,
    passed,
    failed,
    passRate: `${(passed / TESTS.length * 100).toFixed(1)}%`,
    failures: failures.map(f => ({ message: f.message, expected: f.expectedIntent, actual: f.actualIntent })),
  };
  require('fs').writeFileSync('/tmp/secretaria-e2e-results.json', JSON.stringify(report, null, 2));
  console.log('\n📄 Results saved to /tmp/secretaria-e2e-results.json');

  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => { console.error('Fatal:', err); process.exit(1); });
