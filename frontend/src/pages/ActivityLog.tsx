import React, { useState, useEffect, useCallback } from 'react'
import { Card, CardContent } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { DateInput } from '@/components/ui/DateInput'
import { SkeletonTable } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/shared/EmptyState'
import { ExportExcelButton } from '@/components/shared/ExportExcel'
import { Pagination } from '@/components/shared/Pagination'
import { api } from '@/services/api'

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

interface LogEntry {
  id: string
  action: string
  module: string
  entityType: string
  entityId: string | null
  description: string
  changes: Record<string, { old: any; new: any }> | null
  metadata: any
  ipAddress: string | null
  userName: string
  userRole: string
  createdAt: string
}

export default function ActivityLog() {
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  // Filters
  const [filterModule, setFilterModule] = useState('')
  const [filterAction, setFilterAction] = useState('')
  const [filterDateFrom, setFilterDateFrom] = useState('')
  const [filterDateTo, setFilterDateTo] = useState('')
  const [filterSearch, setFilterSearch] = useState('')

  const limit = 50

  const loadLogs = useCallback(async () => {
    setLoading(true)
    try {
      const params: any = { page, limit }
      if (filterModule) params.module = filterModule
      if (filterAction) params.action = filterAction
      if (filterDateFrom) params.dateFrom = filterDateFrom
      if (filterDateTo) params.dateTo = filterDateTo
      if (filterSearch) params.search = filterSearch
      const data = await api.getActivityLogs(params)
      setLogs(data.items || [])
      setTotal(data.total || 0)
    } catch {
      setLogs([])
      setTotal(0)
    } finally {
      setLoading(false)
    }
  }, [page, filterModule, filterAction, filterDateFrom, filterDateTo, filterSearch])

  useEffect(() => { loadLogs() }, [loadLogs])

  const clearFilters = () => {
    setFilterModule('')
    setFilterAction('')
    setFilterDateFrom('')
    setFilterDateTo('')
    setFilterSearch('')
    setPage(1)
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

  // Group logs by date
  const grouped: Record<string, LogEntry[]> = {}
  logs.forEach(log => {
    const key = formatDate(log.createdAt)
    if (!grouped[key]) grouped[key] = []
    grouped[key].push(log)
  })

  const totalPages = Math.ceil(total / limit)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Registro de Actividad</h1>
          <p className="text-gray-500 dark:text-gray-400">Historial de acciones de todos los usuarios</p>
        </div>
        <ExportExcelButton
          data={logs.map(l => ({
            fecha: new Date(l.createdAt).toLocaleString('es-AR'),
            usuario: l.userName,
            rol: l.userRole,
            accion: ACTION_LABELS[l.action] || l.action,
            modulo: MODULE_LABELS[l.module] || l.module,
            descripcion: l.description,
            ip: l.ipAddress || '-',
          }))}
          columns={[
            { key: 'fecha', label: 'Fecha' },
            { key: 'usuario', label: 'Usuario' },
            { key: 'rol', label: 'Rol' },
            { key: 'accion', label: 'Accion' },
            { key: 'modulo', label: 'Modulo' },
            { key: 'descripcion', label: 'Descripcion' },
            { key: 'ip', label: 'IP' },
          ]}
          filename="actividad"
        />
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-4">
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <div>
              <label className="text-xs text-gray-500 dark:text-gray-400">Modulo</label>
              <select className="w-full px-3 py-2 border rounded-lg text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100" value={filterModule} onChange={e => { setFilterModule(e.target.value); setPage(1) }}>
                <option value="">Todos</option>
                {Object.entries(MODULE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500 dark:text-gray-400">Accion</label>
              <select className="w-full px-3 py-2 border rounded-lg text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100" value={filterAction} onChange={e => { setFilterAction(e.target.value); setPage(1) }}>
                <option value="">Todas</option>
                {Object.entries(ACTION_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500 dark:text-gray-400">Desde</label>
              <DateInput value={filterDateFrom} onChange={v => { setFilterDateFrom(v); setPage(1) }} />
            </div>
            <div>
              <label className="text-xs text-gray-500 dark:text-gray-400">Hasta</label>
              <DateInput value={filterDateTo} onChange={v => { setFilterDateTo(v); setPage(1) }} />
            </div>
            <div>
              <label className="text-xs text-gray-500 dark:text-gray-400">Buscar</label>
              <input className="w-full px-3 py-2 border rounded-lg text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100" placeholder="Texto libre..." value={filterSearch} onChange={e => setFilterSearch(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { setPage(1); loadLogs() } }} />
            </div>
            <div className="flex items-end">
              <Button variant="secondary" size="sm" onClick={clearFilters}>Limpiar</Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Logs */}
      {loading ? (
        <SkeletonTable rows={10} cols={4} />
      ) : logs.length === 0 ? (
        <EmptyState title="Sin actividad registrada" description="No hay registros de actividad para los filtros seleccionados." />
      ) : (
        <Card>
          <CardContent className="p-0">
            {Object.entries(grouped).map(([dateLabel, entries]) => (
              <div key={dateLabel}>
                <div className="px-4 py-2 bg-gray-50 dark:bg-gray-800 border-b dark:border-gray-700">
                  <span className="text-sm font-semibold text-gray-600 dark:text-gray-300">{dateLabel}</span>
                  <span className="text-xs text-gray-400 ml-2">({entries.length} acciones)</span>
                </div>
                {entries.map(log => (
                  <div key={log.id} className="px-4 py-3 border-b dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                    <div className="flex items-start gap-3 cursor-pointer" onClick={() => setExpandedId(expandedId === log.id ? null : log.id)}>
                      <span className="text-xs text-gray-400 dark:text-gray-500 font-mono whitespace-nowrap mt-0.5">{formatTime(log.createdAt)}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap ${MODULE_COLORS[log.module] || 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300'}`}>
                        {MODULE_LABELS[log.module] || log.module}
                      </span>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap ${ACTION_COLORS[log.action] || 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300'}`}>
                        {ACTION_LABELS[log.action] || log.action}
                      </span>
                      <div className="flex-1 min-w-0">
                        <span className="text-sm font-medium text-gray-700 dark:text-gray-200">{log.userName}</span>
                        <span className="text-xs text-gray-400 ml-1">({log.userRole})</span>
                        <p className="text-sm text-gray-600 dark:text-gray-400 truncate">{log.description}</p>
                      </div>
                      <span className="text-xs text-gray-400">{expandedId === log.id ? '▲' : '▼'}</span>
                    </div>

                    {expandedId === log.id && (
                      <div className="mt-2 ml-16 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg text-xs space-y-2">
                        {log.changes && Object.keys(log.changes).length > 0 && (
                          <div>
                            <span className="font-semibold text-gray-600 dark:text-gray-300">Cambios:</span>
                            <div className="mt-1 space-y-1">
                              {Object.entries(log.changes).map(([field, change]) => (
                                <div key={field} className="flex gap-2">
                                  <span className="text-gray-500">{field}:</span>
                                  <span className="text-red-500 line-through">{String(change.old)}</span>
                                  <span className="text-gray-400">→</span>
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
                ))}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {totalPages > 1 && (
        <Pagination currentPage={page} totalPages={totalPages} totalItems={total} pageSize={limit} onPageChange={setPage} />
      )}
    </div>
  )
}
