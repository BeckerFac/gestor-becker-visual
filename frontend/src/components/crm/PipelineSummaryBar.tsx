import React from 'react'
import { formatCurrency } from '@/lib/utils'

interface StageSummary {
  count: number
  total_value: number
}

interface PipelineSummaryBarProps {
  stages: Record<string, StageSummary>
  totals: {
    active_deals: number
    pipeline_value: number
    won_value: number
    lost_count: number
  }
}

const STAGE_CONFIG: Record<string, { label: string; color: string; bgColor: string }> = {
  contacto: { label: 'Contacto', color: 'text-blue-700 dark:text-blue-300', bgColor: 'bg-blue-100 dark:bg-blue-900/40' },
  cotizacion: { label: 'Cotizacion', color: 'text-purple-700 dark:text-purple-300', bgColor: 'bg-purple-100 dark:bg-purple-900/40' },
  negociacion: { label: 'Negociacion', color: 'text-amber-700 dark:text-amber-300', bgColor: 'bg-amber-100 dark:bg-amber-900/40' },
  pedido: { label: 'Pedido', color: 'text-orange-700 dark:text-orange-300', bgColor: 'bg-orange-100 dark:bg-orange-900/40' },
  entregado: { label: 'Entregado', color: 'text-teal-700 dark:text-teal-300', bgColor: 'bg-teal-100 dark:bg-teal-900/40' },
  cobrado: { label: 'Cobrado', color: 'text-green-700 dark:text-green-300', bgColor: 'bg-green-100 dark:bg-green-900/40' },
}

const ACTIVE_STAGES = ['contacto', 'cotizacion', 'negociacion', 'pedido', 'entregado', 'cobrado']

export const PipelineSummaryBar: React.FC<PipelineSummaryBarProps> = ({ stages, totals }) => {
  const maxCount = Math.max(...ACTIVE_STAGES.map(s => stages[s]?.count || 0), 1)

  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-4">
          <div>
            <span className="text-sm text-gray-500 dark:text-gray-400">Deals activos</span>
            <p className="text-xl font-bold text-gray-900 dark:text-white">{totals.active_deals}</p>
          </div>
          <div className="h-8 w-px bg-gray-200 dark:bg-gray-700" />
          <div>
            <span className="text-sm text-gray-500 dark:text-gray-400">Pipeline</span>
            <p className="text-xl font-bold text-gray-900 dark:text-white">{formatCurrency(totals.pipeline_value)}</p>
          </div>
          <div className="h-8 w-px bg-gray-200 dark:bg-gray-700" />
          <div>
            <span className="text-sm text-gray-500 dark:text-gray-400">Cobrado</span>
            <p className="text-xl font-bold text-green-600 dark:text-green-400">{formatCurrency(totals.won_value)}</p>
          </div>
          {totals.lost_count > 0 && (
            <>
              <div className="h-8 w-px bg-gray-200 dark:bg-gray-700" />
              <div>
                <span className="text-sm text-gray-500 dark:text-gray-400">Perdidos</span>
                <p className="text-xl font-bold text-red-600 dark:text-red-400">{totals.lost_count}</p>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Funnel bar */}
      <div className="flex gap-1 items-end h-8">
        {ACTIVE_STAGES.map(stage => {
          const config = STAGE_CONFIG[stage]
          const stageData = stages[stage] || { count: 0, total_value: 0 }
          const width = Math.max((stageData.count / maxCount) * 100, stageData.count > 0 ? 15 : 5)

          return (
            <div key={stage} className="flex-1 flex flex-col items-center gap-0.5" title={`${config.label}: ${stageData.count} deals - ${formatCurrency(stageData.total_value)}`}>
              <div
                className={`w-full rounded-sm ${config.bgColor} transition-all`}
                style={{ height: `${Math.max(width * 0.32, 4)}px` }}
              />
              <span className={`text-[10px] font-medium ${config.color} truncate`}>{stageData.count}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
