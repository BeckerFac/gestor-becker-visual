import React, { useState, useEffect, useCallback } from 'react'
import { Card, CardContent } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { DateInput } from '@/components/ui/DateInput'
import { SkeletonTable } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/shared/EmptyState'
import { ExportExcelButton } from '@/components/shared/ExportExcel'
import { Pagination } from '@/components/shared/Pagination'
import { ActivityTimeline, type LogEntry } from '@/components/shared/ActivityTimeline'
import { api } from '@/services/api'

const SECRETARIA_SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000'

const MODULE_LABELS: Record<string, string> = {
  orders: 'Pedidos', invoices: 'Facturas', products: 'Productos', quotes: 'Cotizaciones',
  remitos: 'Remitos', purchases: 'Compras', cobros: 'Recibos', pagos: 'Ordenes de Pago',
  cheques: 'Cheques', enterprises: 'Empresas', banks: 'Bancos', users: 'Usuarios',
  inventory: 'Inventario', materials: 'Materiales', crm: 'Oportunidades', billing: 'Billing',
  secretaria: 'SecretarIA', cuenta_corriente: 'Cuenta Corriente', portal: 'Portal', settings: 'Config',
}

const ACTION_LABELS: Record<string, string> = {
  create: 'Crear', update: 'Modificar', delete: 'Eliminar',
  login: 'Login', logout: 'Logout', download: 'Descarga',
}

interface UserOption {
  id: string
  name: string
  email: string
}

export default function ActivityLog() {
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [users, setUsers] = useState<UserOption[]>([])

  // Filters
  const [filterUser, setFilterUser] = useState('')
  const [filterModule, setFilterModule] = useState('')
  const [filterAction, setFilterAction] = useState('')
  const [filterDateFrom, setFilterDateFrom] = useState('')
  const [filterDateTo, setFilterDateTo] = useState('')
  const [filterSearch, setFilterSearch] = useState('')

  const limit = 50

  useEffect(() => {
    api.getUsers()
      .then((data: UserOption[]) => setUsers(data || []))
      .catch(console.error)
  }, [])

  const loadLogs = useCallback(async () => {
    setLoading(true)
    try {
      const params: any = { page, limit }
      if (filterUser) params.userId = filterUser
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
  }, [page, filterUser, filterModule, filterAction, filterDateFrom, filterDateTo, filterSearch])

  useEffect(() => { loadLogs() }, [loadLogs])

  const clearFilters = () => {
    setFilterUser('')
    setFilterModule('')
    setFilterAction('')
    setFilterDateFrom('')
    setFilterDateTo('')
    setFilterSearch('')
    setPage(1)
  }

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
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-7 gap-3">
            <div>
              <label className="text-xs text-gray-500 dark:text-gray-400">Usuario</label>
              <select
                className="w-full px-3 py-2 border rounded-lg text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100"
                value={filterUser}
                onChange={e => { setFilterUser(e.target.value); setPage(1) }}
              >
                <option value="">Todos los usuarios</option>
                <option value={SECRETARIA_SYSTEM_USER_ID}>SecretarIA</option>
                {users.map(u => <option key={u.id} value={u.id}>{u.name || u.email}</option>)}
              </select>
            </div>
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
        <ActivityTimeline logs={logs} />
      )}

      {totalPages > 1 && (
        <Pagination currentPage={page} totalPages={totalPages} totalItems={total} pageSize={limit} onPageChange={setPage} />
      )}
    </div>
  )
}
