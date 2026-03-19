import React, { useState, useEffect } from 'react'
import { Button } from '@/components/ui/Button'
import { api } from '@/services/api'
import { toast } from '@/hooks/useToast'

export interface CrmStage {
  id: string
  name: string
  color: string
  order: number
  trigger_event: string | null
  is_loss_stage: boolean
  deal_count?: number
}

interface StageConfiguratorProps {
  open: boolean
  onClose: () => void
  onSaved: () => void
}

const PRESET_COLORS = [
  { name: 'Gris', value: '#6B7280' },
  { name: 'Azul', value: '#3B82F6' },
  { name: 'Violeta', value: '#8B5CF6' },
  { name: 'Amarillo', value: '#EAB308' },
  { name: 'Cyan', value: '#06B6D4' },
  { name: 'Verde', value: '#22C55E' },
  { name: 'Rojo', value: '#EF4444' },
  { name: 'Rosa', value: '#EC4899' },
]

const TRIGGER_OPTIONS: { value: string; label: string; lossOnly?: boolean }[] = [
  { value: '', label: '(Sin trigger)' },
  { value: 'quote_created', label: 'Cotizacion creada' },
  { value: 'quote_accepted', label: 'Cotizacion aceptada' },
  { value: 'order_created', label: 'Pedido creado' },
  { value: 'order_in_production', label: 'En produccion' },
  { value: 'order_delivered', label: 'Entregado' },
  { value: 'invoice_authorized', label: 'Factura autorizada' },
  { value: 'payment_received', label: 'Pago recibido' },
  { value: 'quote_rejected', label: 'Cotizacion rechazada', lossOnly: true },
  { value: 'order_cancelled', label: 'Pedido cancelado', lossOnly: true },
]

const DEFAULT_STAGES: Omit<CrmStage, 'id'>[] = [
  { name: 'Contacto', color: '#3B82F6', order: 1, trigger_event: null, is_loss_stage: false },
  { name: 'Cotizacion', color: '#8B5CF6', order: 2, trigger_event: 'quote_created', is_loss_stage: false },
  { name: 'Negociacion', color: '#EAB308', order: 3, trigger_event: 'quote_accepted', is_loss_stage: false },
  { name: 'Pedido', color: '#F97316', order: 4, trigger_event: 'order_created', is_loss_stage: false },
  { name: 'Entregado', color: '#06B6D4', order: 5, trigger_event: 'order_delivered', is_loss_stage: false },
  { name: 'Cobrado', color: '#22C55E', order: 6, trigger_event: 'payment_received', is_loss_stage: false },
  { name: 'Perdido', color: '#EF4444', order: 7, trigger_event: null, is_loss_stage: true },
]

interface EditableStage {
  id?: string
  name: string
  color: string
  order: number
  trigger_event: string
  is_loss_stage: boolean
  deal_count: number
  isNew?: boolean
}

