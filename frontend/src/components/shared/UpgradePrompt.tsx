import React, { useState } from 'react'
import { FEATURE_LABELS } from '@/hooks/useBilling'
import type { FeatureKey } from '@/hooks/useBilling'
import { UpgradeModal } from '@/components/billing/UpgradeModal'

interface UpgradePromptProps {
  feature: FeatureKey
  // 'overlay' = blurred content with centered CTA (default)
  // 'inline' = compact inline message
  variant?: 'overlay' | 'inline'
}

// Shows an upgrade prompt when a user tries to access a Premium feature on Estandar.
// Does NOT hide the feature entirely: shows a blurred/grayed preview with lock + CTA.
export const UpgradePrompt: React.FC<UpgradePromptProps> = ({
  feature,
  variant = 'overlay',
}) => {
  const [showUpgrade, setShowUpgrade] = useState(false)
  const label = FEATURE_LABELS[feature] || feature

  if (variant === 'inline') {
    return (
      <>
        <div className="flex items-center gap-2 px-3 py-2 bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded-lg">
          <svg className="w-4 h-4 text-purple-500 shrink-0" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
          </svg>
          <span className="text-sm text-purple-700 dark:text-purple-300">
            Disponible en Premium
          </span>
          <button
            onClick={() => setShowUpgrade(true)}
            className="ml-auto text-xs font-semibold text-purple-600 dark:text-purple-400 hover:text-purple-800 dark:hover:text-purple-200 underline"
          >
            Ver plan Premium
          </button>
        </div>
        <UpgradeModal
          open={showUpgrade}
          onClose={() => setShowUpgrade(false)}
        />
      </>
    )
  }

  // Overlay variant: full section replacement
  return (
    <>
      <div className="relative min-h-[300px] flex items-center justify-center">
        {/* Blurred placeholder background */}
        <div className="absolute inset-0 bg-gradient-to-b from-gray-100 to-gray-50 dark:from-gray-800 dark:to-gray-900 rounded-xl opacity-60" />
        <div className="absolute inset-0 backdrop-blur-sm rounded-xl" />

        {/* Content overlay */}
        <div className="relative z-10 text-center px-6 py-10 max-w-md">
          {/* Lock icon */}
          <div className="mx-auto w-16 h-16 bg-purple-100 dark:bg-purple-900/40 rounded-full flex items-center justify-center mb-4">
            <svg className="w-8 h-8 text-purple-600 dark:text-purple-400" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
            </svg>
          </div>

          <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-2">
            Disponible en Premium
          </h3>
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">
            {label} esta disponible en el plan Premium.
            Desbloquea todas las funciones avanzadas para potenciar tu negocio.
          </p>

          <button
            onClick={() => setShowUpgrade(true)}
            className="inline-flex items-center gap-2 px-6 py-3 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-semibold transition-colors shadow-lg shadow-purple-200 dark:shadow-none"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            Ver plan Premium
          </button>
        </div>
      </div>
      <UpgradeModal
        open={showUpgrade}
        onClose={() => setShowUpgrade(false)}
      />
    </>
  )
}

// Compact lock badge shown next to sidebar items
export const LockBadge: React.FC = () => (
  <span className="inline-flex items-center justify-center w-4 h-4 ml-auto">
    <svg className="w-3.5 h-3.5 text-gray-400" fill="currentColor" viewBox="0 0 20 20">
      <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
    </svg>
  </span>
)
