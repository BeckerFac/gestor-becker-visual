import React, { useState, useEffect, useCallback, useRef } from 'react'
import { Card, CardContent, CardHeader } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { TagBadges } from '@/components/shared/TagBadges'
import { SkeletonTable } from '@/components/ui/Skeleton'
import { formatCurrency, formatDate } from '@/lib/utils'
import { api } from '@/services/api'

interface Enterprise {
  id: string
  name: string
  razon_social: string | null
  cuit: string | null
  address: string | null
  city: string | null
  province: string | null
  postal_code: string | null
  fiscal_address: string | null
  fiscal_city: string | null
  fiscal_province: string | null
  fiscal_postal_code: string | null
  phone: string | null
  email: string | null
  tax_condition: string | null
  notes: string | null
  status: string
  contact_count: number
  tags: { id: string; name: string; color: string }[]
  contacts?: Contact[]
}

interface Contact {
  id: string
  name: string
  email: string | null
  phone: string | null
  cuit: string | null
  role: string | null
  contact_name: string | null
}

type TabKey = 'contactos' | 'pedidos' | 'cotizaciones' | 'facturas' | 'cobros' | 'pagos' | 'cuenta_corriente' | 'cheques'

const TABS: { key: TabKey; label: string }[] = [
  { key: 'contactos', label: 'Contactos' },
  { key: 'pedidos', label: 'Pedidos' },
  { key: 'cotizaciones', label: 'Cotizaciones' },
  { key: 'facturas', label: 'Facturas' },
  { key: 'cobros', label: 'Cobros' },
  { key: 'pagos', label: 'Pagos' },
  { key: 'cuenta_corriente', label: 'Cuenta Corriente' },
  { key: 'cheques', label: 'Cheques' },
]

