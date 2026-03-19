import React, { useState, useEffect, useRef, useCallback } from 'react'
import { Card, CardContent, CardHeader } from '@/components/ui/Card'
import { formatCurrency, formatDate } from '@/lib/utils'
import { useAuthStore } from '@/stores/authStore'
import { useCanAny } from '@/components/shared/PermissionGate'
import { api } from '@/services/api'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { SkeletonPage } from '@/components/ui/Skeleton'
import { PeriodSelector } from '@/components/shared/PeriodSelector'
import { useNavigate } from 'react-router-dom'

interface DashboardData {
  sales_month: number
  collections_pending: number
  cheques_pending_count: number
  cheques_pending_amount: number
  orders_unpaid_count: number
  orders_unpaid_amount: number
  recent_invoices: any[]
  recent_orders: any[]
}

interface InsightAction {
  type: string
  severity: 'critical' | 'warning' | 'info'
  title: string
  description: string
  link: string
  value?: string
}

interface InsightsData {
  actions: InsightAction[]
  top_customers: Array<{ name: string; revenue: number; order_count: number }>
}

interface AgingData {
  summary: {
    current: number
    bucket_1_30: number
    bucket_31_60: number
    bucket_61_90: number
    bucket_90_plus: number
    total_overdue: number
  }
  worst_clients: Array<{ enterprise_name: string; total_overdue: number; oldest_days: number }>
  avg_dso: number
}

interface SearchResults {
  enterprises: any[]
  customers: any[]
  orders: any[]
  purchases: any[]
  products: any[]
  invoices: any[]
}

const DISMISSED_KEY = 'gestia_dismissed_dashboard_alerts'

function getDismissed(): string[] {
  try {
    return JSON.parse(localStorage.getItem(DISMISSED_KEY) || '[]')
  } catch {
    return []
  }
}

function dismissAction(type: string) {
  const dismissed = getDismissed()
  if (!dismissed.includes(type)) {
    localStorage.setItem(DISMISSED_KEY, JSON.stringify([...dismissed, type]))
  }
}

function restoreActions() {
  localStorage.removeItem(DISMISSED_KEY)
}


