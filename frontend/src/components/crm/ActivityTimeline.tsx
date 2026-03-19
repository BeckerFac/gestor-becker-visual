import React, { useState } from 'react'
import { formatDateTime } from '@/lib/utils'
import { Button } from '@/components/ui/Button'
import { api } from '@/services/api'
import { toast } from '@/hooks/useToast'

interface Activity {
  id: string
  deal_id: string | null
  enterprise_id: string | null
  activity_type: string
  description: string | null
  is_auto: boolean
  created_by: string | null
  created_by_name: string | null
  created_at: string
  deal_title: string | null
}

interface ActivityTimelineProps {
  activities: Activity[]
  dealId?: string
  enterpriseId?: string
  companyId?: string
  onActivityCreated?: () => void
}

const ACTIVITY_ICONS: Record<string, { icon: string; color: string }> = {
  note: { icon: 'N', color: 'bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-300' },
  call: { icon: 'T', color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300' },
  email: { icon: '@', color: 'bg-purple-100 text-purple-700 dark:bg-purple-900/50 dark:text-purple-300' },
  whatsapp: { icon: 'W', color: 'bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300' },
  meeting: { icon: 'R', color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300' },
  quote_created: { icon: '$', color: 'bg-purple-100 text-purple-700 dark:bg-purple-900/50 dark:text-purple-300' },
  order_created: { icon: 'P', color: 'bg-orange-100 text-orange-700 dark:bg-orange-900/50 dark:text-orange-300' },
  invoice_sent: { icon: 'F', color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300' },
  payment_received: { icon: '$', color: 'bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300' },
  remito_sent: { icon: 'R', color: 'bg-teal-100 text-teal-700 dark:bg-teal-900/50 dark:text-teal-300' },
  stage_change: { icon: '>', color: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/50 dark:text-indigo-300' },
}

const ACTIVITY_TYPE_LABELS: Record<string, string> = {
  note: 'Nota',
  call: 'Llamada',
  email: 'Email',
  whatsapp: 'WhatsApp',
  meeting: 'Reunion',
  quote_created: 'Cotizacion creada',
  order_created: 'Pedido creado',
  invoice_sent: 'Factura emitida',
  payment_received: 'Pago recibido',
  remito_sent: 'Remito emitido',
  stage_change: 'Cambio de etapa',
}

const MANUAL_TYPES = [
  { value: 'note', label: 'Nota' },
  { value: 'call', label: 'Llamada' },
  { value: 'email', label: 'Email' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'meeting', label: 'Reunion' },
]

export const ActivityTimeline: React.FC<ActivityTimelineProps> = ({
  activities,
  dealId,
  enterpriseId,
  onActivityCreated,
}) => {
  const [showForm, setShowForm] = useState(false)
  const [activityType, setActivityType] = useState('note')
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!description.trim()) return

    setSaving(true)
    try {
      await api.createCrmActivity({
        deal_id: dealId || null,
        enterprise_id: enterpriseId || null,
        activity_type: activityType,
        description: description.trim(),
        is_auto: false,
      })
      setDescription('')
      setShowForm(false)
      toast.success('Actividad registrada')
      onActivityCreated?.()
    } catch (err: any) {
      toast.error(err.message || 'Error al crear actividad')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Actividad</h4>
        <button
          onClick={() => setShowForm(!showForm)}
          className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
        >
          {showForm ? 'Cancelar' : '+ Registrar actividad'}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="bg-gray-50 dark:bg-gray-900/50 rounded-lg p-3 space-y-2">
          <div className="flex gap-2">
            <select
              className="px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={activityType}
              onChange={e => setActivityType(e.target.value)}
            >
              {MANUAL_TYPES.map(t => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
            <input
              type="text"
              className="flex-1 px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Descripcion de la actividad..."
              value={description}
              onChange={e => setDescription(e.target.value)}
              autoFocus
            />
            <Button type="submit" size="sm" loading={saving}>
              Guardar
            </Button>
          </div>
        </form>
      )}

      {activities.length === 0 ? (
        <p className="text-xs text-gray-400 dark:text-gray-500 text-center py-4">Sin actividad registrada</p>
      ) : (
        <div className="space-y-0">
          {activities.map((activity, i) => {
            const config = ACTIVITY_ICONS[activity.activity_type] || ACTIVITY_ICONS.note
            return (
              <div key={activity.id} className="flex gap-3 group">
                {/* Timeline line */}
                <div className="flex flex-col items-center">
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${config.color}`}>
                    {config.icon}
                  </div>
                  {i < activities.length - 1 && (
                    <div className="w-px h-full bg-gray-200 dark:bg-gray-700 min-h-[16px]" />
                  )}
                </div>

                {/* Content */}
                <div className="pb-3 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-xs font-medium text-gray-600 dark:text-gray-400">
                      {ACTIVITY_TYPE_LABELS[activity.activity_type] || activity.activity_type}
                    </span>
                    {activity.is_auto && (
                      <span className="text-[10px] px-1 py-0.5 bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 rounded">auto</span>
                    )}
                    <span className="text-[10px] text-gray-400 dark:text-gray-500">{formatDateTime(activity.created_at)}</span>
                  </div>
                  {activity.description && (
                    <p className="text-sm text-gray-800 dark:text-gray-200">{activity.description}</p>
                  )}
                  {activity.created_by_name && (
                    <span className="text-[10px] text-gray-400 dark:text-gray-500">por {activity.created_by_name}</span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
