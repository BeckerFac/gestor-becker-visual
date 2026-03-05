import React, { useState, useEffect } from 'react'
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
  notes: string | null
  invoice?: { id: string; invoice_number: number; invoice_type: string; total_amount: string; status: string } | null
  created_at: string
}

const STATUS_LABELS: Record<string, { label: string; color: string; icon: string }> = {
  pendiente: { label: 'Pendiente', color: 'bg-yellow-100 text-yellow-800 border-yellow-300', icon: '⏳' },
  en_produccion: { label: 'En Producción', color: 'bg-blue-100 text-blue-800 border-blue-300', icon: '🔨' },
  en_pausa: { label: 'En Pausa', color: 'bg-gray-100 text-gray-700 border-gray-300', icon: '⏸️' },
  terminado: { label: 'Terminado', color: 'bg-green-100 text-green-800 border-green-300', icon: '✅' },
  entregado: { label: 'Entregado', color: 'bg-emerald-100 text-emerald-800 border-emerald-300', icon: '📦' },
  cancelado: { label: 'Cancelado', color: 'bg-red-100 text-red-800 border-red-300', icon: '❌' },
}

const PRODUCT_TYPE_LABELS: Record<string, string> = {
  portabanner: 'Portabanner', bandera: 'Bandera', ploteo: 'Ploteo', carteleria: 'Cartelería',
  vinilo: 'Vinilo', lona: 'Lona', backing: 'Backing', senaletica: 'Señalética',
  vehicular: 'Vehicular', textil: 'Textil', otro: 'Otro',
}

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
  const [activeTab, setActiveTab] = useState<'orders' | 'invoices' | 'quotes'>('orders')
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

  // === LOGIN SCREEN ===
  if (!isLoggedIn) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-gray-900">Portal de Cliente</h1>
            <p className="text-gray-500 mt-2">Accedé a tus pedidos, facturas y cotizaciones</p>
          </div>
          <Card>
            <CardContent className="pt-6">
              <form onSubmit={handleLogin} className="space-y-4">
                {loginError && (
                  <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
                    {loginError}
                  </div>
                )}
                <Input
                  label="Código de Acceso"
                  placeholder="Ingresá el código que te dio tu proveedor"
                  value={loginForm.access_code}
                  onChange={e => setLoginForm({ ...loginForm, access_code: e.target.value })}
                  required
                />
                <Button type="submit" variant="primary" loading={loginLoading} className="w-full">
                  Ingresar
                </Button>
              </form>
            </CardContent>
          </Card>
          <p className="text-center text-sm text-gray-400 mt-4">
            Si no tenés un código de acceso, pedíselo a tu proveedor.
          </p>
        </div>
      </div>
    )
  }

  // === PORTAL DASHBOARD ===
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold text-gray-900">Portal de Cliente</h1>
              <p className="text-sm text-gray-500">{companyName}</p>
            </div>
            <div className="flex items-center gap-4">
              <div className="text-right">
                <p className="text-sm font-medium text-gray-900">{customerName}</p>
                <p className="text-xs text-gray-500">Cliente</p>
              </div>
              <button onClick={handleLogout} className="px-3 py-1.5 bg-red-100 text-red-700 hover:bg-red-200 rounded-lg text-sm font-medium transition-colors">
                Salir
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        {/* Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
          <Card className="border border-blue-200 bg-blue-50">
            <CardContent className="pt-3 pb-2">
              <p className="text-xs text-blue-700">Total Pedidos</p>
              <p className="text-2xl font-bold text-blue-800">{summary.total_orders || 0}</p>
            </CardContent>
          </Card>
          <Card className="border border-yellow-200 bg-yellow-50">
            <CardContent className="pt-3 pb-2">
              <p className="text-xs text-yellow-700">En Proceso</p>
              <p className="text-2xl font-bold text-yellow-800">{summary.active_orders || 0}</p>
            </CardContent>
          </Card>
          <Card className="border border-green-200 bg-green-50">
            <CardContent className="pt-3 pb-2">
              <p className="text-xs text-green-700">Entregados</p>
              <p className="text-2xl font-bold text-green-800">{summary.delivered_orders || 0}</p>
            </CardContent>
          </Card>
          <Card className="border border-indigo-200 bg-indigo-50">
            <CardContent className="pt-3 pb-2">
              <p className="text-xs text-indigo-700">Total Comprado</p>
              <p className="text-xl font-bold text-indigo-800">{formatCurrency(parseFloat(summary.total_spent || '0'))}</p>
            </CardContent>
          </Card>
          <Card className="border border-purple-200 bg-purple-50">
            <CardContent className="pt-3 pb-2">
              <p className="text-xs text-purple-700">Facturas</p>
              <p className="text-2xl font-bold text-purple-800">{summary.total_invoices || 0}</p>
            </CardContent>
          </Card>
          <Card className="border border-orange-200 bg-orange-50">
            <CardContent className="pt-3 pb-2">
              <p className="text-xs text-orange-700">Cotizaciones</p>
              <p className="text-2xl font-bold text-orange-800">{summary.total_quotes || 0}</p>
            </CardContent>
          </Card>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-gray-100 p-1 rounded-lg w-fit">
          {[
            { key: 'orders' as const, label: 'Mis Pedidos', count: orders.length },
            { key: 'invoices' as const, label: 'Mis Facturas', count: invoices.length },
            { key: 'quotes' as const, label: 'Mis Cotizaciones', count: quotes.length },
          ].map(tab => (
            <button
              key={tab.key}
              onClick={() => { setActiveTab(tab.key); setSelectedOrder(null) }}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${activeTab === tab.key ? 'bg-white shadow text-blue-700' : 'text-gray-500 hover:text-gray-700'}`}
            >
              {tab.label} ({tab.count})
            </button>
          ))}
        </div>

        {loading ? (
          <Card><CardContent><p className="text-center py-8 text-gray-500">Cargando...</p></CardContent></Card>
        ) : (
          <>
            {/* === ORDERS TAB === */}
            {activeTab === 'orders' && !selectedOrder && (
              <div className="space-y-3">
                {orders.length === 0 ? (
                  <Card><CardContent><p className="text-center py-8 text-gray-500">No tenés pedidos registrados</p></CardContent></Card>
                ) : (
                  orders.map(order => {
                    const st = STATUS_LABELS[order.status] || STATUS_LABELS.pendiente
                    const payMatch = (order.notes || '').match(/Forma de pago: (\w+)/i)
                    return (
                      <Card key={order.id} className="hover:shadow-md transition-shadow cursor-pointer" onClick={() => setSelectedOrder(order)}>
                        <CardContent className="pt-4 pb-4">
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              <div className="flex items-center gap-3 mb-2">
                                <span className="text-lg">{st.icon}</span>
                                <h3 className="font-semibold text-gray-900">{order.title}</h3>
                                <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${st.color}`}>{st.label}</span>
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
                                  <p className="font-medium">{payMatch ? payMatch[1] : '-'}</p>
                                </div>
                                <div>
                                  <p className="text-gray-500">Entrega Estimada</p>
                                  <p className="font-medium">{order.estimated_delivery ? formatDate(order.estimated_delivery) : 'A confirmar'}</p>
                                </div>
                              </div>
                            </div>
                            <div className="text-gray-400 ml-4">→</div>
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
                <button onClick={() => setSelectedOrder(null)} className="text-blue-600 hover:underline text-sm font-medium">
                  ← Volver a mis pedidos
                </button>
                <Card>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <h3 className="text-lg font-semibold">{selectedOrder.title}</h3>
                      <span className={`px-3 py-1 rounded-full text-sm font-medium border ${STATUS_LABELS[selectedOrder.status]?.color || ''}`}>
                        {STATUS_LABELS[selectedOrder.status]?.icon} {STATUS_LABELS[selectedOrder.status]?.label}
                      </span>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mb-6">
                      <div>
                        <p className="text-sm text-gray-500">Pedido N°</p>
                        <p className="text-lg font-bold">#{String(selectedOrder.order_number || 0).padStart(4, '0')}</p>
                      </div>
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

                    {selectedOrder.invoice && (
                      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
                        <h4 className="text-sm font-semibold text-blue-800 mb-1">Factura Asociada</h4>
                        <p className="text-sm text-blue-700">
                          Factura {selectedOrder.invoice.invoice_type} N° {selectedOrder.invoice.invoice_number} —
                          Total: {formatCurrency(parseFloat(selectedOrder.invoice.total_amount || '0'))} —
                          Estado: {selectedOrder.invoice.status}
                        </p>
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
                  <Card><CardContent><p className="text-center py-8 text-gray-500">No tenés facturas registradas</p></CardContent></Card>
                ) : (
                  <Card>
                    <CardContent className="overflow-x-auto pt-4">
                      <table className="min-w-full border-collapse">
                        <thead>
                          <tr className="border-b border-gray-200 bg-gray-50">
                            <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Tipo</th>
                            <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">N°</th>
                            <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Fecha</th>
                            <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Subtotal</th>
                            <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">IVA</th>
                            <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Total</th>
                            <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Estado</th>
                          </tr>
                        </thead>
                        <tbody>
                          {invoices.map((inv: any) => (
                            <tr key={inv.id} className="border-b border-gray-200 hover:bg-gray-50">
                              <td className="px-4 py-3 text-sm"><span className="px-2 py-0.5 rounded bg-indigo-100 text-indigo-700 font-bold">{inv.invoice_type}</span></td>
                              <td className="px-4 py-3 text-sm font-mono font-medium">{inv.invoice_number}</td>
                              <td className="px-4 py-3 text-sm">{formatDate(inv.invoice_date || inv.created_at)}</td>
                              <td className="px-4 py-3 text-sm">{formatCurrency(parseFloat(inv.subtotal || '0'))}</td>
                              <td className="px-4 py-3 text-sm">{formatCurrency(parseFloat(inv.vat_amount || '0'))}</td>
                              <td className="px-4 py-3 text-sm font-bold text-green-700">{formatCurrency(parseFloat(inv.total_amount || '0'))}</td>
                              <td className="px-4 py-3 text-sm">
                                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${inv.status === 'authorized' ? 'bg-green-100 text-green-800' : inv.status === 'draft' ? 'bg-yellow-100 text-yellow-800' : 'bg-gray-100 text-gray-800'}`}>
                                  {inv.status === 'authorized' ? 'Autorizada' : inv.status === 'draft' ? 'Borrador' : inv.status}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </CardContent>
                  </Card>
                )}
              </div>
            )}

            {/* === QUOTES TAB === */}
            {activeTab === 'quotes' && (
              <div className="space-y-3">
                {quotes.length === 0 ? (
                  <Card><CardContent><p className="text-center py-8 text-gray-500">No tenés cotizaciones registradas</p></CardContent></Card>
                ) : (
                  <Card>
                    <CardContent className="overflow-x-auto pt-4">
                      <table className="min-w-full border-collapse">
                        <thead>
                          <tr className="border-b border-gray-200 bg-gray-50">
                            <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">N°</th>
                            <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Título</th>
                            <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Fecha</th>
                            <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Válida hasta</th>
                            <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Total</th>
                            <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Estado</th>
                            <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">PDF</th>
                          </tr>
                        </thead>
                        <tbody>
                          {quotes.map((q: any) => (
                            <tr key={q.id} className="border-b border-gray-200 hover:bg-gray-50">
                              <td className="px-4 py-3 text-sm font-mono font-bold text-blue-700">#{String(q.quote_number || 0).padStart(4, '0')}</td>
                              <td className="px-4 py-3 text-sm">{q.title || 'Cotización'}</td>
                              <td className="px-4 py-3 text-sm">{formatDate(q.created_at)}</td>
                              <td className="px-4 py-3 text-sm">{q.valid_until ? formatDate(q.valid_until) : '-'}</td>
                              <td className="px-4 py-3 text-sm font-bold text-green-700">{formatCurrency(parseFloat(q.total_amount || '0'))}</td>
                              <td className="px-4 py-3 text-sm">
                                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${q.status === 'accepted' ? 'bg-green-100 text-green-800' : q.status === 'draft' ? 'bg-gray-100 text-gray-800' : 'bg-blue-100 text-blue-800'}`}>
                                  {q.status === 'draft' ? 'Borrador' : q.status === 'sent' ? 'Enviada' : q.status === 'accepted' ? 'Aceptada' : q.status}
                                </span>
                              </td>
                              <td className="px-4 py-3">
                                <button
                                  onClick={() => handleDownloadQuotePdf(q.id)}
                                  className="text-blue-600 hover:underline text-sm font-medium"
                                >
                                  Descargar PDF
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </CardContent>
                  </Card>
                )}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  )
}
