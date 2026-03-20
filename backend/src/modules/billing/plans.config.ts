// Plan definitions for Gestor BeckerVisual SaaS
// Prices in ARS (Argentine Pesos)
// Restructured: 2026-03-19

export type BillingPeriod = 'monthly' | 'annual' | 'lifetime';
export type AiLevel = 'none' | 'basic' | 'full';
export type SupportLevel = 'community' | 'email' | 'priority' | 'dedicated';

export interface AiFeatures {
  readonly enabled: boolean;
  readonly chatMessagesPerDay: number;    // 0 = disabled, Infinity = unlimited
  readonly chatMessagesPerMonth: number;
  readonly whatsappEnabled: boolean;
  readonly morningBriefEnabled: boolean;
  readonly voiceEnabled: boolean;
  readonly documentSendEnabled: boolean;
  readonly insightsPerDay: number;
  readonly narrativesEnabled: boolean;
}

export interface PlanFeatures {
  readonly facturacion: boolean;
  readonly pedidos: boolean;
  readonly stock: boolean;
  readonly reportesBasicos: boolean;
  readonly reportesAvanzados: boolean;    // Rentabilidad, Conversion
  readonly crm: boolean;
  readonly portal: boolean;
  readonly aiChat: boolean;
  readonly aiInsights: boolean;
  readonly aiNarratives: boolean;
  readonly customBranding: boolean;       // Logo in invoices/quotes
}

export interface PlanLimits {
  readonly invoicesPerMonth: number;      // comprobantes (invoices + orders + quotes)
  readonly usersMax: number;
  readonly aiEnabled: boolean;
  readonly aiLevel: AiLevel;
  readonly storageMb: number;
  readonly supportLevel: SupportLevel;
}

export interface PlanDefinition {
  readonly id: string;
  readonly name: string;
  readonly displayName: string;
  readonly billingPeriod: BillingPeriod | 'none';   // 'none' for trial
  readonly priceArs: number;              // total price for the period
  readonly priceArsMonthly: number;       // effective monthly price (for display)
  readonly priceMpItemId: string;         // MercadoPago plan/item ID
  readonly description: string;
  readonly limits: PlanLimits;
  readonly features: PlanFeatures;
  readonly ai: AiFeatures;
  readonly popular: boolean;
  readonly order: number;
  readonly basePlanGroup: string;         // groups monthly/annual variants together
}

// --- Constants ---

export const TRIAL_DURATION_DAYS = 14;
export const ANNUAL_DISCOUNT = 0.32;      // 32% discount on annual plans

// Base monthly prices
const ESTANDAR_MONTHLY_PRICE = 28999;
const PREMIUM_MONTHLY_PRICE = 73999;

// Annual prices (32% discount)
const ESTANDAR_ANNUAL_PRICE = Math.round(ESTANDAR_MONTHLY_PRICE * 12 * (1 - ANNUAL_DISCOUNT));
const PREMIUM_ANNUAL_PRICE = Math.round(PREMIUM_MONTHLY_PRICE * 12 * (1 - ANNUAL_DISCOUNT));

// Effective monthly for annual plans
const ESTANDAR_ANNUAL_MONTHLY = Math.round(ESTANDAR_ANNUAL_PRICE / 12);
const PREMIUM_ANNUAL_MONTHLY = Math.round(PREMIUM_ANNUAL_PRICE / 12);

// --- AI feature sets ---

const TRIAL_AI: AiFeatures = {
  enabled: true,
  chatMessagesPerDay: 10,
  chatMessagesPerMonth: 300,
  whatsappEnabled: false,
  morningBriefEnabled: false,
  voiceEnabled: false,
  documentSendEnabled: false,
  insightsPerDay: 3,
  narrativesEnabled: false,
};

const ESTANDAR_AI: AiFeatures = {
  enabled: false,
  chatMessagesPerDay: 0,
  chatMessagesPerMonth: 0,
  whatsappEnabled: false,
  morningBriefEnabled: false,
  voiceEnabled: false,
  documentSendEnabled: false,
  insightsPerDay: 0,
  narrativesEnabled: false,
};

const PREMIUM_AI: AiFeatures = {
  enabled: true,
  chatMessagesPerDay: 50,
  chatMessagesPerMonth: 1000,
  whatsappEnabled: true,
  morningBriefEnabled: true,
  voiceEnabled: true,
  documentSendEnabled: true,
  insightsPerDay: Infinity,
  narrativesEnabled: true,
};

const LIFETIME_AI: AiFeatures = {
  ...PREMIUM_AI,
  chatMessagesPerMonth: 500,
};

// --- Feature sets ---

const TRIAL_FEATURES: PlanFeatures = {
  facturacion: true,
  pedidos: true,
  stock: true,
  reportesBasicos: true,
  reportesAvanzados: true,
  crm: true,
  portal: true,
  aiChat: true,
  aiInsights: true,
  aiNarratives: true,
  customBranding: true,
};

