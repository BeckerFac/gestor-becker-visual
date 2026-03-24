import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { DndContext, DragOverlay, useDroppable, useDraggable, closestCorners } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { DealCard, Deal } from './DealCard'
import { DealDetailPanel } from './DealDetailPanel'
import { PipelineSummaryBar } from './PipelineSummaryBar'
import { Button } from '@/components/ui/Button'
import { ContextMenuBase, type ContextMenuItem } from '@/components/ui/ContextMenuBase'
import { useContextMenu } from '@/hooks/useContextMenu'
import { useKanbanDragDrop } from '@/hooks/useKanbanDragDrop'
import { api } from '@/services/api'
import { toast } from '@/hooks/useToast'
import { formatCurrency } from '@/lib/utils'
import { CrmStage } from './StageConfigurator'

interface Enterprise {
  id: string
  name: string
}

interface PipelineKanbanProps {
  enterprises: Enterprise[]
  stages: CrmStage[]
  onStagesNeeded?: () => void
}

// Map hex colors to Tailwind gradient classes for column headers
function getStageGradient(hex: string): { headerBg: string; headerText: string } {
  const colorMap: Record<string, { headerBg: string; headerText: string }> = {
    '#3B82F6': { headerBg: 'bg-gradient-to-r from-blue-50 to-blue-100 dark:from-blue-950/40 dark:to-blue-900/30', headerText: 'text-blue-800 dark:text-blue-300' },
    '#8B5CF6': { headerBg: 'bg-gradient-to-r from-purple-50 to-purple-100 dark:from-purple-950/40 dark:to-purple-900/30', headerText: 'text-purple-800 dark:text-purple-300' },
    '#EAB308': { headerBg: 'bg-gradient-to-r from-amber-50 to-amber-100 dark:from-amber-950/40 dark:to-amber-900/30', headerText: 'text-amber-800 dark:text-amber-300' },
    '#F97316': { headerBg: 'bg-gradient-to-r from-orange-50 to-orange-100 dark:from-orange-950/40 dark:to-orange-900/30', headerText: 'text-orange-800 dark:text-orange-300' },
    '#06B6D4': { headerBg: 'bg-gradient-to-r from-cyan-50 to-cyan-100 dark:from-cyan-950/40 dark:to-cyan-900/30', headerText: 'text-cyan-800 dark:text-cyan-300' },
    '#22C55E': { headerBg: 'bg-gradient-to-r from-green-50 to-green-100 dark:from-green-950/40 dark:to-green-900/30', headerText: 'text-green-800 dark:text-green-300' },
    '#EF4444': { headerBg: 'bg-gradient-to-r from-red-50 to-red-100 dark:from-red-950/40 dark:to-red-900/30', headerText: 'text-red-800 dark:text-red-300' },
    '#EC4899': { headerBg: 'bg-gradient-to-r from-pink-50 to-pink-100 dark:from-pink-950/40 dark:to-pink-900/30', headerText: 'text-pink-800 dark:text-pink-300' },
    '#6B7280': { headerBg: 'bg-gradient-to-r from-gray-50 to-gray-100 dark:from-gray-950/40 dark:to-gray-900/30', headerText: 'text-gray-800 dark:text-gray-300' },
  }
  return colorMap[hex] || colorMap['#6B7280']
}

// Map hex to Tailwind border-l color
function getStageBorderColor(hex: string): string {
  const map: Record<string, string> = {
    '#3B82F6': 'border-l-blue-500',
    '#8B5CF6': 'border-l-purple-500',
    '#EAB308': 'border-l-amber-500',
    '#F97316': 'border-l-orange-500',
    '#06B6D4': 'border-l-cyan-500',
    '#22C55E': 'border-l-green-500',
    '#EF4444': 'border-l-red-500',
    '#EC4899': 'border-l-pink-500',
    '#6B7280': 'border-l-gray-500',
  }
  return map[hex] || 'border-l-gray-400'
}

export { getStageGradient, getStageBorderColor }

