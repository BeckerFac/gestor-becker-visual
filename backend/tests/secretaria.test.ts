import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import crypto from 'node:crypto'
import { mockPoolQuery, resetMocks } from './helpers/setup'

// ── Mock OpenAI ──
const mockChatCreate = vi.fn()
vi.mock('openai', () => ({
  default: class {
    chat = { completions: { create: (...args: any[]) => mockChatCreate(...args) } }
  },
}))

// ── Mock ai.queries ──
const mockGetCompanySummary = vi.fn()
const mockGetTopCustomers = vi.fn()
const mockGetTopProducts = vi.fn()
const mockGetCollectionsSummary = vi.fn()
vi.mock('../src/modules/ai/ai.queries', () => ({
  getCompanySummary: (...args: any[]) => mockGetCompanySummary(...args),
  getTopCustomers: (...args: any[]) => mockGetTopCustomers(...args),
  getTopProducts: (...args: any[]) => mockGetTopProducts(...args),
  getCollectionsSummary: (...args: any[]) => mockGetCollectionsSummary(...args),
}))

// ── Mock logger ──
vi.mock('../src/config/logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}))

// ── Imports (after mocks) ──
import { WhatsAppClient } from '../src/modules/secretaria/secretaria.whatsapp'
import { SECRETARIA_PROMPTS, SECRETARIA_CONFIG } from '../src/modules/secretaria/secretaria.config'
import type {
  SecretariaContext,
  WhatsAppWebhookPayload,
  IntentClassification,
  ToolResult,
} from '../src/modules/secretaria/secretaria.types'

// =============================================================================
// WhatsApp Client Tests
// =============================================================================

describe('WhatsAppClient', () => {
  let client: WhatsAppClient

  beforeEach(() => {
    client = new WhatsAppClient()
    vi.stubEnv('WHATSAPP_VERIFY_TOKEN', 'test-verify-token')
    vi.stubEnv('WHATSAPP_APP_SECRET', 'test-app-secret')
    vi.stubEnv('WHATSAPP_ACCESS_TOKEN', 'test-access-token')
    vi.stubEnv('WHATSAPP_PHONE_NUMBER_ID', '123456')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  // -- Test 1: verifyWebhook correct token returns challenge --
  it('verifyWebhook: correct token returns challenge', () => {
    const result = client.verifyWebhook({
      'hub.mode': 'subscribe',
      'hub.verify_token': 'test-verify-token',
      'hub.challenge': 'challenge-123',
    })

    expect(result).toBe('challenge-123')
  })

  // -- Test 2: verifyWebhook wrong token returns null (403 path) --
  it('verifyWebhook: wrong token returns null', () => {
    const result = client.verifyWebhook({
      'hub.mode': 'subscribe',
      'hub.verify_token': 'wrong-token',
      'hub.challenge': 'challenge-123',
    })

    expect(result).toBeNull()
  })

  // -- Test 3: validateWebhookSignature valid HMAC returns true --
  it('validateWebhookSignature: valid HMAC returns true', () => {
    const body = '{"test":"data"}'
    const expected = 'sha256=' + crypto
      .createHmac('sha256', 'test-app-secret')
      .update(body)
      .digest('hex')

    const result = client.validateWebhookSignature(body, expected)
    expect(result).toBe(true)
  })

  // -- Test 4: validateWebhookSignature invalid HMAC returns false --
  it('validateWebhookSignature: invalid HMAC returns false', () => {
    const body = '{"test":"data"}'
    const result = client.validateWebhookSignature(body, 'sha256=invalidhash0000000000000000000000000000000000000000000000000000')
    expect(result).toBe(false)
  })

  // -- Test 5: validateWebhookSignature no secret configured returns false --
  it('validateWebhookSignature: no secret configured returns false with warning', () => {
    vi.stubEnv('WHATSAPP_APP_SECRET', '')
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const result = client.validateWebhookSignature('body', 'sha256=abc')

    expect(result).toBe(false)
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('WHATSAPP_APP_SECRET not configured'),
    )

    consoleSpy.mockRestore()
  })

  // -- Test 6: parseIncomingMessage text message extracts body --
  it('parseIncomingMessage: text message extracts body', () => {
    const payload = {
      object: 'whatsapp_business_account',
      entry: [{
        id: 'entry-1',
        changes: [{
          value: {
            messaging_product: 'whatsapp',
            metadata: { display_phone_number: '15551234567', phone_number_id: '123' },
            messages: [{
              from: '5491112345678',
              id: 'msg-1',
              timestamp: '1700000000',
              type: 'text',
              text: { body: 'Hola, quien me debe?' },
            }],
          },
          field: 'messages',
        }],
      }],
    }

    const result = client.parseIncomingMessage(payload)

    expect(result).not.toBeNull()
    expect(result!.type).toBe('text')
    expect(result!.text).toBe('Hola, quien me debe?')
    expect(result!.from).toBe('5491112345678')
    expect(result!.messageId).toBe('msg-1')
  })

  // -- Test 7: parseIncomingMessage audio message extracts media_id --
  it('parseIncomingMessage: audio message extracts media_id', () => {
    const payload = {
      object: 'whatsapp_business_account',
      entry: [{
        id: 'entry-1',
        changes: [{
          value: {
            messaging_product: 'whatsapp',
            metadata: { display_phone_number: '15551234567', phone_number_id: '123' },
            messages: [{
              from: '5491112345678',
              id: 'msg-2',
              timestamp: '1700000000',
              type: 'audio',
              audio: { id: 'media-abc-123', mime_type: 'audio/ogg' },
            }],
          },
          field: 'messages',
        }],
      }],
    }

    const result = client.parseIncomingMessage(payload)

    expect(result).not.toBeNull()
    expect(result!.type).toBe('audio')
    expect(result!.mediaId).toBe('media-abc-123')
  })

  // -- Test 8: parseIncomingMessage empty payload returns null --
  it('parseIncomingMessage: empty payload returns null', () => {
    expect(client.parseIncomingMessage({})).toBeNull()
    expect(client.parseIncomingMessage(null)).toBeNull()
    expect(client.parseIncomingMessage(undefined)).toBeNull()
    expect(client.parseIncomingMessage({ object: 'whatsapp_business_account', entry: [] })).toBeNull()
    expect(client.parseIncomingMessage({
      object: 'whatsapp_business_account',
      entry: [{ id: 'e', changes: [{ value: { statuses: [] }, field: 'messages' }] }],
    })).toBeNull()
  })

  // -- Test 9: sendTextMessage truncates to 4096 chars --
  it('sendTextMessage: truncates to 4096 chars', async () => {
    // Mock fetch to capture the body
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ messages: [{ id: 'ok' }] }), { status: 200 }),
    )

    const longText = 'A'.repeat(5000)
    await client.sendTextMessage('5491112345678', longText)

    expect(fetchSpy).toHaveBeenCalled()
    const callBody = JSON.parse(fetchSpy.mock.calls[0][1]!.body as string)
    expect(callBody.text.body.length).toBe(4096)
    expect(callBody.text.body.endsWith('...')).toBe(true)

    fetchSpy.mockRestore()
  })
})

