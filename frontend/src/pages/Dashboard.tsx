import React, { useState, useEffect, useRef, useCallback } from 'react'
import { Card, CardContent, CardHeader } from '@/components/ui/Card'
import { formatCurrency, formatDate } from '@/lib/utils'
import { useAuthStore } from '@/stores/authStore'
import { api } from '@/services/api'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
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

interface SearchResults {
  enterprises: any[]
  customers: any[]
  orders: any[]
  purchases: any[]
  products: any[]
  invoices: any[]
}

const ORDER_STATUS_MAP: Record<string, { label: string; color: string }> = {
  pending: { label: 'Pendiente', color: 'bg-yellow-100 text-yellow-800' },
  pendiente: { label: 'Pendiente', color: 'bg-yellow-100 text-yellow-800' },
  in_production: { label: 'En producción', color: 'bg-blue-100 text-blue-800' },
  en_produccion: { label: 'En producción', color: 'bg-blue-100 text-blue-800' },
  ready: { label: 'Listo', color: 'bg-purple-100 text-purple-800' },
  terminado: { label: 'Terminado', color: 'bg-green-100 text-green-800' },
  delivered: { label: 'Entregado', color: 'bg-green-100 text-green-800' },
  entregado: { label: 'Entregado', color: 'bg-emerald-100 text-emerald-800' },
  cancelled: { label: 'Cancelado', color: 'bg-red-100 text-red-800' },
  cancelado: { label: 'Cancelado', color: 'bg-red-100 text-red-800' },
}

const INVOICE_STATUS_MAP: Record<string, { label: string; color: string }> = {
  draft: { label: 'Borrador', color: 'bg-gray-100 text-gray-800' },
  pending: { label: 'Pendiente', color: 'bg-yellow-100 text-yellow-800' },
  authorized: { label: 'Autorizada', color: 'bg-green-100 text-green-800' },
  cancelled: { label: 'Anulada', color: 'bg-red-100 text-red-800' },
}

