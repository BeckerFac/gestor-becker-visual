import React, { useEffect, useState, useCallback } from 'react'
import { useAuthStore } from '@/stores/authStore'
import { Navigate } from 'react-router-dom'
import { api } from '@/services/api'
import { formatDate, formatCurrency } from '@/lib/utils'
import { cn } from '@/lib/utils'
import { AdminActivityTab } from '@/components/admin/AdminActivityTab'

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
  subscription_plan?: string
  blocked?: boolean
  block_reason?: string
  block_reason_category?: string
  blocked_at?: string
  billing_period?: string
  plan_overrides?: Record<string, any>
  trial_extended_days?: number
  sub_plan?: string
  sub_status?: string
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
  subscription: {
    plan: string
    status: string
    trial_ends_at: string | null
    current_period_start: string | null
    current_period_end: string | null
  } | null
  audit_trail: Array<{
    id: string
    action: string
    resource: string
    new_values: any
    old_values: any
    created_at: string
    user_email: string | null
    user_name: string | null
  }>
}

interface SystemStats {
  total_companies: number
  active_companies: number
  trial_companies: number
  blocked_companies: number
  active_users: number
  total_users: number
  invoices_this_month: number
  revenue_this_month: string
  new_companies_last_week: number
  new_companies_last_month: number
  growth: Array<{ week: string; count: number }>
  mrr: number
  churn_rate: number
  conversion_rate: number
  avg_revenue_per_company: number
  plan_distribution: Array<{ plan: string; status: string; count: number }>
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

interface BackupEntry {
  id: string
  date: string
  timestamp: string
  company_id: string
  company_name: string
  size_mb: number
  status: string
}

type Tab = 'dashboard' | 'companies' | 'activity' | 'system'

const BLOCK_CATEGORIES = [
  { value: 'no_pago', label: 'Falta de pago' },
  { value: 'abuso', label: 'Abuso / Uso indebido' },
  { value: 'solicitud_cliente', label: 'Solicitud del cliente' },
  { value: 'otro', label: 'Otro' },
] as const

const PLAN_OPTIONS = [
  { value: 'trial', label: 'Trial' },
  { value: 'estandar_monthly', label: 'Estandar (mensual)' },
  { value: 'estandar_annual', label: 'Estandar (anual)' },
  { value: 'premium_monthly', label: 'Premium (mensual)' },
  { value: 'premium_annual', label: 'Premium (anual)' },
]

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
          { key: 'companies' as Tab, label: 'Empresas' },
          { key: 'activity' as Tab, label: 'Actividad' },
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
      {tab === 'activity' && <AdminActivityTab />}
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
    <div className="space-y-8">
      {/* SaaS KPI Cards - Primary row */}
      <div>
        <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 mb-3 uppercase tracking-wider">
          Metricas SaaS
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label="MRR" value={formatCurrency(stats.mrr)} color="green" />
          <StatCard label="Churn Rate" value={`${stats.churn_rate}%`} color={stats.churn_rate > 5 ? 'red' : 'green'} />
          <StatCard label="Conversion Trial-Pago" value={`${stats.conversion_rate}%`} color="blue" />
          <StatCard label="Revenue promedio/empresa" value={formatCurrency(stats.avg_revenue_per_company)} />
        </div>
      </div>

      {/* Company Stats */}
      <div>
        <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 mb-3 uppercase tracking-wider">
          Empresas y Usuarios
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <StatCard label="Empresas totales" value={stats.total_companies} />
          <StatCard label="Activas" value={stats.active_companies} color="green" />
          <StatCard label="En trial" value={stats.trial_companies} color="yellow" />
          <StatCard label="Bloqueadas" value={stats.blocked_companies} color="red" />
          <StatCard label="Usuarios activos" value={stats.active_users} />
        </div>
      </div>

