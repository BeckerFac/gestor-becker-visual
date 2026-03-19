import React, { useState, useEffect, useCallback } from 'react'
import { DealCard, Deal } from './DealCard'
import { DealDetailPanel } from './DealDetailPanel'
import { PipelineSummaryBar } from './PipelineSummaryBar'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { SkeletonTable } from '@/components/ui/Skeleton'
import { api } from '@/services/api'
import { toast } from '@/hooks/useToast'
import { formatCurrency } from '@/lib/utils'

interface Enterprise {
  id: string
  name: string
}

interface PipelineKanbanProps {
  enterprises: Enterprise[]
}

const STAGE_ORDER = ['contacto', 'cotizacion', 'negociacion', 'pedido', 'entregado', 'cobrado'] as const

const STAGE_CONFIG: Record<string, { label: string; headerBg: string; headerText: string }> = {
  contacto: { label: 'Contacto', headerBg: 'bg-gradient-to-r from-blue-50 to-blue-100 dark:from-blue-950/40 dark:to-blue-900/30', headerText: 'text-blue-800 dark:text-blue-300' },
  cotizacion: { label: 'Cotizacion', headerBg: 'bg-gradient-to-r from-purple-50 to-purple-100 dark:from-purple-950/40 dark:to-purple-900/30', headerText: 'text-purple-800 dark:text-purple-300' },
  negociacion: { label: 'Negociacion', headerBg: 'bg-gradient-to-r from-amber-50 to-amber-100 dark:from-amber-950/40 dark:to-amber-900/30', headerText: 'text-amber-800 dark:text-amber-300' },
  pedido: { label: 'Pedido', headerBg: 'bg-gradient-to-r from-orange-50 to-orange-100 dark:from-orange-950/40 dark:to-orange-900/30', headerText: 'text-orange-800 dark:text-orange-300' },
  entregado: { label: 'Entregado', headerBg: 'bg-gradient-to-r from-teal-50 to-teal-100 dark:from-teal-950/40 dark:to-teal-900/30', headerText: 'text-teal-800 dark:text-teal-300' },
  cobrado: { label: 'Cobrado', headerBg: 'bg-gradient-to-r from-green-50 to-green-100 dark:from-green-950/40 dark:to-green-900/30', headerText: 'text-green-800 dark:text-green-300' },
}