export const Dashboard: React.FC = () => {
  const company = useAuthStore((state) => state.company)
  const navigate = useNavigate()
  const [dashboard, setDashboard] = useState<DashboardData | null>(null)
  const [insights, setInsights] = useState<InsightsData | null>(null)
  const [aging, setAging] = useState<AgingData | null>(null)
  const [dismissed, setDismissed] = useState<string[]>(getDismissed())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [period, setPeriod] = useState('mes')
  const [periodDates, setPeriodDates] = useState<{ from: string; to: string }>({ from: '', to: '' })

  // Search state
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SearchResults | null>(null)
  const [searchLoading, setSearchLoading] = useState(false)

  // Permission hooks - must be called before any conditional return
  const canInvoices = useCanAny('invoices')
  const canCobros = useCanAny('cobros')
  const canCheques = useCanAny('cheques')
  const canOrders = useCanAny('orders')
  const [showResults, setShowResults] = useState(false)
  const searchRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true)
        setError(null)
        const [dashRes, insightsRes, agingRes] = await Promise.all([
          api.getDashboard(periodDates.from || undefined, periodDates.to || undefined).catch((err: any) => {
            setError(`Error cargando dashboard: ${err?.response?.data?.error || err?.message || 'Error desconocido'}`)
            return {
              sales_month: 0, collections_pending: 0,
              cheques_pending_count: 0, cheques_pending_amount: 0,
              orders_unpaid_count: 0, orders_unpaid_amount: 0,
              recent_invoices: [], recent_orders: [],
            }
          }),
          api.getInsights().catch(() => ({ actions: [], top_customers: [] })),
          api.getAgingReport().catch(() => null),
        ])
        setDashboard(dashRes)
        setInsights(insightsRes)
        setAging(agingRes)
      } finally {
        setLoading(false)
      }
    }
    loadData()
  }, [periodDates, period])

  // Close search results on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowResults(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const performSearch = useCallback(async (query: string) => {
    if (query.trim().length < 2) {
      setSearchResults(null)
      setShowResults(false)
      return
    }
    try {
      setSearchLoading(true)
      const results = await api.globalSearch(query)
      setSearchResults(results)
      setShowResults(true)
    } catch {
      setSearchResults(null)
    } finally {
      setSearchLoading(false)
    }
  }, [])

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    setSearchQuery(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => performSearch(value), 300)
  }

  const handleSearchNavigate = (path: string) => {
    setShowResults(false)
    setSearchQuery('')
    navigate(path)
  }

  const handleDismiss = (type: string, e: React.MouseEvent) => {
    e.stopPropagation()
    dismissAction(type)
    setDismissed([...dismissed, type])
  }

  const handleRestoreAll = () => {
    restoreActions()
    setDismissed([])
  }

  const hasResults = searchResults && (
    (searchResults.enterprises?.length || 0) > 0 ||
    (searchResults.customers?.length || 0) > 0 ||
    (searchResults.orders?.length || 0) > 0 ||
    (searchResults.purchases?.length || 0) > 0 ||
    (searchResults.products?.length || 0) > 0 ||
    (searchResults.invoices?.length || 0) > 0
  )

  const periodLabels: Record<string, string> = {
    hoy: 'Hoy',
    semana: 'esta Semana',
    mes: 'este Mes',
    '3meses': 'ultimos 3 Meses',
    anual: 'este Ano',
    todos: 'Total Historico',
  }
  const periodLabel = periodLabels[period] || 'este Mes'

  if (loading) {
    return <SkeletonPage />
  }

  const allKpis = [
    {
      label: `Facturado ${periodLabel}`,
      value: formatCurrency(dashboard?.sales_month || 0),
      color: 'border-blue-200 bg-blue-50',
      textColor: 'text-blue-800',
      labelColor: 'text-blue-600',
      onClick: () => navigate('/invoices'),
      visible: canInvoices,
    },
    {
      label: 'Por Cobrar',
      value: formatCurrency(dashboard?.collections_pending || 0),
      color: 'border-orange-200 bg-orange-50',
      textColor: 'text-orange-800',
      labelColor: 'text-orange-600',
      onClick: () => navigate('/cobros'),
      visible: canCobros,
    },
    {
      label: `Cheques a Cobrar (${dashboard?.cheques_pending_count || 0})`,
      value: formatCurrency(dashboard?.cheques_pending_amount || 0),
      color: 'border-purple-200 bg-purple-50',
      textColor: 'text-purple-800',
      labelColor: 'text-purple-600',
      onClick: () => navigate('/cheques'),
      visible: canCheques,
    },
    {
      label: `Pedidos sin Pagar (${dashboard?.orders_unpaid_count || 0})`,
      value: formatCurrency(dashboard?.orders_unpaid_amount || 0),
      color: 'border-red-200 bg-red-50',
      textColor: 'text-red-800',
      labelColor: 'text-red-600',
      onClick: () => navigate('/orders'),
      visible: canOrders,
    },
  ]
  const kpis = allKpis.filter(k => k.visible)

  // Filter out dismissed actions
  const visibleActions = (insights?.actions || []).filter(a => !dismissed.includes(a.type))
  const hasDismissed = dismissed.length > 0

  return (
    <div className="space-y-6">
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
          {error}<button onClick={() => setError(null)} className="ml-2 font-bold">x</button>
        </div>
      )}
      {/* Header with Search */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Dashboard</h1>
          <p className="text-gray-600 dark:text-gray-400 mt-1">
            {company ? `${company.name} — CUIT: ${company.cuit}` : 'Cargando...'}
          </p>
        </div>

        {/* Global Search */}
        <div ref={searchRef} className="relative w-full max-w-md">
          <input
            type="text"
            placeholder="Buscar empresas, pedidos, productos, facturas..."
            className="w-full px-4 py-2.5 pl-10 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 shadow-sm"
            value={searchQuery}
            onChange={handleSearchChange}
            onFocus={() => { if (searchResults) setShowResults(true) }}
          />
          <svg className="absolute left-3 top-3 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          {searchLoading && (
            <div className="absolute right-3 top-3">
              <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            </div>
          )}

          {/* Search Results Dropdown */}
          {showResults && searchQuery.trim().length >= 2 && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg z-50 max-h-96 overflow-y-auto">
              {!hasResults ? (
                <div className="px-4 py-6 text-center text-gray-500 text-sm">
                  No se encontraron resultados para "{searchQuery}"
                </div>
              ) : (
                <div className="py-2">
                  {(searchResults!.enterprises?.length || 0) > 0 && (
                    <div>
                      <p className="px-4 py-1 text-xs font-semibold text-gray-500 uppercase tracking-wider bg-gray-50">Empresas</p>
                      {(searchResults!.enterprises || []).map((e: any) => (
                        <button key={e.id} className="w-full px-4 py-2 text-left hover:bg-blue-50 transition-colors flex items-center gap-3" onClick={() => handleSearchNavigate('/empresas')}>
                          <span className="text-lg">🏢</span>
                          <div>
                            <p className="text-sm font-medium text-gray-900">{e.name}</p>
                            {e.cuit && <p className="text-xs text-gray-500 font-mono">{e.cuit}</p>}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                  {(searchResults!.orders?.length || 0) > 0 && (
                    <div>
                      <p className="px-4 py-1 text-xs font-semibold text-gray-500 uppercase tracking-wider bg-gray-50">Pedidos</p>
                      {(searchResults!.orders || []).map((o: any) => (
                        <button key={o.id} className="w-full px-4 py-2 text-left hover:bg-blue-50 transition-colors flex items-center gap-3" onClick={() => handleSearchNavigate('/orders')}>
                          <span className="text-lg">📋</span>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-900">
                              <span className="font-mono text-blue-700">#{String(o.order_number).padStart(4, '0')}</span> {o.title}
                            </p>
                            <p className="text-xs text-gray-500">{o.customer_name || '-'} — {formatCurrency(parseFloat(o.total_amount || '0'))}</p>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                  {(searchResults!.purchases?.length || 0) > 0 && (
                    <div>
                      <p className="px-4 py-1 text-xs font-semibold text-gray-500 uppercase tracking-wider bg-gray-50">Compras</p>
                      {(searchResults!.purchases || []).map((p: any) => (
                        <button key={p.id} className="w-full px-4 py-2 text-left hover:bg-blue-50 transition-colors flex items-center gap-3" onClick={() => handleSearchNavigate('/compras')}>
                          <span className="text-lg">🛒</span>
                          <div>
                            <p className="text-sm font-medium text-gray-900">
                              Compra <span className="font-mono text-orange-700">#{String(p.purchase_number).padStart(4, '0')}</span>
                            </p>
                            <p className="text-xs text-gray-500">{p.enterprise_name || '-'} — {formatCurrency(parseFloat(p.total_amount || '0'))}</p>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                  {(searchResults!.products?.length || 0) > 0 && (
                    <div>
                      <p className="px-4 py-1 text-xs font-semibold text-gray-500 uppercase tracking-wider bg-gray-50">Productos</p>
                      {(searchResults!.products || []).map((p: any) => (
                        <button key={p.id} className="w-full px-4 py-2 text-left hover:bg-blue-50 transition-colors flex items-center gap-3" onClick={() => handleSearchNavigate('/products')}>
                          <span className="text-lg">📦</span>
                          <div>
                            <p className="text-sm font-medium text-gray-900">{p.name}</p>
                            <p className="text-xs text-gray-500">{p.sku ? `SKU: ${p.sku}` : ''} {p.category || ''}</p>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                  {(searchResults!.invoices?.length || 0) > 0 && (
                    <div>
                      <p className="px-4 py-1 text-xs font-semibold text-gray-500 uppercase tracking-wider bg-gray-50">Facturas</p>
                      {(searchResults!.invoices || []).map((inv: any) => (
                        <button key={inv.id} className="w-full px-4 py-2 text-left hover:bg-blue-50 transition-colors flex items-center gap-3" onClick={() => handleSearchNavigate('/invoices')}>
                          <span className="text-lg">🧾</span>
                          <div>
                            <p className="text-sm font-medium text-gray-900">
                              {inv.invoice_type} <span className="font-mono">{String(inv.invoice_number).padStart(8, '0')}</span>
                            </p>
                            <p className="text-xs text-gray-500">{inv.customer_name || '-'} — {formatCurrency(parseFloat(inv.total_amount || '0'))}</p>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                  {(searchResults!.customers?.length || 0) > 0 && (
                    <div>
                      <p className="px-4 py-1 text-xs font-semibold text-gray-500 uppercase tracking-wider bg-gray-50">Contactos</p>
                      {(searchResults!.customers || []).map((c: any) => (
                        <button key={c.id} className="w-full px-4 py-2 text-left hover:bg-blue-50 transition-colors flex items-center gap-3" onClick={() => handleSearchNavigate('/empresas')}>
                          <span className="text-lg">👤</span>
                          <div>
                            <p className="text-sm font-medium text-gray-900">{c.name}</p>
                            <p className="text-xs text-gray-500">{c.email || ''} {c.cuit || ''}</p>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Period Selector */}
      <PeriodSelector selected={period} onChange={p => { setPeriod(p.value); setPeriodDates({ from: p.dateFrom, to: p.dateTo }) }} />

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis.map((kpi, idx) => (
          <Card
            key={idx}
            className={`border ${kpi.color} cursor-pointer hover:shadow-md transition-shadow`}
            onClick={kpi.onClick}
          >
            <CardContent className="pt-5 pb-4">
              <p className={`text-sm font-medium ${kpi.labelColor} truncate`}>{kpi.label}</p>
              <p className={`text-lg md:text-2xl font-bold mt-1 ${kpi.textColor} truncate`}>{kpi.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Aging Summary Bar */}
      {aging && aging.summary.total_overdue > 0 && canCobros && (
        <div
          className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-sm overflow-hidden cursor-pointer hover:shadow-md transition-shadow"
          onClick={() => navigate('/cobros')}
        >
          <div className="px-5 py-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-red-500 to-orange-500 flex items-center justify-center shadow-sm">
                <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div>
                <span className="text-sm font-semibold text-gray-800 dark:text-gray-200">Antiguedad de Saldos</span>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Total vencido: <span className="font-bold text-red-600 dark:text-red-400">{formatCurrency(aging.summary.total_overdue)}</span>
                  {aging.avg_dso > 0 && <span className="ml-3">DSO promedio: <span className="font-bold">{aging.avg_dso} dias</span></span>}
                </p>
              </div>
            </div>
            {aging.worst_clients.length > 0 && (
              <div className="hidden md:block text-right">
                <p className="text-xs text-gray-500 dark:text-gray-400">Mayor deudor</p>
                <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">
                  {aging.worst_clients[0].enterprise_name}
                  <span className="ml-1 text-red-600 dark:text-red-400">{formatCurrency(aging.worst_clients[0].total_overdue)}</span>
                  <span className="ml-1 text-xs text-gray-400">({aging.worst_clients[0].oldest_days}d)</span>
                </p>
              </div>
            )}
          </div>
          {/* Stacked bar */}
          <div className="px-5 pb-3">
            <div className="flex w-full h-4 rounded-full overflow-hidden bg-gray-100 dark:bg-gray-800">
              {(() => {
                const s = aging.summary
                const total = s.current + s.bucket_1_30 + s.bucket_31_60 + s.bucket_61_90 + s.bucket_90_plus
                if (total === 0) return null
                const segments = [
                  { value: s.current, color: 'bg-[#22C55E]', label: 'Al dia' },
                  { value: s.bucket_1_30, color: 'bg-[#EAB308]', label: '1-30d' },
                  { value: s.bucket_31_60, color: 'bg-[#F97316]', label: '31-60d' },
                  { value: s.bucket_61_90, color: 'bg-[#EF4444]', label: '61-90d' },
                  { value: s.bucket_90_plus, color: 'bg-[#991B1B]', label: '90+d' },
                ]
                return segments.map((seg, i) => {
                  const pct = (seg.value / total) * 100
                  if (pct < 0.5) return null
                  return (
                    <div
                      key={i}
                      className={`${seg.color} transition-all duration-500`}
                      style={{ width: `${pct}%` }}
                      title={`${seg.label}: ${formatCurrency(seg.value)} (${pct.toFixed(0)}%)`}
                    />
                  )
                })
              })()}
            </div>
            <div className="flex items-center gap-4 mt-2 flex-wrap">
              {[
                { label: 'Al dia', value: aging.summary.current, color: 'bg-[#22C55E]' },
                { label: '1-30d', value: aging.summary.bucket_1_30, color: 'bg-[#EAB308]' },
                { label: '31-60d', value: aging.summary.bucket_31_60, color: 'bg-[#F97316]' },
                { label: '61-90d', value: aging.summary.bucket_61_90, color: 'bg-[#EF4444]' },
                { label: '90+d', value: aging.summary.bucket_90_plus, color: 'bg-[#991B1B]' },
              ].filter(b => b.value > 0).map((b, i) => (
                <div key={i} className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-400">
                  <div className={`w-2.5 h-2.5 rounded-full ${b.color}`} />
                  <span>{b.label}:</span>
                  <span className="font-semibold text-gray-800 dark:text-gray-200">{formatCurrency(b.value)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Zero overdue celebration */}
      {aging && aging.summary.total_overdue === 0 && canCobros && (aging.summary.current > 0 || aging.avg_dso > 0) && (
        <div className="rounded-xl border border-green-200 dark:border-green-900 bg-gradient-to-r from-green-50 to-emerald-50 dark:from-green-950/30 dark:to-emerald-950/30 px-5 py-3">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-green-500 flex items-center justify-center shadow-sm">
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-semibold text-green-800 dark:text-green-200">Todo al dia</p>
              <p className="text-xs text-green-600 dark:text-green-400">No hay facturas vencidas pendientes de cobro</p>
            </div>
          </div>
        </div>
      )}

      {/* Action Items - show if there are actions (visible or dismissed) */}
      {(insights?.actions || []).length > 0 && (
        <div className="rounded-xl bg-gradient-to-r from-indigo-50 via-white to-purple-50 dark:from-indigo-950/30 dark:via-gray-900 dark:to-purple-950/30 border border-indigo-100 dark:border-indigo-900/50 shadow-sm overflow-hidden">
          <div className="px-5 py-3 flex items-center justify-between border-b border-indigo-100/60 dark:border-indigo-900/30">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-sm">
                <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
                </svg>
              </div>
              <span className="text-sm font-semibold text-gray-800 dark:text-gray-200">Atencion</span>
              {visibleActions.length > 0 && (
                <span className="text-xs font-bold bg-indigo-600 text-white w-5 h-5 rounded-full flex items-center justify-center">
                  {visibleActions.length}
                </span>
              )}
            </div>
          </div>

          {visibleActions.length > 0 ? (
            <div className="divide-y divide-indigo-50 dark:divide-indigo-900/20">
              {visibleActions.map((action) => (
                <div
                  key={action.type}
                  onClick={() => navigate(action.link)}
                  className="group flex items-center gap-4 px-5 py-3.5 hover:bg-indigo-50/50 dark:hover:bg-indigo-950/20 cursor-pointer transition-all"
                >
                  <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ring-4 ${
                    action.severity === 'critical'
                      ? 'bg-red-500 ring-red-100 dark:ring-red-950'
                      : action.severity === 'warning'
                      ? 'bg-amber-500 ring-amber-100 dark:ring-amber-950'
                      : 'bg-blue-500 ring-blue-100 dark:ring-blue-950'
                  }`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 dark:text-gray-200">{action.title}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{action.description}</p>
                  </div>
                  {action.value && (
                    <span className={`text-sm font-bold tabular-nums flex-shrink-0 ${
                      action.severity === 'critical' ? 'text-red-600 dark:text-red-400' :
                      action.severity === 'warning' ? 'text-amber-600 dark:text-amber-400' : 'text-blue-600 dark:text-blue-400'
                    }`}>{action.value}</span>
                  )}
                  <button
                    onClick={(e) => handleDismiss(action.type, e)}
                    className="opacity-0 group-hover:opacity-100 p-1.5 hover:bg-white dark:hover:bg-gray-800 rounded-lg transition-all shadow-none hover:shadow-sm"
                    title="Ocultar"
                  >
                    <svg className="w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                  <svg className="w-4 h-4 text-gray-300 dark:text-gray-600 group-hover:text-indigo-500 group-hover:translate-x-0.5 transition-all flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              ))}
            </div>
          ) : (
            <div className="px-5 py-4 flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-green-500 flex items-center justify-center shadow-sm">
                <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <p className="text-sm font-semibold text-green-700 dark:text-green-300">Todo al dia</p>
            </div>
          )}

          {/* Restore dismissed link at bottom of widget */}
          {hasDismissed && (
            <div className="px-5 py-2 border-t border-indigo-100/60 dark:border-indigo-900/30">
              <button
                onClick={handleRestoreAll}
                className="text-xs text-gray-400 hover:text-indigo-500 transition-colors"
              >
                Mostrar ocultos ({dismissed.length})
              </button>
            </div>
          )}
        </div>
      )}

      {/* Two tables side by side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Orders */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">Ultimos Pedidos</h3>
              <button
                onClick={() => navigate('/orders')}
                className="text-sm text-blue-600 hover:text-blue-800 font-medium"
              >
                Ver todos
              </button>
            </div>
          </CardHeader>
          <CardContent>
            {(dashboard?.recent_orders?.length || 0) > 0 ? (
              <div className="space-y-3">
                {(dashboard!.recent_orders || []).map((order: any) => (
                    <div key={order.id} className="flex items-center justify-between py-2 border-b last:border-0">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold text-blue-700 text-sm">
                            #{String(order.order_number || 0).padStart(4, '0')}
                          </span>
                          <span className="text-sm text-gray-700 truncate">{order.customer_name || 'Sin cliente'}</span>
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          <StatusBadge status={order.status} />
                          <StatusBadge
                            status={order.payment_status === 'pagado' ? 'pagado' : 'no_pagado'}
                            label={order.payment_status === 'pagado' ? 'Pagado' : 'No pagado'}
                            color={order.payment_status === 'pagado' ? 'green' : 'red'}
                          />
                        </div>
                      </div>
                      <span className="font-bold text-gray-900 ml-3">{formatCurrency(parseFloat(order.total_amount || '0'))}</span>
                    </div>
                ))}
              </div>
            ) : (
              <p className="text-center py-6 text-gray-400">No hay pedidos aun</p>
            )}
          </CardContent>
        </Card>

        {/* Recent Invoices */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">Ultimas Facturas</h3>
              <button
                onClick={() => navigate('/invoices')}
                className="text-sm text-blue-600 hover:text-blue-800 font-medium"
              >
                Ver todas
              </button>
            </div>
          </CardHeader>
          <CardContent>
            {(dashboard?.recent_invoices?.length || 0) > 0 ? (
              <div className="space-y-3">
                {(dashboard!.recent_invoices || []).map((inv: any) => (
                    <div key={inv.id} className="flex items-center justify-between py-2 border-b last:border-0">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-sm">{inv.invoice_type}</span>
                          <span className="text-sm text-gray-500 font-mono">{String(inv.invoice_number).padStart(8, '0')}</span>
                          <span className="text-sm text-gray-700 truncate">{inv.customer_name || '-'}</span>
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          <StatusBadge status={inv.status} />
                          <span className="text-xs text-gray-500">{formatDate(inv.invoice_date)}</span>
                        </div>
                      </div>
                      <span className="font-bold text-gray-900 ml-3">{formatCurrency(parseFloat(inv.total_amount || '0'))}</span>
                    </div>
                ))}
              </div>
            ) : (
              <p className="text-center py-6 text-gray-400">No hay facturas aun</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