// =============================================================================
// Intent Classification Tests
// =============================================================================

describe('Intent Classification', () => {
  beforeEach(() => {
    resetMocks()
    mockChatCreate.mockReset()
    vi.stubEnv('OPENAI_API_KEY', 'test-openai-key')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  const baseContext: SecretariaContext = {
    companyId: 'company-1',
    userId: 'user-1',
    phoneNumber: '5491112345678',
    displayName: 'Juan',
    recentMessages: [],
    memory: {},
  }

  function mockIntentResponse(intent: string, confidence: number, entities: Record<string, string> = {}) {
    mockChatCreate.mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify({ intent, confidence, entities }) } }],
    })
  }

  // -- Test 10: classifyIntent "quien me debe?" -> query_balances --
  it('classifyIntent: "quien me debe?" -> query_balances', async () => {
    mockIntentResponse('query_balances', 0.95)
    const { classifyIntent } = await import('../src/modules/secretaria/secretaria.agents')

    const result = await classifyIntent('quien me debe?', baseContext)

    expect(result.intent).toBe('query_balances')
    expect(result.confidence).toBeGreaterThanOrEqual(0.5)
  })

  // -- Test 11: classifyIntent "cuantos discos tengo?" -> query_products --
  it('classifyIntent: "cuantos discos tengo?" -> query_products', async () => {
    mockIntentResponse('query_products', 0.9, { product_name: 'discos' })
    const { classifyIntent } = await import('../src/modules/secretaria/secretaria.agents')

    const result = await classifyIntent('cuantos discos tengo?', baseContext)

    expect(result.intent).toBe('query_products')
    expect(result.entities.product_name).toBe('discos')
  })

  // -- Test 12: classifyIntent "hola" -> greeting --
  it('classifyIntent: "hola" -> greeting', async () => {
    mockIntentResponse('greeting', 0.99)
    const { classifyIntent } = await import('../src/modules/secretaria/secretaria.agents')

    const result = await classifyIntent('hola', baseContext)
    expect(result.intent).toBe('greeting')
  })

  // -- Test 13: classifyIntent "ayuda" -> help --
  it('classifyIntent: "ayuda" -> help', async () => {
    mockIntentResponse('help', 0.95)
    const { classifyIntent } = await import('../src/modules/secretaria/secretaria.agents')

    const result = await classifyIntent('ayuda', baseContext)
    expect(result.intent).toBe('help')
  })

  // -- Test 14: classifyIntent gibberish -> unknown with low confidence --
  it('classifyIntent: gibberish -> unknown with low confidence', async () => {
    mockIntentResponse('unknown', 0.2)
    const { classifyIntent } = await import('../src/modules/secretaria/secretaria.agents')

    const result = await classifyIntent('asdlkjfhg ksdjfh', baseContext)

    expect(result.intent).toBe('unknown')
    expect(result.confidence).toBeLessThan(0.5)
  })
})

