import React, { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { UpgradeModal } from './UpgradeModal'

interface TrialBannerProps {
  daysRemaining: number | null
  status: string
  plan: string
  planGroup?: string
  isEstandar?: boolean
  isPremium?: boolean
}

export const TrialBanner: React.FC<TrialBannerProps> = ({
  daysRemaining,
  status,
  plan,
  planGroup,
  isEstandar = false,
  isPremium = false,
}) => {
  const [showUpgrade, setShowUpgrade] = useState(false)

  // Don't show banner for active paid plans (Estandar or Premium)
  // Estandar users paid - respect them, no upgrade pressure
  if (status === 'active' && plan !== 'trial') return null

  // Premium users have everything, no banner needed
  if (isPremium) return null

  let message = ''
  let variant: 'info' | 'warning' | 'danger' = 'info'

  if (status === 'trial') {
    if (daysRemaining !== null && daysRemaining <= 3) {
      message = `Te quedan ${daysRemaining} ${daysRemaining === 1 ? 'dia' : 'dias'} de prueba gratuita.`
      variant = 'warning'
    } else if (daysRemaining !== null) {
      message = `Periodo de prueba: ${daysRemaining} dias restantes.`
      variant = 'info'
    }
  } else if (status === 'expired') {
    message = 'Tu periodo de prueba expiro. Elegí un plan para seguir usando el sistema.'
    variant = 'danger'
  } else if (status === 'past_due') {
    message = 'Tu pago esta pendiente. Actualizá tu medio de pago.'
    variant = 'warning'
  } else if (status === 'cancelled') {
    message = 'Tu suscripcion fue cancelada. Reactivá un plan para continuar.'
    variant = 'danger'
  }

  if (!message) return null

  const bgColors = {
    info: 'bg-blue-50 border-blue-200 text-blue-800',
    warning: 'bg-yellow-50 border-yellow-200 text-yellow-800',
    danger: 'bg-red-50 border-red-200 text-red-800',
  }

  const isTrialOrExpired = status === 'trial' || status === 'expired'

  return (
    <>
      <div className={`flex items-center justify-between px-4 py-2 border rounded-lg text-sm ${bgColors[variant]}`}>
        <span>{message}</span>
        <Button
          variant="primary"
          className="ml-4 text-xs px-3 py-1"
          onClick={() => setShowUpgrade(true)}
        >
          {isTrialOrExpired ? 'Elegir plan' : 'Ver planes'}
        </Button>
      </div>

      <UpgradeModal
        open={showUpgrade}
        onClose={() => setShowUpgrade(false)}
        currentPlan={plan}
        currentPlanGroup={planGroup}
        isTrialOrExpired={isTrialOrExpired}
        isEstandar={isEstandar}
        isPremium={isPremium}
      />
    </>
  )
}
