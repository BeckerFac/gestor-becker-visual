import React, { useState, useEffect, useMemo } from 'react'
import { Card, CardContent, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { SkeletonTable } from '@/components/ui/Skeleton'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Pagination } from '@/components/shared/Pagination'
import { EmptyState } from '@/components/shared/EmptyState'
import { DateRangeFilter } from '@/components/shared/DateRangeFilter'
import { ExportCSVButton } from '@/components/shared/ExportCSV'
import { TagBadges } from '@/components/shared/TagBadges'
import { toast } from '@/hooks/useToast'
import { api } from '@/services/api'
import { PermissionGate } from '@/components/shared/PermissionGate'

interface Cobro {
  id: string
  enterprise_name: string | null
  enterprise_id: string | null
  enterprise_tags?: { id: string; name: string; color: string }[]
  order_id: string | null
  order_number: number | null
  order_title: string | null
  amount: string
  payment_method: string
  bank_name: string | null
  reference: string | null
  payment_date: string
  notes: string | null
  has_receipt: boolean
  item_count: number
}

interface Enterprise { id: string; name: string }
interface Order { id: string; order_number: number; title: string; total_amount: string; customer?: { enterprise_id?: string } }
interface Bank { id: string; bank_name: string }

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  efectivo: 'Efectivo',
  mercado_pago: 'Mercado Pago',
  transferencia: 'Transferencia',
  cheque: 'Cheque',
  tarjeta: 'Tarjeta',
}