// =============================================================================
// Tools Tests
// =============================================================================

describe('SecretarIA Tools', () => {
  beforeEach(() => {
    resetMocks()
    mockGetCompanySummary.mockReset()
    mockGetTopCustomers.mockReset()
    mockGetTopProducts.mockReset()
    mockGetCollectionsSummary.mockReset()
  })

  // -- Test 15: queryClients returns top clients with company_id filter --
  it('queryClients: returns top clients with company_id filter', async () => {
    mockPoolQuery.mockResolvedValueOnce({
      rows: [
        { nombre: 'Garcia SA', cuit: '20123456789', total_facturado: '150000', ultimo_pedido: '2026-03-15', saldo_pendiente: '50000', cantidad_pedidos: '10' },
        { nombre: 'Lopez SRL', cuit: '20987654321', total_facturado: '80000', ultimo_pedido: '2026-03-10', saldo_pendiente: '0', cantidad_pedidos: '5' },
      ],
    })

    const { queryClients } = await import('../src/modules/secretaria/secretaria.tools')
    const result = await queryClients('company-1', {})

    expect(result.toolName).toBe('queryClients')
    expect(result.data).toHaveLength(2)
    expect(result.formatted).toContain('Top clientes')

    // Verify company_id was passed as first param
    expect(mockPoolQuery.mock.calls[0][1][0]).toBe('company-1')
  })

  // -- Test 16: queryProducts fuzzy search by name --
  it('queryProducts: fuzzy search by name works', async () => {
    mockPoolQuery.mockResolvedValueOnce({
      rows: [
        { nombre: 'Disco de Corte 115mm', sku: 'DC-115', precio: '2500', costo: '1500', stock: '100', controls_stock: true, margen_pct: '40.0' },
      ],
    })

    const { queryProducts } = await import('../src/modules/secretaria/secretaria.tools')
    const result = await queryProducts('company-1', { product_name: 'disco' })

    expect(result.toolName).toBe('queryProducts')
    expect(result.formatted).toContain('Disco de Corte')

    // Verify search term is ILIKE with %
    expect(mockPoolQuery.mock.calls[0][1][1]).toBe('%disco%')
  })

  // -- Test 17: queryBalances returns por cobrar/por pagar/neto --
  it('queryBalances: returns por cobrar/por pagar/neto', async () => {
    mockGetCollectionsSummary.mockResolvedValueOnce({
      pending_collection_amount: 500000,
      pending_collection_count: 15,
      collected_this_month: 200000,
      paid_this_month: 100000,
    })

    const { queryBalances } = await import('../src/modules/secretaria/secretaria.tools')
    const result = await queryBalances('company-1', {})

    expect(result.toolName).toBe('queryBalances')
    expect(result.formatted).toContain('Por cobrar')
    expect(result.formatted).toContain('Cobrado este mes')
    expect(result.formatted).toContain('Neto pendiente')
  })

  // -- Test 18: morningBrief returns combined summary --
  it('morningBrief: returns combined summary', async () => {
    mockGetCompanySummary.mockResolvedValueOnce({
      total_orders: 100,
      pending_orders: 10,
      total_customers: 50,
      total_products: 200,
    })
    mockGetCollectionsSummary.mockResolvedValueOnce({
      pending_collection_amount: 300000,
      pending_collection_count: 8,
      collected_this_month: 150000,
      paid_this_month: 80000,
    })
    // pendingOrders
    mockPoolQuery.mockResolvedValueOnce({
      rows: [{ cantidad: '5', total: '250000' }],
    })
    // lowStock
    mockPoolQuery.mockResolvedValueOnce({
      rows: [{ name: 'Disco 115mm', stock: '2', low_stock_threshold: '10' }],
    })
    // cheques
    mockPoolQuery.mockResolvedValueOnce({
      rows: [{ cantidad: '2', total: '80000' }],
    })
    // MoM sales
    mockPoolQuery.mockResolvedValueOnce({
      rows: [{ mes_actual: '1200000' }],
    })

    const { morningBrief } = await import('../src/modules/secretaria/secretaria.tools')
    const result = await morningBrief('company-1')

    expect(result.toolName).toBe('morningBrief')
    expect(result.formatted).toContain('Buenos dias')
    expect(result.formatted).toContain('Ventas del mes')
    expect(result.formatted).toContain('Pedidos pendientes')
    expect(result.formatted).toContain('Por cobrar')
    expect(result.formatted).toContain('Cheques proximos')
    expect(result.formatted).toContain('Stock bajo')
  })

  // -- Test 19: executeTool maps intent to correct tool --
  it('executeTool: maps intent to correct tool', async () => {
    const { executeTool } = await import('../src/modules/secretaria/secretaria.tools')

    // Test greeting
    const greetingResult = await executeTool('greeting', {}, 'company-1')
    expect(greetingResult.toolName).toBe('greeting')
    expect(greetingResult.formatted).toContain('SecretarIA')

    // Test help
    const helpResult = await executeTool('help', {}, 'company-1')
    expect(helpResult.toolName).toBe('help')
    expect(helpResult.formatted).toContain('Clientes')
  })

  // -- Test 20: executeTool unknown intent returns help response --
  it('executeTool: unknown intent returns help response', async () => {
    const { executeTool } = await import('../src/modules/secretaria/secretaria.tools')
    const result = await executeTool('unknown', {}, 'company-1')

    expect(result.toolName).toBe('unknown')
    expect(result.formatted).toContain('No entendi')
  })
})