// Estandar: core modules. NO CRM pipeline (Premium-only).
// Excluded from Estandar: AI, advanced reports, custom branding.
const CRM_IN_ESTANDAR = false; // CRM/Pipeline is Premium-only per product spec
const ESTANDAR_FEATURES: PlanFeatures = {
  facturacion: true,
  pedidos: true,
  stock: true,
  reportesBasicos: true,
  reportesAvanzados: false,
  crm: CRM_IN_ESTANDAR,
  portal: true,
  aiChat: false,
  aiInsights: false,
  aiNarratives: false,
  customBranding: false,
};

const PREMIUM_FEATURES: PlanFeatures = {
  facturacion: true,
  pedidos: true,
  stock: true,
  reportesBasicos: true,
  reportesAvanzados: true,
  crm: true,
  portal: true,
  aiChat: true,
  aiInsights: true,
  aiNarratives: true,
  customBranding: true,
};

// --- Plan definitions ---

export const PLANS: Record<string, PlanDefinition> = {
  trial: {
    id: 'trial',
    name: 'trial',
    displayName: 'Prueba Gratuita',
    billingPeriod: 'none',
    priceArs: 0,
    priceArsMonthly: 0,
    priceMpItemId: '',
    description: 'Proba todas las funciones durante 14 dias',
    limits: {
      invoicesPerMonth: Infinity,
      usersMax: 1,
      aiEnabled: true,
      aiLevel: 'full',
      storageMb: 500,
      supportLevel: 'email',
    },
    features: TRIAL_FEATURES,
    ai: TRIAL_AI,
    popular: false,
    order: 0,
    basePlanGroup: 'trial',
  },
  estandar_monthly: {
    id: 'estandar_monthly',
    name: 'estandar_monthly',
    displayName: 'Estandar',
    billingPeriod: 'monthly',
    priceArs: ESTANDAR_MONTHLY_PRICE,
    priceArsMonthly: ESTANDAR_MONTHLY_PRICE,
    priceMpItemId: '', // TODO: Set after creating plan in MercadoPago
    description: 'Todo lo esencial para facturar y gestionar tu negocio',
    limits: {
      invoicesPerMonth: 600,
      usersMax: 2,
      aiEnabled: false,
      aiLevel: 'none',
      storageMb: 1000,
      supportLevel: 'email',
    },
    features: ESTANDAR_FEATURES,
    ai: ESTANDAR_AI,
    popular: true,
    order: 1,
    basePlanGroup: 'estandar',
  },
  estandar_annual: {
    id: 'estandar_annual',
    name: 'estandar_annual',
    displayName: 'Estandar',
    billingPeriod: 'annual',
    priceArs: ESTANDAR_ANNUAL_PRICE,
    priceArsMonthly: ESTANDAR_ANNUAL_MONTHLY,
    priceMpItemId: '', // TODO: Set after creating plan in MercadoPago
    description: 'Todo lo esencial para facturar y gestionar tu negocio',
    limits: {
      invoicesPerMonth: 600,
      usersMax: 2,
      aiEnabled: false,
      aiLevel: 'none',
      storageMb: 1000,
      supportLevel: 'email',
    },
    features: ESTANDAR_FEATURES,
    ai: ESTANDAR_AI,
    popular: false,
    order: 2,
    basePlanGroup: 'estandar',
  },
  premium_monthly: {
    id: 'premium_monthly',
    name: 'premium_monthly',
    displayName: 'Premium',
    billingPeriod: 'monthly',
    priceArs: PREMIUM_MONTHLY_PRICE,
    priceArsMonthly: PREMIUM_MONTHLY_PRICE,
    priceMpItemId: '', // TODO: Set after creating plan in MercadoPago
    description: 'Sin limites, con IA y reportes avanzados',
    limits: {
      invoicesPerMonth: Infinity,
      usersMax: Infinity,
      aiEnabled: true,
      aiLevel: 'full',
      storageMb: Infinity,
      supportLevel: 'priority',
    },
    features: PREMIUM_FEATURES,
    ai: PREMIUM_AI,
    popular: false,
    order: 3,
    basePlanGroup: 'premium',
  },
  premium_annual: {
    id: 'premium_annual',
    name: 'premium_annual',
    displayName: 'Premium',
    billingPeriod: 'annual',
    priceArs: PREMIUM_ANNUAL_PRICE,
    priceArsMonthly: PREMIUM_ANNUAL_MONTHLY,
    priceMpItemId: '', // TODO: Set after creating plan in MercadoPago
    description: 'Sin limites, con IA y reportes avanzados',
    limits: {
      invoicesPerMonth: Infinity,
      usersMax: Infinity,
      aiEnabled: true,
      aiLevel: 'full',
      storageMb: Infinity,
      supportLevel: 'priority',
    },
    features: PREMIUM_FEATURES,
    ai: PREMIUM_AI,
    popular: false,
    order: 4,
    basePlanGroup: 'premium',
  },
  lifetime: {
    id: 'lifetime',
    name: 'lifetime',
    displayName: 'Lifetime',
    billingPeriod: 'lifetime',
    priceArs: 0, // one-time payment handled separately
    priceArsMonthly: 0,
    priceMpItemId: '',
    description: 'Acceso de por vida al plan Premium con IA incluida',
    limits: {
      invoicesPerMonth: Infinity,
      usersMax: Infinity,
      aiEnabled: true,
      aiLevel: 'full',
      storageMb: Infinity,
      supportLevel: 'priority',
    },
    features: PREMIUM_FEATURES,
    ai: LIFETIME_AI,
    popular: false,
    order: 5,
    basePlanGroup: 'lifetime',
  },
} as const;

