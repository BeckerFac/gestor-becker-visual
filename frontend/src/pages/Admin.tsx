import React, { useEffect, useState, useCallback } from 'react'
import { useAuthStore } from '@/stores/authStore'
import { Navigate } from 'react-router-dom'
import { api } from '@/services/api'
import { formatDate, formatCurrency } from '@/lib/utils'
import { cn } from '@/lib/utils'

// ---- Types ----

interface CompanySummary {
  id: string
  name: string
  cuit: string
  onboarding_completed: boolean
  created_at: string
  updated_at: string
  users_count: number
  last_activity: string | null
  invoices_count_this_month: number
  subscription_status?: string
}

interface CompanyDetail {
  company: Record<string, any>
  users: Array<{
    id: string
    email: string
    name: string
    role: string
    active: boolean
    last_login: string | null
    created_at: string
  }>
  stats: {
    products_count: number
    customers_count: number
    total_invoices: number
    invoices_this_month: number
    total_orders: number
    total_revenue: string
  }
}

interface SystemStats {
  total_companies: number
  active_companies: number
  trial_companies: number
  active_users: number
  total_users: number
  invoices_this_month: number
  revenue_this_month: string
  new_companies_last_week: number
  new_companies_last_month: number
  growth: Array<{ week: string; count: number }>
}

interface SystemHealth {
  database: {
    size_bytes: number
    size_mb: number
    connection_pool: { totalCount: number; idleCount: number; waitingCount: number }
    table_counts: Record<string, number>
  }
  memory: {
    rss_mb: number
    heap_used_mb: number
    heap_total_mb: number
    external_mb: number
  }
  uptime_seconds: number
  uptime_formatted: string
  node_version: string
  timestamp: string
}

type Tab = 'dashboard' | 'companies' | 'system'

// ---- Component ----

export const Admin: React.FC = () => {
  const user = useAuthStore((s) => s.user)
  const [tab, setTab] = useState<Tab>('dashboard')

  if (!user?.is_superadmin) {
    return <Navigate to="/dashboard" replace />
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Panel de Administracion</h1>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-gray-200 dark:border-gray-700">
        {([
          { key: 'dashboard' as Tab, label: 'Dashboard' },
          { key: 'companies' as Tab, label: 'Companies' },
          { key: 'system' as Tab, label: 'Sistema' },
        ]).map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              'px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px',
              tab === t.key
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'dashboard' && <DashboardTab />}
      {tab === 'companies' && <CompaniesTab />}
      {tab === 'system' && <SystemTab />}
    </div>
  )
}

// ---- Dashboard Tab ----

