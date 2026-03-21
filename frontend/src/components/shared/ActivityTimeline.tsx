import React, { useState } from 'react'
import { Card, CardContent } from '@/components/ui/Card'

const SECRETARIA_SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000'

const MODULE_LABELS: Record<string, string> = {
  orders: 'Pedidos', invoices: 'Facturas', products: 'Productos', quotes: 'Cotizaciones',
  remitos: 'Remitos', purchases: 'Compras', cobros: 'Cobros', pagos: 'Pagos',
  cheques: 'Cheques', enterprises: 'Empresas', banks: 'Bancos', users: 'Usuarios',
  inventory: 'Inventario', materials: 'Materiales', crm: 'Oportunidades', billing: 'Billing',
  secretaria: 'SecretarIA', cuenta_corriente: 'Cuenta Corriente', portal: 'Portal', settings: 'Config',
}

const MODULE_COLORS: Record<string, string> = {
  orders: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  invoices: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400',
  products: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  cobros: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
  pagos: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400',
  users: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
}

const ACTION_LABELS: Record<string, string> = {
  create: 'Crear', update: 'Modificar', delete: 'Eliminar',
  login: 'Login', logout: 'Logout', download: 'Descarga',
}

const ACTION_COLORS: Record<string, string> = {
  create: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  update: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
  delete: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
  login: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
}

export interface LogEntry {
  id: string
  action: string
  module: string
  entityType: string
  entityId: string | null
  description: string
  descriptionSimple?: string
  changes: Record<string, { old: any; new: any }> | null
  metadata: any
  ipAddress: string | null
  userName: string
  userRole: string
  userId?: string
  companyName?: string
  createdAt: string
}

interface ActivityTimelineProps {
  logs: LogEntry[]
  showCompany?: boolean
}

const formatTime = (dateStr: string) => {
  const d = new Date(dateStr)
  return d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

const formatDate = (dateStr: string) => {
  const d = new Date(dateStr)
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)

  if (d.toDateString() === today.toDateString()) return 'Hoy'
  if (d.toDateString() === yesterday.toDateString()) return 'Ayer'
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

const isSecretarIA = (log: LogEntry): boolean => {
  return log.userId === SECRETARIA_SYSTEM_USER_ID
}

export const ActivityTimeline: React.FC<ActivityTimelineProps> = ({ logs, showCompany = false }) => {
  const [expandedId, setExpandedId] = useState<string | null>(null)

  // Group logs by date
  const grouped: Record<string, LogEntry[]> = {}
  logs.forEach(log => {
    const key = formatDate(log.createdAt)
    if (!grouped[key]) grouped[key] = []
    grouped[key].push(log)
  })

  return (
    <Card>
      <CardContent className="p-0">
        {Object.entries(grouped).map(([dateLabel, entries]) => (
          <div key={dateLabel}>
            <div className="px-4 py-2 bg-gray-50 dark:bg-gray-800 border-b dark:border-gray-700">
              <span className="text-sm font-semibold text-gray-600 dark:text-gray-300">{dateLabel}</span>
              <span className="text-xs text-gray-400 ml-2">({entries.length} acciones)</span>
            </div>
            {entries.map(log => {
              const secretaria = isSecretarIA(log)
              const hasRichDescription = log.description && log.descriptionSimple && log.description !== log.descriptionSimple && log.descriptionSimple !== '-'

              return (
                <div key={log.id} className="px-4 py-3 border-b dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                  <div className="flex items-start gap-3 cursor-pointer" onClick={() => setExpandedId(expandedId === log.id ? null : log.id)}>
                    <span className="text-xs text-gray-400 dark:text-gray-500 font-mono whitespace-nowrap mt-0.5">{formatTime(log.createdAt)}</span>

                    {/* Company badge */}
                    {showCompany && log.companyName && (
                      <span className="text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-400">
                        {log.companyName}
                      </span>
                    )}

                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap ${MODULE_COLORS[log.module] || 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300'}`}>
                      {MODULE_LABELS[log.module] || log.module}
                    </span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap ${ACTION_COLORS[log.action] || 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300'}`}>
                      {ACTION_LABELS[log.action] || log.action}
                    </span>
                    <div className="flex-1 min-w-0">
                      {/* User name with SecretarIA differentiation */}
                      {secretaria ? (
                        <span className="inline-flex items-center gap-1">
                          <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-400">
                            SecretarIA
                          </span>
                        </span>
                      ) : (
                        <>
                          <span className="text-sm font-medium text-gray-700 dark:text-gray-200">{log.userName}</span>
                          <span className="text-xs text-gray-400 ml-1">({log.userRole})</span>
                        </>
                      )}

                      {/* Rich description */}
                      {hasRichDescription ? (
                        <>
                          <p className="text-sm font-medium text-gray-700 dark:text-gray-300">{log.description}</p>
                          <p className="text-xs text-gray-400 dark:text-gray-500">{log.descriptionSimple}</p>
                        </>
                      ) : (
                        <p className="text-sm text-gray-600 dark:text-gray-400 truncate">{log.description}</p>
                      )}
                    </div>
                    <span className="text-xs text-gray-400">{expandedId === log.id ? '\u25B2' : '\u25BC'}</span>
                  </div>

                  {expandedId === log.id && (
                    <div className="mt-2 ml-16 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg text-xs space-y-2">
                      {/* SecretarIA AI metadata */}
                      {secretaria && log.metadata && (
                        <div className="space-y-1">
                          <span className="font-semibold text-violet-600 dark:text-violet-400">Detalles IA:</span>
                          {log.metadata.ai_intent && (
                            <div><span className="text-gray-500">Intent:</span> <span className="text-gray-700 dark:text-gray-300">{log.metadata.ai_intent}</span></div>
                          )}
                          {log.metadata.ai_confidence != null && (
                            <div><span className="text-gray-500">Confianza:</span> <span className="text-gray-700 dark:text-gray-300">{(log.metadata.ai_confidence * 100).toFixed(0)}%</span></div>
                          )}
                          {log.metadata.channel && (
                            <div><span className="text-gray-500">Canal:</span> <span className="text-gray-700 dark:text-gray-300">{log.metadata.channel}</span></div>
                          )}
                          {log.metadata.response_summary && (
                            <div>
                              <span className="text-gray-500">Respuesta:</span>
                              <p className="text-gray-700 dark:text-gray-300 mt-0.5 whitespace-pre-wrap">{log.metadata.response_summary}</p>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Changes */}
                      {log.changes && Object.keys(log.changes).length > 0 && (
                        <div>
                          <span className="font-semibold text-gray-600 dark:text-gray-300">Cambios:</span>
                          <div className="mt-1 space-y-1">
                            {Object.entries(log.changes).map(([field, change]) => (
                              <div key={field} className="flex gap-2">
                                <span className="text-gray-500">{field}:</span>
                                <span className="text-red-500 line-through">{String(change.old)}</span>
                                <span className="text-gray-400">{'\u2192'}</span>
                                <span className="text-green-600 dark:text-green-400">{String(change.new)}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      {log.ipAddress && <div><span className="text-gray-500">IP:</span> <span className="text-gray-700 dark:text-gray-300">{log.ipAddress}</span></div>}
                      {log.entityId && <div><span className="text-gray-500">ID:</span> <span className="font-mono text-gray-700 dark:text-gray-300">{log.entityId}</span></div>}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
