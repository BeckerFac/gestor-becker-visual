import React from 'react'
import { cn } from '@/lib/utils'

interface PlanBadgeProps {
  plan: string
  status?: string
  size?: 'sm' | 'md'
}

const PLAN_COLORS: Record<string, string> = {
  trial: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  starter: 'bg-blue-100 text-blue-800 border-blue-200',
  pyme: 'bg-green-100 text-green-800 border-green-200',
  profesional: 'bg-purple-100 text-purple-800 border-purple-200',
  enterprise: 'bg-orange-100 text-orange-800 border-orange-200',
}

const PLAN_LABELS: Record<string, string> = {
  trial: 'Prueba',
  starter: 'Starter',
  pyme: 'PyME',
  profesional: 'Pro',
  enterprise: 'Enterprise',
}

const STATUS_INDICATORS: Record<string, string> = {
  trial: '',
  active: '',
  past_due: ' (Pago pendiente)',
  cancelled: ' (Cancelado)',
  expired: ' (Expirado)',
}

export const PlanBadge: React.FC<PlanBadgeProps> = ({ plan, status, size = 'sm' }) => {
  const colorClass = PLAN_COLORS[plan] || PLAN_COLORS.trial
  const label = PLAN_LABELS[plan] || plan
  const statusSuffix = status ? (STATUS_INDICATORS[status] || '') : ''

  return (
    <span
      className={cn(
        'inline-flex items-center border rounded-full font-medium',
        colorClass,
        size === 'sm' ? 'px-2 py-0.5 text-[10px]' : 'px-3 py-1 text-xs'
      )}
    >
      {label}{statusSuffix}
    </span>
  )
}
