import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Deal } from './DealCard'
import { ActivityTimeline } from './ActivityTimeline'
import { CrmStage } from './StageConfigurator'
import { Button } from '@/components/ui/Button'
import { formatCurrency, formatDate } from '@/lib/utils'
import { api } from '@/services/api'
import { toast } from '@/hooks/useToast'

interface DealDetailPanelProps {
  deal: Deal
  stages: CrmStage[]
  onClose: () => void
  onDealUpdated: () => void
}

interface DealDocument {
  id: string
  type: 'quote' | 'order' | 'invoice' | 'cobro'
  number: string
  amount: number
  status: string
  date: string
}

const DOC_ICONS: Record<string, string> = {
  quote: '$',
  order: 'P',
  invoice: 'F',
  cobro: 'C',
}

const DOC_LABELS: Record<string, string> = {
  quote: 'Cotizacion',
  order: 'Pedido',
  invoice: 'Factura',
  cobro: 'Cobro',
}

const DOC_ROUTES: Record<string, string> = {
  quote: '/quotes',
  order: '/orders',
  invoice: '/invoices',
  cobro: '/cobros',
}

const DOC_ICON_COLORS: Record<string, string> = {
  quote: 'bg-purple-100 text-purple-700 dark:bg-purple-900/50 dark:text-purple-300',
  order: 'bg-orange-100 text-orange-700 dark:bg-orange-900/50 dark:text-orange-300',
  invoice: 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300',
  cobro: 'bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300',
}

const PRIORITY_LABELS: Record<string, string> = {
  baja: 'Baja',
  normal: 'Normal',
  alta: 'Alta',
  urgente: 'Urgente',
}

const LOST_REASONS = [
  'Precio alto',
  'Eligio competencia',
  'No necesita el producto',
  'Timing / no es el momento',
  'Sin presupuesto',
  'Otro',
]