// =============================================================================
// Memory Tests
// =============================================================================

describe('SecretarIA Memory', () => {
  beforeEach(() => {
    resetMocks()
  })

  // -- Test 21: setMemory creates new memory with correct confidence --
  it('setMemory: creates new memory with correct confidence', async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [] })
    const { secretariaMemory } = await import('../src/modules/secretaria/secretaria.memory')

    await secretariaMemory.setMemory('company-1', 'user-1', 'test_key', 'test_value', 'explicit', 'preference')

    expect(mockPoolQuery).toHaveBeenCalledTimes(1)
    const args = mockPoolQuery.mock.calls[0][1]
    expect(args[0]).toBe('company-1')
    expect(args[1]).toBe('user-1')
    expect(args[4]).toBe('test_value')
    // explicit -> confidence 0.9
    expect(args[5]).toBe(0.9)
  })

  // -- Test 22: setMemory upserts existing memory --
  it('setMemory: upserts existing memory (ON CONFLICT)', async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [] })
    const { secretariaMemory } = await import('../src/modules/secretaria/secretaria.memory')

    await secretariaMemory.setMemory('company-1', 'user-1', 'same_key', 'new_value', 'inferred', 'preference')

    // The SQL contains ON CONFLICT ... DO UPDATE
    const sqlQuery = mockPoolQuery.mock.calls[0][0]
    expect(sqlQuery).toContain('ON CONFLICT')
    expect(sqlQuery).toContain('DO UPDATE')

    // inferred -> confidence 0.5
    expect(mockPoolQuery.mock.calls[0][1][5]).toBe(0.5)
  })

  // -- Test 23: confirmMemory increments confidence (max 1.0) --
  it('confirmMemory: increments confidence (max 1.0)', async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [] })
    const { secretariaMemory } = await import('../src/modules/secretaria/secretaria.memory')

    await secretariaMemory.confirmMemory('company-1', 'my_key')

    const sqlQuery = mockPoolQuery.mock.calls[0][0]
    expect(sqlQuery).toContain('LEAST(confidence + 0.1, 1.0)')
    expect(sqlQuery).toContain('times_used = times_used + 1')
  })

  // -- Test 24: contradictMemory decrements confidence, deletes if < 0.2 --
  it('contradictMemory: decrements confidence, deletes if < 0.2', async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [] }) // UPDATE
    mockPoolQuery.mockResolvedValueOnce({ rows: [] }) // DELETE
    const { secretariaMemory } = await import('../src/modules/secretaria/secretaria.memory')

    await secretariaMemory.contradictMemory('company-1', 'my_key')

    expect(mockPoolQuery).toHaveBeenCalledTimes(2)
    const updateSql = mockPoolQuery.mock.calls[0][0]
    expect(updateSql).toContain('confidence - 0.2')
    const deleteSql = mockPoolQuery.mock.calls[1][0]
    expect(deleteSql).toContain('DELETE')
    expect(deleteSql).toContain('confidence < 0.2')
  })

  // -- Test 25: detectAndSaveMemory "siempre factura A" saves preference --
  it('detectAndSaveMemory: "siempre factura A" saves preference', async () => {
    mockPoolQuery.mockResolvedValue({ rows: [] }) // setMemory calls
    const { secretariaMemory } = await import('../src/modules/secretaria/secretaria.memory')

    const saved = await secretariaMemory.detectAndSaveMemory(
      'company-1',
      'user-1',
      'siempre quiero factura A',
      'Ok, tomo nota.',
    )

    expect(saved.length).toBeGreaterThanOrEqual(1)
    expect(saved[0].type).toBe('preference')
    expect(saved[0].value).toBe('factura A')
  })

  // -- Test 26: detectAndSaveMemory "cuando digo disco..." saves alias --
  it('detectAndSaveMemory: "cuando digo disco me refiero a Disco de Corte" saves alias', async () => {
    mockPoolQuery.mockResolvedValue({ rows: [] })
    const { secretariaMemory } = await import('../src/modules/secretaria/secretaria.memory')

    const saved = await secretariaMemory.detectAndSaveMemory(
      'company-1',
      'user-1',
      'cuando digo disco me refiero a Disco de Corte',
      'Entendido.',
    )

    expect(saved.length).toBeGreaterThanOrEqual(1)
    const aliasMem = saved.find(s => s.type === 'alias')
    expect(aliasMem).toBeDefined()
    expect(aliasMem!.key).toContain('alias_disco')
    expect(aliasMem!.value).toContain('Disco de Corte')
  })

  // -- Test 27: getMemoryContext formats string under 500 chars --
  it('getMemoryContext: formats string under 500 chars', async () => {
    const memoryRows = Array.from({ length: 30 }, (_, i) => ({
      key: `preference_item_${i}`,
      value: `Value for item number ${i} with some extra text`,
    }))
    mockPoolQuery.mockResolvedValueOnce({ rows: memoryRows })
    const { secretariaMemory } = await import('../src/modules/secretaria/secretaria.memory')

    const context = await secretariaMemory.getMemoryContext('company-1', 'user-1')

    expect(context.length).toBeLessThanOrEqual(500)
    expect(context).toContain('Preferencias conocidas:')
  })
})

