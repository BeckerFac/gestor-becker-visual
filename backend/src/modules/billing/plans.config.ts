// Plan definitions for Gestor BeckerVisual SaaS
// Prices in ARS (Argentine Pesos)

export interface PlanLimits {
  readonly invoicesPerMonth: number;   // comprobantes (invoices + orders + quotes)
  readonly usersMax: number;
  readonly aiEnabled: boolean;
  readonly aiLevel: 'none' | 'basic' | 'full';
  readonly storageMb: number;
  readonly supportLevel: 'community' | 'email' | 'priority' | 'dedicated';
  readonly portalEnabled: boolean;
  readonly crmEnabled: boolean;
  readonly reportsAdvanced: boolean;
}

export interface PlanDefinition {
  readonly id: string;
  readonly name: string;
  readonly displayName: string;
  readonly priceArs: number;          // monthly price in ARS
  readonly priceMpItemId: string;     // MercadoPago plan/item ID (set after creating in MP)
  readonly description: string;
  readonly limits: PlanLimits;
  readonly popular: boolean;
  readonly order: number;
}

export const TRIAL_DURATION_DAYS = 15;

export const PLANS: Record<string, PlanDefinition> = {
  trial: {
    id: 'trial',
    name: 'trial',
    displayName: 'Prueba Gratuita',
    priceArs: 0,
    priceMpItemId: '',
    description: 'Proba todas las funciones durante 15 dias',
    limits: {
      invoicesPerMonth: 20,
      usersMax: 2,
      aiEnabled: false,
      aiLevel: 'none',
      storageMb: 100,
      supportLevel: 'community',
      portalEnabled: false,
      crmEnabled: false,
      reportsAdvanced: false,
    },
    popular: false,
    order: 0,
  },
  starter: {
    id: 'starter',
    name: 'starter',
    displayName: 'Starter',
    priceArs: 49900,
    priceMpItemId: '', // TODO: Set after creating plan in MercadoPago
    description: 'Ideal para emprendedores y profesionales independientes',
    limits: {
      invoicesPerMonth: 50,
      usersMax: 2,
      aiEnabled: false,
      aiLevel: 'none',
      storageMb: 500,
      supportLevel: 'email',
      portalEnabled: false,
      crmEnabled: false,
      reportsAdvanced: false,
    },
    popular: false,
    order: 1,
  },
  pyme: {
    id: 'pyme',
    name: 'pyme',
    displayName: 'PyME',
    priceArs: 99900,
    priceMpItemId: '', // TODO: Set after creating plan in MercadoPago
    description: 'Para pequenas y medianas empresas en crecimiento',
    limits: {
      invoicesPerMonth: 500,
      usersMax: 5,
      aiEnabled: true,
      aiLevel: 'basic',
      storageMb: 2000,
      supportLevel: 'email',
      portalEnabled: true,
      crmEnabled: true,
      reportsAdvanced: false,
    },
    popular: true,
    order: 2,
  },
  profesional: {
    id: 'profesional',
    name: 'profesional',
    displayName: 'Profesional',
    priceArs: 169900,
    priceMpItemId: '', // TODO: Set after creating plan in MercadoPago
    description: 'Para empresas que necesitan control total',
    limits: {
      invoicesPerMonth: 2000,
      usersMax: 15,
      aiEnabled: true,
      aiLevel: 'full',
      storageMb: 10000,
      supportLevel: 'priority',
      portalEnabled: true,
      crmEnabled: true,
      reportsAdvanced: true,
    },
    popular: false,
    order: 3,
  },
  enterprise: {
    id: 'enterprise',
    name: 'enterprise',
    displayName: 'Enterprise',
    priceArs: 249900,
    priceMpItemId: '', // TODO: Set after creating plan in MercadoPago
    description: 'Sin limites, soporte dedicado',
    limits: {
      invoicesPerMonth: Infinity,
      usersMax: Infinity,
      aiEnabled: true,
      aiLevel: 'full',
      storageMb: Infinity,
      supportLevel: 'dedicated',
      portalEnabled: true,
      crmEnabled: true,
      reportsAdvanced: true,
    },
    popular: false,
    order: 4,
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

export function formatPriceArs(priceArs: number): string {
  if (priceArs === 0) return 'Gratis';
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(priceArs);
}