export const DealDetailPanel: React.FC<DealDetailPanelProps> = ({
  deal,
  stages,
  onClose,
  onDealUpdated,
}) => {
  const navigate = useNavigate()
  const [activities, setActivities] = useState<any[]>([])
  const [documents, setDocuments] = useState<DealDocument[]>([])
  const [loadingActivities, setLoadingActivities] = useState(true)
  const [loadingDocs, setLoadingDocs] = useState(true)
  const [showLostForm, setShowLostForm] = useState(false)
  const [lostReason, setLostReason] = useState('')
  const [closing, setClosing] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editForm, setEditForm] = useState({
    title: deal.title,
    value: String(deal.value || 0),
    priority: deal.priority,
    notes: deal.notes || '',
  })
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)

  // Active (non-loss) stages for the pipeline progress bar
  const activeStages = stages
    .filter(s => !s.is_loss_stage)
    .sort((a, b) => a.order - b.order)

  const lossStages = stages.filter(s => s.is_loss_stage)

  const isLostDeal = lossStages.some(s =>
    s.id === deal.stage || s.name.toLowerCase() === deal.stage.toLowerCase()
  ) || deal.stage === 'perdido'

  const currentStageIndex = activeStages.findIndex(s =>
    s.id === deal.stage || s.name.toLowerCase() === deal.stage.toLowerCase()
  )

  const currentStageName = (() => {
    const found = stages.find(s => s.id === deal.stage || s.name.toLowerCase() === deal.stage.toLowerCase())
    return found?.name || deal.stage
  })()

  const currentStageColor = (() => {
    const found = stages.find(s => s.id === deal.stage || s.name.toLowerCase() === deal.stage.toLowerCase())
    return found?.color || '#6B7280'
  })()

  const loadActivities = async () => {
    try {
      setLoadingActivities(true)
      const data = await api.getCrmActivities({ deal_id: deal.id, limit: 30 })
      setActivities(data)
    } catch (err) {
      console.error('Failed to load activities:', err)
    } finally {
      setLoadingActivities(false)
    }
  }

  const loadDocuments = async () => {
    try {
      setLoadingDocs(true)
      const data = await api.getCrmDealDocuments(deal.id)
      setDocuments(Array.isArray(data) ? data : [])
    } catch {
      // Documents endpoint might not exist yet, fail silently
      setDocuments([])
    } finally {
      setLoadingDocs(false)
    }
  }

  useEffect(() => {
    loadActivities()
    loadDocuments()
  }, [deal.id])

  const handleMoveStage = async (stageIdOrName: string) => {
    try {
      await api.moveCrmDealStage(deal.id, stageIdOrName)
      const targetStage = stages.find(s => s.id === stageIdOrName || s.name.toLowerCase() === stageIdOrName)
      toast.success(`Movido a ${targetStage?.name || stageIdOrName}`)
      onDealUpdated()
    } catch (err: any) {
      toast.error(err.message)
    }
  }

  const handleMarkLost = async () => {
    if (!lostReason.trim()) {
      toast.error('Indica un motivo de perdida')
      return
    }
    setClosing(true)
    try {
      await api.closeCrmDeal(deal.id, false, lostReason)
      toast.success('Deal marcado como perdido')
      setShowLostForm(false)
      onDealUpdated()
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setClosing(false)
    }
  }

  const handleReopen = async () => {
    const firstStage = activeStages[0]
    if (!firstStage) return
    try {
      await api.moveCrmDealStage(deal.id, firstStage.id || firstStage.name.toLowerCase())
      toast.success(`Deal reabierto en ${firstStage.name}`)
      onDealUpdated()
    } catch (err: any) {
      toast.error(err.message)
    }
  }

  const handleSaveEdit = async () => {
    setSaving(true)
    try {
      await api.updateCrmDeal(deal.id, {
        title: editForm.title,
        value: parseFloat(editForm.value) || 0,
        priority: editForm.priority,
        notes: editForm.notes || null,
      })
      toast.success('Deal actualizado')
      setEditing(false)
      onDealUpdated()
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!confirm('Eliminar este deal? Esta accion no se puede deshacer.')) return
    setDeleting(true)
    try {
      await api.deleteCrmDeal(deal.id)
      toast.success('Deal eliminado')
      onClose()
      onDealUpdated()
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setDeleting(false)
    }
  }

  const handleDocClick = (doc: DealDocument) => {
    const route = DOC_ROUTES[doc.type]
    if (route) navigate(route)
  }

  // Stage badge style
  const stageBadgeStyle = {
    backgroundColor: `${currentStageColor}20`,
    color: currentStageColor,
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30" />
      <div
        className="relative w-full max-w-lg bg-white dark:bg-gray-900 shadow-xl overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 px-5 py-4 z-10">
          <div className="flex items-center justify-between mb-2">
            <span
              className="text-xs font-medium px-2 py-0.5 rounded-full"
              style={stageBadgeStyle}
            >
              {currentStageName}
            </span>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:text-gray-400 dark:hover:text-gray-200 text-xl leading-none">&times;</button>
          </div>

          {editing ? (
            <div className="space-y-2">
              <input
                className="w-full px-2 py-1 text-lg font-bold border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={editForm.title}
                onChange={e => setEditForm({ ...editForm, title: e.target.value })}
              />
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="text-xs text-gray-500 dark:text-gray-400">Valor</label>
                  <input
                    type="number"
                    className="w-full px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    value={editForm.value}
                    onChange={e => setEditForm({ ...editForm, value: e.target.value })}
                  />
                </div>
                <div className="flex-1">
                  <label className="text-xs text-gray-500 dark:text-gray-400">Prioridad</label>
                  <select
                    className="w-full px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    value={editForm.priority}
                    onChange={e => setEditForm({ ...editForm, priority: e.target.value })}
                  >
                    <option value="baja">Baja</option>
                    <option value="normal">Normal</option>
                    <option value="alta">Alta</option>
                    <option value="urgente">Urgente</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-500 dark:text-gray-400">Notas</label>
                <textarea
                  className="w-full px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
                  rows={2}
                  value={editForm.notes}
                  onChange={e => setEditForm({ ...editForm, notes: e.target.value })}
                />
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={handleSaveEdit} loading={saving}>Guardar</Button>
                <Button size="sm" variant="secondary" onClick={() => setEditing(false)}>Cancelar</Button>
              </div>
            </div>
          ) : (
            <>
              <h2 className="text-lg font-bold text-gray-900 dark:text-white">{deal.title}</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {deal.enterprise_name || deal.customer_name || 'Sin empresa'}
                {deal.enterprise_cuit && ` (${deal.enterprise_cuit})`}
              </p>
            </>
          )}
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-5">
          {/* Info grid */}
          {!editing && (
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <span className="text-xs text-gray-500 dark:text-gray-400 block">Valor</span>
                <span className="font-semibold text-gray-900 dark:text-white">{formatCurrency(Number(deal.value))}</span>
              </div>
              <div>
                <span className="text-xs text-gray-500 dark:text-gray-400 block">Prioridad</span>
                <span className="font-medium text-gray-700 dark:text-gray-300">{PRIORITY_LABELS[deal.priority] || deal.priority}</span>
              </div>
              <div>
                <span className="text-xs text-gray-500 dark:text-gray-400 block">Dias en etapa</span>
                <span className="font-medium text-gray-700 dark:text-gray-300">{deal.days_in_stage || 0} dias</span>
              </div>
              <div>
                <span className="text-xs text-gray-500 dark:text-gray-400 block">Creado</span>
                <span className="font-medium text-gray-700 dark:text-gray-300">{formatDate(deal.created_at)}</span>
              </div>
              {deal.expected_close_date && (
                <div className="col-span-2">
                  <span className="text-xs text-gray-500 dark:text-gray-400 block">Cierre esperado</span>
                  <span className="font-medium text-gray-700 dark:text-gray-300">{formatDate(deal.expected_close_date)}</span>
                </div>
              )}
              {deal.notes && (
                <div className="col-span-2">
                  <span className="text-xs text-gray-500 dark:text-gray-400 block">Notas</span>
                  <p className="text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{deal.notes}</p>
                </div>
              )}
              {deal.lost_reason && (
                <div className="col-span-2">
                  <span className="text-xs text-red-500 block">Motivo de perdida</span>
                  <p className="text-red-700 dark:text-red-400">{deal.lost_reason}</p>
                </div>
              )}
            </div>
          )}

          {/* Stage progress (dynamic from stages prop) */}
          {!isLostDeal && activeStages.length > 0 && (
            <div>
              <span className="text-xs text-gray-500 dark:text-gray-400 block mb-2">Pipeline</span>
              <div className="flex gap-0.5">
                {activeStages.map((stage, i) => (
                  <button
                    key={stage.id}
                    onClick={() => handleMoveStage(stage.id || stage.name.toLowerCase())}
                    className={`flex-1 h-2 rounded-sm transition-colors cursor-pointer ${
                      i > currentStageIndex ? 'bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600' : ''
                    }`}
                    style={i <= currentStageIndex ? { backgroundColor: stage.color } : undefined}
                    title={`Mover a ${stage.name}`}
                  />
                ))}
              </div>
              <div className="flex justify-between mt-1">
                {activeStages.map(stage => (
                  <span key={stage.id} className="text-[9px] text-gray-400 dark:text-gray-500">{stage.name.slice(0, 3)}</span>
                ))}
              </div>
            </div>
          )}

          {/* Stage selector dropdown */}
          {!isLostDeal && (
            <div>
              <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1">Mover a etapa</label>
              <select
                className="w-full px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={deal.stage}
                onChange={e => handleMoveStage(e.target.value)}
              >
                {activeStages.map(s => (
                  <option key={s.id} value={s.id || s.name.toLowerCase()}>{s.name}</option>
                ))}
              </select>
            </div>
          )}

          {/* Linked documents */}
          <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
            <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Documentos vinculados</h4>
            {loadingDocs ? (
              <p className="text-xs text-gray-400 text-center py-2">Cargando...</p>
            ) : documents.length === 0 ? (
              <p className="text-xs text-gray-400 dark:text-gray-500 text-center py-3">Sin documentos vinculados</p>
            ) : (
              <div className="space-y-1.5">
                {documents.map(doc => (
                  <button
                    key={`${doc.type}-${doc.id}`}
                    onClick={() => handleDocClick(doc)}
                    className="w-full flex items-center gap-2.5 px-3 py-2 bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-left"
                  >
                    <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${DOC_ICON_COLORS[doc.type] || 'bg-gray-200 text-gray-700 dark:text-gray-300'}`}>
                      {DOC_ICONS[doc.type] || '?'}
                    </span>
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-medium text-gray-900 dark:text-white">
                        {DOC_LABELS[doc.type]} #{doc.number}
                      </span>
                      <span className="text-xs text-gray-500 dark:text-gray-400 ml-2">
                        {formatCurrency(doc.amount)}
                      </span>
                    </div>
                    <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex flex-wrap gap-2">
            {!isLostDeal && (
              <>
                {!editing && (
                  <Button size="xs" variant="outline" onClick={() => setEditing(true)}>Editar</Button>
                )}
                {currentStageIndex >= 0 && currentStageIndex < activeStages.length - 1 && (
                  <Button size="xs" variant="primary" onClick={() => handleMoveStage(activeStages[currentStageIndex + 1].id || activeStages[currentStageIndex + 1].name.toLowerCase())}>
                    Mover a {activeStages[currentStageIndex + 1].name}
                  </Button>
                )}
                <Button size="xs" variant="danger" onClick={() => setShowLostForm(!showLostForm)}>
                  Marcar perdido
                </Button>
              </>
            )}
            {isLostDeal && (
              <Button size="xs" variant="warning" onClick={handleReopen}>
                Reabrir deal
              </Button>
            )}
            <Button size="xs" variant="ghost" onClick={handleDelete} loading={deleting}>
              Eliminar
            </Button>
          </div>

          {/* Lost reason form */}
          {showLostForm && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 space-y-2">
              <p className="text-sm font-medium text-red-700 dark:text-red-400">Motivo de perdida</p>
              <select
                className="w-full px-2 py-1.5 text-sm border border-red-300 dark:border-red-700 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500"
                value={lostReason}
                onChange={e => setLostReason(e.target.value)}
              >
                <option value="">Seleccionar motivo...</option>
                {LOST_REASONS.map(r => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
              <div className="flex gap-2">
                <Button size="sm" variant="danger" onClick={handleMarkLost} loading={closing}>Confirmar</Button>
                <Button size="sm" variant="secondary" onClick={() => setShowLostForm(false)}>Cancelar</Button>
              </div>
            </div>
          )}

          {/* Activity Timeline */}
          <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
            {loadingActivities ? (
              <p className="text-xs text-gray-400 text-center py-4">Cargando actividad...</p>
            ) : (
              <ActivityTimeline
                activities={activities}
                dealId={deal.id}
                enterpriseId={deal.enterprise_id || undefined}
                onActivityCreated={loadActivities}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