export const StageConfigurator: React.FC<StageConfiguratorProps> = ({
  open,
  onClose,
  onSaved,
}) => {
  const [stages, setStages] = useState<EditableStage[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const loadStages = async () => {
    try {
      setLoading(true)
      const data: CrmStage[] = await api.getCrmStages()
      setStages(data.map(s => ({
        id: s.id,
        name: s.name,
        color: s.color,
        order: s.order,
        trigger_event: s.trigger_event || '',
        is_loss_stage: s.is_loss_stage,
        deal_count: s.deal_count || 0,
      })))
    } catch (err: any) {
      toast.error(err.message || 'Error al cargar etapas')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (open) loadStages()
  }, [open])

  if (!open) return null

  const handleNameChange = (index: number, name: string) => {
    setStages(prev => prev.map((s, i) => i === index ? { ...s, name } : s))
  }

  const handleColorChange = (index: number, color: string) => {
    setStages(prev => prev.map((s, i) => i === index ? { ...s, color } : s))
  }

  const handleTriggerChange = (index: number, trigger_event: string) => {
    setStages(prev => prev.map((s, i) => i === index ? { ...s, trigger_event } : s))
  }

  const handleLossToggle = (index: number) => {
    setStages(prev => prev.map((s, i) => {
      if (i !== index) return s
      const newIsLoss = !s.is_loss_stage
      return {
        ...s,
        is_loss_stage: newIsLoss,
        trigger_event: newIsLoss ? s.trigger_event : (
          TRIGGER_OPTIONS.find(t => t.value === s.trigger_event)?.lossOnly ? '' : s.trigger_event
        ),
      }
    }))
  }

  const handleMoveUp = (index: number) => {
    if (index <= 0) return
    setStages(prev => {
      const updated = [...prev]
      const temp = updated[index - 1]
      updated[index - 1] = { ...updated[index], order: temp.order }
      updated[index] = { ...temp, order: updated[index].order }
      return updated
    })
  }

  const handleMoveDown = (index: number) => {
    if (index >= stages.length - 1) return
    setStages(prev => {
      const updated = [...prev]
      const temp = updated[index + 1]
      updated[index + 1] = { ...updated[index], order: temp.order }
      updated[index] = { ...temp, order: updated[index].order }
      return updated
    })
  }

  const handleAddStage = () => {
    const maxOrder = stages.reduce((max, s) => Math.max(max, s.order), 0)
    setStages(prev => [...prev, {
      name: 'Nueva Etapa',
      color: '#6B7280',
      order: maxOrder + 1,
      trigger_event: '',
      is_loss_stage: false,
      deal_count: 0,
      isNew: true,
    }])
  }

  const handleDeleteStage = (index: number) => {
    const stage = stages[index]
    if (stage.deal_count > 0) return
    setStages(prev => prev.filter((_, i) => i !== index))
  }

  const handleRestoreDefaults = () => {
    if (!confirm('Esto reemplazara todas las etapas con las 7 predeterminadas. Los deals existentes podrian quedar sin etapa. Continuar?')) return
    setStages(DEFAULT_STAGES.map((s, i) => ({
      ...s,
      trigger_event: s.trigger_event || '',
      deal_count: 0,
      isNew: true,
    })))
  }

  const handleSave = async () => {
    // Validate
    const emptyName = stages.find(s => !s.name.trim())
    if (emptyName) {
      toast.error('Todas las etapas deben tener nombre')
      return
    }

    setSaving(true)
    try {
      // Determine which stages to create, update, or delete
      const existingIds = stages.filter(s => s.id).map(s => s.id!)

      // Get current stages from server to find deletions
      const serverStages: CrmStage[] = await api.getCrmStages()
      const toDelete = serverStages.filter(s => !existingIds.includes(s.id))

      // Delete removed stages
      for (const s of toDelete) {
        await api.deleteCrmStage(s.id)
      }

      // Create or update stages
      for (let i = 0; i < stages.length; i++) {
        const stage = stages[i]
        const payload = {
          name: stage.name.trim(),
          color: stage.color,
          order: i + 1,
          trigger_event: stage.trigger_event || null,
          is_loss_stage: stage.is_loss_stage,
        }

        if (stage.id && !stage.isNew) {
          await api.updateCrmStage(stage.id, payload)
        } else {
          await api.createCrmStage(payload)
        }
      }

      toast.success('Etapas guardadas correctamente')
      onSaved()
      onClose()
    } catch (err: any) {
      toast.error(err.message || 'Error al guardar etapas')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div
        className="relative w-full max-w-2xl max-h-[90vh] bg-white dark:bg-gray-900 rounded-xl shadow-2xl overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between flex-shrink-0">
          <div>
            <h2 className="text-lg font-bold text-gray-900 dark:text-white">Configurar Etapas del Pipeline</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">Define las etapas por las que pasan las oportunidades</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-2xl leading-none">&times;</button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loading ? (
            <div className="text-center py-12 text-gray-400">Cargando etapas...</div>
          ) : (
            <div className="space-y-2">
              {stages.map((stage, index) => (
                <div
                  key={stage.id || `new-${index}`}
                  className="flex items-center gap-3 bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-lg px-4 py-3"
                >
                  {/* Order number */}
                  <span className="text-xs font-mono text-gray-400 dark:text-gray-500 w-5 text-center flex-shrink-0">{index + 1}</span>

                  {/* Color picker */}
                  <div className="relative group flex-shrink-0">
                    <div
                      className="w-6 h-6 rounded-full border-2 border-white dark:border-gray-700 shadow-sm cursor-pointer"
                      style={{ backgroundColor: stage.color }}
                    />
                    <div className="absolute left-0 top-8 hidden group-hover:flex bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl p-2 gap-1.5 z-20 flex-wrap w-[136px]">
                      {PRESET_COLORS.map(c => (
                        <button
                          key={c.value}
                          onClick={() => handleColorChange(index, c.value)}
                          className="w-6 h-6 rounded-full border-2 hover:scale-110 transition-transform"
                          style={{
                            backgroundColor: c.value,
                            borderColor: stage.color === c.value ? '#000' : 'transparent',
                          }}
                          title={c.name}
                        />
                      ))}
                    </div>
                  </div>

                  {/* Name */}
                  <input
                    type="text"
                    className="flex-1 min-w-0 px-2 py-1 text-sm font-medium border border-transparent hover:border-gray-300 dark:hover:border-gray-600 focus:border-blue-500 rounded bg-transparent text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                    value={stage.name}
                    onChange={e => handleNameChange(index, e.target.value)}
                  />

                  {/* Loss stage toggle */}
                  <label className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 cursor-pointer flex-shrink-0" title="Etapa de perdida">
                    <input
                      type="checkbox"
                      checked={stage.is_loss_stage}
                      onChange={() => handleLossToggle(index)}
                      className="rounded border-gray-300 dark:border-gray-600"
                    />
                    Perdida
                  </label>

                  {/* Trigger */}
                  <select
                    className="px-2 py-1 text-xs border border-gray-200 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-1 focus:ring-blue-500 max-w-[150px]"
                    value={stage.trigger_event}
                    onChange={e => handleTriggerChange(index, e.target.value)}
                  >
                    {TRIGGER_OPTIONS
                      .filter(t => !t.lossOnly || stage.is_loss_stage)
                      .map(t => (
                        <option key={t.value} value={t.value}>{t.label}</option>
                      ))}
                  </select>

                  {/* Move buttons */}
                  <div className="flex gap-0.5 flex-shrink-0">
                    <button
                      onClick={() => handleMoveUp(index)}
                      disabled={index === 0}
                      className="p-1 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 disabled:opacity-30 disabled:cursor-not-allowed"
                      title="Subir"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" /></svg>
                    </button>
                    <button
                      onClick={() => handleMoveDown(index)}
                      disabled={index === stages.length - 1}
                      className="p-1 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 disabled:opacity-30 disabled:cursor-not-allowed"
                      title="Bajar"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                    </button>
                  </div>

                  {/* Delete */}
                  <div className="flex-shrink-0 relative group/del">
                    <button
                      onClick={() => handleDeleteStage(index)}
                      disabled={stage.deal_count > 0}
                      className="p-1 text-red-400 hover:text-red-600 disabled:opacity-30 disabled:cursor-not-allowed"
                      title={stage.deal_count > 0 ? `No se puede eliminar: ${stage.deal_count} deal(s) activos` : 'Eliminar etapa'}
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                    </button>
                    {stage.deal_count > 0 && (
                      <div className="absolute right-0 top-8 hidden group-hover/del:block bg-gray-900 text-white text-xs rounded px-2 py-1 whitespace-nowrap z-20 shadow-lg">
                        No se puede eliminar: {stage.deal_count} deal(s) activos
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between flex-shrink-0">
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={handleAddStage}>+ Agregar etapa</Button>
            <Button size="sm" variant="ghost" onClick={handleRestoreDefaults}>Restaurar default</Button>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={onClose}>Cancelar</Button>
            <Button size="sm" variant="primary" onClick={handleSave} loading={saving}>Guardar</Button>
          </div>
        </div>
      </div>
    </div>
  )
}
