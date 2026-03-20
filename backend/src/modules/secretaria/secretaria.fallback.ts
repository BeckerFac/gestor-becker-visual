// SecretarIA — Rule-based fallback responses (no LLM required)
// Used when the LLM quota is exceeded or as a cost-saving measure for simple queries.

import { queryBalances, queryProducts } from './secretaria.tools';
import { ToolResult } from './secretaria.types';
import logger from '../../config/logger';

// ── Keyword matchers ──

interface FallbackRule {
  readonly keywords: ReadonlyArray<string>;
  readonly handler: (companyId: string, text: string) => Promise<ToolResult> | ToolResult;
}

const GREETING_WORDS: ReadonlyArray<string> = [
  'hola', 'buen dia', 'buenos dias', 'buenas tardes', 'buenas noches', 'buenas', 'hey', 'ey',
];

const HELP_WORDS: ReadonlyArray<string> = [
  'ayuda', 'help', 'que podes hacer', 'que sabes hacer', 'comandos', 'funciones',
];

const BALANCE_WORDS: ReadonlyArray<string> = [
  'quien me debe', 'deudores', 'saldos', 'cuentas corrientes', 'por cobrar', 'deudas',
];

const STOCK_WORDS: ReadonlyArray<string> = [
  'stock bajo', 'sin stock', 'reponer', 'stock critico', 'falta stock',
];

// ── Handlers ──

function greetingHandler(): ToolResult {
  return {
    toolName: 'fallback_greeting',
    data: null,
    formatted: 'Hola! En que puedo ayudarte?\n\nEscribi "ayuda" para ver las consultas disponibles.',
  };
}

function helpHandler(): ToolResult {
  return {
    toolName: 'fallback_help',
    data: null,
    formatted: `*Consultas disponibles (modo basico):*

- "quien me debe" — Ver saldos pendientes de cobro
- "stock bajo" — Productos con stock critico
- "ayuda" — Esta lista de comandos

Para respuestas mas detalladas con IA, espera al 1ro del mes o compra un pack de mensajes adicionales.`,
  };
}

async function balanceHandler(companyId: string): Promise<ToolResult> {
  try {
    return await queryBalances(companyId, {});
  } catch (error) {
    logger.error({ error, companyId }, 'SecretarIA fallback: balance query failed');
    return {
      toolName: 'fallback_balances',
      data: null,
      formatted: 'No pude consultar los saldos en este momento. Intenta de nuevo en unos minutos.',
    };
  }
}

async function stockHandler(companyId: string): Promise<ToolResult> {
  try {
    return await queryProducts(companyId, { status: 'low_stock' });
  } catch (error) {
    logger.error({ error, companyId }, 'SecretarIA fallback: stock query failed');
    return {
      toolName: 'fallback_stock',
      data: null,
      formatted: 'No pude consultar el stock en este momento. Intenta de nuevo en unos minutos.',
    };
  }
}

// ── Rules (order matters — first match wins) ──

const FALLBACK_RULES: ReadonlyArray<FallbackRule> = [
  { keywords: [...GREETING_WORDS], handler: () => greetingHandler() },
  { keywords: [...HELP_WORDS], handler: () => helpHandler() },
  { keywords: [...BALANCE_WORDS], handler: (companyId) => balanceHandler(companyId) },
  { keywords: [...STOCK_WORDS], handler: (companyId) => stockHandler(companyId) },
];

// ── Public API ──

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip accents
    .trim();
}

export async function handleFallback(
  companyId: string,
  text: string,
): Promise<ToolResult> {
  const normalized = normalizeText(text);

  for (const rule of FALLBACK_RULES) {
    const matched = rule.keywords.some((kw) => normalized.includes(kw));
    if (matched) {
      return rule.handler(companyId, text);
    }
  }

  // No rule matched — generic fallback
  return {
    toolName: 'fallback_generic',
    data: null,
    formatted:
      'Tu limite de IA fue alcanzado. Podes seguir usando consultas basicas como "quien me debe", "stock bajo" o "ayuda".\n\nPara respuestas completas, compra creditos adicionales o espera al 1ro del mes.',
  };
}

/**
 * Check whether a message can be handled by the fallback engine.
 * Returns true if a keyword match is found (avoids calling the LLM).
 */
export function canHandleFallback(text: string): boolean {
  const normalized = normalizeText(text);
  return FALLBACK_RULES.some((rule) =>
    rule.keywords.some((kw) => normalized.includes(kw)),
  );
}
