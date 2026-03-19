// AI Service - Core chat functionality ("Preguntale a GESTIA")
// Converts natural language questions to data queries and returns natural language answers

import Anthropic from '@anthropic-ai/sdk';
import { AI_CONFIG, isAiConfigured } from './ai.config';
import { getCachedResponse, setCachedResponse, checkRateLimit, incrementRateLimit } from './ai.cache';
import {
  SCHEMA_DESCRIPTION,
  runSafeQuery,
  getCompanySummary,
  getTopCustomers,
  getTopProducts,
  getCollectionsSummary,
} from './ai.queries';
import { ApiError } from '../../middlewares/errorHandler';
import logger from '../../config/logger';

let anthropicClient: Anthropic | null = null;

function getClient(): Anthropic {
  if (!anthropicClient) {
    if (!isAiConfigured()) {
      throw new ApiError(503, 'IA no configurada. Configurá ANTHROPIC_API_KEY en las variables de entorno.');
    }
    anthropicClient = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
  }
  return anthropicClient;
}

// Determine if a question is simple (use Haiku) or complex (use Sonnet)
function isComplexQuestion(question: string): boolean {
  const complexIndicators = [
    'anali', 'compar', 'tendencia', 'proyecc', 'predicc',
    'por que', 'explicar', 'detall', 'estrategia',
    'recomen', 'optimiz', 'mejora', 'problem',
  ];
  const lower = question.toLowerCase();
  return complexIndicators.some(ind => lower.includes(ind));
}

export interface ChatResponse {
  readonly answer: string;
  readonly cached: boolean;
  readonly remaining_queries: number;
}

export interface InsightItem {
  readonly type: string;
  readonly severity: 'critical' | 'warning' | 'info' | 'success';
  readonly title: string;
  readonly description: string;
  readonly metric?: string;
}

class AiService {
  // Main chat endpoint
  async chat(companyId: string, question: string): Promise<ChatResponse> {
    if (!isAiConfigured()) {
      throw new ApiError(503, 'IA no configurada. Contactá al administrador.');
    }

    if (!question || question.trim().length < 3) {
      throw new ApiError(400, 'La pregunta es muy corta. Escribí al menos 3 caracteres.');
    }

    if (question.trim().length > 500) {
      throw new ApiError(400, 'La pregunta es muy larga. Maximo 500 caracteres.');
    }

    // Check rate limit
    const rateCheck = checkRateLimit(companyId);
    if (!rateCheck.allowed) {
      throw new ApiError(429, 'Alcanzaste el limite de consultas de IA por hoy (50). Intenta maniana.');
    }

    // Check cache
    const cached = getCachedResponse(companyId, question);
    if (cached) {
      return {
        answer: cached,
        cached: true,
        remaining_queries: rateCheck.remaining,
      };
    }

    // Gather context data (aggregated, anonymization-safe)
    const [summary, topCustomers, topProducts, collections] = await Promise.all([
      getCompanySummary(companyId),
      getTopCustomers(companyId, 5),
      getTopProducts(companyId, 5),
      getCollectionsSummary(companyId),
    ]);

    const contextData = `
DATOS DEL NEGOCIO (actualizados):
- Total pedidos: ${summary.total_orders} | Revenue total: $${summary.total_revenue.toLocaleString('es-AR')}
- Pedidos pendientes: ${summary.pending_orders} | Pedidos sin pagar: ${summary.unpaid_orders}
- Facturas autorizadas: ${summary.total_invoices} | Total facturado: $${summary.total_invoiced.toLocaleString('es-AR')}
- Total clientes: ${summary.total_customers} | Total productos: ${summary.total_products}

COBRANZAS ESTE MES:
- Cobrado: $${collections.collected_this_month.toLocaleString('es-AR')} (${collections.collection_count} cobros)
- Pagado: $${collections.paid_this_month.toLocaleString('es-AR')} (${collections.payment_count} pagos)
- Pendiente de cobro: $${collections.pending_collection_amount.toLocaleString('es-AR')} (${collections.pending_collection_count} pedidos)

TOP 5 CLIENTES POR FACTURACION:
${topCustomers.map((c, i) => `${i + 1}. ${c.name}: $${c.revenue.toLocaleString('es-AR')} (${c.orders} pedidos)`).join('\n')}

TOP 5 PRODUCTOS POR VENTA:
${topProducts.map((p, i) => `${i + 1}. ${p.name}: $${p.revenue.toLocaleString('es-AR')} (${p.quantity} unidades, margen ${p.margin_pct.toFixed(1)}%)`).join('\n')}
`;

    // Determine model based on complexity
    const model = isComplexQuestion(question) ? AI_CONFIG.models.smart : AI_CONFIG.models.fast;

    try {
      const client = getClient();
      const response = await client.messages.create({
        model,
        max_tokens: AI_CONFIG.maxTokens.chat,
        system: AI_CONFIG.systemPrompts.chat,
        messages: [
          {
            role: 'user',
            content: `${contextData}\n\nPREGUNTA DEL USUARIO: ${question}`,
          },
        ],
      });

      const answer = response.content
        .filter(block => block.type === 'text')
        .map(block => (block as any).text)
        .join('');

      // Cache and track
      setCachedResponse(companyId, question, answer);
      incrementRateLimit(companyId);

      return {
        answer,
        cached: false,
        remaining_queries: rateCheck.remaining - 1,
      };
    } catch (error: any) {
      logger.error({ error: error.message }, 'AI chat error');

      if (error instanceof ApiError) throw error;

      if (error.status === 429) {
        throw new ApiError(429, 'El servicio de IA esta temporalmente sobrecargado. Intenta en unos minutos.');
      }

      throw new ApiError(500, 'Error al procesar tu consulta. Intenta de nuevo.');
    }
  }