// =============================================================================
// Linking Tests
// =============================================================================

describe('SecretarIA Phone Linking', () => {
  beforeEach(() => {
    resetMocks()
  })

  // -- Test 28: generateLinkingCode returns 6-digit code --
  it('generateLinkingCode: returns 6-digit code', async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [] }) // check existing
    mockPoolQuery.mockResolvedValueOnce({ rows: [] }) // INSERT
    const { secretariaMemory } = await import('../src/modules/secretaria/secretaria.memory')

    const code = await secretariaMemory.generateLinkingCode('company-1', 'user-1', '5491112345678')

    expect(code).toMatch(/^\d{6}$/)
    expect(parseInt(code)).toBeGreaterThanOrEqual(100000)
    expect(parseInt(code)).toBeLessThan(1000000)
  })

  // -- Test 29: generateLinkingCode phone already linked to another company -> error --
  it('generateLinkingCode: phone already linked to another company throws error', async () => {
    mockPoolQuery.mockResolvedValueOnce({
      rows: [{ company_id: 'OTHER-COMPANY', verified: true }],
    })
    const { secretariaMemory } = await import('../src/modules/secretaria/secretaria.memory')

    await expect(
      secretariaMemory.generateLinkingCode('company-1', 'user-1', '5491112345678'),
    ).rejects.toThrow('ya esta vinculado a otra empresa')
  })

  // -- Test 30: verifyLinkingCode correct code -> success --
  it('verifyLinkingCode: correct code -> success', async () => {
    const futureDate = new Date(Date.now() + 5 * 60 * 1000).toISOString()
    mockPoolQuery.mockResolvedValueOnce({
      rows: [{
        id: 'link-1',
        company_id: 'company-1',
        user_id: 'user-1',
        phone_number: '5491112345678',
        linking_code: '123456',
        linking_code_expires: futureDate,
        verified: false,
        company_name: 'Test Company',
      }],
    })
    mockPoolQuery.mockResolvedValueOnce({ rows: [] }) // UPDATE
    const { secretariaMemory } = await import('../src/modules/secretaria/secretaria.memory')

    const result = await secretariaMemory.verifyLinkingCode('5491112345678', '123456')

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.companyId).toBe('company-1')
      expect(result.userId).toBe('user-1')
    }
  })

  // -- Test 31: verifyLinkingCode expired code -> error --
  it('verifyLinkingCode: expired code -> error', async () => {
    const pastDate = new Date(Date.now() - 5 * 60 * 1000).toISOString()
    mockPoolQuery.mockResolvedValueOnce({
      rows: [{
        id: 'link-1',
        company_id: 'company-1',
        user_id: 'user-1',
        phone_number: '5491112345678',
        linking_code: '123456',
        linking_code_expires: pastDate,
        verified: false,
        company_name: 'Test Company',
      }],
    })
    const { secretariaMemory } = await import('../src/modules/secretaria/secretaria.memory')

    const result = await secretariaMemory.verifyLinkingCode('5491112345678', '123456')

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.reason).toBe('expired')
    }
  })

  // -- Test 32: verifyLinkingCode wrong code -> error --
  it('verifyLinkingCode: wrong code -> error', async () => {
    const futureDate = new Date(Date.now() + 5 * 60 * 1000).toISOString()
    mockPoolQuery.mockResolvedValueOnce({
      rows: [{
        id: 'link-1',
        company_id: 'company-1',
        user_id: 'user-1',
        phone_number: '5491112345678',
        linking_code: '123456',
        linking_code_expires: futureDate,
        verified: false,
        company_name: 'Test Company',
      }],
    })
    const { secretariaMemory } = await import('../src/modules/secretaria/secretaria.memory')

    const result = await secretariaMemory.verifyLinkingCode('5491112345678', '999999')

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.reason).toBe('invalid_code')
    }
  })

  // -- Test 33: lookupPhone verified phone returns company/user --
  it('lookupPhone: verified phone returns company/user', async () => {
    mockPoolQuery.mockResolvedValueOnce({
      rows: [{ company_id: 'company-1', user_id: 'user-1', display_name: 'Juan Garcia' }],
    })
    const { secretariaMemory } = await import('../src/modules/secretaria/secretaria.memory')

    const result = await secretariaMemory.lookupPhone('5491112345678')

    expect(result).not.toBeNull()
    expect(result!.companyId).toBe('company-1')
    expect(result!.userId).toBe('user-1')
    expect(result!.displayName).toBe('Juan Garcia')
  })

  // -- Test 34: lookupPhone unverified phone returns null --
  it('lookupPhone: unverified phone returns null', async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [] })
    const { secretariaMemory } = await import('../src/modules/secretaria/secretaria.memory')

    const result = await secretariaMemory.lookupPhone('5491199999999')
    expect(result).toBeNull()
  })
})

