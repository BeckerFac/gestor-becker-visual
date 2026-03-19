import React from 'react'
import { formatCurrency } from '@/lib/utils'

export interface Deal {
  id: string
  company_id: string
  enterprise_id: string | null
  customer_id: string | null
  title: string
  value: number | string
  stage: string
  priority: string
  expected_close_date: string | null
  lost_reason: string | null
  notes: string | null
  created_by: string | null
  created_at: string
  updated_at: string
  enterprise_name: string | null
  enterprise_cuit: string | null
  customer_name: string | null
  days_in_stage: number
}

interface DealCardProps {
  deal: Deal
  onSelect: (deal: Deal) => void
  onMoveForward?: (deal: Deal) => void
  onMoveBackward?: (deal: Deal) => void
  showStageActions?: boolean
}

const STAGE_ORDER = ['contacto', 'cotizacion', 'negociacion', 'pedido', 'entregado', 'cobrado']

const STAGE_BORDER_COLORS: Record<string, string> = {
  contacto: 'border-l-blue-500',
  cotizacion: 'border-l-purple-500',
  negociacion: 'border-l-amber-500',
  pedido: 'border-l-orange-500',
  entregado: 'border-l-teal-500',
  cobrado: 'border-l-green-500',
  perdido: 'border-l-red-500',
}

const PRIORITY_DOTS: Record<string, string> = {
  baja: 'bg-gray-400',
  normal: 'bg-blue-500',
  alta: 'bg-orange-500',
  urgente: 'bg-red-500',
}

function getDaysColor(days: number): string {
  if (days <= 7) return 'text-green-600 dark:text-green-400'
  if (days <= 14) return 'text-amber-600 dark:text-amber-400'
  return 'text-red-600 dark:text-red-400'
}

export const DealCard: React.FC<DealCardProps> = ({
  deal,
  onSelect,
  onMoveForward,
  onMoveBackward,
  showStageActions = true,
}) => {
  const currentIndex = STAGE_ORDER.indexOf(deal.stage)
  const canMoveForward = currentIndex >= 0 && currentIndex < STAGE_ORDER.length - 1
  const canMoveBackward = currentIndex > 0

  return (
    <div
      className={`bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 border-l-4 ${STAGE_BORDER_COLORS[deal.stage] || 'border-l-gray-400'} rounded-lg p-3 cursor-pointer hover:shadow-md transition-shadow group`}
      onClick={() => onSelect(deal)}
    >
      {/* Header row */}
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${PRIORITY_DOTS[deal.priority] || PRIORITY_DOTS.normal}`} title={`Prioridad: ${deal.priority}`} />
          <span className="text-xs font-medium text-gray-500 dark:text-gray-400 truncate">
            {deal.enterprise_name || deal.customer_name || 'Sin empresa'}
          </span>
        </div>
        <span className="text-xs font-semibold text-gray-900 dark:text-white whitespace-nowrap">
          {formatCurrency(Number(deal.value))}
        </span>
      </div>

      {/* Title */}
      <p className="text-sm font-medium text-gray-900 dark:text-white truncate mb-2" title={deal.title}>
        {deal.title}
      </p>

      {/* Footer */}
      <div className="flex items-center justify-between">
        <span className={`text-xs ${getDaysColor(deal.days_in_stage || 0)}`}>
          {deal.days_in_stage || 0}d en etapa
        </span>

        {showStageActions && deal.stage !== 'perdido' && (
          <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
            {canMoveBackward && onMoveBackward && (
              <button
                onClick={() => onMoveBackward(deal)}
                className="px-1.5 py-0.5 text-[10px] font-medium text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 bg-gray-100 dark:bg-gray-700 rounded hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                title={`Mover a ${STAGE_ORDER[currentIndex - 1]}`}
              >
                &lt;
              </button>
            )}
            {canMoveForward && onMoveForward && (
              <button
                onClick={() => onMoveForward(deal)}
                className="px-1.5 py-0.5 text-[10px] font-medium text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-200 bg-blue-50 dark:bg-blue-900/40 rounded hover:bg-blue-100 dark:hover:bg-blue-800/50 transition-colors"
                title={`Mover a ${STAGE_ORDER[currentIndex + 1]}`}
              >
                &gt;
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