export const PipelineKanban: React.FC<PipelineKanbanProps> = ({ enterprises }) => {
  const [dealsByStage, setDealsByStage] = useState<Record<string, Deal[]>>({})
  const [summary, setSummary] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [selectedDeal, setSelectedDeal] = useState<Deal | null>(null)
  const [showQuickAdd, setShowQuickAdd] = useState(false)
  const [quickAddForm, setQuickAddForm] = useState({ enterprise_id: '', title: '', value: '' })
  const [savingDeal, setSavingDeal] = useState(false)
  const [search, setSearch] = useState('')
  const [showLostDeals, setShowLostDeals] = useState(false)
  const [lostDeals, setLostDeals] = useState<Deal[]>([])

  const loadData = useCallback(async () => {
    try {
      const [stageData, summaryData] = await Promise.all([
        api.getCrmDealsByStage(),
        api.getCrmPipelineSummary(),
      ])
      setDealsByStage(stageData)
      setSummary(summaryData)
    } catch (err: any) {
      toast.error(err.message || 'Error al cargar pipeline')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadData()
  }, [loadData])

  const handleMoveForward = async (deal: Deal) => {
    const currentIndex = STAGE_ORDER.indexOf(deal.stage as any)
    if (currentIndex < 0 || currentIndex >= STAGE_ORDER.length - 1) return
    const nextStage = STAGE_ORDER[currentIndex + 1]

    try {
      await api.moveCrmDealStage(deal.id, nextStage)
      toast.success(`Movido a ${STAGE_CONFIG[nextStage].label}`)
      await loadData()
    } catch (err: any) {
      toast.error(err.message)
    }
  }

  const handleMoveBackward = async (deal: Deal) => {
    const currentIndex = STAGE_ORDER.indexOf(deal.stage as any)
    if (currentIndex <= 0) return
    const prevStage = STAGE_ORDER[currentIndex - 1]

    try {
      await api.moveCrmDealStage(deal.id, prevStage)
      toast.success(`Movido a ${STAGE_CONFIG[prevStage].label}`)
      await loadData()
    } catch (err: any) {
      toast.error(err.message)
    }
  }

  const handleQuickAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!quickAddForm.title.trim()) {
      toast.error('El titulo es obligatorio')
      return
    }
    setSavingDeal(true)
    try {
      await api.createCrmDeal({
        enterprise_id: quickAddForm.enterprise_id || null,
        title: quickAddForm.title.trim(),
        value: parseFloat(quickAddForm.value) || 0,
      })
      toast.success('Deal creado')
      setQuickAddForm({ enterprise_id: '', title: '', value: '' })
      setShowQuickAdd(false)
      await loadData()
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setSavingDeal(false)
    }
  }

  const handleShowLost = async () => {
    if (showLostDeals) {
      setShowLostDeals(false)
      return
    }
    try {
      const data = await api.getCrmDeals({ stage: 'perdido' })
      setLostDeals(data)
      setShowLostDeals(true)
    } catch (err: any) {
      toast.error(err.message)
    }
  }

  const filterDeals = (deals: Deal[]): Deal[] => {
    if (!search.trim()) return deals
    const s = search.toLowerCase()
    return deals.filter(d =>
      d.title.toLowerCase().includes(s) ||
      (d.enterprise_name || '').toLowerCase().includes(s) ||
      (d.customer_name || '').toLowerCase().includes(s)
    )
  }

  if (loading) {
    return <SkeletonTable rows={5} cols={6} />
  }

  // Mobile: list view
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768

  return (
    <div className="space-y-4">
      {/* Summary bar */}
      {summary && (
        <PipelineSummaryBar stages={summary.stages} totals={summary.totals} />
      )}

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex-1 min-w-[200px]">
          <input
            type="text"
            placeholder="Buscar deal..."
            className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <Button
          size="sm"
          variant={showQuickAdd ? 'danger' : 'primary'}
          onClick={() => setShowQuickAdd(!showQuickAdd)}
        >
          {showQuickAdd ? 'Cancelar' : '+ Nuevo Deal'}
        </Button>
        <Button
          size="sm"
          variant={showLostDeals ? 'secondary' : 'outline'}
          onClick={handleShowLost}
        >
          {showLostDeals ? 'Ocultar perdidos' : `Perdidos (${summary?.stages?.perdido?.count || 0})`}
        </Button>
      </div>

      {/* Quick add form */}
      {showQuickAdd && (
        <form onSubmit={handleQuickAdd} className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
            <div>
              <label className="text-xs font-medium text-gray-600 dark:text-gray-400 block mb-1">Empresa</label>
              <select
                className="w-full px-2 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={quickAddForm.enterprise_id}
                onChange={e => setQuickAddForm({ ...quickAddForm, enterprise_id: e.target.value })}
              >
                <option value="">Sin empresa</option>
                {enterprises.map(ent => (
                  <option key={ent.id} value={ent.id}>{ent.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 dark:text-gray-400 block mb-1">Titulo *</label>
              <input
                type="text"
                className="w-full px-2 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Descripcion del deal"
                value={quickAddForm.title}
                onChange={e => setQuickAddForm({ ...quickAddForm, title: e.target.value })}
                autoFocus
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 dark:text-gray-400 block mb-1">Valor $</label>
              <input
                type="number"
                className="w-full px-2 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="0"
                value={quickAddForm.value}
                onChange={e => setQuickAddForm({ ...quickAddForm, value: e.target.value })}
              />
            </div>
            <Button type="submit" size="sm" loading={savingDeal} className="w-full">Crear Deal</Button>
          </div>
        </form>
      )}

      {/* Kanban board (desktop) / List view (mobile) */}
      {isMobile ? (
        <MobileListView
          dealsByStage={dealsByStage}
          search={search}
          filterDeals={filterDeals}
          onSelect={setSelectedDeal}
        />
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-4" style={{ minHeight: '400px' }}>
          {STAGE_ORDER.map(stage => {
            const config = STAGE_CONFIG[stage]
            const deals = filterDeals(dealsByStage[stage] || [])
            const totalValue = deals.reduce((sum, d) => sum + Number(d.value || 0), 0)

            return (
              <div key={stage} className="flex-shrink-0 w-[220px] flex flex-col bg-gray-50 dark:bg-gray-900/50 rounded-lg border border-gray-200 dark:border-gray-700">
                {/* Column header */}
                <div className={`px-3 py-2.5 rounded-t-lg ${config.headerBg}`}>
                  <div className="flex items-center justify-between">
                    <span className={`text-sm font-semibold ${config.headerText}`}>{config.label}</span>
                    <span className={`text-xs font-medium ${config.headerText} bg-white/50 dark:bg-black/20 px-1.5 py-0.5 rounded-full`}>
                      {deals.length}
                    </span>
                  </div>
                  <span className={`text-xs ${config.headerText} opacity-75`}>
                    {formatCurrency(totalValue)}
                  </span>
                </div>

                {/* Cards */}
                <div className="flex-1 overflow-y-auto p-2 space-y-2" style={{ maxHeight: '60vh' }}>
                  {deals.length === 0 ? (
                    <p className="text-xs text-gray-400 dark:text-gray-500 text-center py-6">Sin deals</p>
                  ) : (
                    deals.map(deal => (
                      <DealCard
                        key={deal.id}
                        deal={deal}
                        onSelect={setSelectedDeal}
                        onMoveForward={handleMoveForward}
                        onMoveBackward={handleMoveBackward}
                      />
                    ))
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Lost deals section */}
      {showLostDeals && lostDeals.length > 0 && (
        <div className="bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800 rounded-lg p-4">
          <h4 className="text-sm font-semibold text-red-800 dark:text-red-400 mb-3">
            Deals perdidos ({lostDeals.length})
          </h4>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
            {lostDeals.map(deal => (
              <DealCard
                key={deal.id}
                deal={deal}
                onSelect={setSelectedDeal}
                showStageActions={false}
              />
            ))}
          </div>
        </div>
      )}

      {/* Deal detail panel */}
      {selectedDeal && (
        <DealDetailPanel
          deal={selectedDeal}
          onClose={() => setSelectedDeal(null)}
          onDealUpdated={() => {
            setSelectedDeal(null)
            loadData()
          }}
        />
      )}
    </div>
  )
}

// Mobile list view with tabs per stage
const MobileListView: React.FC<{
  dealsByStage: Record<string, Deal[]>
  search: string
  filterDeals: (deals: Deal[]) => Deal[]
  onSelect: (deal: Deal) => void
}> = ({ dealsByStage, filterDeals, onSelect }) => {
  const [activeStage, setActiveStage] = useState<string>('contacto')

  const STAGE_LABELS: Record<string, string> = {
    contacto: 'Cont.',
    cotizacion: 'Cotiz.',
    negociacion: 'Negoc.',
    pedido: 'Ped.',
    entregado: 'Entreg.',
    cobrado: 'Cobr.',
  }

  const deals = filterDeals(dealsByStage[activeStage] || [])

  return (
    <div>
      {/* Stage tabs */}
      <div className="flex overflow-x-auto gap-1 mb-3 pb-1">
        {STAGE_ORDER.map(stage => {
          const count = (dealsByStage[stage] || []).length
          return (
            <button
              key={stage}
              onClick={() => setActiveStage(stage)}
              className={`flex-shrink-0 px-3 py-1.5 text-xs font-medium rounded-full transition-colors ${
                activeStage === stage
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
              }`}
            >
              {STAGE_LABELS[stage]} ({count})
            </button>
          )
        })}
      </div>

      {/* Deal list */}
      <div className="space-y-2">
        {deals.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-8">Sin deals en esta etapa</p>
        ) : (
          deals.map(deal => (
            <DealCard key={deal.id} deal={deal} onSelect={onSelect} showStageActions={false} />
          ))
        )}
      </div>
    </div>
  )
}