export const Dashboard: React.FC = () => {
  const company = useAuthStore((state) => state.company)
  const navigate = useNavigate()
  const [dashboard, setDashboard] = useState<DashboardData | null>(null)
  const [salesData, setSalesData] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  // Search state
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SearchResults | null>(null)
  const [searchLoading, setSearchLoading] = useState(false)
  const [showResults, setShowResults] = useState(false)
  const searchRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true)
        const [dashRes, salesRes] = await Promise.all([
          api.getDashboard().catch(() => ({
            sales_month: 0, collections_pending: 0,
            cheques_pending_count: 0, cheques_pending_amount: 0,
            orders_unpaid_count: 0, orders_unpaid_amount: 0,
            recent_invoices: [], recent_orders: [],
          })),
          api.getSalesReport(7).catch(() => []),
        ])
        setDashboard(dashRes)
        setSalesData(Array.isArray(salesRes) ? salesRes : [])
      } finally {
        setLoading(false)
      }
    }
    loadData()
  }, [])

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

  const hasResults = searchResults && (
    searchResults.enterprises.length > 0 ||
    searchResults.customers.length > 0 ||
    searchResults.orders.length > 0 ||
    searchResults.purchases.length > 0 ||
    searchResults.products.length > 0 ||
    searchResults.invoices.length > 0
  )

  const formatShortDate = (dateStr: string) => {
    const d = new Date(dateStr)
    return `${d.getDate()}/${d.getMonth() + 1}`
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => (
            <Card key={i}><CardContent className="pt-6"><div className="animate-pulse h-16 bg-gray-200 rounded" /></CardContent></Card>
          ))}
        </div>
      </div>
    )
  }

  const kpis = [
    {
      label: 'Facturado este Mes',
      value: formatCurrency(dashboard?.sales_month || 0),
      color: 'border-blue-200 bg-blue-50',
      textColor: 'text-blue-800',
      labelColor: 'text-blue-600',
      onClick: () => navigate('/invoices'),
    },
    {
      label: 'Por Cobrar',
      value: formatCurrency(dashboard?.collections_pending || 0),
      color: 'border-orange-200 bg-orange-50',
      textColor: 'text-orange-800',
      labelColor: 'text-orange-600',
      onClick: () => navigate('/cobros'),
    },
    {
      label: `Cheques a Cobrar (${dashboard?.cheques_pending_count || 0})`,
      value: formatCurrency(dashboard?.cheques_pending_amount || 0),
      color: 'border-purple-200 bg-purple-50',
      textColor: 'text-purple-800',
      labelColor: 'text-purple-600',
      onClick: () => navigate('/cheques'),
    },
    {
      label: `Pedidos sin Pagar (${dashboard?.orders_unpaid_count || 0})`,
      value: formatCurrency(dashboard?.orders_unpaid_amount || 0),
      color: 'border-red-200 bg-red-50',
      textColor: 'text-red-800',
      labelColor: 'text-red-600',
      onClick: () => navigate('/orders'),
    },
  ]

  return (
    <div className="space-y-6">
      {/* Header with Search */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-gray-600 mt-1">
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
                  {/* Enterprises */}
                  {searchResults!.enterprises.length > 0 && (
                    <div>
                      <p className="px-4 py-1 text-xs font-semibold text-gray-500 uppercase tracking-wider bg-gray-50">Empresas</p>
                      {searchResults!.enterprises.map((e: any) => (
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

                  {/* Orders */}
                  {searchResults!.orders.length > 0 && (
                    <div>
                      <p className="px-4 py-1 text-xs font-semibold text-gray-500 uppercase tracking-wider bg-gray-50">Pedidos</p>
                      {searchResults!.orders.map((o: any) => (
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

                  {/* Purchases */}
                  {searchResults!.purchases.length > 0 && (
                    <div>
                      <p className="px-4 py-1 text-xs font-semibold text-gray-500 uppercase tracking-wider bg-gray-50">Compras</p>
                      {searchResults!.purchases.map((p: any) => (
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

                  {/* Products */}
                  {searchResults!.products.length > 0 && (
                    <div>
                      <p className="px-4 py-1 text-xs font-semibold text-gray-500 uppercase tracking-wider bg-gray-50">Productos</p>
                      {searchResults!.products.map((p: any) => (
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

                  {/* Invoices */}
                  {searchResults!.invoices.length > 0 && (
                    <div>
                      <p className="px-4 py-1 text-xs font-semibold text-gray-500 uppercase tracking-wider bg-gray-50">Facturas</p>
                      {searchResults!.invoices.map((inv: any) => (
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

                  {/* Customers */}
                  {searchResults!.customers.length > 0 && (
                    <div>
                      <p className="px-4 py-1 text-xs font-semibold text-gray-500 uppercase tracking-wider bg-gray-50">Contactos</p>
                      {searchResults!.customers.map((c: any) => (
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

      {/* Sales Chart */}
      <Card>
        <CardHeader><h3 className="text-lg font-semibold">Ventas - Últimos 7 Días</h3></CardHeader>
        <CardContent>
          {salesData.length > 0 ? (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={salesData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis
                  dataKey="date"
                  tickFormatter={formatShortDate}
                  tick={{ fill: '#6b7280', fontSize: 12 }}
                />
                <YAxis
                  tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
                  tick={{ fill: '#6b7280', fontSize: 12 }}
                />
                <Tooltip
                  formatter={(value: any) => [formatCurrency(Number(value)), 'Ventas']}
                  labelFormatter={(label: any) => formatShortDate(String(label))}
                  contentStyle={{ borderRadius: '8px', border: '1px solid #e5e7eb' }}
                />
                <Bar dataKey="total" fill="#3b82f6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-40 text-gray-400">
              <p>No hay datos de ventas para mostrar</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Two tables side by side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Orders */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">Últimos Pedidos</h3>
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
                {dashboard!.recent_orders.map((order: any) => {
                  const s = ORDER_STATUS_MAP[order.status] || { label: order.status, color: 'bg-gray-100 text-gray-800' }
                  return (
                    <div key={order.id} className="flex items-center justify-between py-2 border-b last:border-0">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold text-blue-700 text-sm">
                            #{String(order.order_number || 0).padStart(4, '0')}
                          </span>
                          <span className="text-sm text-gray-700 truncate">{order.customer_name || 'Sin cliente'}</span>
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${s.color}`}>{s.label}</span>
                          {order.payment_status === 'pagado' ? (
                            <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">Pagado</span>
                          ) : (
                            <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">No pagado</span>
                          )}
                        </div>
                      </div>
                      <span className="font-bold text-gray-900 ml-3">{formatCurrency(parseFloat(order.total_amount || '0'))}</span>
                    </div>
                  )
                })}
              </div>
            ) : (
              <p className="text-center py-6 text-gray-400">No hay pedidos aún</p>
            )}
          </CardContent>
        </Card>

        {/* Recent Invoices */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">Últimas Facturas</h3>
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
                {dashboard!.recent_invoices.map((inv: any) => {
                  const s = INVOICE_STATUS_MAP[inv.status] || { label: inv.status, color: 'bg-gray-100 text-gray-800' }
                  return (
                    <div key={inv.id} className="flex items-center justify-between py-2 border-b last:border-0">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-sm">{inv.invoice_type}</span>
                          <span className="text-sm text-gray-500 font-mono">{String(inv.invoice_number).padStart(8, '0')}</span>
                          <span className="text-sm text-gray-700 truncate">{inv.customer_name || '-'}</span>
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${s.color}`}>{s.label}</span>
                          <span className="text-xs text-gray-500">{formatDate(inv.invoice_date)}</span>
                        </div>
                      </div>
                      <span className="font-bold text-gray-900 ml-3">{formatCurrency(parseFloat(inv.total_amount || '0'))}</span>
                    </div>
                  )
                })}
              </div>
            ) : (
              <p className="text-center py-6 text-gray-400">No hay facturas aún</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
