import { useState, useEffect, useCallback } from 'react'
import { api } from '@/services/api'

// Mirror of backend FeatureKey type
export type FeatureKey =
  | 'crm'
  | 'ai'
  | 'ai_chat'
  | 'ai_insights'
  | 'ai_narratives'
  | 'advanced_reports'
  | 'custom_branding'
  | 'priority_support'
  | 'export_completo'
  | 'secretaria'

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
  secretaria: 'SecretarIA - Asistente WhatsApp',
}

export interface PlanFeatures {
  facturacion: boolean
  pedidos: boolean
  stock: boolean
  reportesBasicos: boolean
  reportesAvanzados: boolean
  crm: boolean
  portal: boolean
  aiChat: boolean
  aiInsights: boolean
  aiNarratives: boolean
  customBranding: boolean
}

export interface AiFeatures {
  enabled: boolean
  chatMessagesPerDay: number
  chatMessagesPerMonth: number
  whatsappEnabled: boolean
  morningBriefEnabled: boolean
  voiceEnabled: boolean
  documentSendEnabled: boolean
  insightsPerDay: number
  narrativesEnabled: boolean
}

export interface SubscriptionData {
  plan: string
  status: string
  plan_details: {
    id: string
    displayName: string
    billingPeriod: string
    priceArs: number
    priceArsMonthly: number
    basePlanGroup: string
    features: PlanFeatures
    ai: AiFeatures
    limits: {
      invoicesPerMonth: number
      usersMax: number
      aiEnabled: boolean
      aiLevel: string
      storageMb: number
      supportLevel: string
    }
  }
  usage: {
    invoices_count: number
    orders_count: number
    users_count: number
    total_documents: number
    storage_mb: number
  }
  days_remaining: number | null
  is_trial: boolean
  can_use: boolean
  current_period_end: string | null
}

// Feature checking logic (client-side mirror of backend planHasFeature)
function checkFeature(features: PlanFeatures, feature: FeatureKey): boolean {
  switch (feature) {
    case 'crm': return features.crm
    case 'ai': return features.aiChat || features.aiInsights || features.aiNarratives
    case 'ai_chat': return features.aiChat
    case 'ai_insights': return features.aiInsights
    case 'ai_narratives': return features.aiNarratives
    case 'advanced_reports': return features.reportesAvanzados
    case 'custom_branding': return features.customBranding
    case 'priority_support': return features.customBranding
    case 'export_completo': return true
    case 'secretaria': return features.aiChat // SecretarIA requires Premium (same gate as AI)
    default: return false
  }
}

// Singleton cache to avoid re-fetching on every component mount
let cachedSubscription: SubscriptionData | null = null
let cacheTimestamp = 0
const CACHE_TTL_MS = 60_000 // 1 minute

// Main billing hook: returns subscription data with feature checking
export function useBilling() {
  const [subscription, setSubscription] = useState<SubscriptionData | null>(cachedSubscription)
  const [loading, setLoading] = useState(!cachedSubscription)

  useEffect(() => {
    const now = Date.now()
    if (cachedSubscription && (now - cacheTimestamp) < CACHE_TTL_MS) {
      setSubscription(cachedSubscription)
      setLoading(false)
      return
    }

    let cancelled = false
    api.getBillingSubscription()
      .then((data: SubscriptionData) => {
        if (!cancelled) {
          cachedSubscription = data
          cacheTimestamp = Date.now()
          setSubscription(data)
          setLoading(false)
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false)
      })

    return () => { cancelled = true }
  }, [])

  const hasFeature = useCallback((feature: FeatureKey): boolean => {
    if (!subscription) return true // graceful degradation
    // Trial users with active trial get everything
    if (subscription.is_trial && subscription.can_use) return true
    return checkFeature(subscription.plan_details.features, feature)
  }, [subscription])

  const planGroup = subscription?.plan_details?.basePlanGroup || 'trial'
  const isPremium = planGroup === 'premium'
  const isEstandar = planGroup === 'estandar'
  const isTrial = planGroup === 'trial'

  const refresh = useCallback(async () => {
    try {
      const data = await api.getBillingSubscription()
      cachedSubscription = data
      cacheTimestamp = Date.now()
      setSubscription(data)
    } catch {
      // silent
    }
  }, [])

  const aiFeatures = subscription?.plan_details?.ai ?? null

  return {
    subscription,
    loading,
    hasFeature,
    isPremium,
    isEstandar,
    isTrial,
    planGroup,
    aiFeatures,
    refresh,
  }
}

// Focused hook: checks a single feature
export function useFeatureAccess(feature: FeatureKey) {
  const { hasFeature, loading, subscription } = useBilling()
  return {
    hasFeature: hasFeature(feature),
    loading,
    planGroup: subscription?.plan_details?.basePlanGroup || 'trial',
  }
}

// Invalidate cache (call after plan changes)
export function invalidateBillingCache() {
  cachedSubscription = null
  cacheTimestamp = 0
}
