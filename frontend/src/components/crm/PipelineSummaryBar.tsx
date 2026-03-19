import React from 'react'
import { formatCurrency } from '@/lib/utils'
import { CrmStage } from './StageConfigurator'

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
  dynamicStages?: CrmStage[]
}

// Fallback stage config for when no dynamic stages are provided
const FALLBACK_STAGES = ['contacto', 'cotizacion', 'negociacion', 'pedido', 'entregado', 'cobrado']

// Map hex colors to Tailwind classes for summary bar
function getBarColors(hex: string): { color: string; bgColor: string } {
  const map: Record<string, { color: string; bgColor: string }> = {
    '#3B82F6': { color: 'text-blue-700 dark:text-blue-300', bgColor: 'bg-blue-100 dark:bg-blue-900/40' },
    '#8B5CF6': { color: 'text-purple-700 dark:text-purple-300', bgColor: 'bg-purple-100 dark:bg-purple-900/40' },
    '#EAB308': { color: 'text-amber-700 dark:text-amber-300', bgColor: 'bg-amber-100 dark:bg-amber-900/40' },
    '#F97316': { color: 'text-orange-700 dark:text-orange-300', bgColor: 'bg-orange-100 dark:bg-orange-900/40' },
    '#06B6D4': { color: 'text-cyan-700 dark:text-cyan-300', bgColor: 'bg-cyan-100 dark:bg-cyan-900/40' },
    '#22C55E': { color: 'text-green-700 dark:text-green-300', bgColor: 'bg-green-100 dark:bg-green-900/40' },
    '#EF4444': { color: 'text-red-700 dark:text-red-300', bgColor: 'bg-red-100 dark:bg-red-900/40' },
    '#EC4899': { color: 'text-pink-700 dark:text-pink-300', bgColor: 'bg-pink-100 dark:bg-pink-900/40' },
    '#6B7280': { color: 'text-gray-700 dark:text-gray-300', bgColor: 'bg-gray-100 dark:bg-gray-900/40' },
  }
  return map[hex] || map['#6B7280']
}

export const PipelineSummaryBar: React.FC<PipelineSummaryBarProps> = ({ stages: stageData, totals, dynamicStages }) => {
  // Build the list of stages to render
  const stageList = dynamicStages
    ? dynamicStages.filter(s => !s.is_loss_stage).sort((a, b) => a.order - b.order)
    : FALLBACK_STAGES.map(name => ({ id: name, name, color: '#6B7280', order: 0, trigger_event: null, is_loss_stage: false }))

  const getStageCount = (stage: { id: string; name: string }) => {
    // Try matching by lowercase name first, then by id
    return stageData[stage.name.toLowerCase()]?.count || stageData[stage.id]?.count || 0
  }

  const getStageValue = (stage: { id: string; name: string }) => {
    return stageData[stage.name.toLowerCase()]?.total_value || stageData[stage.id]?.total_value || 0
  }

  const maxCount = Math.max(...stageList.map(s => getStageCount(s)), 1)

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
        {stageList.map(stage => {
          const colors = getBarColors(stage.color)
          const count = getStageCount(stage)
          const value = getStageValue(stage)
          const width = Math.max((count / maxCount) * 100, count > 0 ? 15 : 5)

          return (
            <div key={stage.id} className="flex-1 flex flex-col items-center gap-0.5" title={`${stage.name}: ${count} deals - ${formatCurrency(value)}`}>
              <div
                className={`w-full rounded-sm ${colors.bgColor} transition-all`}
                style={{ height: `${Math.max(width * 0.32, 4)}px` }}
              />
              <span className={`text-[10px] font-medium ${colors.color} truncate`}>{count}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