export function getPlan(planId: string): PlanDefinition {
  return PLANS[planId] || PLANS.trial;
}

export function getPlansSorted(): ReadonlyArray<PlanDefinition> {
  return Object.values(PLANS)
    .filter(p => p.id !== 'trial')
    .sort((a, b) => a.order - b.order);
}

// Get plans grouped by base plan for frontend display (Estandar, Premium)
export function getPlansGrouped(): ReadonlyArray<{
  group: string;
  monthly: PlanDefinition;
  annual: PlanDefinition;
}> {
  const groups = ['estandar', 'premium'];
  return groups.map(group => ({
    group,
    monthly: Object.values(PLANS).find(p => p.basePlanGroup === group && p.billingPeriod === 'monthly')!,
    annual: Object.values(PLANS).find(p => p.basePlanGroup === group && p.billingPeriod === 'annual')!,
  }));
}

// Check if a plan is in the "estandar" tier
export function isEstandarPlan(planId: string): boolean {
  return planId.startsWith('estandar_');
}

// Check if a plan is in the "premium" tier
export function isPremiumPlan(planId: string): boolean {
  return planId.startsWith('premium_');
}

// Check if a plan is the lifetime tier
export function isLifetimePlan(planId: string): boolean {
  return planId === 'lifetime';
}

// Get AI features for a plan
export function getPlanAiFeatures(planId: string): AiFeatures {
  const plan = getPlan(planId);
  return plan.ai;
}

// Get the base plan group from a plan ID
export function getPlanGroup(planId: string): string {
  return PLANS[planId]?.basePlanGroup || 'trial';
}

// --- Feature gating ---

// Canonical feature keys used for plan-based gating
export type FeatureKey =
  | 'crm'
  | 'ai'
  | 'ai_chat'
  | 'ai_insights'
  | 'ai_narratives'
  | 'advanced_reports'
  | 'custom_branding'
  | 'priority_support'
  | 'export_completo';

// Map feature keys to PlanFeatures checks
const FEATURE_MAP: Record<FeatureKey, (f: PlanFeatures) => boolean> = {
  crm: (f) => f.crm,
  ai: (f) => f.aiChat || f.aiInsights || f.aiNarratives,
  ai_chat: (f) => f.aiChat,
  ai_insights: (f) => f.aiInsights,
  ai_narratives: (f) => f.aiNarratives,
  advanced_reports: (f) => f.reportesAvanzados,
  custom_branding: (f) => f.customBranding,
  priority_support: (f) => f.customBranding, // co-gated with premium
  export_completo: () => true,
};

// Human-readable labels for upgrade prompts
export const FEATURE_LABELS: Record<FeatureKey, string> = {
  crm: 'CRM / Pipeline de Oportunidades',
  ai: 'Funciones de Inteligencia Artificial',
  ai_chat: 'Chat IA',
  ai_insights: 'Insights IA',
  ai_narratives: 'Narrativas IA en reportes',
  advanced_reports: 'Reportes Avanzados (Rentabilidad, Clientes, Conversion)',
  custom_branding: 'Marca personalizada (logo en comprobantes)',
  priority_support: 'Soporte prioritario',
  export_completo: 'Exportacion completa',
};

// Check if a plan has a specific feature
export function planHasFeature(planId: string, feature: FeatureKey): boolean {
  const plan = getPlan(planId);
  const checker = FEATURE_MAP[feature];
  if (!checker) return false;
  return checker(plan.features);
}

// Get the minimum plan required for a feature
export function getRequiredPlanForFeature(feature: FeatureKey): string {
  if (planHasFeature('estandar_monthly', feature)) return 'estandar';
  return 'premium';
}

export function formatPriceArs(priceArs: number): string {
  if (priceArs === 0) return 'Gratis';
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(priceArs);
}