export const Global: React.FC = () => {
  const [searchTerm, setSearchTerm] = useState('')
  const [enterprises, setEnterprises] = useState<Enterprise[]>([])
  const [filteredEnterprises, setFilteredEnterprises] = useState<Enterprise[]>([])
  const [selectedEnterprise, setSelectedEnterprise] = useState<Enterprise | null>(null)
  const [showDropdown, setShowDropdown] = useState(false)
  const [activeTab, setActiveTab] = useState<TabKey>('contactos')
  const [loading, setLoading] = useState(false)
  const [tabLoading, setTabLoading] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Tab data
  const [contacts, setContacts] = useState<any[]>([])
  const [orders, setOrders] = useState<any[]>([])
  const [quotes, setQuotes] = useState<any[]>([])
  const [invoices, setInvoices] = useState<any[]>([])
  const [cobros, setCobros] = useState<any[]>([])
  const [pagos, setPagos] = useState<any[]>([])
  const [cuentaCorriente, setCuentaCorriente] = useState<any>(null)
  const [cheques, setCheques] = useState<any[]>([])

  // Load enterprises on mount
  useEffect(() => {
    const loadEnterprises = async () => {
      try {
        const data = await api.getEnterprises()
        setEnterprises(data)
      } catch (e) {
        console.error('Failed to load enterprises', e)
      }
    }
    loadEnterprises()
  }, [])

  // Filter enterprises as user types
  useEffect(() => {
    if (!searchTerm.trim()) {
      setFilteredEnterprises([])
      setShowDropdown(false)
      return
    }
    const q = searchTerm.toLowerCase()
    const matches = enterprises.filter(
      (e) =>
        e.name.toLowerCase().includes(q) ||
        (e.cuit && e.cuit.includes(q)) ||
        (e.razon_social && e.razon_social.toLowerCase().includes(q))
    )
    setFilteredEnterprises(matches.slice(0, 10))
    setShowDropdown(matches.length > 0)
  }, [searchTerm, enterprises])

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const selectEnterprise = useCallback(async (enterprise: Enterprise) => {
    setShowDropdown(false)
    setSearchTerm(enterprise.name)
    setLoading(true)
    setActiveTab('contactos')

    try {
      const detail = await api.getEnterprise(enterprise.id)
      const enriched: Enterprise = {
        ...enterprise,
        ...detail,
      }
      setSelectedEnterprise(enriched)
      setContacts(detail.contacts || [])
    } catch (e) {
      console.error('Failed to load enterprise detail', e)
    } finally {
      setLoading(false)
    }
  }, [])

  const loadTabData = useCallback(async (tab: TabKey, enterpriseId: string) => {
    setTabLoading(true)
    try {
      switch (tab) {
        case 'contactos':
          // Already loaded with enterprise detail
          break
        case 'pedidos': {
          const ordersData = await api.getOrders({ enterprise_id: enterpriseId, limit: 100 })
          setOrders(ordersData.items || ordersData || [])
          break
        }
        case 'cotizaciones': {
          const quotesData = await api.getQuotes({ enterprise_id: enterpriseId, limit: 100 })
          setQuotes(quotesData.items || quotesData || [])
          break
        }
        case 'facturas': {
          const invoicesData = await api.getInvoices({ enterprise_id: enterpriseId, limit: 100 })
          setInvoices(invoicesData.items || invoicesData || [])
          break
        }
        case 'cobros': {
          const cobrosData = await api.getCobros({ enterprise_id: enterpriseId })
          setCobros(cobrosData.items || cobrosData || [])
          break
        }
        case 'pagos': {
          const pagosData = await api.getPagos({ enterprise_id: enterpriseId })
          setPagos(pagosData.items || pagosData || [])
          break
        }
        case 'cuenta_corriente': {
          const ccData = await api.getCuentaCorrienteDetalle(enterpriseId)
          setCuentaCorriente(ccData)
          break
        }
        case 'cheques': {
          // Get contacts for this enterprise, then filter cheques by those customer IDs
          const entDetail = await api.getEnterprise(enterpriseId)
          const contactIds = (entDetail.contacts || []).map((c: any) => c.id)
          if (contactIds.length > 0) {
            const allCheques = await api.getCheques({})
            const filtered = (Array.isArray(allCheques) ? allCheques : allCheques.items || [])
              .filter((c: any) => contactIds.includes(c.customer_id))
            setCheques(filtered)
          } else {
            setCheques([])
          }
          break
        }
      }
    } catch (e) {
      console.error(`Failed to load ${tab} data`, e)
    } finally {
      setTabLoading(false)
    }
  }, [selectedEnterprise])

  const handleTabChange = useCallback((tab: TabKey) => {
    setActiveTab(tab)
    if (selectedEnterprise && tab !== 'contactos') {
      loadTabData(tab, selectedEnterprise.id)
    }
  }, [selectedEnterprise, loadTabData])

  const clearSelection = () => {
    setSelectedEnterprise(null)
    setSearchTerm('')
    setContacts([])
    setOrders([])
    setQuotes([])
    setInvoices([])
    setCobros([])
    setPagos([])
    setCuentaCorriente(null)
    setCheques([])
    setActiveTab('contactos')
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Busqueda Global</h1>
          <p className="text-sm text-gray-500 mt-1">Busca una empresa y consulta toda su informacion</p>
        </div>
      </div>

      {/* Search Bar */}
      <div className="relative" ref={dropdownRef}>
        <div className="flex gap-2">
          <div className="flex-1">
            <Input
              placeholder="Buscar empresa por nombre o CUIT..."
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value)
                if (selectedEnterprise) clearSelection()
              }}
              className="text-lg py-3"
            />
          </div>
          {selectedEnterprise && (
            <button
              onClick={clearSelection}
              className="px-4 py-2 text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
            >
              Limpiar
            </button>
          )}
        </div>

        {/* Dropdown */}
        {showDropdown && !selectedEnterprise && (
          <div className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-80 overflow-y-auto">
            {filteredEnterprises.map((ent) => (
              <button
                key={ent.id}
                onClick={() => selectEnterprise(ent)}
                className="w-full text-left px-4 py-3 hover:bg-blue-50 border-b border-gray-100 last:border-0 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-medium text-gray-900">{ent.name}</span>
                    {ent.razon_social && ent.razon_social !== ent.name && (
                      <span className="ml-2 text-sm text-gray-500">({ent.razon_social})</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {ent.cuit && (
                      <span className="text-xs font-mono text-gray-400">{ent.cuit}</span>
                    )}
                    <span className="text-xs text-gray-400">
                      {ent.contact_count} contacto{Number(ent.contact_count) !== 1 ? 's' : ''}
                    </span>
                  </div>
                </div>
                {ent.tags && ent.tags.length > 0 && (
                  <TagBadges tags={ent.tags} size="sm" className="mt-1" />
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {loading && (
        <Card>
          <CardContent className="py-8">
            <SkeletonTable rows={3} cols={4} />
          </CardContent>
        </Card>
      )}

      {/* Enterprise Header Card */}
      {selectedEnterprise && !loading && (
        <>
          <Card className="border-l-4 border-l-blue-500">
            <CardContent className="pt-5 pb-5">
              <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <h2 className="text-xl font-bold text-gray-900">{selectedEnterprise.name}</h2>
                    <StatusBadge status={selectedEnterprise.status} />
                  </div>
                  {selectedEnterprise.razon_social && selectedEnterprise.razon_social !== selectedEnterprise.name && (
                    <p className="text-sm text-gray-500 mb-2">Razon Social: {selectedEnterprise.razon_social}</p>
                  )}
                  {selectedEnterprise.tags && selectedEnterprise.tags.length > 0 && (
                    <TagBadges tags={selectedEnterprise.tags} size="md" className="mb-3" />
                  )}
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-2 text-sm">
                    {selectedEnterprise.cuit && (
                      <div>
                        <span className="text-gray-500">CUIT:</span>{' '}
                        <span className="font-mono font-medium">{selectedEnterprise.cuit}</span>
                      </div>
                    )}
                    {selectedEnterprise.tax_condition && (
                      <div>
                        <span className="text-gray-500">Cond. Fiscal:</span>{' '}
                        <span className="font-medium">{selectedEnterprise.tax_condition}</span>
                      </div>
                    )}
                    {selectedEnterprise.email && (
                      <div>
                        <span className="text-gray-500">Email:</span>{' '}
                        <span className="font-medium">{selectedEnterprise.email}</span>
                      </div>
                    )}
                    {selectedEnterprise.phone && (
                      <div>
                        <span className="text-gray-500">Telefono:</span>{' '}
                        <span className="font-medium">{selectedEnterprise.phone}</span>
                      </div>
                    )}
                    {selectedEnterprise.address && (
                      <div>
                        <span className="text-gray-500">Direccion:</span>{' '}
                        <span className="font-medium">
                          {selectedEnterprise.address}
                          {selectedEnterprise.city && `, ${selectedEnterprise.city}`}
                          {selectedEnterprise.province && `, ${selectedEnterprise.province}`}
                          {selectedEnterprise.postal_code && ` (${selectedEnterprise.postal_code})`}
                        </span>
                      </div>
                    )}
                    {selectedEnterprise.fiscal_address && (
                      <div>
                        <span className="text-gray-500">Dir. Fiscal:</span>{' '}
                        <span className="font-medium">
                          {selectedEnterprise.fiscal_address}
                          {selectedEnterprise.fiscal_city && `, ${selectedEnterprise.fiscal_city}`}
                          {selectedEnterprise.fiscal_province && `, ${selectedEnterprise.fiscal_province}`}
                          {selectedEnterprise.fiscal_postal_code && ` (${selectedEnterprise.fiscal_postal_code})`}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1 text-sm text-gray-500 shrink-0">
                  <span>{contacts.length} contacto{contacts.length !== 1 ? 's' : ''}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Tab Bar */}
          <div className="flex gap-1 bg-gray-100 p-1 rounded-lg overflow-x-auto">
            {TABS.map((tab) => (
              <button
                key={tab.key}
                onClick={() => handleTabChange(tab.key)}
                className={`px-4 py-2 rounded-md text-sm font-medium transition-colors whitespace-nowrap ${
                  activeTab === tab.key
                    ? 'bg-white shadow text-blue-700'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Tab Content */}
          {tabLoading ? (
            <Card>
              <CardContent className="py-8">
                <SkeletonTable rows={4} cols={5} />
              </CardContent>
            </Card>
          ) : (
            <>
              {/* Contactos Tab */}
              {activeTab === 'contactos' && (
                <Card>
                  <CardHeader>
                    <span className="font-semibold">Contactos ({contacts.length})</span>
                  </CardHeader>
                  <CardContent className="overflow-x-auto">
                    {contacts.length === 0 ? (
                      <p className="text-center py-8 text-gray-500">No hay contactos registrados</p>
                    ) : (
                      <table className="min-w-full border-collapse">
                        <thead>
                          <tr className="border-b border-gray-200 bg-gray-50">
                            <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Nombre</th>
                            <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Contacto</th>
                            <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">CUIT</th>
                            <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Email</th>
                            <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Telefono</th>
                            <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Rol</th>
                          </tr>
                        </thead>
                        <tbody>
                          {contacts.map((c: any) => (
                            <tr key={c.id} className="border-b border-gray-200 hover:bg-gray-50">
                              <td className="px-4 py-3 text-sm font-medium text-gray-900">{c.name}</td>
                              <td className="px-4 py-3 text-sm text-gray-600">{c.contact_name || '-'}</td>
                              <td className="px-4 py-3 text-sm font-mono text-gray-600">{c.cuit || '-'}</td>
                              <td className="px-4 py-3 text-sm text-gray-600">{c.email || '-'}</td>
                              <td className="px-4 py-3 text-sm text-gray-600">{c.phone || '-'}</td>
                              <td className="px-4 py-3 text-sm text-gray-600">{c.role || '-'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* Pedidos Tab */}
              {activeTab === 'pedidos' && (
                <Card>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <span className="font-semibold">Pedidos ({orders.length})</span>
                      {orders.length > 0 && (
                        <span className="text-sm text-gray-500">
                          Total: {formatCurrency(orders.reduce((sum: number, o: any) => sum + parseFloat(o.total_amount || '0'), 0))}
                        </span>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent className="overflow-x-auto">
                    {orders.length === 0 ? (
                      <p className="text-center py-8 text-gray-500">No hay pedidos registrados</p>
                    ) : (
                      <table className="min-w-full border-collapse">
                        <thead>
                          <tr className="border-b border-gray-200 bg-gray-50">
                            <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">N</th>
                            <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Titulo</th>
                            <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Cliente</th>
                            <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Estado</th>
                            <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Pago</th>
                            <th className="px-4 py-3 text-right text-sm font-semibold text-gray-900">Total</th>
                            <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Fecha</th>
                          </tr>
                        </thead>
                        <tbody>
                          {orders.map((o: any) => (
                            <tr key={o.id} className="border-b border-gray-200 hover:bg-gray-50">
                              <td className="px-4 py-3 text-sm font-mono font-bold text-blue-700">
                                #{String(o.order_number || 0).padStart(4, '0')}
                              </td>
                              <td className="px-4 py-3 text-sm font-medium text-gray-900">{o.title}</td>
                              <td className="px-4 py-3 text-sm text-gray-600">
                                {o.customer?.name || o.customer_name || '-'}
                              </td>
                              <td className="px-4 py-3 text-sm">
                                <StatusBadge status={o.status} />
                              </td>
                              <td className="px-4 py-3 text-sm">
                                <StatusBadge
                                  status={o.payment_status || 'pendiente'}
                                  color={o.payment_status === 'pagado' ? 'green' : o.payment_status === 'parcial' ? 'orange' : 'yellow'}
                                />
                              </td>
                              <td className="px-4 py-3 text-sm text-right font-medium">
                                {formatCurrency(parseFloat(o.total_amount || '0'))}
                              </td>
                              <td className="px-4 py-3 text-sm text-gray-600">
                                {formatDate(o.created_at)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* Cotizaciones Tab */}
              {activeTab === 'cotizaciones' && (
                <Card>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <span className="font-semibold">Cotizaciones ({quotes.length})</span>
                      {quotes.length > 0 && (
                        <span className="text-sm text-gray-500">
                          Total: {formatCurrency(quotes.reduce((sum: number, q: any) => sum + parseFloat(q.total_amount || '0'), 0))}
                        </span>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent className="overflow-x-auto">
                    {quotes.length === 0 ? (
                      <p className="text-center py-8 text-gray-500">No hay cotizaciones registradas</p>
                    ) : (
                      <table className="min-w-full border-collapse">
                        <thead>
                          <tr className="border-b border-gray-200 bg-gray-50">
                            <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">N</th>
                            <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Titulo</th>
                            <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Cliente</th>
                            <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Estado</th>
                            <th className="px-4 py-3 text-right text-sm font-semibold text-gray-900">Total</th>
                            <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Valida hasta</th>
                            <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Fecha</th>
                          </tr>
                        </thead>
                        <tbody>
                          {quotes.map((q: any) => (
                            <tr key={q.id} className="border-b border-gray-200 hover:bg-gray-50">
                              <td className="px-4 py-3 text-sm font-mono font-bold text-blue-700">
                                #{String(q.quote_number || 0).padStart(4, '0')}
                              </td>
                              <td className="px-4 py-3 text-sm font-medium text-gray-900">{q.title || 'Cotizacion'}</td>
                              <td className="px-4 py-3 text-sm text-gray-600">
                                {q.customer?.name || '-'}
                              </td>
                              <td className="px-4 py-3 text-sm">
                                <StatusBadge
                                  status={q.status}
                                  label={q.status === 'draft' ? 'Borrador' : q.status === 'sent' ? 'Enviada' : q.status === 'accepted' ? 'Aceptada' : q.status}
                                  color={q.status === 'accepted' ? 'green' : q.status === 'sent' ? 'blue' : 'gray'}
                                />
                              </td>
                              <td className="px-4 py-3 text-sm text-right font-medium">
                                {formatCurrency(parseFloat(q.total_amount || '0'))}
                              </td>
                              <td className="px-4 py-3 text-sm text-gray-600">
                                {q.valid_until ? formatDate(q.valid_until) : '-'}
                              </td>
                              <td className="px-4 py-3 text-sm text-gray-600">
                                {formatDate(q.created_at)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* Facturas Tab */}
              {activeTab === 'facturas' && (
                <Card>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <span className="font-semibold">Facturas ({invoices.length})</span>
                      {invoices.length > 0 && (
                        <span className="text-sm text-gray-500">
                          Total: {formatCurrency(invoices.reduce((sum: number, i: any) => sum + parseFloat(i.total_amount || '0'), 0))}
                        </span>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent className="overflow-x-auto">
                    {invoices.length === 0 ? (
                      <p className="text-center py-8 text-gray-500">No hay facturas registradas</p>
                    ) : (
                      <table className="min-w-full border-collapse">
                        <thead>
                          <tr className="border-b border-gray-200 bg-gray-50">
                            <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Tipo</th>
                            <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">N</th>
                            <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Cliente</th>
                            <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Estado</th>
                            <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Pago</th>
                            <th className="px-4 py-3 text-right text-sm font-semibold text-gray-900">Total</th>
                            <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Fecha</th>
                          </tr>
                        </thead>
                        <tbody>
                          {invoices.map((inv: any) => (
                            <tr key={inv.id} className="border-b border-gray-200 hover:bg-gray-50">
                              <td className="px-4 py-3 text-sm">
                                <span className="px-2 py-0.5 rounded bg-indigo-100 text-indigo-700 font-bold text-xs">
                                  {inv.invoice_type}
                                </span>
                              </td>
                              <td className="px-4 py-3 text-sm font-mono font-medium">{inv.invoice_number}</td>
                              <td className="px-4 py-3 text-sm text-gray-600">
                                {inv.customer?.name || inv.customer_name || '-'}
                              </td>
                              <td className="px-4 py-3 text-sm">
                                <StatusBadge
                                  status={inv.status}
                                  label={inv.status === 'authorized' ? 'Autorizada' : inv.status === 'draft' ? 'Borrador' : inv.status}
                                  color={inv.status === 'authorized' ? 'green' : inv.status === 'draft' ? 'yellow' : 'gray'}
                                />
                              </td>
                              <td className="px-4 py-3 text-sm">
                                {inv.payment_status && (
                                  <StatusBadge
                                    status={inv.payment_status}
                                    label={inv.payment_status === 'pagada' ? 'Pagada' : inv.payment_status === 'parcial' ? 'Parcial' : 'Pendiente'}
                                    color={inv.payment_status === 'pagada' ? 'green' : inv.payment_status === 'parcial' ? 'orange' : 'yellow'}
                                  />
                                )}
                              </td>
                              <td className="px-4 py-3 text-sm text-right font-medium">
                                {formatCurrency(parseFloat(inv.total_amount || '0'))}
                              </td>
                              <td className="px-4 py-3 text-sm text-gray-600">
                                {formatDate(inv.invoice_date || inv.created_at)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* Cobros Tab */}
              {activeTab === 'cobros' && (
                <Card>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <span className="font-semibold">Cobros ({cobros.length})</span>
                      {cobros.length > 0 && (
                        <span className="text-sm text-gray-500">
                          Total: {formatCurrency(cobros.reduce((sum: number, c: any) => sum + parseFloat(c.amount || '0'), 0))}
                        </span>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent className="overflow-x-auto">
                    {cobros.length === 0 ? (
                      <p className="text-center py-8 text-gray-500">No hay cobros registrados</p>
                    ) : (
                      <table className="min-w-full border-collapse">
                        <thead>
                          <tr className="border-b border-gray-200 bg-gray-50">
                            <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Fecha</th>
                            <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Metodo</th>
                            <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Referencia</th>
                            <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Pedido</th>
                            <th className="px-4 py-3 text-right text-sm font-semibold text-gray-900">Monto</th>
                          </tr>
                        </thead>
                        <tbody>
                          {cobros.map((c: any) => (
                            <tr key={c.id} className="border-b border-gray-200 hover:bg-gray-50">
                              <td className="px-4 py-3 text-sm text-gray-600">
                                {formatDate(c.payment_date || c.created_at)}
                              </td>
                              <td className="px-4 py-3 text-sm">
                                <StatusBadge
                                  status={c.payment_method}
                                  label={c.payment_method}
                                  color="blue"
                                />
                              </td>
                              <td className="px-4 py-3 text-sm text-gray-600">{c.reference || '-'}</td>
                              <td className="px-4 py-3 text-sm text-gray-600">
                                {c.order_number ? `#${String(c.order_number).padStart(4, '0')}` : '-'}
                              </td>
                              <td className="px-4 py-3 text-sm text-right font-bold text-green-700">
                                {formatCurrency(parseFloat(c.amount || '0'))}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* Pagos Tab */}
              {activeTab === 'pagos' && (
                <Card>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <span className="font-semibold">Pagos ({pagos.length})</span>
                      {pagos.length > 0 && (
                        <span className="text-sm text-gray-500">
                          Total: {formatCurrency(pagos.reduce((sum: number, p: any) => sum + parseFloat(p.amount || '0'), 0))}
                        </span>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent className="overflow-x-auto">
                    {pagos.length === 0 ? (
                      <p className="text-center py-8 text-gray-500">No hay pagos registrados</p>
                    ) : (
                      <table className="min-w-full border-collapse">
                        <thead>
                          <tr className="border-b border-gray-200 bg-gray-50">
                            <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Fecha</th>
                            <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Metodo</th>
                            <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Referencia</th>
                            <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Compra</th>
                            <th className="px-4 py-3 text-right text-sm font-semibold text-gray-900">Monto</th>
                          </tr>
                        </thead>
                        <tbody>
                          {pagos.map((p: any) => (
                            <tr key={p.id} className="border-b border-gray-200 hover:bg-gray-50">
                              <td className="px-4 py-3 text-sm text-gray-600">
                                {formatDate(p.payment_date || p.created_at)}
                              </td>
                              <td className="px-4 py-3 text-sm">
                                <StatusBadge
                                  status={p.payment_method}
                                  label={p.payment_method}
                                  color="blue"
                                />
                              </td>
                              <td className="px-4 py-3 text-sm text-gray-600">{p.reference || '-'}</td>
                              <td className="px-4 py-3 text-sm text-gray-600">
                                {p.purchase_number ? `#${String(p.purchase_number).padStart(4, '0')}` : '-'}
                              </td>
                              <td className="px-4 py-3 text-sm text-right font-bold text-red-700">
                                {formatCurrency(parseFloat(p.amount || '0'))}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* Cuenta Corriente Tab */}
              {activeTab === 'cuenta_corriente' && (
                <div className="space-y-4">
                  {!cuentaCorriente ? (
                    <Card>
                      <CardContent>
                        <p className="text-center py-8 text-gray-500">No se pudo cargar la cuenta corriente</p>
                      </CardContent>
                    </Card>
                  ) : (
                    <>
                      {/* Summary Cards */}
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                        <Card className="border border-blue-200 bg-blue-50">
                          <CardContent className="pt-3 pb-2">
                            <p className="text-xs text-blue-700">Ventas</p>
                            <p className="text-lg font-bold text-blue-800">
                              {formatCurrency(cuentaCorriente.cuentas_a_cobrar?.total_ventas || 0)}
                            </p>
                          </CardContent>
                        </Card>
                        <Card className="border border-green-200 bg-green-50">
                          <CardContent className="pt-3 pb-2">
                            <p className="text-xs text-green-700">Cobros</p>
                            <p className="text-lg font-bold text-green-800">
                              {formatCurrency(cuentaCorriente.cuentas_a_cobrar?.total_cobros || 0)}
                            </p>
                          </CardContent>
                        </Card>
                        <Card className={`border ${(cuentaCorriente.balance_neto || 0) >= 0 ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}`}>
                          <CardContent className="pt-3 pb-2">
                            <p className={`text-xs ${(cuentaCorriente.balance_neto || 0) >= 0 ? 'text-green-700' : 'text-red-700'}`}>Balance Neto</p>
                            <p className={`text-lg font-bold ${(cuentaCorriente.balance_neto || 0) >= 0 ? 'text-green-800' : 'text-red-800'}`}>
                              {formatCurrency(cuentaCorriente.balance_neto || 0)}
                            </p>
                          </CardContent>
                        </Card>
                      </div>

                      {/* Cuentas a Cobrar */}
                      {cuentaCorriente.cuentas_a_cobrar?.movimientos?.length > 0 && (
                        <Card>
                          <CardHeader>
                            <div className="flex items-center justify-between">
                              <span className="font-semibold">Cuentas a Cobrar</span>
                              <span className={`text-sm font-bold ${(cuentaCorriente.cuentas_a_cobrar.saldo || 0) >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                                Saldo: {formatCurrency(cuentaCorriente.cuentas_a_cobrar.saldo || 0)}
                              </span>
                            </div>
                          </CardHeader>
                          <CardContent className="overflow-x-auto">
                            <table className="min-w-full border-collapse text-sm">
                              <thead>
                                <tr className="border-b border-gray-200 bg-gray-50">
                                  <th className="px-4 py-2 text-left font-semibold text-gray-900">Fecha</th>
                                  <th className="px-4 py-2 text-left font-semibold text-gray-900">Tipo</th>
                                  <th className="px-4 py-2 text-left font-semibold text-gray-900">Descripcion</th>
                                  <th className="px-4 py-2 text-right font-semibold text-gray-900">Debe</th>
                                  <th className="px-4 py-2 text-right font-semibold text-gray-900">Haber</th>
                                  <th className="px-4 py-2 text-right font-semibold text-gray-900">Saldo</th>
                                </tr>
                              </thead>
                              <tbody>
                                {cuentaCorriente.cuentas_a_cobrar.movimientos.map((m: any, idx: number) => (
                                  <tr key={`${m.id}-${idx}`} className="border-b border-gray-100 even:bg-gray-50/50">
                                    <td className="px-4 py-2 text-gray-600">{formatDate(m.fecha)}</td>
                                    <td className="px-4 py-2">
                                      <StatusBadge
                                        status={m.tipo}
                                        label={m.tipo === 'venta' ? 'Venta' : m.tipo === 'cobro' ? 'Cobro' : m.tipo}
                                        color={m.tipo === 'venta' ? 'blue' : 'green'}
                                      />
                                    </td>
                                    <td className="px-4 py-2 text-gray-600">{m.descripcion}</td>
                                    <td className="px-4 py-2 text-right">{m.debe ? formatCurrency(m.debe) : '-'}</td>
                                    <td className="px-4 py-2 text-right">{m.haber ? formatCurrency(m.haber) : '-'}</td>
                                    <td className="px-4 py-2 text-right font-medium">{formatCurrency(m.saldo)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </CardContent>
                        </Card>
                      )}

                      {/* Cuentas a Pagar */}
                      {cuentaCorriente.cuentas_a_pagar?.movimientos?.length > 0 && (
                        <Card>
                          <CardHeader>
                            <div className="flex items-center justify-between">
                              <span className="font-semibold">Cuentas a Pagar</span>
                              <span className={`text-sm font-bold ${(cuentaCorriente.cuentas_a_pagar.saldo || 0) <= 0 ? 'text-green-700' : 'text-red-700'}`}>
                                Saldo: {formatCurrency(cuentaCorriente.cuentas_a_pagar.saldo || 0)}
                              </span>
                            </div>
                          </CardHeader>
                          <CardContent className="overflow-x-auto">
                            <table className="min-w-full border-collapse text-sm">
                              <thead>
                                <tr className="border-b border-gray-200 bg-gray-50">
                                  <th className="px-4 py-2 text-left font-semibold text-gray-900">Fecha</th>
                                  <th className="px-4 py-2 text-left font-semibold text-gray-900">Tipo</th>
                                  <th className="px-4 py-2 text-left font-semibold text-gray-900">Descripcion</th>
                                  <th className="px-4 py-2 text-right font-semibold text-gray-900">Debe</th>
                                  <th className="px-4 py-2 text-right font-semibold text-gray-900">Haber</th>
                                  <th className="px-4 py-2 text-right font-semibold text-gray-900">Saldo</th>
                                </tr>
                              </thead>
                              <tbody>
                                {cuentaCorriente.cuentas_a_pagar.movimientos.map((m: any, idx: number) => (
                                  <tr key={`${m.id}-${idx}`} className="border-b border-gray-100 even:bg-gray-50/50">
                                    <td className="px-4 py-2 text-gray-600">{formatDate(m.fecha)}</td>
                                    <td className="px-4 py-2">
                                      <StatusBadge
                                        status={m.tipo}
                                        label={m.tipo === 'compra' ? 'Compra' : m.tipo === 'pago' ? 'Pago' : m.tipo}
                                        color={m.tipo === 'compra' ? 'orange' : 'red'}
                                      />
                                    </td>
                                    <td className="px-4 py-2 text-gray-600">{m.descripcion}</td>
                                    <td className="px-4 py-2 text-right">{m.debe ? formatCurrency(m.debe) : '-'}</td>
                                    <td className="px-4 py-2 text-right">{m.haber ? formatCurrency(m.haber) : '-'}</td>
                                    <td className="px-4 py-2 text-right font-medium">{formatCurrency(m.saldo)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </CardContent>
                        </Card>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* Cheques Tab */}
              {activeTab === 'cheques' && (
                <Card>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <span className="font-semibold">Cheques ({cheques.length})</span>
                      {cheques.length > 0 && (
                        <span className="text-sm text-gray-500">
                          Total: {formatCurrency(cheques.reduce((sum: number, ch: any) => sum + parseFloat(ch.amount || '0'), 0))}
                        </span>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent className="overflow-x-auto">
                    {cheques.length === 0 ? (
                      <p className="text-center py-8 text-gray-500">No hay cheques registrados</p>
                    ) : (
                      <table className="min-w-full border-collapse">
                        <thead>
                          <tr className="border-b border-gray-200 bg-gray-50">
                            <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Numero</th>
                            <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Banco</th>
                            <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Librador</th>
                            <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Estado</th>
                            <th className="px-4 py-3 text-right text-sm font-semibold text-gray-900">Monto</th>
                            <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Vencimiento</th>
                          </tr>
                        </thead>
                        <tbody>
                          {cheques.map((ch: any) => (
                            <tr key={ch.id} className="border-b border-gray-200 hover:bg-gray-50">
                              <td className="px-4 py-3 text-sm font-mono font-medium">{ch.number}</td>
                              <td className="px-4 py-3 text-sm text-gray-600">{ch.bank}</td>
                              <td className="px-4 py-3 text-sm text-gray-600">{ch.drawer}</td>
                              <td className="px-4 py-3 text-sm">
                                <StatusBadge
                                  status={ch.status}
                                  label={
                                    ch.status === 'a_cobrar' ? 'A Cobrar' :
                                    ch.status === 'endosado' ? 'Endosado' :
                                    ch.status === 'depositado' ? 'Depositado' :
                                    ch.status === 'cobrado' ? 'Cobrado' :
                                    ch.status === 'rechazado' ? 'Rechazado' :
                                    ch.status
                                  }
                                  color={
                                    ch.status === 'a_cobrar' ? 'yellow' :
                                    ch.status === 'endosado' ? 'blue' :
                                    ch.status === 'depositado' ? 'purple' :
                                    ch.status === 'cobrado' ? 'green' :
                                    ch.status === 'rechazado' ? 'red' : 'gray'
                                  }
                                />
                              </td>
                              <td className="px-4 py-3 text-sm text-right font-medium">
                                {formatCurrency(parseFloat(ch.amount || '0'))}
                              </td>
                              <td className="px-4 py-3 text-sm text-gray-600">
                                {formatDate(ch.due_date)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </>
      )}

      {/* Empty state when nothing selected */}
      {!selectedEnterprise && !loading && (
        <Card>
          <CardContent className="py-16">
            <div className="text-center">
              <svg className="w-16 h-16 text-gray-300 mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <h3 className="text-lg font-medium text-gray-900 mb-1">Busca una empresa</h3>
              <p className="text-sm text-gray-500">
                Escribi el nombre o CUIT de una empresa para ver toda su informacion:
                pedidos, cotizaciones, facturas, cobros, pagos y cuenta corriente.
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
