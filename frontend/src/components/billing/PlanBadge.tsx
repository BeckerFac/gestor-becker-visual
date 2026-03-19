import React from 'react'
import { cn } from '@/lib/utils'

interface PlanBadgeProps {
  plan: string
  status?: string
  size?: 'sm' | 'md'
}

function getPlanGroup(planId: string): string {
  if (planId.startsWith('estandar_')) return 'estandar'
  if (planId.startsWith('premium_')) return 'premium'
  return planId
}

function getBillingPeriod(planId: string): string {
  if (planId.endsWith('_annual')) return 'Anual'
  if (planId.endsWith('_monthly')) return 'Mensual'
  return ''
}

const PLAN_COLORS: Record<string, string> = {
  trial: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  estandar: 'bg-blue-100 text-blue-800 border-blue-200',
  premium: 'bg-purple-100 text-purple-800 border-purple-200',
}

const PLAN_LABELS: Record<string, string> = {
  trial: 'Prueba',
  estandar: 'Estandar',
  premium: 'Premium',
}

const STATUS_INDICATORS: Record<string, string> = {
  trial: '',
  active: '',
  past_due: ' (Pago pendiente)',
  cancelled: ' (Cancelado)',
  expired: ' (Expirado)',
}

export const PlanBadge: React.FC<PlanBadgeProps> = ({ plan, status, size = 'sm' }) => {
  const group = getPlanGroup(plan)
  const period = getBillingPeriod(plan)
  const colorClass = PLAN_COLORS[group] || PLAN_COLORS.trial
  const label = PLAN_LABELS[group] || plan
  const statusSuffix = status ? (STATUS_INDICATORS[status] || '') : ''
  const periodSuffix = period ? ` ${period}` : ''

  return (
    <span
      className={cn(
        'inline-flex items-center border rounded-full font-medium',
        colorClass,
        size === 'sm' ? 'px-2 py-0.5 text-[10px]' : 'px-3 py-1 text-xs'
      )}
    >
      {label}{periodSuffix}{statusSuffix}
    </span>
  )
}
