import React from 'react'
import { useFeatureAccess } from '@/hooks/useBilling'
import { UpgradePrompt } from './UpgradePrompt'

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

interface FeatureGateProps {
  feature: FeatureKey
  children: React.ReactNode
  // Optional custom fallback. Default: UpgradePrompt overlay
  fallback?: React.ReactNode
  // If true, renders nothing instead of upgrade prompt (use for hiding elements completely)
  hide?: boolean
}

// Declarative component: renders children if the current plan includes the feature,
// otherwise shows an upgrade prompt or custom fallback.
export const FeatureGate: React.FC<FeatureGateProps> = ({
  feature,
  children,
  fallback,
  hide = false,
}) => {
  const { hasFeature, loading } = useFeatureAccess(feature)

  // While loading subscription data, show children to avoid flash of upgrade prompt
  if (loading) return <>{children}</>

  if (!hasFeature) {
    if (hide) return null
    if (fallback) return <>{fallback}</>
    return <UpgradePrompt feature={feature} />
  }

  return <>{children}</>
}

// Hook version: returns whether the feature is available
export { useFeatureAccess } from '@/hooks/useBilling'