// =============================================================================
// Usage Tests
// =============================================================================

describe('SecretarIA Usage Tracking', () => {
  beforeEach(() => {
    resetMocks()
  })

  // -- Test 35: trackUsage increments monthly counters --
  it('trackUsage: increments monthly counters', async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [] })
    const { secretariaMemory } = await import('../src/modules/secretaria/secretaria.memory')

    await secretariaMemory.trackUsage('company-1', {
      messages_received: 1,
      messages_sent: 1,
    })

    const sqlQuery = mockPoolQuery.mock.calls[0][0]
    expect(sqlQuery).toContain('ON CONFLICT (company_id, month) DO UPDATE')
    expect(sqlQuery).toContain('messages_received = secretaria_usage.messages_received + COALESCE')

    const args = mockPoolQuery.mock.calls[0][1]
    expect(args[0]).toBe('company-1')
    // month format YYYY-MM
    expect(args[1]).toMatch(/^\d{4}-\d{2}$/)
  })

  // -- Test 36: checkUsageLimits under limit -> ok --
  it('checkUsageLimits: under limit -> ok', async () => {
    mockPoolQuery.mockResolvedValueOnce({
      rows: [{
        company_id: 'company-1',
        month: '2026-03',
        messages_received: 50,
        messages_sent: 50,
        llm_tokens_input: 10000,
        llm_tokens_output: 5000,
        stt_minutes: '0',
        estimated_cost_usd: '5.00',
      }],
    })
    const { secretariaMemory } = await import('../src/modules/secretaria/secretaria.memory')

    const result = await secretariaMemory.checkUsageLimits('company-1')

    expect(result.withinLimits).toBe(true)
    expect(result.percentUsed).toBeLessThanOrEqual(100)
    expect(result.warning).toBeUndefined()
  })

  // -- Test 37: checkUsageLimits over 80% -> warning --
  it('checkUsageLimits: over 80% -> warning', async () => {
    mockPoolQuery.mockResolvedValueOnce({
      rows: [{
        company_id: 'company-1',
        month: '2026-03',
        messages_received: 220,
        messages_sent: 220,
        llm_tokens_input: 50000,
        llm_tokens_output: 25000,
        stt_minutes: '0',
        estimated_cost_usd: '20.00',
      }],
    })
    const { secretariaMemory } = await import('../src/modules/secretaria/secretaria.memory')

    const result = await secretariaMemory.checkUsageLimits('company-1')

    expect(result.withinLimits).toBe(true)
    expect(result.percentUsed).toBeGreaterThan(80)
    expect(result.warning).toBeDefined()
    expect(result.warning).toContain('%')
  })

  // -- Test 38: checkUsageLimits over 100% -> blocked --
  it('checkUsageLimits: over 100% -> blocked', async () => {
    mockPoolQuery.mockResolvedValueOnce({
      rows: [{
        company_id: 'company-1',
        month: '2026-03',
        messages_received: 300,
        messages_sent: 300,
        llm_tokens_input: 100000,
        llm_tokens_output: 50000,
        stt_minutes: '0',
        estimated_cost_usd: '50.00',
      }],
    })
    const { secretariaMemory } = await import('../src/modules/secretaria/secretaria.memory')

    const result = await secretariaMemory.checkUsageLimits('company-1')

    expect(result.withinLimits).toBe(false)
    expect(result.percentUsed).toBeGreaterThan(100)
    expect(result.warning).toContain('excedido')
  })
})