  // Generate a SQL query from natural language (for advanced chat)
  async chatWithSQL(companyId: string, question: string): Promise<ChatResponse> {
    if (!isAiConfigured()) {
      throw new ApiError(503, 'IA no configurada.');
    }

    const rateCheck = checkRateLimit(companyId);
    if (!rateCheck.allowed) {
      throw new ApiError(429, 'Limite de consultas alcanzado.');
    }

    const cached = getCachedResponse(companyId, `sql:${question}`);
    if (cached) {
      return { answer: cached, cached: true, remaining_queries: rateCheck.remaining };
    }

    const client = getClient();

    // Step 1: Generate SQL from the question
    const sqlGenResponse = await client.messages.create({
      model: AI_CONFIG.models.fast,
      max_tokens: 512,
      system: `Sos un experto en SQL PostgreSQL. Generá una query SELECT para responder la pregunta del usuario.
REGLAS CRITICAS:
- Solo generá queries SELECT (lectura). NUNCA INSERT/UPDATE/DELETE.
- SIEMPRE filtrá por company_id = $1 (parametro de seguridad multi-tenant).
- Usá CAST para campos decimales: CAST(amount AS decimal).
- Limite maximo: 50 rows.
- Respondé SOLO con la query SQL, sin explicacion ni markdown.
- Si la pregunta no se puede responder con SQL, respondé "NO_SQL".
${SCHEMA_DESCRIPTION}`,
      messages: [{ role: 'user', content: question }],
    });

    const sqlQuery = sqlGenResponse.content
      .filter(block => block.type === 'text')
      .map(block => (block as any).text)
      .join('')
      .trim();

    if (sqlQuery === 'NO_SQL' || !sqlQuery.toUpperCase().startsWith('SELECT')) {
      // Fall back to context-based chat
      return this.chat(companyId, question);
    }

    try {
      // Step 2: Execute the query safely
      const queryResults = await runSafeQuery(sqlQuery, companyId);

      // Step 3: Generate natural language answer from results
      const answerResponse = await client.messages.create({
        model: AI_CONFIG.models.fast,
        max_tokens: AI_CONFIG.maxTokens.chat,
        system: AI_CONFIG.systemPrompts.chat,
        messages: [
          {
            role: 'user',
            content: `El usuario preguntó: "${question}"

Resultados de la consulta (datos reales del negocio):
${JSON.stringify(queryResults.slice(0, 20), null, 2)}

Generá una respuesta natural y clara basada en estos datos. Formateá montos en pesos argentinos.`,
          },
        ],
      });

      const answer = answerResponse.content
        .filter(block => block.type === 'text')
        .map(block => (block as any).text)
        .join('');

      setCachedResponse(companyId, `sql:${question}`, answer);
      incrementRateLimit(companyId);

      return { answer, cached: false, remaining_queries: rateCheck.remaining - 1 };
    } catch (error: any) {
      logger.warn({ error: error.message, sql: sqlQuery }, 'SQL query failed, falling back to context chat');
      // If SQL fails, fall back to context-based response
      return this.chat(companyId, question);
    }
  }
}

export const aiService = new AiService();
