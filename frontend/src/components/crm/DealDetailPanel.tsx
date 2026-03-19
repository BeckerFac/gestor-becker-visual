import React, { useState, useEffect } from 'react'
import { Deal } from './DealCard'
import { ActivityTimeline } from './ActivityTimeline'
import { Button } from '@/components/ui/Button'
import { formatCurrency, formatDate } from '@/lib/utils'
import { api } from '@/services/api'
import { toast } from '@/hooks/useToast'

interface DealDetailPanelProps {
  deal: Deal
  onClose: () => void
  onDealUpdated: () => void
}

const STAGE_ORDER = ['contacto', 'cotizacion', 'negociacion', 'pedido', 'entregado', 'cobrado']

const STAGE_LABELS: Record<string, string> = {
  contacto: 'Contacto',
  cotizacion: 'Cotizacion',
  negociacion: 'Negociacion',
  pedido: 'Pedido',
  entregado: 'Entregado',
  cobrado: 'Cobrado',
  perdido: 'Perdido',
}

const STAGE_COLORS: Record<string, string> = {
  contacto: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  cotizacion: 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300',
  negociacion: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  pedido: 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300',
  entregado: 'bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-300',
  cobrado: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
  perdido: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
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
  onClose,
  onDealUpdated,
}) => {
  const [activities, setActivities] = useState<any[]>([])
  const [loadingActivities, setLoadingActivities] = useState(true)
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

  useEffect(() => {
    loadActivities()
  }, [deal.id])

  const handleMoveStage = async (newStage: string) => {
    try {
      await api.moveCrmDealStage(deal.id, newStage)
      toast.success(`Movido a ${STAGE_LABELS[newStage]}`)
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
    try {
      await api.moveCrmDealStage(deal.id, 'contacto')
      toast.success('Deal reabierto en Contacto')
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

  const currentStageIndex = STAGE_ORDER.indexOf(deal.stage)

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
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${STAGE_COLORS[deal.stage]}`}>
              {STAGE_LABELS[deal.stage] || deal.stage}
            </span>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-xl leading-none">&times;</button>
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

          {/* Stage progress */}
          {deal.stage !== 'perdido' && (
            <div>
              <span className="text-xs text-gray-500 dark:text-gray-400 block mb-2">Pipeline</span>
              <div className="flex gap-0.5">
                {STAGE_ORDER.map((stage, i) => (
                  <button
                    key={stage}
                    onClick={() => handleMoveStage(stage)}
                    className={`flex-1 h-2 rounded-sm transition-colors cursor-pointer ${
                      i <= currentStageIndex
                        ? 'bg-blue-500 dark:bg-blue-400'
                        : 'bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600'
                    }`}
                    title={`Mover a ${STAGE_LABELS[stage]}`}
                  />
                ))}
              </div>
              <div className="flex justify-between mt-1">
                {STAGE_ORDER.map(stage => (
                  <span key={stage} className="text-[9px] text-gray-400 dark:text-gray-500">{STAGE_LABELS[stage]?.slice(0, 3)}</span>
                ))}
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex flex-wrap gap-2">
            {deal.stage !== 'perdido' && (
              <>
                {!editing && (
                  <Button size="xs" variant="outline" onClick={() => setEditing(true)}>Editar</Button>
                )}
                {currentStageIndex >= 0 && currentStageIndex < STAGE_ORDER.length - 1 && (
                  <Button size="xs" variant="primary" onClick={() => handleMoveStage(STAGE_ORDER[currentStageIndex + 1])}>
                    Mover a {STAGE_LABELS[STAGE_ORDER[currentStageIndex + 1]]}
                  </Button>
                )}
                <Button size="xs" variant="danger" onClick={() => setShowLostForm(!showLostForm)}>
                  Marcar perdido
                </Button>
              </>
            )}
            {deal.stage === 'perdido' && (
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