export const Cobros: React.FC = () => {
  const [cobros, setCobros] = useState<Cobro[]>([])
  const [enterprises, setEnterprises] = useState<Enterprise[]>([])
  const [orders, setOrders] = useState<Order[]>([])
  const [banks, setBanks] = useState<Bank[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filterEnterprise, setFilterEnterprise] = useState('')
  const [filterMethod, setFilterMethod] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [deleteTarget, setDeleteTarget] = useState<Cobro | null>(null)
  const [deleting, setDeleting] = useState(false)

  const [orderItems, setOrderItems] = useState<any[]>([])
  const [selectedItems, setSelectedItems] = useState<Record<string, string>>({}) // order_item_id -> amount
  const [loadingItems, setLoadingItems] = useState(false)
  const [receiptFile, setReceiptFile] = useState<File | null>(null)
  const [receiptPreview, setReceiptPreview] = useState<string | null>(null)

  const [form, setForm] = useState({
    enterprise_id: '', order_id: '',
    amount: '', payment_method: 'transferencia', bank_id: '',
    reference: '', payment_date: new Date().toISOString().split('T')[0], notes: '',
  })

  const loadOrderItems = async (orderId: string) => {
    if (!orderId) { setOrderItems([]); setSelectedItems({}); return }
    setLoadingItems(true)
    try {
      const details = await api.getOrderPaymentDetails(orderId)
      const items = details.items || []
      setOrderItems(items)
      // Initialize with remaining amount for each item
      const initial: Record<string, string> = {}
      items.forEach((item: any) => {
        if (item.remaining > 0) initial[item.order_item_id] = parseFloat(item.remaining).toFixed(2)
      })
      setSelectedItems(initial)
      // Auto-calculate total from initialized items
      const itemTotal = Object.values(initial).reduce((s, v) => s + parseFloat(v || '0'), 0)
      if (itemTotal > 0) setForm(f => ({ ...f, amount: itemTotal.toFixed(2) }))
    } catch (e: any) {
      console.warn('Could not load order items:', e.message)
      setOrderItems([])
    } finally {
      setLoadingItems(false)
    }
  }

  const loadData = async () => {
    try {
      setLoading(true)
      const [cobrosRes, entRes, ordersRes, bankRes] = await Promise.all([
        api.getCobros(filterEnterprise ? { enterprise_id: filterEnterprise } : undefined),
        api.getEnterprises(),
        api.getOrders(),
        api.getBanks(),
      ])
      setCobros(cobrosRes || [])
      setEnterprises(entRes || [])
      setOrders((ordersRes.items || ordersRes || []))
      setBanks(bankRes || [])
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadData() }, [filterEnterprise])
  useEffect(() => { setCurrentPage(1) }, [filterEnterprise, filterMethod, dateFrom, dateTo, pageSize])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.amount || parseFloat(form.amount) <= 0) {
      setError('El monto debe ser mayor a 0')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const items = Object.entries(selectedItems)
        .filter(([_, amount]) => parseFloat(amount) > 0)
        .map(([order_item_id, amount_paid]) => ({ order_item_id, amount_paid: parseFloat(amount_paid) }))

      await api.createCobro({
        enterprise_id: form.enterprise_id || null,
        order_id: form.order_id || null,
        amount: parseFloat(form.amount),
        payment_method: form.payment_method,
        bank_id: form.bank_id || null,
        reference: form.reference || null,
        payment_date: form.payment_date,
        notes: form.notes || null,
        items: items.length > 0 ? items : undefined,
        receipt_image: receiptPreview || undefined,
      })
      setShowForm(false)
      setForm({ enterprise_id: '', order_id: '', amount: '', payment_method: 'transferencia', bank_id: '', reference: '', payment_date: new Date().toISOString().split('T')[0], notes: '' })
      setSelectedItems({})
      setOrderItems([])
      setReceiptFile(null)
      setReceiptPreview(null)
      toast.success('Cobro registrado correctamente')
      await loadData()
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await api.deleteCobro(deleteTarget.id)
      toast.success('Cobro eliminado')
      setDeleteTarget(null)
      await loadData()
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setDeleting(false)
    }
  }

  const fmt = (n: any) => Number(n || 0).toLocaleString('es-AR', { style: 'currency', currency: 'ARS' })
  const fmtDate = (d: string) => new Date(d).toLocaleDateString('es-AR')
  const showBankSelector = form.payment_method === 'transferencia' || form.payment_method === 'cheque'

  // Filtered + paginated data
  const filteredCobros = useMemo(() => {
    let result = cobros
    if (filterMethod) result = result.filter(c => c.payment_method === filterMethod)
    if (dateFrom) result = result.filter(c => c.payment_date >= dateFrom)
    if (dateTo) result = result.filter(c => c.payment_date <= dateTo + 'T23:59:59')
    return result
  }, [cobros, filterMethod, dateFrom, dateTo])

  const totalCobrado = filteredCobros.reduce((sum, c) => sum + Number(c.amount || 0), 0)
  const totalPages = Math.ceil(filteredCobros.length / pageSize)
  const paginatedCobros = filteredCobros.slice((currentPage - 1) * pageSize, currentPage * pageSize)

  const isFiltered = !!filterEnterprise || !!filterMethod || !!dateFrom || !!dateTo

  const filteredOrders = form.enterprise_id
    ? orders.filter((o: any) => o.enterprise_id === form.enterprise_id || o.customer?.enterprise_id === form.enterprise_id)
    : orders

  const csvColumns = [
    { key: 'payment_date', label: 'Fecha' },
    { key: 'enterprise_name', label: 'Empresa' },
    { key: 'order_number', label: 'Pedido N°' },
    { key: 'amount', label: 'Monto' },
    { key: 'payment_method', label: 'Método' },
    { key: 'bank_name', label: 'Banco' },
    { key: 'reference', label: 'Referencia' },
    { key: 'notes', label: 'Notas' },
  ]

  const clearFilters = () => {
    setFilterEnterprise('')
    setFilterMethod('')
    setDateFrom('')
    setDateTo('')
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Cobros</h1>
          <p className="text-sm text-gray-500 mt-1">Pagos recibidos de empresas</p>
        </div>
        <div className="flex items-center gap-2">
          <ExportCSVButton data={filteredCobros} columns={csvColumns} filename="cobros" />
          <PermissionGate module="cobros" action="create">
            <Button variant={showForm ? 'danger' : 'primary'} onClick={() => setShowForm(!showForm)}>
              {showForm ? 'Cancelar' : '+ Registrar Cobro'}
            </Button>
          </PermissionGate>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <Card className="border border-green-200 bg-green-50">
          <CardContent className="pt-3 pb-2">
            <p className="text-xs text-green-700">Total Cobrado</p>
            <p className="text-xl font-bold text-green-800">{fmt(totalCobrado)}</p>
          </CardContent>
        </Card>
        <Card className="border border-blue-200 bg-blue-50">
          <CardContent className="pt-3 pb-2">
            <p className="text-xs text-blue-700">Registros</p>
            <p className="text-xl font-bold text-blue-800">{filteredCobros.length}</p>
          </CardContent>
        </Card>
        <Card className="border border-purple-200 bg-purple-50">
          <CardContent className="pt-3 pb-2">
            <p className="text-xs text-purple-700">Empresas</p>
            <p className="text-xl font-bold text-purple-800">{new Set(filteredCobros.map(c => c.enterprise_id).filter(Boolean)).size}</p>
          </CardContent>
        </Card>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg animate-fadeIn">
          {error}<button onClick={() => setError(null)} className="ml-2 font-bold">×</button>
        </div>
      )}

      {showForm && (
        <Card className="animate-fadeIn">
          <CardHeader><h3 className="text-lg font-semibold">Registrar Cobro</h3></CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-gray-700">Empresa</label>
                <select className="px-3 py-2 border border-gray-300 rounded-lg" value={form.enterprise_id} onChange={e => setForm({ ...form, enterprise_id: e.target.value, order_id: '' })}>
                  <option value="">Seleccionar...</option>
                  {enterprises.map(ent => <option key={ent.id} value={ent.id}>{ent.name}</option>)}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-gray-700">Pedido asociado</label>
                <select className="px-3 py-2 border border-gray-300 rounded-lg" value={form.order_id} onChange={e => { setForm({ ...form, order_id: e.target.value }); loadOrderItems(e.target.value) }}>
                  <option value="">Sin pedido</option>
                  {filteredOrders.map((o: any) => <option key={o.id} value={o.id}>#{String(o.order_number).padStart(4, '0')} — {o.title} ({fmt(o.total_amount)})</option>)}
                </select>
              </div>
              <Input label="Monto *" type="number" step="0.01" min="0.01" placeholder="0.00" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} required />
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-gray-700">Método de Pago *</label>
                <select className="px-3 py-2 border border-gray-300 rounded-lg" value={form.payment_method} onChange={e => setForm({ ...form, payment_method: e.target.value, bank_id: '' })}>
                  <option value="efectivo">Efectivo</option>
                  <option value="mercado_pago">Mercado Pago</option>
                  <option value="transferencia">Transferencia</option>
                  <option value="cheque">Cheque</option>
                  <option value="tarjeta">Tarjeta</option>
                </select>
              </div>
              {showBankSelector && (
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-gray-700">Banco *</label>
                  <select className="px-3 py-2 border border-gray-300 rounded-lg" value={form.bank_id} onChange={e => setForm({ ...form, bank_id: e.target.value })}>
                    <option value="">Seleccionar banco...</option>
                    {banks.map(b => <option key={b.id} value={b.id}>{b.bank_name}</option>)}
                  </select>
                </div>
              )}
              <Input label="Referencia" placeholder="N° transferencia, cheque, etc." value={form.reference} onChange={e => setForm({ ...form, reference: e.target.value })} />
              <Input label="Fecha" type="date" value={form.payment_date} onChange={e => setForm({ ...form, payment_date: e.target.value })} />
              {/* Partial payment items */}
              {form.order_id && orderItems.length > 0 && (
                <div className="col-span-full">
                  <label className="text-sm font-medium text-gray-700 block mb-2">Items del Pedido (pago parcial)</label>
                  <div className="border border-gray-200 rounded-lg overflow-hidden">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-gray-50 text-xs text-gray-500">
                          <th className="px-3 py-2 text-left">Producto</th>
                          <th className="px-3 py-2 text-right">Subtotal</th>
                          <th className="px-3 py-2 text-right">Pagado</th>
                          <th className="px-3 py-2 text-right">Restante</th>
                          <th className="px-3 py-2 text-right">Pagar</th>
                        </tr>
                      </thead>
                      <tbody>
                        {orderItems.map((item: any) => (
                          <tr key={item.order_item_id} className="border-t border-gray-100">
                            <td className="px-3 py-2 text-gray-900">{item.product_name}{item.description ? ` - ${item.description}` : ''}</td>
                            <td className="px-3 py-2 text-right text-gray-600">{fmt(item.subtotal)}</td>
                            <td className="px-3 py-2 text-right text-green-600">{fmt(item.total_paid)}</td>
                            <td className="px-3 py-2 text-right font-medium">{fmt(item.remaining)}</td>
                            <td className="px-3 py-2 text-right w-32">
                              {item.remaining > 0 ? (
                                <input
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  max={item.remaining}
                                  placeholder="0.00"
                                  value={selectedItems[item.order_item_id] || ''}
                                  onChange={e => {
                                    const val = e.target.value
                                    const newItems = { ...selectedItems }
                                    if (val && parseFloat(val) > 0) newItems[item.order_item_id] = val
                                    else delete newItems[item.order_item_id]
                                    setSelectedItems(newItems)
                                    // Auto-calculate total
                                    const itemTotal = Object.values(newItems).reduce((s, v) => s + parseFloat(v || '0'), 0)
                                    if (itemTotal > 0) setForm(f => ({ ...f, amount: itemTotal.toFixed(2) }))
                                  }}
                                  className="w-full px-2 py-1 border border-gray-300 rounded text-right text-sm"
                                />
                              ) : (
                                <span className="text-xs text-green-600 font-medium">Completo</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {loadingItems && <p className="text-xs text-gray-400 mt-1">Cargando items...</p>}
                </div>
              )}

              {/* Receipt upload */}
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-gray-700">Comprobante</label>
                <input
                  type="file"
                  accept="image/*,.pdf"
                  onChange={e => {
                    const file = e.target.files?.[0]
                    if (file) {
                      if (file.size > 2 * 1024 * 1024) {
                        toast.error('El archivo no debe superar 2MB')
                        return
                      }
                      setReceiptFile(file)
                      const reader = new FileReader()
                      reader.onload = () => setReceiptPreview(reader.result as string)
                      reader.readAsDataURL(file)
                    }
                  }}
                  className="text-sm text-gray-500 file:mr-2 file:py-1 file:px-3 file:rounded file:border-0 file:text-sm file:bg-gray-100 file:text-gray-700 hover:file:bg-gray-200"
                />
                {receiptPreview && (
                  <div className="mt-1 flex items-center gap-2">
                    <span className="text-xs text-green-600">Archivo seleccionado</span>
                    <button onClick={() => { setReceiptFile(null); setReceiptPreview(null) }} className="text-xs text-red-500">Quitar</button>
                  </div>
                )}
              </div>

              <div className="col-span-full">
                <label className="text-sm font-medium text-gray-700 block mb-1">Notas</label>
                <textarea className="w-full px-3 py-2 border border-gray-300 rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y" rows={2} placeholder="Observaciones..." value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
              </div>
              <div className="flex items-end">
                <Button type="submit" variant="success" loading={saving} className="w-full">Registrar Cobro</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Filters */}
      <Card>
        <CardContent className="pt-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-500">Empresa</label>
              <select className="px-2 py-1.5 border border-gray-300 rounded-lg text-sm" value={filterEnterprise} onChange={e => setFilterEnterprise(e.target.value)}>
                <option value="">Todas las empresas</option>
                {enterprises.map(ent => <option key={ent.id} value={ent.id}>{ent.name}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-500">Método de Pago</label>
              <select className="px-2 py-1.5 border border-gray-300 rounded-lg text-sm" value={filterMethod} onChange={e => setFilterMethod(e.target.value)}>
                <option value="">Todos</option>
                <option value="efectivo">Efectivo</option>
                <option value="mercado_pago">Mercado Pago</option>
                <option value="transferencia">Transferencia</option>
                <option value="cheque">Cheque</option>
                <option value="tarjeta">Tarjeta</option>
              </select>
            </div>
            <div className="col-span-2 md:col-span-2">
              <DateRangeFilter dateFrom={dateFrom} dateTo={dateTo} onDateFromChange={setDateFrom} onDateToChange={setDateTo} onClear={() => { setDateFrom(''); setDateTo('') }} />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      {loading ? (
        <SkeletonTable rows={6} cols={5} />
      ) : filteredCobros.length === 0 ? (
        <EmptyState
          title={isFiltered ? 'No hay cobros con estos filtros' : 'No hay cobros registrados'}
          description={isFiltered ? undefined : 'Registrá el primer cobro para empezar a llevar el control'}
          variant={isFiltered ? 'filtered' : 'empty'}
          actionLabel={isFiltered ? 'Limpiar filtros' : '+ Registrar Cobro'}
          onAction={isFiltered ? clearFilters : () => setShowForm(true)}
        />
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50 text-left text-sm font-medium text-gray-500">
                  <th className="px-4 py-3">Fecha</th>
                  <th className="px-4 py-3">Empresa</th>
                  <th className="px-4 py-3">Pedido</th>
                  <th className="px-4 py-3 text-right">Monto</th>
                  <th className="px-4 py-3">Método</th>
                  <th className="px-4 py-3">Banco</th>
                  <th className="px-4 py-3">Referencia</th>
                  <th className="px-4 py-3"></th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {paginatedCobros.map(cobro => (
                  <tr key={cobro.id} className="border-b hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 text-sm text-gray-600">{fmtDate(cobro.payment_date)}</td>
                    <td className="px-4 py-3 text-sm text-gray-900">
                      <div className="flex items-center gap-1.5">
                        {cobro.enterprise_name || <span className="text-gray-400">-</span>}
                        <TagBadges tags={cobro.enterprise_tags || []} size="sm" />
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {cobro.order_number ? (
                        <span className="font-mono text-xs bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded">#{String(cobro.order_number).padStart(4, '0')}</span>
                      ) : '-'}
                    </td>
                    <td className="px-4 py-3 text-right"><span className="font-bold text-green-700">{fmt(cobro.amount)}</span></td>
                    <td className="px-4 py-3 text-sm">{PAYMENT_METHOD_LABELS[cobro.payment_method] || cobro.payment_method}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{cobro.bank_name || '-'}</td>
                    <td className="px-4 py-3">{cobro.reference ? <span className="font-mono text-xs">{cobro.reference}</span> : '-'}</td>
                    <td className="px-4 py-3 text-center">
                      {(cobro as any).has_receipt && (
                        <button
                          onClick={async (e) => {
                            e.stopPropagation()
                            try {
                              const res = await api.getCobroReceipt(cobro.id)
                              const w = window.open('', '_blank')
                              if (w) {
                                w.document.write(`<html><body style="margin:0;display:flex;justify-content:center;align-items:center;min-height:100vh;background:#f3f4f6"><img src="${res.receipt_image}" style="max-width:100%;max-height:100vh" /></body></html>`)
                              }
                            } catch (err: any) {
                              toast.error(err.message)
                            }
                          }}
                          className="text-blue-500 hover:text-blue-700"
                          title="Ver comprobante"
                        >
                          <svg className="w-4 h-4 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                          </svg>
                        </button>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <PermissionGate module="cobros" action="delete">
                        <button onClick={() => setDeleteTarget(cobro)} className="text-red-500 hover:text-red-700 text-sm transition-colors">Eliminar</button>
                      </PermissionGate>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            currentPage={currentPage}
            totalPages={totalPages}
            totalItems={filteredCobros.length}
            pageSize={pageSize}
            onPageChange={setCurrentPage}
            onPageSizeChange={setPageSize}
          />
        </Card>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        title="Eliminar cobro"
        message="¿Eliminar este cobro? Esta accion no se puede deshacer."
        confirmLabel="Eliminar"
        variant="danger"
        loading={deleting}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}
