// SecretarIA — AI access control: role-based tool filtering & plan-based limits

import { SecretariaIntent } from './secretaria.types';
import { AiFeatures } from '../billing/plans.config';

// ── Role-based tool access ──

// Intent types allowed per GESTIA role
const ROLE_TOOL_MAP: Record<string, readonly SecretariaIntent[]> = {
  owner: [
    'query_clients', 'query_products', 'query_invoices', 'query_balances',
    'query_orders', 'query_general', 'morning_brief', 'send_document',
    'help', 'greeting', 'unknown',
  ],
  admin: [
    'query_clients', 'query_products', 'query_invoices', 'query_balances',
    'query_orders', 'query_general', 'morning_brief', 'send_document',
    'help', 'greeting', 'unknown',
  ],
  gerente: [
    'query_clients', 'query_products', 'query_invoices', 'query_balances',
    'query_orders', 'query_general', 'morning_brief', 'send_document',
    'help', 'greeting', 'unknown',
  ],
  vendedor: [
    'query_clients', 'query_products', 'query_orders', 'morning_brief',
    'help', 'greeting', 'unknown',
  ],
  contable: [
    'query_invoices', 'query_balances', 'query_general', 'morning_brief',
    'help', 'greeting', 'unknown',
  ],
  viewer: [
    'query_general', 'morning_brief',
    'help', 'greeting', 'unknown',
  ],
};

// Roles with full access (no filtering needed)
const FULL_ACCESS_ROLES = new Set(['owner', 'admin', 'gerente']);

/**
 * Returns the list of allowed intent types for a given role.
 * Unknown roles default to viewer-level access.
 */
export function getAvailableTools(role: string): readonly SecretariaIntent[] {
  const normalizedRole = role.toLowerCase();
  return ROLE_TOOL_MAP[normalizedRole] ?? ROLE_TOOL_MAP.viewer;
}

/**
 * Checks whether a given intent is allowed for the specified role.
 */
export function isIntentAllowedForRole(role: string, intent: SecretariaIntent): boolean {
  const normalizedRole = role.toLowerCase();
  if (FULL_ACCESS_ROLES.has(normalizedRole)) return true;
  const allowed = getAvailableTools(normalizedRole);
  return allowed.includes(intent);
}

// ── Plan-based AI access checks ──

export interface AiLimitCheckResult {
  readonly allowed: boolean;
  readonly reason?: string;
  readonly dailyUsed?: number;
  readonly dailyLimit?: number;
  readonly monthlyUsed?: number;
  readonly monthlyLimit?: number;
}

/**
 * Checks daily message limit against plan AI features.
 */
export function checkDailyLimit(
  aiFeatures: AiFeatures,
  dailyMessagesUsed: number,
): AiLimitCheckResult {
  if (!aiFeatures.enabled) {
    return { allowed: false, reason: 'AI no esta disponible en tu plan actual.' };
  }

  if (aiFeatures.chatMessagesPerDay === 0) {
    return { allowed: false, reason: 'AI no esta disponible en tu plan actual.' };
  }

  if (isFinite(aiFeatures.chatMessagesPerDay) && dailyMessagesUsed >= aiFeatures.chatMessagesPerDay) {
    return {
      allowed: false,
      reason: `Alcanzaste el limite diario de consultas IA (${aiFeatures.chatMessagesPerDay}). Intenta manana o contacta a tu admin para ampliar.`,
      dailyUsed: dailyMessagesUsed,
      dailyLimit: aiFeatures.chatMessagesPerDay,
    };
  }

  return { allowed: true, dailyUsed: dailyMessagesUsed, dailyLimit: aiFeatures.chatMessagesPerDay };
}

/**
 * Checks monthly message limit against plan AI features.
 */
export function checkMonthlyLimit(
  aiFeatures: AiFeatures,
  monthlyMessagesUsed: number,
  availableCredits: number,
): AiLimitCheckResult {
  if (!aiFeatures.enabled) {
    return { allowed: false, reason: 'AI no esta disponible en tu plan actual.' };
  }

  if (isFinite(aiFeatures.chatMessagesPerMonth) && monthlyMessagesUsed >= aiFeatures.chatMessagesPerMonth) {
    if (availableCredits > 0) {
      // Has credit packs — allow but will deduct from credits
      return { allowed: true, monthlyUsed: monthlyMessagesUsed, monthlyLimit: aiFeatures.chatMessagesPerMonth };
    }

    return {
      allowed: false,
      reason: 'Alcanzaste el limite mensual de consultas IA. Compra un pack de creditos o espera al proximo mes.',
      monthlyUsed: monthlyMessagesUsed,
      monthlyLimit: aiFeatures.chatMessagesPerMonth,
    };
  }

  return { allowed: true, monthlyUsed: monthlyMessagesUsed, monthlyLimit: aiFeatures.chatMessagesPerMonth };
}