const DashboardTab: React.FC = () => {
  const [stats, setStats] = useState<SystemStats | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.adminGetSystemStats().then(setStats).catch(console.error).finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="text-gray-500">Cargando estadisticas...</div>
  if (!stats) return <div className="text-red-500">Error al cargar estadisticas</div>

  return (
    <div>
      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <StatCard label="Companies totales" value={stats.total_companies} />
        <StatCard label="Companies activas" value={stats.active_companies} color="green" />
        <StatCard label="En trial" value={stats.trial_companies} color="yellow" />
        <StatCard label="Usuarios activos" value={stats.active_users} />
        <StatCard label="Facturas este mes" value={stats.invoices_this_month} />
        <StatCard label="Revenue este mes" value={formatCurrency(stats.revenue_this_month)} />
        <StatCard label="Nuevas (7 dias)" value={stats.new_companies_last_week} color="blue" />
        <StatCard label="Nuevas (30 dias)" value={stats.new_companies_last_month} color="blue" />
      </div>

      {/* Growth Chart (simple bar chart) */}
      {stats.growth.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
          <h3 className="text-sm font-semibold mb-4 text-gray-700 dark:text-gray-300">
            Nuevas companies por semana (ultimas 12 semanas)
          </h3>
          <div className="flex items-end gap-2 h-32">
            {stats.growth.map((g, i) => {
              const max = Math.max(...stats.growth.map((x) => x.count), 1)
              const height = (g.count / max) * 100
              return (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-xs text-gray-500">{g.count}</span>
                  <div
                    className="w-full bg-blue-500 rounded-t"
                    style={{ height: `${Math.max(height, 4)}%` }}
                  />
                  <span className="text-[10px] text-gray-400">
                    {new Date(g.week).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' })}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

// ---- Companies Tab ----

const CompaniesTab: React.FC = () => {
  const [companies, setCompanies] = useState<CompanySummary[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<CompanyDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  const loadCompanies = useCallback(() => {
    setLoading(true)
    api.adminGetAllCompanies()
      .then((data) => setCompanies(data.companies))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { loadCompanies() }, [loadCompanies])

  const handleExpand = async (id: string) => {
    if (expandedId === id) {
      setExpandedId(null)
      setDetail(null)
      return
    }
    setExpandedId(id)
    setDetailLoading(true)
    try {
      const d = await api.adminGetCompanyDetail(id)
      setDetail(d)
    } catch (e) {
      console.error(e)
    } finally {
      setDetailLoading(false)
    }
  }

  const handleDisable = async (id: string) => {
    const reason = prompt('Motivo de deshabilitacion:')
    if (!reason) return
    try {
      await api.adminDisableCompany(id, reason)
      loadCompanies()
    } catch (e: any) {
      alert('Error: ' + e.message)
    }
  }

  const handleEnable = async (id: string) => {
    try {
      await api.adminEnableCompany(id)
      loadCompanies()
    } catch (e: any) {
      alert('Error: ' + e.message)
    }
  }

  const handleImpersonate = async (id: string) => {
    try {
      const result = await api.adminImpersonateCompany(id)
      // Store impersonation data and redirect
      localStorage.setItem('impersonation_token', result.token)
      localStorage.setItem('impersonation_company', JSON.stringify(result.company))
      localStorage.setItem('impersonation_user', JSON.stringify(result.user))

      // Store original auth data to restore later
      const currentToken = localStorage.getItem('accessToken')
      const currentUser = localStorage.getItem('user')
      const currentCompany = localStorage.getItem('company')
      if (currentToken) localStorage.setItem('original_accessToken', currentToken)
      if (currentUser) localStorage.setItem('original_user', currentUser)
      if (currentCompany) localStorage.setItem('original_company', currentCompany)

      // Switch to impersonation
      localStorage.setItem('accessToken', result.token)
      localStorage.setItem('user', JSON.stringify(result.user))
      localStorage.setItem('company', JSON.stringify(result.company))
      localStorage.setItem('is_impersonating', 'true')

      window.location.href = '/dashboard'
    } catch (e: any) {
      alert('Error: ' + e.message)
    }
  }

  const filtered = companies.filter((c) => {
    const q = search.toLowerCase()
    return c.name.toLowerCase().includes(q) || c.cuit.includes(q)
  })

  if (loading) return <div className="text-gray-500">Cargando companies...</div>

  return (
    <div>
      {/* Search */}
      <div className="mb-4">
        <input
          type="text"
          placeholder="Buscar por nombre o CUIT..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full md:w-96 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-sm"
        />
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-700">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-gray-500 dark:text-gray-300">Nombre</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500 dark:text-gray-300">CUIT</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500 dark:text-gray-300 hidden md:table-cell">Estado</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500 dark:text-gray-300 hidden md:table-cell">Usuarios</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500 dark:text-gray-300 hidden lg:table-cell">Creada</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500 dark:text-gray-300 hidden lg:table-cell">Ult. Actividad</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500 dark:text-gray-300 hidden lg:table-cell">Facturas/mes</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500 dark:text-gray-300">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
            {filtered.map((c) => (
              <React.Fragment key={c.id}>
                <tr
                  className="hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer"
                  onClick={() => handleExpand(c.id)}
                >
                  <td className="px-4 py-3 font-medium">{c.name}</td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{c.cuit}</td>
                  <td className="px-4 py-3 hidden md:table-cell">
                    <StatusBadge status={c.subscription_status || (c.onboarding_completed ? 'active' : 'trial')} />
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell">{c.users_count}</td>
                  <td className="px-4 py-3 hidden lg:table-cell text-gray-500">{formatDate(c.created_at)}</td>
                  <td className="px-4 py-3 hidden lg:table-cell text-gray-500">{c.last_activity ? formatDate(c.last_activity) : '-'}</td>
                  <td className="px-4 py-3 hidden lg:table-cell">{c.invoices_count_this_month}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => handleImpersonate(c.id)}
                        className="px-2 py-1 text-xs bg-blue-100 text-blue-700 rounded hover:bg-blue-200 transition-colors"
                        title="Ver como esta company"
                      >
                        Ver como
                      </button>
                      {c.users_count > 0 && (
                        <button
                          onClick={() => handleDisable(c.id)}
                          className="px-2 py-1 text-xs bg-red-100 text-red-700 rounded hover:bg-red-200 transition-colors"
                        >
                          Deshabilitar
                        </button>
                      )}
                      <button
                        onClick={() => handleEnable(c.id)}
                        className="px-2 py-1 text-xs bg-green-100 text-green-700 rounded hover:bg-green-200 transition-colors"
                      >
                        Habilitar
                      </button>
                    </div>
                  </td>
                </tr>

                {/* Expanded detail */}
                {expandedId === c.id && (
                  <tr>
                    <td colSpan={8} className="px-4 py-4 bg-gray-50 dark:bg-gray-750">
                      {detailLoading ? (
                        <div className="text-gray-500">Cargando detalle...</div>
                      ) : detail ? (
                        <CompanyDetailPanel detail={detail} />
                      ) : null}
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div className="px-4 py-8 text-center text-gray-500">
            No se encontraron companies
          </div>
        )}
      </div>
    </div>
  )
}

// ---- Company Detail Panel ----

const CompanyDetailPanel: React.FC<{ detail: CompanyDetail }> = ({ detail }) => {
  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
        <MiniStat label="Productos" value={detail.stats.products_count} />
        <MiniStat label="Clientes" value={detail.stats.customers_count} />
        <MiniStat label="Facturas totales" value={detail.stats.total_invoices} />
        <MiniStat label="Facturas/mes" value={detail.stats.invoices_this_month} />
        <MiniStat label="Pedidos" value={detail.stats.total_orders} />
        <MiniStat label="Revenue total" value={formatCurrency(detail.stats.total_revenue)} />
      </div>

      {/* Users table */}
      <div>
        <h4 className="text-sm font-semibold mb-2">Usuarios ({detail.users.length})</h4>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b dark:border-gray-600">
                <th className="px-2 py-1 text-left">Email</th>
                <th className="px-2 py-1 text-left">Nombre</th>
                <th className="px-2 py-1 text-left">Rol</th>
                <th className="px-2 py-1 text-left">Activo</th>
                <th className="px-2 py-1 text-left">Ultimo login</th>
              </tr>
            </thead>
            <tbody>
              {detail.users.map((u) => (
                <tr key={u.id} className="border-b dark:border-gray-700">
                  <td className="px-2 py-1">{u.email}</td>
                  <td className="px-2 py-1">{u.name}</td>
                  <td className="px-2 py-1">
                    <span className="px-1.5 py-0.5 rounded text-xs bg-gray-200 dark:bg-gray-600">
                      {u.role}
                    </span>
                  </td>
                  <td className="px-2 py-1">{u.active ? 'Si' : 'No'}</td>
                  <td className="px-2 py-1 text-gray-500">{u.last_login ? formatDate(u.last_login) : 'Nunca'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ---- System Tab ----

const SystemTab: React.FC = () => {
  const [health, setHealth] = useState<SystemHealth | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.adminGetSystemHealth().then(setHealth).catch(console.error).finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="text-gray-500">Cargando salud del sistema...</div>
  if (!health) return <div className="text-red-500">Error al cargar salud del sistema</div>

  return (
    <div className="space-y-6">
      {/* Uptime & Node */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Uptime" value={health.uptime_formatted} color="green" />
        <StatCard label="Node.js" value={health.node_version} />
        <StatCard label="DB Size" value={`${health.database.size_mb} MB`} />
        <StatCard label="Sesiones activas" value={health.database.table_counts.active_sessions ?? 0} />
      </div>

      {/* Memory */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
        <h3 className="text-sm font-semibold mb-4 text-gray-700 dark:text-gray-300">Memoria</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <MiniStat label="RSS" value={`${health.memory.rss_mb} MB`} />
          <MiniStat label="Heap usado" value={`${health.memory.heap_used_mb} MB`} />
          <MiniStat label="Heap total" value={`${health.memory.heap_total_mb} MB`} />
          <MiniStat label="External" value={`${health.memory.external_mb} MB`} />
        </div>
      </div>

      {/* DB Connection Pool */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
        <h3 className="text-sm font-semibold mb-4 text-gray-700 dark:text-gray-300">Connection Pool</h3>
        <div className="grid grid-cols-3 gap-4">
          <MiniStat label="Total" value={health.database.connection_pool.totalCount} />
          <MiniStat label="Idle" value={health.database.connection_pool.idleCount} />
          <MiniStat label="Waiting" value={health.database.connection_pool.waitingCount} />
        </div>
      </div>

      {/* Table Counts */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
        <h3 className="text-sm font-semibold mb-4 text-gray-700 dark:text-gray-300">Registros por tabla</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {Object.entries(health.database.table_counts).map(([table, count]) => (
            <MiniStat key={table} label={table} value={count} />
          ))}
        </div>
      </div>
    </div>
  )
}

// ---- Shared components ----

const StatCard: React.FC<{ label: string; value: string | number; color?: string }> = ({ label, value, color }) => {
  const colorClasses: Record<string, string> = {
    green: 'border-l-green-500',
    yellow: 'border-l-yellow-500',
    blue: 'border-l-blue-500',
    red: 'border-l-red-500',
  }
  return (
    <div className={cn(
      'bg-white dark:bg-gray-800 rounded-lg shadow p-4 border-l-4',
      colorClasses[color || ''] || 'border-l-gray-300 dark:border-l-gray-600'
    )}>
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">{label}</p>
      <p className="text-lg font-bold">{value}</p>
    </div>
  )
}

const MiniStat: React.FC<{ label: string; value: string | number }> = ({ label, value }) => (
  <div className="text-center">
    <p className="text-lg font-bold">{value}</p>
    <p className="text-[10px] text-gray-500 uppercase">{label}</p>
  </div>
)

const StatusBadge: React.FC<{ status: string }> = ({ status }) => {
  const styles: Record<string, string> = {
    active: 'bg-green-100 text-green-800',
    trial: 'bg-yellow-100 text-yellow-800',
    expired: 'bg-red-100 text-red-800',
    disabled: 'bg-gray-200 text-gray-600',
    cancelled: 'bg-red-100 text-red-800',
    grace: 'bg-orange-100 text-orange-800',
  }
  return (
    <span className={cn('px-2 py-0.5 rounded text-xs font-medium', styles[status] || 'bg-gray-100 text-gray-600')}>
      {status}
    </span>
  )
}