export const PipelineKanban: React.FC<PipelineKanbanProps> = ({ enterprises, stages }) => {
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

  // Active (non-loss) stages sorted by order — memoized to prevent re-render loops
  const activeStages = useMemo(() =>
    stages.filter(s => !s.is_loss_stage).sort((a, b) => a.order - b.order),
    [stages]
  )

  // Loss stages — memoized
  const lossStages = useMemo(() => stages.filter(s => s.is_loss_stage), [stages])

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

  const findStageById = (id: string) => stages.find(s => s.id === id)


  const handleMoveForward = async (deal: Deal) => {
    const currentStageIndex = activeStages.findIndex(s =>
      s.id === deal.stage || s.name.toLowerCase() === deal.stage.toLowerCase()
    )
    if (currentStageIndex < 0 || currentStageIndex >= activeStages.length - 1) return
    const nextStage = activeStages[currentStageIndex + 1]

    try {
      // Try with stage_id first, fall back to name
      await api.moveCrmDealStage(deal.id, nextStage.id || nextStage.name.toLowerCase())
      toast.success(`Movido a ${nextStage.name}`)
      await loadData()
    } catch (err: any) {
      toast.error(err.message)
    }
  }

  const handleMoveBackward = async (deal: Deal) => {
    const currentStageIndex = activeStages.findIndex(s =>
      s.id === deal.stage || s.name.toLowerCase() === deal.stage.toLowerCase()
    )
    if (currentStageIndex <= 0) return
    const prevStage = activeStages[currentStageIndex - 1]

    try {
      await api.moveCrmDealStage(deal.id, prevStage.id || prevStage.name.toLowerCase())
      toast.success(`Movido a ${prevStage.name}`)
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
    return (
      <div className="flex gap-3 overflow-x-auto pb-4" style={{ minHeight: '400px' }}>
        {activeStages.map(stage => (
          <div key={stage.id} className="flex-shrink-0 w-[220px] bg-gray-50 dark:bg-gray-900/50 rounded-lg border border-gray-200 dark:border-gray-700 animate-pulse">
            <div className="px-3 py-2.5 rounded-t-lg bg-gray-100 dark:bg-gray-800">
              <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-20" />
            </div>
            <div className="p-2 space-y-2">
              {[1, 2].map(i => <div key={i} className="h-20 bg-gray-100 dark:bg-gray-800 rounded" />)}
            </div>
          </div>
        ))}
      </div>
    )
  }

  const lostCount = lossStages.reduce((sum, s) => {
    const key = s.name.toLowerCase()
    return sum + (dealsByStage[key] || dealsByStage[s.id] || []).length
  }, 0) || summary?.stages?.perdido?.count || 0

  // Mobile: list view
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768

  // Drag & drop
  const dnd = useKanbanDragDrop({ dealsByStage, setDealsByStage, loadData })

  // Context menu
  const contextMenu = useContextMenu<Deal>()

  return (
    <div className="space-y-4">
      {/* Summary bar */}
      {summary && (
        <PipelineSummaryBar stages={summary.stages} totals={summary.totals} dynamicStages={activeStages} />
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
          {showLostDeals ? 'Ocultar no concretados' : `No concretados (${lostCount})`}
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
          stages={activeStages}
          search={search}
          filterDeals={filterDeals}
          onSelect={setSelectedDeal}
        />
      ) : (
        <DndContext
          sensors={dnd.sensors}
          collisionDetection={closestCorners}
          onDragStart={dnd.handleDragStart}
          onDragEnd={dnd.handleDragEnd}
          onDragCancel={dnd.handleDragCancel}
        >
          <div className="flex gap-3 overflow-x-auto pb-4" style={{ minHeight: '400px' }}>
            {activeStages.map((stage, stageIdx) => (
              <KanbanColumn key={stage.id} stageId={stage.id}>
                {({ isOver }) => {
                  const gradient = getStageGradient(stage.color)
                  const stageKey = stage.name.toLowerCase()
                  const deals = filterDeals(dealsByStage[stageKey] || dealsByStage[stage.id] || [])
                  const totalValue = deals.reduce((sum, d) => sum + Number(d.value || 0), 0)

                  return (
                    <div className={`flex-shrink-0 w-[220px] flex flex-col bg-gray-50 dark:bg-gray-900/50 rounded-lg border transition-all ${
                      isOver
                        ? 'border-blue-400 dark:border-blue-500 ring-2 ring-blue-300/50 dark:ring-blue-600/30 bg-blue-50/30 dark:bg-blue-950/20'
                        : 'border-gray-200 dark:border-gray-700'
                    }`}>
                      {/* Column header */}
                      <div className={`px-3 py-2.5 rounded-t-lg ${gradient.headerBg}`}>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1.5">
                            <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: stage.color }} />
                            <span className={`text-sm font-semibold ${gradient.headerText}`}>{stage.name}</span>
                          </div>
                          <span className={`text-xs font-medium ${gradient.headerText} bg-white/50 dark:bg-black/20 px-1.5 py-0.5 rounded-full`}>
                            {deals.length}
                          </span>
                        </div>
                        <span className={`text-xs ${gradient.headerText} opacity-75`}>
                          {formatCurrency(totalValue)}
                        </span>
                      </div>

                      {/* Cards */}
                      <div className="flex-1 overflow-y-auto p-2 space-y-2" style={{ maxHeight: '60vh' }}>
                        {deals.length === 0 ? (
                          <p className={`text-xs text-center py-6 ${isOver ? 'text-blue-400' : 'text-gray-400 dark:text-gray-500'}`}>
                            {isOver ? 'Soltar aqui' : 'Sin deals'}
                          </p>
                        ) : (
                          deals.map(deal => (
                            <DraggableDealCard
                              key={deal.id}
                              deal={deal}
                              stageKey={stage.id}
                              stageColor={stage.color}
                              onSelect={setSelectedDeal}
                              onMoveForward={stageIdx < activeStages.length - 1 ? handleMoveForward : undefined}
                              onMoveBackward={stageIdx > 0 ? handleMoveBackward : undefined}
                              onContextMenu={(e) => contextMenu.openMenu(e, deal)}
                            />
                          ))
                        )}
                      </div>
                    </div>
                  )
                }}
              </KanbanColumn>
            ))}
          </div>

          {/* Drag overlay (ghost card) */}
          <DragOverlay dropAnimation={null}>
            {dnd.activeDeal && (
              <div className="rotate-2 scale-105 shadow-2xl opacity-90 w-[200px]">
                <DealCard
                  deal={dnd.activeDeal}
                  onSelect={() => {}}
                  showStageActions={false}
                />
              </div>
            )}
          </DragOverlay>
        </DndContext>
      )}

      {/* Context menu for deals */}
      {contextMenu.menu && (
        <ContextMenuBase
          x={contextMenu.menu.x}
          y={contextMenu.menu.y}
          header={{
            title: contextMenu.menu.item.title,
            subtitle: contextMenu.menu.item.enterprise_name || undefined,
          }}
          items={getDealContextMenuItems(contextMenu.menu.item, activeStages, {
            onMoveTo: async (deal, stageId) => {
              try {
                await api.moveCrmDealStage(deal.id, stageId)
                toast.success('Deal movido')
                await loadData()
              } catch (e: any) { toast.error(e.message) }
            },
            onEdit: (deal) => setSelectedDeal(deal),
            onChangePriority: async (deal, priority) => {
              try {
                await api.updateCrmDeal(deal.id, { priority })
                toast.success('Prioridad actualizada')
                await loadData()
              } catch (e: any) { toast.error(e.message) }
            },
            onMarkWon: async (deal) => {
              try {
                await api.closeCrmDeal(deal.id, true)
                toast.success('Deal cerrado como exitoso')
                await loadData()
              } catch (e: any) { toast.error(e.message) }
            },
            onMarkLost: async (deal) => {
              try {
                await api.closeCrmDeal(deal.id, false)
                toast.success('Deal cerrado como no concretado')
                await loadData()
              } catch (e: any) { toast.error(e.message) }
            },
            onDelete: async (deal) => {
              try {
                await api.deleteCrmDeal(deal.id)
                toast.success('Deal eliminado')
                await loadData()
              } catch (e: any) { toast.error(e.message) }
            },
          })}
          onClose={contextMenu.closeMenu}
        />
      )}

      {/* Lost deals section (collapsed at bottom) */}
      {lossStages.length > 0 && (
        <div className="border-t border-gray-200 dark:border-gray-700 pt-2">
          <button
            onClick={handleShowLost}
            className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
          >
            <svg className={`w-4 h-4 transition-transform ${showLostDeals ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            No concretados ({lostCount})
          </button>
        </div>
      )}
      {showLostDeals && lostDeals.length > 0 && (
        <div className="bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800 rounded-lg p-4 transition-all">
          <h4 className="text-sm font-semibold text-red-800 dark:text-red-400 mb-3">
            Deals no concretados ({lostDeals.length})
          </h4>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
            {lostDeals.map(deal => (
              <DealCard
                key={deal.id}
                deal={deal}
                stageColor="#EF4444"
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
          stages={stages}
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

// --- Inline components for DnD ---

const KanbanColumn: React.FC<{
  stageId: string
  children: (props: { isOver: boolean }) => React.ReactNode
}> = ({ stageId, children }) => {
  const { isOver, setNodeRef } = useDroppable({ id: stageId })
  return <div ref={setNodeRef}>{children({ isOver })}</div>
}

const DraggableDealCard: React.FC<{
  deal: Deal
  stageKey: string
  stageColor?: string
  onSelect: (deal: Deal) => void
  onMoveForward?: (deal: Deal) => void
  onMoveBackward?: (deal: Deal) => void
  onContextMenu?: (e: React.MouseEvent) => void
}> = ({ deal, stageKey, stageColor, onSelect, onMoveForward, onMoveBackward, onContextMenu }) => {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: deal.id,
    data: { deal, stageKey },
  })
  const style = transform ? { transform: CSS.Translate.toString(transform) } : undefined

  return (
    <div ref={setNodeRef} style={style} {...listeners} {...attributes}>
      <DealCard
        deal={deal}
        stageColor={stageColor}
        onSelect={onSelect}
        onMoveForward={onMoveForward}
        onMoveBackward={onMoveBackward}
        onContextMenu={onContextMenu}
        isDragging={isDragging}
      />
    </div>
  )
}

// --- Context menu items helper ---

function getDealContextMenuItems(
  deal: Deal,
  stages: CrmStage[],
  callbacks: {
    onMoveTo: (deal: Deal, stageId: string) => void
    onEdit: (deal: Deal) => void
    onChangePriority: (deal: Deal, priority: string) => void
    onMarkWon: (deal: Deal) => void
    onMarkLost: (deal: Deal) => void
    onDelete: (deal: Deal) => void
  }
): ContextMenuItem[] {
  const moveSubmenu: ContextMenuItem[] = stages
    .filter(s => s.id !== deal.stage_id && s.name.toLowerCase() !== deal.stage?.toLowerCase())
    .map(s => ({
      id: `move-${s.id}`,
      label: s.name,
      onClick: () => callbacks.onMoveTo(deal, s.id),
    }))

  const prioritySubmenu: ContextMenuItem[] = [
    { id: 'p-baja', label: 'Baja', disabled: deal.priority === 'baja', onClick: () => callbacks.onChangePriority(deal, 'baja') },
    { id: 'p-normal', label: 'Normal', disabled: deal.priority === 'normal', onClick: () => callbacks.onChangePriority(deal, 'normal') },
    { id: 'p-alta', label: 'Alta', disabled: deal.priority === 'alta', onClick: () => callbacks.onChangePriority(deal, 'alta') },
    { id: 'p-urgente', label: 'Urgente', disabled: deal.priority === 'urgente', onClick: () => callbacks.onChangePriority(deal, 'urgente') },
  ]

  return [
    {
      id: 'move-to',
      label: 'Mover a...',
      icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" /></svg>,
      submenu: moveSubmenu,
    },
    {
      id: 'edit',
      label: 'Editar deal',
      icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>,
      onClick: () => callbacks.onEdit(deal),
    },
    {
      id: 'priority',
      label: 'Cambiar prioridad',
      icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4h13M3 8h9m-9 4h6m4 0l4-4m0 0l4 4m-4-4v12" /></svg>,
      submenu: prioritySubmenu,
    },
    { id: 'sep-1', label: '', separator: true },
    {
      id: 'won',
      label: 'Cerrar como exitoso',
      icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>,
      onClick: () => callbacks.onMarkWon(deal),
    },
    {
      id: 'lost',
      label: 'Cerrar como no concretado',
      icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>,
      onClick: () => callbacks.onMarkLost(deal),
    },
    { id: 'sep-2', label: '', separator: true },
    {
      id: 'delete',
      label: 'Eliminar deal',
      icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>,
      danger: true,
      onClick: () => callbacks.onDelete(deal),
    },
  ]
}

// Mobile list view with tabs per stage
const MobileListView: React.FC<{
  dealsByStage: Record<string, Deal[]>
  stages: CrmStage[]
  search: string
  filterDeals: (deals: Deal[]) => Deal[]
  onSelect: (deal: Deal) => void
}> = ({ dealsByStage, stages, filterDeals, onSelect }) => {
  const [activeStageId, setActiveStageId] = useState<string>(stages[0]?.id || '')

  const activeStage = stages.find(s => s.id === activeStageId)
  const stageKey = activeStage?.name.toLowerCase() || ''
  const deals = filterDeals(dealsByStage[stageKey] || dealsByStage[activeStageId] || [])

  return (
    <div>
      {/* Stage tabs */}
      <div className="flex overflow-x-auto gap-1 mb-3 pb-1">
        {stages.map(stage => {
          const key = stage.name.toLowerCase()
          const count = (dealsByStage[key] || dealsByStage[stage.id] || []).length
          return (
            <button
              key={stage.id}
              onClick={() => setActiveStageId(stage.id)}
              className={`flex-shrink-0 px-3 py-1.5 text-xs font-medium rounded-full transition-colors ${
                activeStageId === stage.id
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
              }`}
            >
              {stage.name.slice(0, 6)}. ({count})
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
            <DealCard
              key={deal.id}
              deal={deal}
              stageColor={activeStage?.color || '#6B7280'}
              onSelect={onSelect}
              showStageActions={false}
            />
          ))
        )}
      </div>
    </div>
  )
}
