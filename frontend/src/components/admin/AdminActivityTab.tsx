import React, { useState, useEffect, useCallback } from 'react'
import { Card, CardContent } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { DateInput } from '@/components/ui/DateInput'
import { SkeletonTable } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/shared/EmptyState'
import { Pagination } from '@/components/shared/Pagination'
import { api } from '@/services/api'
import { ActivityTimeline, type LogEntry } from '@/components/shared/ActivityTimeline'

interface LogStats {
  logsPerCompany: Array<{ company_name: string; company_id: string; total: number }>
  today: number
  thisWeek: number
  thisMonth: number
  activeUsers: Array<{ user_name: string; total: number }>
  topModules: Array<{ module: string; total: number }>
  actionsBreakdown: Array<{ action: string; total: number }>
}

interface CompanyOption {
  id: string
  name: string
}

const MODULE_LABELS: Record<string, string> = {
  orders: 'Pedidos', invoices: 'Facturas', products: 'Productos', quotes: 'Cotizaciones',
  remitos: 'Remitos', purchases: 'Compras', cobros: 'Cobros', pagos: 'Pagos',
  cheques: 'Cheques', enterprises: 'Empresas', banks: 'Bancos', users: 'Usuarios',
  inventory: 'Inventario', materials: 'Materiales', crm: 'Oportunidades', billing: 'Billing',
  secretaria: 'SecretarIA', cuenta_corriente: 'Cuenta Corriente', portal: 'Portal', settings: 'Config',
}

const ACTION_LABELS: Record<string, string> = {
  create: 'Crear', update: 'Modificar', delete: 'Eliminar',
  login: 'Login', logout: 'Logout', download: 'Descarga',
}

export const AdminActivityTab: React.FC = () => {
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState<LogStats | null>(null)
  const [statsLoading, setStatsLoading] = useState(true)
  const [companies, setCompanies] = useState<CompanyOption[]>([])

  // Filters
  const [filterCompany, setFilterCompany] = useState('')
  const [filterModule, setFilterModule] = useState('')
  const [filterAction, setFilterAction] = useState('')
  const [filterDateFrom, setFilterDateFrom] = useState('')
  const [filterDateTo, setFilterDateTo] = useState('')
  const [filterSearch, setFilterSearch] = useState('')

  const limit = 50

  useEffect(() => {
    api.adminGetLogStats()
      .then(setStats)
      .catch(console.error)
      .finally(() => setStatsLoading(false))

    api.adminGetAllCompanies()
      .then((data: { companies: CompanyOption[] }) => setCompanies(data.companies || []))
      .catch(console.error)
  }, [])

  const loadLogs = useCallback(async () => {
    setLoading(true)
    try {
      const params: any = { page, limit }
      if (filterCompany) params.companyId = filterCompany
      if (filterModule) params.module = filterModule
      if (filterAction) params.action = filterAction
      if (filterDateFrom) params.dateFrom = filterDateFrom
      if (filterDateTo) params.dateTo = filterDateTo
      if (filterSearch) params.search = filterSearch
      const data = await api.adminGetLogs(params)
      setLogs(data.items || [])
      setTotal(data.total || 0)
    } catch {
      setLogs([])
      setTotal(0)
    } finally {
      setLoading(false)
    }
  }, [page, filterCompany, filterModule, filterAction, filterDateFrom, filterDateTo, filterSearch])

  useEffect(() => { loadLogs() }, [loadLogs])

  const clearFilters = () => {
    setFilterCompany('')
    setFilterModule('')
    setFilterAction('')
    setFilterDateFrom('')
    setFilterDateTo('')
    setFilterSearch('')
    setPage(1)
  }

  const totalPages = Math.ceil(total / limit)

  const mostActiveCompany = stats?.logsPerCompany?.[0]?.company_name || '-'
  const mostCommonAction = stats?.actionsBreakdown?.[0]?.action || '-'

  return (
    <div className="space-y-6">
      {/* Stats cards */}
      {statsLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 animate-pulse">
              <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-20 mb-2" />
              <div className="h-6 bg-gray-200 dark:bg-gray-700 rounded w-12" />
            </div>
          ))}
        </div>
      ) : stats ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 border-l-4 border-l-blue-500">
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Logs hoy</p>
            <p className="text-lg font-bold">{stats.today}</p>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 border-l-4 border-l-green-500">
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Esta semana</p>
            <p className="text-lg font-bold">{stats.thisWeek}</p>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 border-l-4 border-l-purple-500">
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Empresa mas activa</p>
            <p className="text-lg font-bold truncate" title={mostActiveCompany}>{mostActiveCompany}</p>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 border-l-4 border-l-yellow-500">
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Accion mas comun</p>
            <p className="text-lg font-bold">{ACTION_LABELS[mostCommonAction] || mostCommonAction}</p>
          </div>
        </div>
      ) : null}

      {/* Filters */}
      <Card>
        <CardContent className="pt-4">
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-7 gap-3">
            <div>
              <label className="text-xs text-gray-500 dark:text-gray-400">Empresa</label>
              <select
                className="w-full px-3 py-2 border rounded-lg text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100"
                value={filterCompany}
                onChange={e => { setFilterCompany(e.target.value); setPage(1) }}
              >
                <option value="">Todas las empresas</option>
                {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500 dark:text-gray-400">Modulo</label>
              <select
                className="w-full px-3 py-2 border rounded-lg text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100"
                value={filterModule}
                onChange={e => { setFilterModule(e.target.value); setPage(1) }}
              >
                <option value="">Todos</option>
                {Object.entries(MODULE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500 dark:text-gray-400">Accion</label>
              <select
                className="w-full px-3 py-2 border rounded-lg text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100"
                value={filterAction}
                onChange={e => { setFilterAction(e.target.value); setPage(1) }}
              >
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
              <input
                className="w-full px-3 py-2 border rounded-lg text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100"
                placeholder="Texto libre..."
                value={filterSearch}
                onChange={e => setFilterSearch(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { setPage(1); loadLogs() } }}
              />
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
        <ActivityTimeline logs={logs} showCompany />
      )}

      {totalPages > 1 && (
        <Pagination currentPage={page} totalPages={totalPages} totalItems={total} pageSize={limit} onPageChange={setPage} />
      )}
    </div>
  )
}
