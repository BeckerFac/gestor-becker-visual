import React, { useState, useEffect, useCallback } from 'react'
import { PipelineKanban } from '@/components/crm/PipelineKanban'
import { StageConfigurator, CrmStage } from '@/components/crm/StageConfigurator'
import { Button } from '@/components/ui/Button'
import { SkeletonTable } from '@/components/ui/Skeleton'
import { api } from '@/services/api'
import { toast } from '@/hooks/useToast'
import { formatCurrency } from '@/lib/utils'
import { HelpTip } from '@/components/shared/HelpTip'
import { FeatureGate } from '@/components/shared/FeatureGate'

interface Enterprise {
  id: string
  name: string
}

// Default stages (fallback if API doesn't have stages yet)
const DEFAULT_STAGES: CrmStage[] = [
  { id: 'default-1', name: 'Contacto', color: '#3B82F6', order: 1, trigger_event: null, is_loss_stage: false },
  { id: 'default-2', name: 'Cotizacion', color: '#8B5CF6', order: 2, trigger_event: 'quote_created', is_loss_stage: false },
  { id: 'default-3', name: 'Negociacion', color: '#EAB308', order: 3, trigger_event: 'quote_accepted', is_loss_stage: false },
  { id: 'default-4', name: 'Pedido', color: '#F97316', order: 4, trigger_event: 'order_created', is_loss_stage: false },
  { id: 'default-5', name: 'Entregado', color: '#06B6D4', order: 5, trigger_event: 'order_delivered', is_loss_stage: false },
  { id: 'default-6', name: 'Cobrado', color: '#22C55E', order: 6, trigger_event: 'payment_received', is_loss_stage: false },
  { id: 'default-7', name: 'Perdido', color: '#EF4444', order: 7, trigger_event: null, is_loss_stage: true },
]

export const Oportunidades: React.FC = () => {
  const [enterprises, setEnterprises] = useState<Enterprise[]>([])
  const [stages, setStages] = useState<CrmStage[]>([])
  const [summary, setSummary] = useState<{ active_deals: number; pipeline_value: number } | null>(null)
  const [loading, setLoading] = useState(true)
  const [showConfigurator, setShowConfigurator] = useState(false)

  // Filters
  const [filterEnterprise, setFilterEnterprise] = useState('')
  const [filterStage, setFilterStage] = useState('')
  const [filterSearch, setFilterSearch] = useState('')

  const loadData = useCallback(async () => {
    try {
      setLoading(true)
      const [entRes, stagesRes, summaryRes] = await Promise.all([
        api.getEnterprises().catch(() => []),
        api.getCrmStages().catch(() => []),
        api.getCrmPipelineSummary().catch(() => null),
      ])

      setEnterprises(
        (Array.isArray(entRes) ? entRes : []).map((e: any) => ({ id: e.id, name: e.name }))
      )

      const loadedStages = Array.isArray(stagesRes) && stagesRes.length > 0 ? stagesRes : DEFAULT_STAGES
      setStages(loadedStages)

      if (summaryRes?.totals) {
        setSummary({
          active_deals: summaryRes.totals.active_deals || 0,
          pipeline_value: summaryRes.totals.pipeline_value || 0,
        })
      }
    } catch (err: any) {
      toast.error(err.message || 'Error al cargar datos')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadData()
  }, [loadData])

  const handleStagesSaved = () => {
    loadData()
  }

  const activeStages = stages.filter(s => !s.is_loss_stage).sort((a, b) => a.order - b.order)

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <div className="h-7 w-48 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
            <div className="h-4 w-64 bg-gray-100 dark:bg-gray-800 rounded animate-pulse mt-2" />
          </div>
        </div>
        <SkeletonTable rows={5} cols={6} />
      </div>
    )
  }

  return (
    <FeatureGate feature="crm">
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Oportunidades</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {summary
              ? `${summary.active_deals} oportunidad${summary.active_deals !== 1 ? 'es' : ''} activa${summary.active_deals !== 1 ? 's' : ''} | Pipeline: ${formatCurrency(summary.pipeline_value)}`
              : 'Pipeline CRM'
            }
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setShowConfigurator(true)}
        >
          <svg className="w-4 h-4 mr-1.5 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          Configurar etapas<HelpTip text="Personaliza las etapas del pipeline y asigna triggers automaticos para que los deals se muevan solos." />
        </Button>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-4 py-3">
        <div className="flex-1 min-w-[180px]">
          <input
            type="text"
            placeholder="Buscar por titulo..."
            className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={filterSearch}
            onChange={e => setFilterSearch(e.target.value)}
          />
        </div>
        <select
          className="px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          value={filterEnterprise}
          onChange={e => setFilterEnterprise(e.target.value)}
        >
          <option value="">Todas las empresas</option>
          {enterprises.map(ent => (
            <option key={ent.id} value={ent.id}>{ent.name}</option>
          ))}
        </select>
        <select
          className="px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          value={filterStage}
          onChange={e => setFilterStage(e.target.value)}
        >
          <option value="">Todas las etapas</option>
          {activeStages.map(s => (
            <option key={s.id} value={s.name.toLowerCase()}>{s.name}</option>
          ))}
        </select>
        {(filterSearch || filterEnterprise || filterStage) && (
          <button
            onClick={() => { setFilterSearch(''); setFilterEnterprise(''); setFilterStage('') }}
            className="text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
          >
            Limpiar filtros
          </button>
        )}
      </div>

      {/* Kanban */}
      <PipelineKanban
        enterprises={enterprises}
        stages={stages}
      />

      {/* Stage Configurator Modal */}
      <StageConfigurator
        open={showConfigurator}
        onClose={() => setShowConfigurator(false)}
        onSaved={handleStagesSaved}
      />
    </div>
    </FeatureGate>
  )
}