      {/* Revenue Stats */}
      <div>
        <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 mb-3 uppercase tracking-wider">
          Facturacion y Crecimiento
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label="Facturas este mes" value={stats.invoices_this_month} />
          <StatCard label="Revenue este mes" value={formatCurrency(stats.revenue_this_month)} />
          <StatCard label="Nuevas (7 dias)" value={stats.new_companies_last_week} color="blue" />
          <StatCard label="Nuevas (30 dias)" value={stats.new_companies_last_month} color="blue" />
        </div>
      </div>

      {/* Plan Distribution */}
      {stats.plan_distribution.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
          <h3 className="text-sm font-semibold mb-4 text-gray-700 dark:text-gray-300">
            Distribucion de Planes
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {stats.plan_distribution.map((pd, i) => (
              <div key={i} className="text-center p-3 bg-gray-50 dark:bg-gray-700 rounded">
                <p className="text-lg font-bold">{pd.count}</p>
                <p className="text-xs text-gray-500 capitalize">{pd.plan} ({pd.status})</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Growth Chart */}
      {stats.growth.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
          <h3 className="text-sm font-semibold mb-4 text-gray-700 dark:text-gray-300">
            Nuevas empresas por semana (ultimas 12 semanas)
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
  const [planFilter, setPlanFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [sortBy, setSortBy] = useState('created_at')
  const [sortDir, setSortDir] = useState('desc')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<CompanyDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showBlockModal, setShowBlockModal] = useState<string | null>(null)

  const loadCompanies = useCallback(() => {
    setLoading(true)
    api.adminGetAllCompanies({ search, plan: planFilter, status: statusFilter, sortBy, sortDir })
      .then((data) => setCompanies(data.companies))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [search, planFilter, statusFilter, sortBy, sortDir])

  useEffect(() => {
    const debounce = setTimeout(() => loadCompanies(), 300)
    return () => clearTimeout(debounce)
  }, [loadCompanies])

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

  const handleBlock = async (id: string, category: string, reason: string) => {
    try {
      await api.adminBlockCompany(id, category, reason)
      setShowBlockModal(null)
      loadCompanies()
      // Refresh detail if expanded
      if (expandedId === id) {
        const d = await api.adminGetCompanyDetail(id)
        setDetail(d)
      }
    } catch (e: any) {
      alert('Error: ' + (e.response?.data?.error || e.message))
    }
  }

  const handleUnblock = async (id: string) => {
    if (!confirm('Desbloquear esta empresa? Se reactivaran todos los usuarios.')) return
    try {
      await api.adminUnblockCompany(id)
      loadCompanies()
      if (expandedId === id) {
        const d = await api.adminGetCompanyDetail(id)
        setDetail(d)
      }
    } catch (e: any) {
      alert('Error: ' + (e.response?.data?.error || e.message))
    }
  }

  const handleImpersonate = async (id: string) => {
    try {
      const result = await api.adminImpersonateCompany(id)
      localStorage.setItem('impersonation_token', result.token)
      localStorage.setItem('impersonation_company', JSON.stringify(result.company))
      localStorage.setItem('impersonation_user', JSON.stringify(result.user))

      const currentToken = localStorage.getItem('accessToken')
      const currentUser = localStorage.getItem('user')
      const currentCompany = localStorage.getItem('company')
      if (currentToken) localStorage.setItem('original_accessToken', currentToken)
      if (currentUser) localStorage.setItem('original_user', currentUser)
      if (currentCompany) localStorage.setItem('original_company', currentCompany)

      localStorage.setItem('accessToken', result.token)
      localStorage.setItem('user', JSON.stringify(result.user))
      localStorage.setItem('company', JSON.stringify(result.company))
      localStorage.setItem('is_impersonating', 'true')

      window.location.href = '/dashboard'
    } catch (e: any) {
      alert('Error: ' + (e.response?.data?.error || e.message))
    }
  }

  const handleSort = (column: string) => {
    if (sortBy === column) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    } else {
      setSortBy(column)
      setSortDir('desc')
    }
  }

  if (loading && companies.length === 0) return <div className="text-gray-500">Cargando empresas...</div>

  return (
    <div>
      {/* Toolbar */}
      <div className="flex flex-wrap gap-3 mb-4 items-end">
        <div className="flex-1 min-w-[200px]">
          <label className="block text-xs text-gray-500 mb-1">Buscar</label>
          <input
            type="text"
            placeholder="Nombre, CUIT o email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Plan</label>
          <select
            value={planFilter}
            onChange={(e) => setPlanFilter(e.target.value)}
            className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-sm"
          >
            <option value="all">Todos</option>
            <option value="trial">Trial</option>
            <option value="estandar">Estandar</option>
            <option value="premium">Premium</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Estado</label>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-sm"
          >
            <option value="all">Todos</option>
            <option value="active">Activas</option>
            <option value="trial">Trial</option>
            <option value="expired">Expiradas</option>
            <option value="blocked">Bloqueadas</option>
            <option value="cancelled">Canceladas</option>
          </select>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
        >
          + Crear empresa
        </button>
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-700">
            <tr>
              <SortHeader label="Nombre" column="name" current={sortBy} dir={sortDir} onSort={handleSort} />
              <th className="px-4 py-3 text-left font-medium text-gray-500 dark:text-gray-300">CUIT</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500 dark:text-gray-300 hidden md:table-cell">Estado</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500 dark:text-gray-300 hidden md:table-cell">Plan</th>
              <SortHeader label="Usuarios" column="users_count" current={sortBy} dir={sortDir} onSort={handleSort} className="hidden md:table-cell" />
              <SortHeader label="Creada" column="created_at" current={sortBy} dir={sortDir} onSort={handleSort} className="hidden lg:table-cell" />
              <SortHeader label="Ult. Actividad" column="last_activity" current={sortBy} dir={sortDir} onSort={handleSort} className="hidden lg:table-cell" />
              <th className="px-4 py-3 text-left font-medium text-gray-500 dark:text-gray-300 hidden lg:table-cell">Fact/mes</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500 dark:text-gray-300">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
            {companies.map((c) => (
              <React.Fragment key={c.id}>
                <tr
                  className={cn(
                    'hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer',
                    c.blocked && 'bg-red-50 dark:bg-red-900/20'
                  )}
                  onClick={() => handleExpand(c.id)}
                >
                  <td className="px-4 py-3 font-medium">
                    {c.name}
                    {c.blocked && <span className="ml-2 text-xs text-red-600 font-normal">[BLOQUEADA]</span>}
                  </td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{c.cuit}</td>
                  <td className="px-4 py-3 hidden md:table-cell">
                    <CompanyStatusBadge company={c} />
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell">
                    <span className="text-xs">{c.subscription_plan || c.sub_plan || 'trial'}</span>
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell">{c.users_count}</td>
                  <td className="px-4 py-3 hidden lg:table-cell text-gray-500">{formatDate(c.created_at)}</td>
                  <td className="px-4 py-3 hidden lg:table-cell text-gray-500">{c.last_activity ? formatDate(c.last_activity) : '-'}</td>
                  <td className="px-4 py-3 hidden lg:table-cell">{c.invoices_count_this_month}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1 flex-wrap" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => handleImpersonate(c.id)}
                        className="px-2 py-1 text-xs bg-blue-100 text-blue-700 rounded hover:bg-blue-200 transition-colors"
                        title="Ver como esta empresa"
                      >
                        Ver como
                      </button>
                      {c.blocked ? (
                        <button
                          onClick={() => handleUnblock(c.id)}
                          className="px-2 py-1 text-xs bg-green-100 text-green-700 rounded hover:bg-green-200 transition-colors"
                        >
                          Desbloquear
                        </button>
                      ) : (
                        <button
                          onClick={() => setShowBlockModal(c.id)}
                          className="px-2 py-1 text-xs bg-red-100 text-red-700 rounded hover:bg-red-200 transition-colors"
                        >
                          Bloquear
                        </button>
                      )}
                    </div>
                  </td>
                </tr>

                {/* Expanded detail */}
                {expandedId === c.id && (
                  <tr>
                    <td colSpan={9} className="px-4 py-4 bg-gray-50 dark:bg-gray-750">
                      {detailLoading ? (
                        <div className="text-gray-500">Cargando detalle...</div>
                      ) : detail ? (
                        <CompanyDetailPanel
                          detail={detail}
                          companyId={c.id}
                          onRefresh={() => {
                            loadCompanies()
                            handleExpand(c.id)
                            setTimeout(() => handleExpand(c.id), 100)
                          }}
                        />
                      ) : null}
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
        {companies.length === 0 && (
          <div className="px-4 py-8 text-center text-gray-500">
            No se encontraron empresas
          </div>
        )}
      </div>

      {/* Block Modal */}
      {showBlockModal && (
        <BlockModal
          companyId={showBlockModal}
          onClose={() => setShowBlockModal(null)}
          onBlock={handleBlock}
        />
      )}

      {/* Create Company Modal */}
      {showCreateModal && (
        <CreateCompanyModal
          onClose={() => setShowCreateModal(false)}
          onCreated={() => {
            setShowCreateModal(false)
            loadCompanies()
          }}
        />
      )}
    </div>
  )
}

// ---- Block Modal ----

const BlockModal: React.FC<{
  companyId: string
  onClose: () => void
  onBlock: (id: string, category: string, reason: string) => void
}> = ({ companyId, onClose, onBlock }) => {
  const [category, setCategory] = useState('')
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async () => {
    if (!category || !reason.trim()) {
      alert('Selecciona una categoria y escribe un motivo')
      return
    }
    setSubmitting(true)
    await onBlock(companyId, category, reason.trim())
    setSubmitting(false)
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 w-full max-w-md mx-4">
        <h3 className="text-lg font-bold mb-4">Bloquear empresa</h3>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Categoria</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-sm"
            >
              <option value="">Seleccionar motivo...</option>
              {BLOCK_CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Detalle del motivo</label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Descripcion detallada del motivo de bloqueo..."
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-sm resize-none"
            />
          </div>
          <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-3">
            <p className="text-xs text-yellow-800 dark:text-yellow-200">
              La empresa vera: "Tu cuenta fue suspendida. Motivo: [razon]. Contactanos a soporte@gestia.com"
            </p>
          </div>
        </div>
        <div className="flex gap-3 mt-6">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 dark:text-gray-300"
          >
            Cancelar
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting || !category || !reason.trim()}
            className="flex-1 px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
          >
            {submitting ? 'Bloqueando...' : 'Bloquear empresa'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ---- Create Company Modal ----

const CreateCompanyModal: React.FC<{
  onClose: () => void
  onCreated: () => void
}> = ({ onClose, onCreated }) => {
  const [form, setForm] = useState({
    name: '',
    cuit: '',
    adminEmail: '',
    adminName: '',
    plan: 'trial',
    billingPeriod: 'monthly',
  })
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<{ temp_password: string; company: { name: string } } | null>(null)

  const handleSubmit = async () => {
    if (!form.name || !form.cuit || !form.adminEmail || !form.adminName) {
      alert('Todos los campos son requeridos')
      return
    }
    setSubmitting(true)
    try {
      const res = await api.adminCreateCompany(form)
      setResult(res)
    } catch (e: any) {
      alert('Error: ' + (e.response?.data?.error || e.message))
    } finally {
      setSubmitting(false)
    }
  }

  if (result) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 w-full max-w-md mx-4">
          <h3 className="text-lg font-bold mb-4 text-green-600">Empresa creada</h3>
          <div className="space-y-3">
            <p className="text-sm">Empresa: <strong>{result.company.name}</strong></p>
            <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-3">
              <p className="text-sm font-medium text-yellow-800 dark:text-yellow-200">Password temporal:</p>
              <p className="text-lg font-mono font-bold text-yellow-900 dark:text-yellow-100 select-all">{result.temp_password}</p>
              <p className="text-xs text-yellow-700 dark:text-yellow-300 mt-1">Copia este password y enviaelo al cliente. No se puede recuperar despues.</p>
            </div>
          </div>
          <button
            onClick={onCreated}
            className="w-full mt-6 px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            Cerrar
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 w-full max-w-md mx-4">
        <h3 className="text-lg font-bold mb-4">Crear empresa</h3>
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium mb-1">Nombre de la empresa</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-sm"
              placeholder="Ejemplo SRL"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">CUIT</label>
            <input
              type="text"
              value={form.cuit}
              onChange={(e) => setForm({ ...form, cuit: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-sm"
              placeholder="30-12345678-9"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Email del admin</label>
            <input
              type="email"
              value={form.adminEmail}
              onChange={(e) => setForm({ ...form, adminEmail: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-sm"
              placeholder="admin@empresa.com"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Nombre del admin</label>
            <input
              type="text"
              value={form.adminName}
              onChange={(e) => setForm({ ...form, adminName: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-sm"
              placeholder="Juan Perez"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1">Plan</label>
              <select
                value={form.plan}
                onChange={(e) => setForm({ ...form, plan: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-sm"
              >
                {PLAN_OPTIONS.map((p) => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Periodo</label>
              <select
                value={form.billingPeriod}
                onChange={(e) => setForm({ ...form, billingPeriod: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-sm"
              >
                <option value="monthly">Mensual</option>
                <option value="annual">Anual</option>
              </select>
            </div>
          </div>
        </div>
        <div className="flex gap-3 mt-6">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 dark:text-gray-300"
          >
            Cancelar
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="flex-1 px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {submitting ? 'Creando...' : 'Crear empresa'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ---- Company Detail Panel ----

const CompanyDetailPanel: React.FC<{
  detail: CompanyDetail
  companyId: string
  onRefresh: () => void
}> = ({ detail, companyId, onRefresh }) => {
  const [activeDetailTab, setActiveDetailTab] = useState<'stats' | 'users' | 'plan' | 'backups' | 'audit'>('stats')

  return (
    <div className="space-y-4">
      {/* Block info banner */}
      {detail.company.blocked && (
        <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg p-4">
          <p className="text-sm font-medium text-red-800 dark:text-red-200">
            Empresa BLOQUEADA
          </p>
          <p className="text-xs text-red-600 dark:text-red-300 mt-1">
            Categoria: {BLOCK_CATEGORIES.find(c => c.value === detail.company.block_reason_category)?.label || detail.company.block_reason_category}
          </p>
          <p className="text-xs text-red-600 dark:text-red-300">
            Motivo: {detail.company.block_reason}
          </p>
          <p className="text-xs text-red-500 mt-1">
            Bloqueada: {detail.company.blocked_at ? formatDate(detail.company.blocked_at) : 'N/A'}
          </p>
        </div>
      )}

      {/* Detail tabs */}
      <div className="flex gap-1 border-b border-gray-200 dark:border-gray-600">
        {[
          { key: 'stats' as const, label: 'Estadisticas' },
          { key: 'users' as const, label: `Usuarios (${detail.users.length})` },
          { key: 'plan' as const, label: 'Plan / Billing' },
          { key: 'backups' as const, label: 'Backups' },
          { key: 'audit' as const, label: 'Auditoria' },
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => setActiveDetailTab(t.key)}
            className={cn(
              'px-3 py-1.5 text-xs font-medium border-b-2 transition-colors -mb-px',
              activeDetailTab === t.key
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {activeDetailTab === 'stats' && <StatsSubPanel detail={detail} />}
      {activeDetailTab === 'users' && <UsersSubPanel users={detail.users} />}
      {activeDetailTab === 'plan' && (
        <PlanSubPanel
          detail={detail}
          companyId={companyId}
          onRefresh={onRefresh}
        />
      )}
      {activeDetailTab === 'backups' && <BackupsSubPanel companyId={companyId} />}
      {activeDetailTab === 'audit' && <AuditSubPanel trail={detail.audit_trail} />}
    </div>
  )
}

// ---- Sub panels ----

const StatsSubPanel: React.FC<{ detail: CompanyDetail }> = ({ detail }) => (
  <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
    <MiniStat label="Productos" value={detail.stats.products_count} />
    <MiniStat label="Clientes" value={detail.stats.customers_count} />
    <MiniStat label="Facturas totales" value={detail.stats.total_invoices} />
    <MiniStat label="Facturas/mes" value={detail.stats.invoices_this_month} />
    <MiniStat label="Pedidos" value={detail.stats.total_orders} />
    <MiniStat label="Revenue total" value={formatCurrency(detail.stats.total_revenue)} />
  </div>
)

const UsersSubPanel: React.FC<{ users: CompanyDetail['users'] }> = ({ users }) => (
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
        {users.map((u) => (
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
)

const PlanSubPanel: React.FC<{
  detail: CompanyDetail
  companyId: string
  onRefresh: () => void
}> = ({ detail, companyId, onRefresh }) => {
  const [plan, setPlan] = useState(detail.subscription?.plan || detail.company.subscription_plan || 'trial')
  const [billingPeriod, setBillingPeriod] = useState(detail.company.billing_period || 'monthly')
  const [trialDays, setTrialDays] = useState(0)
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    setSaving(true)
    try {
      await api.adminUpdateCompanyPlan(companyId, {
        plan,
        billingPeriod,
        trialExtensionDays: trialDays > 0 ? trialDays : undefined,
      })
      alert('Plan actualizado')
      onRefresh()
    } catch (e: any) {
      alert('Error: ' + (e.response?.data?.error || e.message))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4 max-w-lg">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <p className="text-xs text-gray-500 mb-1">Estado actual</p>
          <StatusBadge status={detail.subscription?.status || detail.company.subscription_status || 'trial'} />
        </div>
        <div>
          <p className="text-xs text-gray-500 mb-1">Plan actual</p>
          <p className="text-sm font-medium">{detail.subscription?.plan || detail.company.subscription_plan || 'trial'}</p>
        </div>
        {detail.subscription?.current_period_end && (
          <div>
            <p className="text-xs text-gray-500 mb-1">Fin de periodo</p>
            <p className="text-sm">{formatDate(detail.subscription.current_period_end)}</p>
          </div>
        )}
        {detail.company.trial_ends_at && (
          <div>
            <p className="text-xs text-gray-500 mb-1">Fin de trial</p>
            <p className="text-sm">{formatDate(detail.company.trial_ends_at)}</p>
          </div>
        )}
      </div>

      <hr className="dark:border-gray-600" />

      <div>
        <label className="block text-xs font-medium mb-1">Cambiar plan</label>
        <select
          value={plan}
          onChange={(e) => setPlan(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-sm"
        >
          {PLAN_OPTIONS.map((p) => (
            <option key={p.value} value={p.value}>{p.label}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-xs font-medium mb-1">Periodo de facturacion</label>
        <select
          value={billingPeriod}
          onChange={(e) => setBillingPeriod(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-sm"
        >
          <option value="monthly">Mensual</option>
          <option value="annual">Anual</option>
        </select>
      </div>

      <div>
        <label className="block text-xs font-medium mb-1">Extender trial (dias)</label>
        <input
          type="number"
          value={trialDays}
          onChange={(e) => setTrialDays(parseInt(e.target.value) || 0)}
          min={0}
          max={365}
          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-sm"
          placeholder="0"
        />
        {detail.company.trial_extended_days > 0 && (
          <p className="text-xs text-gray-500 mt-1">
            Ya se extendieron {detail.company.trial_extended_days} dias anteriormente
          </p>
        )}
      </div>

      <button
        onClick={handleSave}
        disabled={saving}
        className="w-full px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
      >
        {saving ? 'Guardando...' : 'Guardar cambios'}
      </button>
    </div>
  )
}

const BackupsSubPanel: React.FC<{ companyId: string }> = ({ companyId }) => {
  const [backups, setBackups] = useState<BackupEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [restoring, setRestoring] = useState<string | null>(null)

  useEffect(() => {
    api.adminListBackups(companyId)
      .then((data) => setBackups(data.backups))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [companyId])

  const handleRestore = async (backupId: string) => {
    const confirmed = confirm(
      'ATENCION: Restaurar un backup reemplazara los datos actuales de esta empresa. Esta seguro?'
    )
    if (!confirmed) return

    const doubleConfirm = confirm(
      'Esta accion es IRREVERSIBLE. Los datos actuales se perderan. Confirmar restauracion?'
    )
    if (!doubleConfirm) return

    setRestoring(backupId)
    try {
      await api.adminRestoreBackup(companyId, backupId)
      alert('Restauracion iniciada. Puede tomar unos minutos.')
    } catch (e: any) {
      alert('Error: ' + (e.response?.data?.error || e.message))
    } finally {
      setRestoring(null)
    }
  }

  if (loading) return <div className="text-gray-500 text-sm">Cargando backups...</div>

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b dark:border-gray-600">
              <th className="px-2 py-1 text-left">Fecha</th>
              <th className="px-2 py-1 text-left">Estado</th>
              <th className="px-2 py-1 text-left">Tamano</th>
              <th className="px-2 py-1 text-left">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {backups.map((b) => (
              <tr key={b.id} className="border-b dark:border-gray-700">
                <td className="px-2 py-1">{b.date}</td>
                <td className="px-2 py-1">
                  <span className={cn(
                    'px-1.5 py-0.5 rounded text-xs',
                    b.status === 'latest' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'
                  )}>
                    {b.status === 'latest' ? 'Mas reciente' : 'Disponible'}
                  </span>
                </td>
                <td className="px-2 py-1">{b.size_mb} MB</td>
                <td className="px-2 py-1">
                  <button
                    onClick={() => handleRestore(b.id)}
                    disabled={restoring === b.id}
                    className="px-2 py-0.5 text-xs bg-orange-100 text-orange-700 rounded hover:bg-orange-200 disabled:opacity-50"
                  >
                    {restoring === b.id ? 'Restaurando...' : 'Restaurar'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

const AuditSubPanel: React.FC<{
  trail: CompanyDetail['audit_trail']
}> = ({ trail }) => {
  if (trail.length === 0) {
    return <div className="text-sm text-gray-500">No hay registros de auditoria</div>
  }

  return (
    <div className="overflow-x-auto max-h-64 overflow-y-auto">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-gray-50 dark:bg-gray-700">
          <tr className="border-b dark:border-gray-600">
            <th className="px-2 py-1 text-left">Fecha</th>
            <th className="px-2 py-1 text-left">Accion</th>
            <th className="px-2 py-1 text-left">Recurso</th>
            <th className="px-2 py-1 text-left">Usuario</th>
            <th className="px-2 py-1 text-left">Detalles</th>
          </tr>
        </thead>
        <tbody>
          {trail.map((entry) => (
            <tr key={entry.id} className="border-b dark:border-gray-700">
              <td className="px-2 py-1 whitespace-nowrap">{formatDate(entry.created_at)}</td>
              <td className="px-2 py-1">
                <AuditActionBadge action={entry.action} />
              </td>
              <td className="px-2 py-1">{entry.resource}</td>
              <td className="px-2 py-1">{entry.user_email || '-'}</td>
              <td className="px-2 py-1 max-w-xs truncate">
                {entry.new_values ? JSON.stringify(entry.new_values) : '-'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
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

  // Ensure nested objects have defaults to prevent "Cannot read properties of undefined"
  const h = {
    ...health,
    uptime_formatted: health.uptime_formatted || '-',
    node_version: health.node_version || '-',
    memory: health.memory || { rss_mb: 0, heap_used_mb: 0, heap_total_mb: 0, external_mb: 0 },
    database: {
      size_mb: health.database?.size_mb ?? '?',
      connection_pool: health.database?.connection_pool || { totalCount: 0, idleCount: 0, waitingCount: 0 },
      table_counts: health.database?.table_counts || {},
    },
  }

  return (
    <div className="space-y-6">
      {/* Uptime & Node */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Uptime" value={h.uptime_formatted || '-'} color="green" />
        <StatCard label="Node.js" value={h.node_version || '-'} />
        <StatCard label="DB Size" value={`${h.database.size_mb} MB`} />
        <StatCard label="Sesiones activas" value={h.database.table_counts.active_sessions ?? 0} />
      </div>

      {/* Memory */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
        <h3 className="text-sm font-semibold mb-4 text-gray-700 dark:text-gray-300">Memoria</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <MiniStat label="RSS" value={`${h.memory.rss_mb} MB`} />
          <MiniStat label="Heap usado" value={`${h.memory.heap_used_mb} MB`} />
          <MiniStat label="Heap total" value={`${h.memory.heap_total_mb} MB`} />
          <MiniStat label="External" value={`${h.memory.external_mb} MB`} />
        </div>
      </div>

      {/* DB Connection Pool */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
        <h3 className="text-sm font-semibold mb-4 text-gray-700 dark:text-gray-300">Connection Pool</h3>
        <div className="grid grid-cols-3 gap-4">
          <MiniStat label="Total" value={h.database.connection_pool.totalCount} />
          <MiniStat label="Idle" value={h.database.connection_pool.idleCount} />
          <MiniStat label="Waiting" value={h.database.connection_pool.waitingCount} />
        </div>
      </div>

      {/* Table Counts */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
        <h3 className="text-sm font-semibold mb-4 text-gray-700 dark:text-gray-300">Registros por tabla</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {Object.entries(h.database.table_counts).map(([table, count]) => (
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
    blocked: 'bg-red-200 text-red-900',
    past_due: 'bg-orange-100 text-orange-800',
  }
  return (
    <span className={cn('px-2 py-0.5 rounded text-xs font-medium', styles[status] || 'bg-gray-100 text-gray-600')}>
      {status}
    </span>
  )
}

const CompanyStatusBadge: React.FC<{ company: CompanySummary }> = ({ company }) => {
  if (company.blocked) {
    return <StatusBadge status="blocked" />
  }
  const status = company.subscription_status || (company.onboarding_completed ? 'active' : 'trial')
  return <StatusBadge status={status} />
}

const AuditActionBadge: React.FC<{ action: string }> = ({ action }) => {
  const colors: Record<string, string> = {
    company_blocked: 'bg-red-100 text-red-700',
    company_unblocked: 'bg-green-100 text-green-700',
    company_disabled: 'bg-red-100 text-red-700',
    company_enabled: 'bg-green-100 text-green-700',
    plan_updated: 'bg-blue-100 text-blue-700',
    company_created_manual: 'bg-purple-100 text-purple-700',
    backup_restore_initiated: 'bg-orange-100 text-orange-700',
    impersonate: 'bg-yellow-100 text-yellow-700',
  }
  return (
    <span className={cn('px-1.5 py-0.5 rounded text-xs', colors[action] || 'bg-gray-100 text-gray-600')}>
      {action.replace(/_/g, ' ')}
    </span>
  )
}

const SortHeader: React.FC<{
  label: string
  column: string
  current: string
  dir: string
  onSort: (col: string) => void
  className?: string
}> = ({ label, column, current, dir, onSort, className }) => (
  <th
    className={cn('px-4 py-3 text-left font-medium text-gray-500 dark:text-gray-300 cursor-pointer hover:text-gray-700 select-none', className)}
    onClick={() => onSort(column)}
  >
    {label}
    {current === column && (
      <span className="ml-1">{dir === 'asc' ? '\u2191' : '\u2193'}</span>
    )}
  </th>
)
