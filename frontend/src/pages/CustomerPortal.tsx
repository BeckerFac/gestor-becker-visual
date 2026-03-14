import React, { useState, useEffect, useMemo } from 'react'
import { Card, CardContent, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { formatCurrency, formatDate } from '@/lib/utils'
import { api } from '@/services/api'

interface PortalOrder {
  id: string
  order_number: number
  title: string
  product_type: string
  status: string
  quantity: number
  unit_price: string
  total_amount: string
  vat_rate: string
  estimated_delivery: string | null
  actual_delivery: string | null
  has_invoice: boolean
  payment_status: string | null
  payment_method: string | null
  notes: string | null
  invoice?: { id: string; invoice_number: number; invoice_type: string; total_amount: string; status: string } | null
  created_at: string
}

const STATUS_LABELS: Record<string, { label: string; color: string; bg: string; icon: string }> = {
  pendiente: { label: 'Pendiente', color: 'text-yellow-800', bg: 'bg-yellow-100 border-yellow-300', icon: '...' },
  en_produccion: { label: 'En Produccion', color: 'text-blue-800', bg: 'bg-blue-100 border-blue-300', icon: '...' },
  en_pausa: { label: 'En Pausa', color: 'text-gray-700', bg: 'bg-gray-100 border-gray-300', icon: '...' },
  terminado: { label: 'Terminado', color: 'text-green-800', bg: 'bg-green-100 border-green-300', icon: '...' },
  entregado: { label: 'Entregado', color: 'text-emerald-800', bg: 'bg-emerald-100 border-emerald-300', icon: '...' },
  cancelado: { label: 'Cancelado', color: 'text-red-800', bg: 'bg-red-100 border-red-300', icon: '...' },
}

const PAYMENT_STATUS_LABELS: Record<string, { label: string; color: string }> = {
  pendiente: { label: 'Pendiente', color: 'bg-yellow-100 text-yellow-800' },
  parcial: { label: 'Parcial', color: 'bg-orange-100 text-orange-800' },
  pagado: { label: 'Pagado', color: 'bg-green-100 text-green-800' },
}

const INVOICE_STATUS_LABELS: Record<string, { label: string; color: string }> = {
  authorized: { label: 'Autorizada', color: 'bg-green-100 text-green-800' },
  draft: { label: 'Borrador', color: 'bg-yellow-100 text-yellow-800' },
  emitido: { label: 'Emitida', color: 'bg-blue-100 text-blue-800' },
}

const QUOTE_STATUS_LABELS: Record<string, { label: string; color: string }> = {
  draft: { label: 'Borrador', color: 'bg-gray-100 text-gray-800' },
  sent: { label: 'Enviada', color: 'bg-blue-100 text-blue-800' },
  accepted: { label: 'Aceptada', color: 'bg-green-100 text-green-800' },
  rejected: { label: 'Rechazada', color: 'bg-red-100 text-red-800' },
}

const PRODUCT_TYPE_LABELS: Record<string, string> = {
  portabanner: 'Portabanner', bandera: 'Bandera', ploteo: 'Ploteo', carteleria: 'Carteleria',
  vinilo: 'Vinilo', lona: 'Lona', backing: 'Backing', senaletica: 'Senaletica',
  vehicular: 'Vehicular', textil: 'Textil', otro: 'Otro',
}

type PortalTab = 'orders' | 'invoices' | 'quotes' | 'balance'

export const CustomerPortal: React.FC = () => {
  // Auth state
  const [isLoggedIn, setIsLoggedIn] = useState(false)
  const [loginForm, setLoginForm] = useState({ access_code: '' })
  const [loginError, setLoginError] = useState<string | null>(null)
  const [loginLoading, setLoginLoading] = useState(false)

  // Data state
  const [customerName, setCustomerName] = useState('')
  const [companyName, setCompanyName] = useState('')
  const [summary, setSummary] = useState<any>({})
  const [orders, setOrders] = useState<PortalOrder[]>([])
  const [invoices, setInvoices] = useState<any[]>([])
  const [quotes, setQuotes] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [activeTab, setActiveTab] = useState<PortalTab>('orders')
  const [selectedOrder, setSelectedOrder] = useState<any>(null)

  // Check if customer token exists
  useEffect(() => {
    const token = localStorage.getItem('customerAccessToken')
    const name = localStorage.getItem('customerName')
    const company = localStorage.getItem('customerCompanyName')
    if (token) {
      setIsLoggedIn(true)
      setCustomerName(name || '')
      setCompanyName(company || '')
    }
  }, [])

  useEffect(() => {
    if (isLoggedIn) loadData()
  }, [isLoggedIn])

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoginLoading(true)
    setLoginError(null)
    try {
      const data = await api.customerLogin(loginForm.access_code)
      localStorage.setItem('customerAccessToken', data.accessToken)
      localStorage.setItem('customerRefreshToken', data.refreshToken)
      localStorage.setItem('customerName', data.customer.name)
      localStorage.setItem('customerCompanyName', data.company.name)
      setCustomerName(data.customer.name)
      setCompanyName(data.company.name)
      setIsLoggedIn(true)
    } catch (e: any) {
      setLoginError(e.message)
    } finally {
      setLoginLoading(false)
    }
  }

  const handleLogout = () => {
    localStorage.removeItem('customerAccessToken')
    localStorage.removeItem('customerRefreshToken')
    localStorage.removeItem('customerName')
    localStorage.removeItem('customerCompanyName')
    setIsLoggedIn(false)
    setOrders([])
    setInvoices([])
    setQuotes([])
    setSummary({})
  }

  const loadData = async () => {
    try {
      setLoading(true)
      const [summaryRes, ordersRes, invoicesRes, quotesRes] = await Promise.all([
        api.portalGetSummary().catch(() => ({})),
        api.portalGetOrders().catch(() => ({ items: [] })),
        api.portalGetInvoices().catch(() => ({ items: [] })),
        api.portalGetQuotes().catch(() => ({ items: [] })),
      ])
      setSummary(summaryRes)
      setOrders(ordersRes.items || [])
      setInvoices(invoicesRes.items || [])
      setQuotes(quotesRes.items || [])
    } catch (e: any) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  const handleDownloadQuotePdf = async (quoteId: string) => {
    try {
      const blob = await api.portalGetQuotePdf(quoteId)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `cotizacion-${quoteId.slice(0, 8)}.pdf`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (e: any) {
      alert('Error descargando PDF: ' + e.message)
    }
  }

  // Compute customer account balance from orders and invoices
  const accountBalance = useMemo(() => {
    const totalOrdered = orders.reduce((sum, o) => sum + parseFloat(o.total_amount || '0'), 0)
    const totalInvoiced = invoices.reduce((sum, inv) => sum + parseFloat(inv.total_amount || '0'), 0)
    const totalPaid = orders
      .filter(o => o.payment_status === 'pagado')
      .reduce((sum, o) => sum + parseFloat(o.total_amount || '0'), 0)
    const totalPartial = orders
      .filter(o => o.payment_status === 'parcial')
      .reduce((sum, o) => sum + parseFloat(o.total_amount || '0') * 0.5, 0) // estimate
    const pendingOrders = orders.filter(o => !o.payment_status || o.payment_status === 'pendiente').length
    const pendingAmount = orders
      .filter(o => !o.payment_status || o.payment_status === 'pendiente')
      .reduce((sum, o) => sum + parseFloat(o.total_amount || '0'), 0)

    return {
      totalOrdered,
      totalInvoiced,
      totalPaid: totalPaid + totalPartial,
      pendingOrders,
      pendingAmount,
    }
  }, [orders, invoices])

  // === LOGIN SCREEN ===
  if (!isLoggedIn) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-600 rounded-2xl mb-4">
              <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
            </div>
            <h1 className="text-3xl font-bold text-gray-900">Portal de Cliente</h1>
            <p className="text-gray-500 mt-2">Accede a tus pedidos, facturas y cotizaciones</p>
          </div>
          <Card variant="elevated">
            <CardContent className="pt-6 pb-6">
              <form onSubmit={handleLogin} className="space-y-5">
                {loginError && (
                  <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm flex items-center gap-2">
                    <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                    </svg>
                    {loginError}
                  </div>
                )}
                <Input
                  label="Codigo de Acceso"
                  placeholder="Ingresa el codigo que te dio tu proveedor"
                  value={loginForm.access_code}
                  onChange={e => setLoginForm({ ...loginForm, access_code: e.target.value })}
                  required
                />
                <Button type="submit" variant="primary" loading={loginLoading} className="w-full">
                  Ingresar al Portal
                </Button>
              </form>
            </CardContent>
          </Card>
          <p className="text-center text-sm text-gray-400 mt-4">
            Si no tenes un codigo de acceso, pediselo a tu proveedor.
          </p>
        </div>
      </div>
    )
  }

  // === PORTAL DASHBOARD ===
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-gradient-to-r from-blue-600 to-indigo-700 text-white shadow-lg">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold">Portal de Cliente</h1>
              <p className="text-blue-100 text-sm mt-0.5">{companyName}</p>
            </div>
            <div className="flex items-center gap-4">
              <div className="text-right hidden sm:block">
                <p className="text-sm font-medium">{customerName}</p>
                <p className="text-xs text-blue-200">Cliente</p>
              </div>
              <button
                onClick={handleLogout}
                className="px-3 py-1.5 bg-white/15 hover:bg-white/25 backdrop-blur rounded-lg text-sm font-medium transition-colors"
              >
                Salir
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        {/* Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <Card className="border border-blue-200 bg-blue-50">
            <CardContent className="pt-3 pb-3">
              <p className="text-xs text-blue-600 font-medium">Total Pedidos</p>
              <p className="text-2xl font-bold text-blue-800 mt-1">{summary.total_orders || 0}</p>
            </CardContent>
          </Card>
          <Card className="border border-yellow-200 bg-yellow-50">
            <CardContent className="pt-3 pb-3">
              <p className="text-xs text-yellow-600 font-medium">En Proceso</p>
              <p className="text-2xl font-bold text-yellow-800 mt-1">{summary.active_orders || 0}</p>
            </CardContent>
          </Card>
          <Card className="border border-green-200 bg-green-50">
            <CardContent className="pt-3 pb-3">
              <p className="text-xs text-green-600 font-medium">Entregados</p>
              <p className="text-2xl font-bold text-green-800 mt-1">{summary.delivered_orders || 0}</p>
            </CardContent>
          </Card>
          <Card className="border border-indigo-200 bg-indigo-50">
            <CardContent className="pt-3 pb-3">
              <p className="text-xs text-indigo-600 font-medium">Total Comprado</p>
              <p className="text-xl font-bold text-indigo-800 mt-1">{formatCurrency(parseFloat(summary.total_spent || '0'))}</p>
            </CardContent>
          </Card>
          <Card className="border border-purple-200 bg-purple-50">
            <CardContent className="pt-3 pb-3">
              <p className="text-xs text-purple-600 font-medium">Facturas</p>
              <p className="text-2xl font-bold text-purple-800 mt-1">{summary.total_invoices || 0}</p>
            </CardContent>
          </Card>
          <Card className="border border-orange-200 bg-orange-50">
            <CardContent className="pt-3 pb-3">
              <p className="text-xs text-orange-600 font-medium">Cotizaciones</p>
              <p className="text-2xl font-bold text-orange-800 mt-1">{summary.total_quotes || 0}</p>
            </CardContent>
          </Card>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-gray-100 p-1 rounded-lg overflow-x-auto">
          {([
            { key: 'orders' as const, label: 'Mis Pedidos', count: orders.length },
            { key: 'invoices' as const, label: 'Mis Facturas', count: invoices.length },
            { key: 'quotes' as const, label: 'Mis Cotizaciones', count: quotes.length },
            { key: 'balance' as const, label: 'Mi Cuenta', count: null },
          ] as { key: PortalTab; label: string; count: number | null }[]).map(tab => (
            <button
              key={tab.key}
              onClick={() => { setActiveTab(tab.key); setSelectedOrder(null) }}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-colors whitespace-nowrap ${activeTab === tab.key ? 'bg-white shadow text-blue-700' : 'text-gray-500 hover:text-gray-700'}`}
            >
              {tab.label}{tab.count !== null ? ` (${tab.count})` : ''}
            </button>
          ))}
        </div>

        {loading ? (
          <Card>
            <CardContent>
              <div className="flex items-center justify-center py-12 gap-3">
                <svg className="animate-spin h-6 w-6 text-blue-600" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                <p className="text-gray-500 font-medium">Cargando datos...</p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <>
            {/* === ORDERS TAB === */}
            {activeTab === 'orders' && !selectedOrder && (
              <div className="space-y-3">
                {orders.length === 0 ? (
                  <Card>
                    <CardContent className="py-12">
                      <div className="text-center">
                        <svg className="w-12 h-12 text-gray-300 mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                        </svg>
                        <p className="text-gray-500">No tenes pedidos registrados</p>
                      </div>
                    </CardContent>
                  </Card>
                ) : (
                  orders.map(order => {
                    const st = STATUS_LABELS[order.status] || STATUS_LABELS.pendiente
                    const paySt = PAYMENT_STATUS_LABELS[order.payment_status || 'pendiente'] || PAYMENT_STATUS_LABELS.pendiente
                    return (
                      <Card key={order.id} className="hover:shadow-md transition-shadow cursor-pointer border-l-4 border-l-transparent hover:border-l-blue-400" onClick={() => setSelectedOrder(order)}>
                        <CardContent className="pt-4 pb-4">
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              <div className="flex items-center gap-2 flex-wrap mb-2">
                                <span className="text-xs font-mono text-gray-400">#{String(order.order_number || 0).padStart(4, '0')}</span>
                                <h3 className="font-semibold text-gray-900">{order.title}</h3>
                                <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${st.bg} ${st.color}`}>{st.label}</span>
                                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${paySt.color}`}>{paySt.label}</span>
                                <span className="px-2 py-0.5 rounded text-xs bg-blue-50 text-blue-600">{PRODUCT_TYPE_LABELS[order.product_type] || order.product_type}</span>
                              </div>
                              <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
                                <div>
                                  <p className="text-gray-500">Fecha</p>
                                  <p className="font-medium">{formatDate(order.created_at)}</p>
                                </div>
                                <div>
                                  <p className="text-gray-500">Cantidad</p>
                                  <p className="font-medium">{order.quantity}</p>
                                </div>
                                <div>
                                  <p className="text-gray-500">Total</p>
                                  <p className="font-bold text-green-700">{formatCurrency(parseFloat(order.total_amount || '0'))}</p>
                                </div>
                                <div>
                                  <p className="text-gray-500">Forma de Pago</p>
                                  <p className="font-medium">{order.payment_method || '-'}</p>
                                </div>
                                <div>
                                  <p className="text-gray-500">Entrega Estimada</p>
                                  <p className="font-medium">{order.estimated_delivery ? formatDate(order.estimated_delivery) : 'A confirmar'}</p>
                                </div>
                              </div>
                              {order.has_invoice && (
                                <div className="mt-2 flex items-center gap-1 text-xs text-blue-600">
                                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                  </svg>
                                  Tiene factura asociada
                                </div>
                              )}
                            </div>
                            <div className="text-gray-300 ml-4 text-lg">
                              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                              </svg>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    )
                  })
                )}
              </div>
            )}

            {/* === ORDER DETAIL === */}
            {activeTab === 'orders' && selectedOrder && (
              <div className="space-y-4">
                <button onClick={() => setSelectedOrder(null)} className="text-blue-600 hover:underline text-sm font-medium flex items-center gap-1">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                  Volver a mis pedidos
                </button>
                <Card>
                  <CardHeader>
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-mono text-gray-400">#{String(selectedOrder.order_number || 0).padStart(4, '0')}</span>
                        <h3 className="text-lg font-semibold">{selectedOrder.title}</h3>
                      </div>
                      <div className="flex items-center gap-2">
                        {(() => {
                          const st = STATUS_LABELS[selectedOrder.status] || STATUS_LABELS.pendiente
                          return <span className={`px-3 py-1 rounded-full text-sm font-medium border ${st.bg} ${st.color}`}>{st.label}</span>
                        })()}
                        {(() => {
                          const ps = PAYMENT_STATUS_LABELS[selectedOrder.payment_status || 'pendiente'] || PAYMENT_STATUS_LABELS.pendiente
                          return <span className={`px-3 py-1 rounded-full text-sm font-medium ${ps.color}`}>{ps.label}</span>
                        })()}
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mb-6">
                      <div>
                        <p className="text-sm text-gray-500">Fecha</p>
                        <p className="font-medium">{formatDate(selectedOrder.created_at)}</p>
                      </div>
                      <div>
                        <p className="text-sm text-gray-500">Tipo de Producto</p>
                        <p className="font-medium">{PRODUCT_TYPE_LABELS[selectedOrder.product_type] || selectedOrder.product_type}</p>
                      </div>
                      <div>
                        <p className="text-sm text-gray-500">Cantidad</p>
                        <p className="font-medium">{selectedOrder.quantity}</p>
                      </div>
                      <div>
                        <p className="text-sm text-gray-500">Forma de Pago</p>
                        <p className="font-medium">{selectedOrder.payment_method || '-'}</p>
                      </div>
                      <div>
                        <p className="text-sm text-gray-500">Precio Unitario</p>
                        <p className="font-medium">{formatCurrency(parseFloat(selectedOrder.unit_price || '0'))}</p>
                      </div>
                      <div>
                        <p className="text-sm text-gray-500">IVA</p>
                        <p className="font-medium">{selectedOrder.vat_rate}%</p>
                      </div>
                      <div>
                        <p className="text-sm text-gray-500">Total</p>
                        <p className="text-xl font-bold text-green-700">{formatCurrency(parseFloat(selectedOrder.total_amount || '0'))}</p>
                      </div>
                      <div>
                        <p className="text-sm text-gray-500">Entrega Estimada</p>
                        <p className="font-medium">{selectedOrder.estimated_delivery ? formatDate(selectedOrder.estimated_delivery) : 'A confirmar'}</p>
                      </div>
                    </div>

                    {/* Status Timeline */}
                    <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 mb-4">
                      <h4 className="text-sm font-semibold text-gray-700 mb-3">Progreso del Pedido</h4>
                      <div className="flex items-center gap-1 overflow-x-auto">
                        {['pendiente', 'en_produccion', 'terminado', 'entregado'].map((step, idx, arr) => {
                          const stepLabels: Record<string, string> = { pendiente: 'Pendiente', en_produccion: 'Produccion', terminado: 'Terminado', entregado: 'Entregado' }
                          const currentIdx = arr.indexOf(selectedOrder.status)
                          const isActive = idx <= currentIdx
                          const isCurrent = step === selectedOrder.status
                          return (
                            <React.Fragment key={step}>
                              <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap ${
                                isCurrent ? 'bg-blue-600 text-white' :
                                isActive ? 'bg-blue-100 text-blue-700' :
                                'bg-gray-200 text-gray-400'
                              }`}>
                                {isActive && !isCurrent && (
                                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                  </svg>
                                )}
                                {stepLabels[step]}
                              </div>
                              {idx < arr.length - 1 && (
                                <div className={`w-6 h-0.5 shrink-0 ${idx < currentIdx ? 'bg-blue-400' : 'bg-gray-200'}`} />
                              )}
                            </React.Fragment>
                          )
                        })}
                      </div>
                    </div>

                    {selectedOrder.invoice && (
                      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
                        <h4 className="text-sm font-semibold text-blue-800 mb-2">Factura Asociada</h4>
                        <div className="flex items-center gap-4 text-sm text-blue-700 flex-wrap">
                          <span>
                            <span className="font-medium">{selectedOrder.invoice.invoice_type}</span> N. {selectedOrder.invoice.invoice_number}
                          </span>
                          <span>Total: <span className="font-bold">{formatCurrency(parseFloat(selectedOrder.invoice.total_amount || '0'))}</span></span>
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                            INVOICE_STATUS_LABELS[selectedOrder.invoice.status]?.color || 'bg-gray-100 text-gray-800'
                          }`}>
                            {INVOICE_STATUS_LABELS[selectedOrder.invoice.status]?.label || selectedOrder.invoice.status}
                          </span>
                        </div>
                      </div>
                    )}

                    {selectedOrder.notes && (
                      <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                        <h4 className="text-sm font-semibold text-gray-700 mb-1">Notas</h4>
                        <p className="text-sm text-gray-600 whitespace-pre-wrap">{selectedOrder.notes}</p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            )}

            {/* === INVOICES TAB === */}
            {activeTab === 'invoices' && (
              <div className="space-y-3">
                {invoices.length === 0 ? (
                  <Card>
                    <CardContent className="py-12">
                      <div className="text-center">
                        <svg className="w-12 h-12 text-gray-300 mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                        <p className="text-gray-500">No tenes facturas registradas</p>
                      </div>
                    </CardContent>
                  </Card>
                ) : (
                  <>
                    {/* Invoices summary */}
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                      <Card className="border border-indigo-200 bg-indigo-50">
                        <CardContent className="pt-3 pb-3">
                          <p className="text-xs text-indigo-600 font-medium">Total Facturado</p>
                          <p className="text-lg font-bold text-indigo-800 mt-1">
                            {formatCurrency(invoices.reduce((sum, inv) => sum + parseFloat(inv.total_amount || '0'), 0))}
                          </p>
                        </CardContent>
                      </Card>
                      <Card className="border border-green-200 bg-green-50">
                        <CardContent className="pt-3 pb-3">
                          <p className="text-xs text-green-600 font-medium">Autorizadas</p>
                          <p className="text-lg font-bold text-green-800 mt-1">
                            {invoices.filter(i => i.status === 'authorized').length}
                          </p>
                        </CardContent>
                      </Card>
                      <Card className="border border-yellow-200 bg-yellow-50">
                        <CardContent className="pt-3 pb-3">
                          <p className="text-xs text-yellow-600 font-medium">Borradores</p>
                          <p className="text-lg font-bold text-yellow-800 mt-1">
                            {invoices.filter(i => i.status === 'draft').length}
                          </p>
                        </CardContent>
                      </Card>
                    </div>
                    <Card>
                      <CardContent className="overflow-x-auto pt-4">
                        <table className="min-w-full border-collapse">
                          <thead>
                            <tr className="border-b border-gray-200 bg-gray-50">
                              <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Tipo</th>
                              <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">N</th>
                              <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Fecha</th>
                              <th className="px-4 py-3 text-right text-sm font-semibold text-gray-900">Subtotal</th>
                              <th className="px-4 py-3 text-right text-sm font-semibold text-gray-900">IVA</th>
                              <th className="px-4 py-3 text-right text-sm font-semibold text-gray-900">Total</th>
                              <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Estado</th>
                            </tr>
                          </thead>
                          <tbody>
                            {invoices.map((inv: any) => {
                              const invSt = INVOICE_STATUS_LABELS[inv.status] || { label: inv.status, color: 'bg-gray-100 text-gray-800' }
                              return (
                                <tr key={inv.id} className="border-b border-gray-200 hover:bg-gray-50">
                                  <td className="px-4 py-3 text-sm">
                                    <span className="px-2 py-0.5 rounded bg-indigo-100 text-indigo-700 font-bold text-xs">{inv.invoice_type}</span>
                                  </td>
                                  <td className="px-4 py-3 text-sm font-mono font-medium">{inv.invoice_number}</td>
                                  <td className="px-4 py-3 text-sm text-gray-600">{formatDate(inv.invoice_date || inv.created_at)}</td>
                                  <td className="px-4 py-3 text-sm text-right text-gray-600">{formatCurrency(parseFloat(inv.subtotal || '0'))}</td>
                                  <td className="px-4 py-3 text-sm text-right text-gray-600">{formatCurrency(parseFloat(inv.vat_amount || '0'))}</td>
                                  <td className="px-4 py-3 text-sm text-right font-bold text-green-700">{formatCurrency(parseFloat(inv.total_amount || '0'))}</td>
                                  <td className="px-4 py-3 text-sm">
                                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${invSt.color}`}>
                                      {invSt.label}
                                    </span>
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </CardContent>
                    </Card>
                  </>
                )}
              </div>
            )}

            {/* === QUOTES TAB === */}
            {activeTab === 'quotes' && (
              <div className="space-y-3">
                {quotes.length === 0 ? (
                  <Card>
                    <CardContent className="py-12">
                      <div className="text-center">
                        <svg className="w-12 h-12 text-gray-300 mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2" />
                        </svg>
                        <p className="text-gray-500">No tenes cotizaciones registradas</p>
                      </div>
                    </CardContent>
                  </Card>
                ) : (
                  <>
                    {/* Quotes summary */}
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                      <Card className="border border-orange-200 bg-orange-50">
                        <CardContent className="pt-3 pb-3">
                          <p className="text-xs text-orange-600 font-medium">Total Cotizado</p>
                          <p className="text-lg font-bold text-orange-800 mt-1">
                            {formatCurrency(quotes.reduce((sum, q) => sum + parseFloat(q.total_amount || '0'), 0))}
                          </p>
                        </CardContent>
                      </Card>
                      <Card className="border border-green-200 bg-green-50">
                        <CardContent className="pt-3 pb-3">
                          <p className="text-xs text-green-600 font-medium">Aceptadas</p>
                          <p className="text-lg font-bold text-green-800 mt-1">
                            {quotes.filter(q => q.status === 'accepted').length}
                          </p>
                        </CardContent>
                      </Card>
                      <Card className="border border-blue-200 bg-blue-50">
                        <CardContent className="pt-3 pb-3">
                          <p className="text-xs text-blue-600 font-medium">Enviadas</p>
                          <p className="text-lg font-bold text-blue-800 mt-1">
                            {quotes.filter(q => q.status === 'sent').length}
                          </p>
                        </CardContent>
                      </Card>
                    </div>
                    <Card>
                      <CardContent className="overflow-x-auto pt-4">
                        <table className="min-w-full border-collapse">
                          <thead>
                            <tr className="border-b border-gray-200 bg-gray-50">
                              <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">N</th>
                              <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Titulo</th>
                              <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Fecha</th>
                              <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Valida hasta</th>
                              <th className="px-4 py-3 text-right text-sm font-semibold text-gray-900">Total</th>
                              <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Estado</th>
                              <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">PDF</th>
                            </tr>
                          </thead>
                          <tbody>
                            {quotes.map((q: any) => {
                              const qSt = QUOTE_STATUS_LABELS[q.status] || { label: q.status, color: 'bg-gray-100 text-gray-800' }
                              const isExpired = q.valid_until && new Date(q.valid_until) < new Date() && q.status !== 'accepted'
                              return (
                                <tr key={q.id} className={`border-b border-gray-200 hover:bg-gray-50 ${isExpired ? 'opacity-60' : ''}`}>
                                  <td className="px-4 py-3 text-sm font-mono font-bold text-blue-700">#{String(q.quote_number || 0).padStart(4, '0')}</td>
                                  <td className="px-4 py-3 text-sm font-medium text-gray-900">{q.title || 'Cotizacion'}</td>
                                  <td className="px-4 py-3 text-sm text-gray-600">{formatDate(q.created_at)}</td>
                                  <td className="px-4 py-3 text-sm">
                                    {q.valid_until ? (
                                      <span className={isExpired ? 'text-red-600 font-medium' : 'text-gray-600'}>
                                        {formatDate(q.valid_until)}
                                        {isExpired && ' (vencida)'}
                                      </span>
                                    ) : '-'}
                                  </td>
                                  <td className="px-4 py-3 text-sm text-right font-bold text-green-700">{formatCurrency(parseFloat(q.total_amount || '0'))}</td>
                                  <td className="px-4 py-3 text-sm">
                                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${qSt.color}`}>
                                      {qSt.label}
                                    </span>
                                  </td>
                                  <td className="px-4 py-3">
                                    <button
                                      onClick={() => handleDownloadQuotePdf(q.id)}
                                      className="text-blue-600 hover:text-blue-800 hover:underline text-sm font-medium flex items-center gap-1"
                                    >
                                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                      </svg>
                                      PDF
                                    </button>
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </CardContent>
                    </Card>
                  </>
                )}
              </div>
            )}

            {/* === BALANCE / CUENTA TAB === */}
            {activeTab === 'balance' && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <Card className="border-l-4 border-l-blue-500">
                    <CardContent className="pt-4 pb-4">
                      <p className="text-sm text-gray-500 mb-1">Total en Pedidos</p>
                      <p className="text-2xl font-bold text-blue-800">{formatCurrency(accountBalance.totalOrdered)}</p>
                      <p className="text-xs text-gray-400 mt-1">{orders.length} pedido{orders.length !== 1 ? 's' : ''}</p>
                    </CardContent>
                  </Card>
                  <Card className="border-l-4 border-l-indigo-500">
                    <CardContent className="pt-4 pb-4">
                      <p className="text-sm text-gray-500 mb-1">Total Facturado</p>
                      <p className="text-2xl font-bold text-indigo-800">{formatCurrency(accountBalance.totalInvoiced)}</p>
                      <p className="text-xs text-gray-400 mt-1">{invoices.length} factura{invoices.length !== 1 ? 's' : ''}</p>
                    </CardContent>
                  </Card>
                  <Card className={`border-l-4 ${accountBalance.pendingOrders > 0 ? 'border-l-yellow-500' : 'border-l-green-500'}`}>
                    <CardContent className="pt-4 pb-4">
                      <p className="text-sm text-gray-500 mb-1">Pendiente de Pago</p>
                      <p className={`text-2xl font-bold ${accountBalance.pendingOrders > 0 ? 'text-yellow-800' : 'text-green-800'}`}>
                        {formatCurrency(accountBalance.pendingAmount)}
                      </p>
                      <p className="text-xs text-gray-400 mt-1">
                        {accountBalance.pendingOrders} pedido{accountBalance.pendingOrders !== 1 ? 's' : ''} pendiente{accountBalance.pendingOrders !== 1 ? 's' : ''}
                      </p>
                    </CardContent>
                  </Card>
                </div>

                {/* Orders payment breakdown */}
                <Card>
                  <CardHeader>
                    <span className="font-semibold">Detalle de Pagos por Pedido</span>
                  </CardHeader>
                  <CardContent className="overflow-x-auto">
                    {orders.length === 0 ? (
                      <p className="text-center py-8 text-gray-500">No hay pedidos para mostrar</p>
                    ) : (
                      <table className="min-w-full border-collapse">
                        <thead>
                          <tr className="border-b border-gray-200 bg-gray-50">
                            <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Pedido</th>
                            <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Titulo</th>
                            <th className="px-4 py-3 text-right text-sm font-semibold text-gray-900">Total</th>
                            <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Estado Pago</th>
                            <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Forma de Pago</th>
                            <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Factura</th>
                          </tr>
                        </thead>
                        <tbody>
                          {orders.map(order => {
                            const ps = PAYMENT_STATUS_LABELS[order.payment_status || 'pendiente'] || PAYMENT_STATUS_LABELS.pendiente
                            return (
                              <tr key={order.id} className="border-b border-gray-200 hover:bg-gray-50">
                                <td className="px-4 py-3 text-sm font-mono font-bold text-blue-700">
                                  #{String(order.order_number || 0).padStart(4, '0')}
                                </td>
                                <td className="px-4 py-3 text-sm font-medium text-gray-900">{order.title}</td>
                                <td className="px-4 py-3 text-sm text-right font-medium">
                                  {formatCurrency(parseFloat(order.total_amount || '0'))}
                                </td>
                                <td className="px-4 py-3 text-sm">
                                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${ps.color}`}>
                                    {ps.label}
                                  </span>
                                </td>
                                <td className="px-4 py-3 text-sm text-gray-600">{order.payment_method || '-'}</td>
                                <td className="px-4 py-3 text-sm text-gray-600">
                                  {order.invoice
                                    ? `${order.invoice.invoice_type} #${order.invoice.invoice_number}`
                                    : order.has_invoice ? 'Si' : '-'}
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    )}
                  </CardContent>
                </Card>
              </div>
            )}
          </>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-200 bg-white mt-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <p className="text-center text-xs text-gray-400">
            Portal de Cliente - {companyName}
          </p>
        </div>
      </footer>
    </div>
  )
}