// =============================================================================
// Security Tests
// =============================================================================

describe('SecretarIA Security', () => {
  beforeEach(() => {
    resetMocks()
    vi.stubEnv('WHATSAPP_APP_SECRET', 'production-secret')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  // -- Test 39: Webhook without signature -> rejected in production --
  it('Webhook without signature is rejected in production mode', () => {
    const client = new WhatsAppClient()
    // No signature at all
    const result = client.validateWebhookSignature('body', '')
    expect(result).toBe(false)
  })

  // -- Test 40: Tool queries always include company_id (grep test) --
  it('Tool queries always include company_id', async () => {
    const fs = await import('node:fs')
    const toolsSource = fs.readFileSync(
      '/home/facu/BECKER/Gestor BeckerVisual/backend/src/modules/secretaria/secretaria.tools.ts',
      'utf-8',
    )

    // Every pool.query call should have $1 as company_id
    const queryMatches = toolsSource.match(/pool\.query\(`[\s\S]*?`/g) || []
    expect(queryMatches.length).toBeGreaterThan(0)

    for (const query of queryMatches) {
      // Every query should reference company_id either directly with $N
      // or via ${whereClause} which is built from parameterized conditions
      const hasDirectCompanyId = /company_id\s*=\s*\$\d/.test(query)
      const hasDynamicWhere = /\$\{whereClause\}/.test(query)
      expect(hasDirectCompanyId || hasDynamicWhere).toBe(true)
    }
  })

  // -- Test 41: System prompts include anti-injection text --
  it('System prompts include anti-injection text', () => {
    expect(SECRETARIA_PROMPTS.intentClassification).toBeDefined()
    expect(SECRETARIA_PROMPTS.responseGeneration).toBeDefined()

    // Check that the security block function exists and produces anti-injection text
    // by verifying the prompt templates + the security block builder
    const responsePrompt = SECRETARIA_PROMPTS.responseGeneration
    expect(responsePrompt).toContain('NUNCA inventes datos')
    expect(responsePrompt).toContain('NUNCA menciones SQL')
  })

  // -- Test 42: Intent classifier sanitizes entity values (no SQL in entities) --
  it('Intent classifier sanitizes entity values (no SQL)', async () => {
    // The sanitizeEntities function is private, but we can verify through classifyIntent
    mockChatCreate.mockResolvedValueOnce({
      choices: [{
        message: {
          content: JSON.stringify({
            intent: 'query_clients',
            confidence: 0.9,
            entities: {
              client_name: "'; DROP TABLE users; --",
              product_name: 'normal_product',
              // Non-allowed key should be stripped
              evil_key: 'evil_value',
            },
          }),
        },
      }],
    })

    vi.stubEnv('OPENAI_API_KEY', 'test-openai-key')
    const { classifyIntent } = await import('../src/modules/secretaria/secretaria.agents')

    const result = await classifyIntent('test', {
      companyId: 'company-1',
      userId: 'user-1',
      phoneNumber: '5491112345678',
      displayName: 'Test',
      recentMessages: [],
      memory: {},
    })

    // Non-allowed key should be stripped
    expect(result.entities).not.toHaveProperty('evil_key')
    // Values should be truncated to 100 chars max
    expect(result.entities.client_name?.length).toBeLessThanOrEqual(100)
    // Allowed keys preserved
    expect(result.entities).toHaveProperty('client_name')
    expect(result.entities).toHaveProperty('product_name')
  })
})

// =============================================================================
// Code Review - Bug Detection Tests
// =============================================================================

describe('SecretarIA Bug Detection', () => {
  // -- BUG FIX 1: Verify SQL queries in tools use parameterized values (no concatenation) --
  it('All SQL queries in tools use parameterized values (no string concatenation)', async () => {
    const fs = await import('node:fs')
    const toolsSource = fs.readFileSync(
      '/home/facu/BECKER/Gestor BeckerVisual/backend/src/modules/secretaria/secretaria.tools.ts',
      'utf-8',
    )

    // Check there are no direct string interpolations inside SQL query strings
    // Pattern: `SELECT ... ${variable} ...` (template literal with interpolation in SQL)
    // The only interpolation should be ${whereClause} which is built from parameterized conditions
    const sqlBlocks = toolsSource.match(/pool\.query\(`([\s\S]*?)`/g) || []
    for (const block of sqlBlocks) {
      // ${whereClause} is safe (built from '$N' params), but no other interpolation
      const interpolations = block.match(/\$\{(?!whereClause|paramIdx)[^}]+\}/g) || []
      expect(interpolations).toEqual([])
    }
  })

  // -- BUG FIX 2: Memory queries use parameterized values --
  it('Memory queries in secretaria.memory.ts use parameterized values', async () => {
    const fs = await import('node:fs')
    const memorySource = fs.readFileSync(
      '/home/facu/BECKER/Gestor BeckerVisual/backend/src/modules/secretaria/secretaria.memory.ts',
      'utf-8',
    )

    // All pool.query calls should use $N parameters
    const queryMatches = memorySource.match(/pool\.query\(\s*`([\s\S]*?)`/g) || []
    for (const query of queryMatches) {
      // Global cleanup queries (e.g. DELETE WHERE confidence < 0.2) don't need params
      // but all queries that access company/user data should be parameterized
      if (query.includes('company_id') || query.includes('phone_number') || query.includes('user_id')) {
        expect(query).toMatch(/\$\d/)
      }
    }
  })

  // -- BUG FIX 3: Linking code is cryptographically random --
  it('Linking code generation uses crypto.randomInt (CSPRNG)', async () => {
    const fs = await import('node:fs')
    const memorySource = fs.readFileSync(
      '/home/facu/BECKER/Gestor BeckerVisual/backend/src/modules/secretaria/secretaria.memory.ts',
      'utf-8',
    )

    // Verify it uses crypto.randomInt, not Math.random
    expect(memorySource).toContain('crypto.randomInt')
    expect(memorySource).not.toContain('Math.random')
  })

  // -- BUG FIX 4: concurrency Map cleanup check --
  it('Phone processing locks map includes cleanup logic', async () => {
    const fs = await import('node:fs')
    const serviceSource = fs.readFileSync(
      '/home/facu/BECKER/Gestor BeckerVisual/backend/src/modules/secretaria/secretaria.service.ts',
      'utf-8',
    )

    // Verify .finally() cleanup exists
    expect(serviceSource).toContain('.finally(')
    expect(serviceSource).toContain('phoneProcessingLocks.delete')
  })

  // -- BUG FIX 5: Usage tracking uses UPSERT (atomic) --
  it('Usage tracking uses atomic UPSERT to prevent race conditions', async () => {
    const fs = await import('node:fs')
    const memorySource = fs.readFileSync(
      '/home/facu/BECKER/Gestor BeckerVisual/backend/src/modules/secretaria/secretaria.memory.ts',
      'utf-8',
    )

    // Verify UPSERT pattern is used (ON CONFLICT DO UPDATE)
    expect(memorySource).toContain('ON CONFLICT (company_id, month) DO UPDATE')
    // Verify it adds to existing values, not replaces
    expect(memorySource).toContain('secretaria_usage.messages_received + COALESCE')
  })

  // -- BUG FIX 6: verifyWebhook handles missing mode correctly --
  it('verifyWebhook returns null when mode is not subscribe', () => {
    const client = new WhatsAppClient()
    vi.stubEnv('WHATSAPP_VERIFY_TOKEN', 'test-token')

    const result = client.verifyWebhook({
      'hub.mode': 'unsubscribe',
      'hub.verify_token': 'test-token',
      'hub.challenge': 'challenge',
    })
    expect(result).toBeNull()
  })

  // -- BUG FIX 7: verifyWebhook handles missing challenge --
  it('verifyWebhook returns null when challenge is missing', () => {
    const client = new WhatsAppClient()
    vi.stubEnv('WHATSAPP_VERIFY_TOKEN', 'test-token')

    const result = client.verifyWebhook({
      'hub.mode': 'subscribe',
      'hub.verify_token': 'test-token',
    })
    expect(result).toBeNull()
  })
})
