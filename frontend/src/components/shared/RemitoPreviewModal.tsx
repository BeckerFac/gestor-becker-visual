import React, { useState, useEffect, useRef, useMemo } from 'react'
import { formatDate } from '@/lib/utils'
import { api } from '@/services/api'
import { toast } from '@/hooks/useToast'

// ─── Types ─────────────────────────────────────────────────────────────────────

interface RemitoItem {
  id?: string
  product_name: string
  description?: string | null
  quantity: number
  unit: string
}

interface RemitoData {
  id: string
  remito_number: number
  date: string
  delivery_address: string | null
  receiver_name: string | null
  transport: string | null
  notes: string | null
  tipo: 'entrega' | 'recepcion'
  status: 'pendiente' | 'entregado' | 'firmado'
  customer_id?: string | null
  enterprise_id?: string | null
  customer?: { id: string; name: string; cuit?: string; email?: string; phone?: string; address?: string } | null
  enterprise?: { id: string; name: string } | null
  order?: { id: string; order_number: number; title: string } | null
  items?: RemitoItem[]
}

interface Customer {
  id: string
  name: string
  cuit: string
  enterprise_id?: string | null
  address?: string
}

interface Enterprise {
  id: string
  name: string
  cuit?: string | null
}

interface RemitoPreviewModalProps {
  remitoId: string
  customers: Customer[]
  enterprises: Enterprise[]
  onClose: () => void
  onSaved: () => void
}

// ─── Constants ──────────────────────────────────────────────────────────────────

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  pendiente: { label: 'Pendiente', color: 'bg-yellow-100 text-yellow-800' },
  entregado: { label: 'Entregado', color: 'bg-blue-100 text-blue-800' },
  firmado:   { label: 'Firmado',   color: 'bg-green-100 text-green-800' },
}

const TIPO_MAP: Record<string, { label: string; color: string }> = {
  entrega:   { label: 'Entrega',   color: 'bg-blue-100 text-blue-700' },
  recepcion: { label: 'Recepcion', color: 'bg-green-100 text-green-700' },
}

const UNIT_OPTIONS = ['unidades', 'metros', 'm2', 'kg', 'rollos', 'paquetes', 'cajas'] as const

function fmtRemitoNumber(n: number) {
  return `#${String(n || 0).padStart(6, '0')}`
}

// ─── Component ──────────────────────────────────────────────────────────────────

export function RemitoPreviewModal({
  remitoId,
  customers,
  enterprises,
  onClose,
  onSaved,
}: RemitoPreviewModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null)

  // Loading states
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [downloadingPdf, setDownloadingPdf] = useState(false)
  const [refreshingPreview, setRefreshingPreview] = useState(false)

  // Remito data
  const [remito, setRemito] = useState<RemitoData | null>(null)

  // Editable fields
  const [customerId, setCustomerId] = useState('')
  const [enterpriseId, setEnterpriseId] = useState('')
  const [deliveryAddress, setDeliveryAddress] = useState('')
  const [receiverName, setReceiverName] = useState('')
  const [transport, setTransport] = useState('')
  const [notes, setNotes] = useState('')
  const [items, setItems] = useState<RemitoItem[]>([])

  // PDF preview
  const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null)

  // Error
  const [error, setError] = useState<string | null>(null)

  // ── Load remito data ──────────────────────────────────────────────────────

  useEffect(() => {
    const loadData = async () => {
      setLoading(true)
      try {
        const [detail, blob] = await Promise.all([
          api.getRemito(remitoId),
          api.getRemitoPdf(remitoId),
        ])
        setRemito(detail)
        setCustomerId(detail.customer_id || detail.customer?.id || '')
        setEnterpriseId(detail.enterprise_id || detail.enterprise?.id || '')
        setDeliveryAddress(detail.delivery_address || '')
        setReceiverName(detail.receiver_name || '')
        setTransport(detail.transport || '')
        setNotes(detail.notes || '')
        setItems(
          (detail.items || []).map((item: any) => ({
            ...item,
            quantity: Number(item.quantity) || 1,
            unit: item.unit || 'unidades',
          }))
        )
        setPdfBlobUrl(URL.createObjectURL(blob))
      } catch (e: any) {
        setError(e.message)
        toast.error('Error al cargar el remito')
      } finally {
        setLoading(false)
      }
    }
    loadData()
  }, [remitoId])

  // ── Escape key + focus trap ───────────────────────────────────────────────

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    dialogRef.current?.focus()
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = ''
      if (pdfBlobUrl) URL.revokeObjectURL(pdfBlobUrl)
    }
  }, [onClose]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Item helpers ──────────────────────────────────────────────────────────

  const updateItem = (idx: number, field: string, value: any) => {
    setItems(prev => prev.map((it, i) => i === idx ? { ...it, [field]: value } : it))
  }

  const addItem = () => {
    setItems(prev => [...prev, { product_name: '', description: '', quantity: 1, unit: 'unidades' }])
  }

  const removeItem = (idx: number) => {
    if (items.length <= 1) return
    setItems(prev => prev.filter((_, i) => i !== idx))
  }

  // ── Filtered customers ────────────────────────────────────────────────────

  const filteredCustomers = enterpriseId
    ? customers.filter(c => c.enterprise_id === enterpriseId)
    : customers

  // ── Enterprise change handler ─────────────────────────────────────────────

  const handleEnterpriseChange = (id: string) => {
    setEnterpriseId(id)
    if (id && customerId) {
      const customer = customers.find(c => c.id === customerId)
      if (customer && customer.enterprise_id !== id) {
        setCustomerId('')
      }
    }
  }

  // ── Save remito ───────────────────────────────────────────────────────────

  const handleSaveRemito = async (silent = false) => {
    const validItems = items.filter(it => it.product_name.trim())
    if (validItems.length === 0) {
      toast.error('Agrega al menos un item con nombre de producto')
      return
    }

    setSaving(true)
    setError(null)
    try {
      await api.updateRemito(remitoId, {
        customer_id: customerId || null,
        enterprise_id: enterpriseId || null,
        delivery_address: deliveryAddress || null,
        receiver_name: receiverName || null,
        transport: transport || null,
        notes: notes || null,
        items: validItems.map(item => ({
          product_name: item.product_name,
          description: item.description || null,
          quantity: Number(item.quantity) || 1,
          unit: item.unit || 'unidades',
        })),
      })
      if (!silent) {
        toast.success('Remito guardado')
        onSaved()
      }
    } catch (e: any) {
      setError(e.message)
      if (!silent) toast.error('Error al guardar: ' + e.message)
      throw e
    } finally {
      setSaving(false)
    }
  }

  // ── Preview refresh ───────────────────────────────────────────────────────

  const handleRefreshPreview = async () => {
    setRefreshingPreview(true)
    setError(null)
    try {
      await handleSaveRemito(true)
      const blob = await api.getRemitoPdf(remitoId)
      if (pdfBlobUrl) URL.revokeObjectURL(pdfBlobUrl)
      setPdfBlobUrl(URL.createObjectURL(blob))
    } catch (e: any) {
      setError(e.message)
      toast.error('Error al generar vista previa')
    } finally {
      setRefreshingPreview(false)
    }
  }

  // ── Download PDF ──────────────────────────────────────────────────────────

  const handleDownloadPdf = async () => {
    setDownloadingPdf(true)
    try {
      await handleSaveRemito(true)
      const blob = await api.getRemitoPdf(remitoId)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `Remito_${String(remito?.remito_number || 0).padStart(6, '0')}.pdf`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (e: any) {
      toast.error('Error al descargar PDF')
    } finally {
      setDownloadingPdf(false)
    }
  }

  // ── Derived values ────────────────────────────────────────────────────────

  const statusInfo = STATUS_MAP[remito?.status || ''] || { label: remito?.status || '', color: 'bg-gray-100 text-gray-700 dark:text-gray-300' }
  const tipoInfo = TIPO_MAP[remito?.tipo || ''] || { label: remito?.tipo || '', color: 'bg-gray-100 text-gray-700 dark:text-gray-300' }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Vista previa de remito"
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="bg-white rounded-xl shadow-2xl w-full max-w-6xl max-h-[90vh] flex flex-col mx-4 outline-none"
        onClick={e => e.stopPropagation()}
      >
        {loading ? (
          <div className="p-8 text-center">
            <svg className="animate-spin h-8 w-8 text-indigo-600 mx-auto mb-3" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/>
            </svg>
            <p className="text-sm text-gray-500">Cargando remito...</p>
          </div>
        ) : remito ? (
          <>
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-3 border-b border-gray-100 shrink-0">
              <div className="flex items-center gap-3">
                {/* R badge */}
                <div className="w-10 h-12 border-2 border-gray-800 flex flex-col items-center justify-center bg-white shrink-0">
                  <span className="text-lg font-bold text-gray-900 dark:text-gray-100 leading-none">R</span>
                  <span className="text-[7px] text-gray-500 border-t border-gray-800 w-full text-center leading-tight pt-0.5">COD. 91</span>
                </div>
                <div>
                  <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">
                    Remito {fmtRemitoNumber(remito.remito_number)}
                  </h3>
                  <p className="text-sm text-gray-500">
                    {formatDate(remito.date)}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${tipoInfo.color}`}>
                  {tipoInfo.label}
                </span>
                <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${statusInfo.color}`}>
                  {statusInfo.label}
                </span>
                <button
                  onClick={onClose}
                  className="text-gray-400 hover:text-gray-600 dark:text-gray-400 transition-colors ml-2"
                  aria-label="Cerrar modal"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Error banner */}
            {error && (
              <div className="mx-6 mt-2 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 flex items-center justify-between">
                <span>{error}</span>
                <button onClick={() => setError(null)} className="ml-2 font-bold text-red-500">x</button>
              </div>
            )}

            {/* Split panel content */}
            <div className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-hidden">

              {/* Left: Editable form */}
              <div className="lg:w-[40%] overflow-y-auto p-5 space-y-4 lg:border-r border-gray-100">

                {/* Enterprise + Customer */}
                <div>
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Destinatario</p>
                  <div className="grid grid-cols-1 gap-3">
                    <div className="flex flex-col gap-1">
                      <label className="text-xs font-medium text-gray-400">Empresa</label>
                      <select
                        className="px-2 py-1.5 border border-gray-200 rounded-lg text-sm bg-white focus:border-indigo-300 focus:ring-1 focus:ring-indigo-200 outline-none"
                        value={enterpriseId}
                        onChange={e => handleEnterpriseChange(e.target.value)}
                      >
                        <option value="">Sin empresa</option>
                        {enterprises.map(e => (
                          <option key={e.id} value={e.id}>{e.name}</option>
                        ))}
                      </select>
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-xs font-medium text-gray-400">
                        Cliente
                        {enterpriseId && <span className="ml-1 text-gray-300">({filteredCustomers.length})</span>}
                      </label>
                      <select
                        className="px-2 py-1.5 border border-gray-200 rounded-lg text-sm bg-white focus:border-indigo-300 focus:ring-1 focus:ring-indigo-200 outline-none"
                        value={customerId}
                        onChange={e => setCustomerId(e.target.value)}
                      >
                        <option value="">Sin cliente</option>
                        {filteredCustomers.map(c => (
                          <option key={c.id} value={c.id}>{c.name}{c.cuit ? ` (${c.cuit})` : ''}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>

                {/* Delivery info */}
                <div>
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Datos de entrega</p>
                  <div className="grid grid-cols-1 gap-3">
                    <div className="flex flex-col gap-1">
                      <label className="text-xs font-medium text-gray-400">Direccion de entrega</label>
                      <input
                        type="text"
                        placeholder="Av. Corrientes 1234, CABA"
                        className="px-2 py-1.5 border border-gray-200 rounded-lg text-sm focus:border-indigo-300 focus:ring-1 focus:ring-indigo-200 outline-none"
                        value={deliveryAddress}
                        onChange={e => setDeliveryAddress(e.target.value)}
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="flex flex-col gap-1">
                        <label className="text-xs font-medium text-gray-400">Receptor</label>
                        <input
                          type="text"
                          placeholder="Juan Perez"
                          className="px-2 py-1.5 border border-gray-200 rounded-lg text-sm focus:border-indigo-300 focus:ring-1 focus:ring-indigo-200 outline-none"
                          value={receiverName}
                          onChange={e => setReceiverName(e.target.value)}
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="text-xs font-medium text-gray-400">Transporte</label>
                        <input
                          type="text"
                          placeholder="Ej: Andreani, OCA"
                          className="px-2 py-1.5 border border-gray-200 rounded-lg text-sm focus:border-indigo-300 focus:ring-1 focus:ring-indigo-200 outline-none"
                          value={transport}
                          onChange={e => setTransport(e.target.value)}
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Order reference (read-only) */}
                {remito.order && (
                  <div>
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Pedido asociado</p>
                    <div className="bg-blue-50 rounded-lg p-3">
                      <span className="font-mono text-sm bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">
                        #{String(remito.order.order_number).padStart(4, '0')}
                      </span>
                      <span className="ml-2 text-sm text-gray-700 dark:text-gray-300">{remito.order.title}</span>
                    </div>
                  </div>
                )}

                {/* Items */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
                      Items ({items.length})
                    </p>
                    <button
                      type="button"
                      onClick={addItem}
                      className="px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
                    >
                      + Agregar
                    </button>
                  </div>
                  {items.length === 0 ? (
                    <div className="text-center py-4 text-sm text-amber-600 bg-amber-50 rounded-lg border border-amber-200">
                      Agrega al menos un item
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {items.map((item, idx) => (
                        <div key={idx} className="flex gap-2 items-center bg-gray-50 p-2.5 rounded-lg">
                          <div className="flex-1 min-w-0">
                            <input
                              className="w-full px-2 py-1 border border-gray-200 rounded text-sm focus:border-indigo-300 focus:ring-1 focus:ring-indigo-200 outline-none"
                              placeholder="Nombre del producto *"
                              value={item.product_name}
                              onChange={e => updateItem(idx, 'product_name', e.target.value)}
                            />
                          </div>
                          <div className="w-16 shrink-0">
                            <input
                              type="number"
                              min="1"
                              className="w-full px-1 py-1 border border-gray-200 rounded text-sm text-center focus:border-indigo-300 focus:ring-1 focus:ring-indigo-200 outline-none"
                              value={item.quantity}
                              onChange={e => updateItem(idx, 'quantity', parseInt(e.target.value) || 1)}
                            />
                          </div>
                          <div className="w-24 shrink-0">
                            <select
                              className="w-full px-1 py-1 border border-gray-200 rounded text-sm focus:border-indigo-300 focus:ring-1 focus:ring-indigo-200 outline-none"
                              value={item.unit}
                              onChange={e => updateItem(idx, 'unit', e.target.value)}
                            >
                              {UNIT_OPTIONS.map(u => (
                                <option key={u} value={u}>{u.charAt(0).toUpperCase() + u.slice(1)}</option>
                              ))}
                            </select>
                          </div>
                          <button
                            type="button"
                            onClick={() => removeItem(idx)}
                            disabled={items.length <= 1}
                            className="w-6 h-6 shrink-0 flex items-center justify-center rounded text-red-400 hover:text-red-600 hover:bg-red-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                          >
                            x
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Notes */}
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-gray-400">Observaciones</label>
                  <textarea
                    rows={2}
                    placeholder="Notas adicionales..."
                    className="px-2 py-1.5 border border-gray-200 rounded-lg text-sm resize-none focus:border-indigo-300 focus:ring-1 focus:ring-indigo-200 outline-none transition-colors"
                    value={notes}
                    onChange={e => setNotes(e.target.value)}
                  />
                </div>
              </div>

              {/* Right: PDF preview */}
              <div className="lg:w-[60%] bg-gray-50 p-5 overflow-y-auto flex flex-col items-center">
                <button
                  onClick={handleRefreshPreview}
                  disabled={refreshingPreview || items.length === 0}
                  className="mb-3 px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2"
                >
                  {refreshingPreview ? (
                    <>
                      <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      Generando...
                    </>
                  ) : (
                    'Actualizar vista previa'
                  )}
                </button>

                {pdfBlobUrl ? (
                  <iframe
                    src={pdfBlobUrl}
                    title="Vista previa del remito PDF"
                    className="w-full flex-1 min-h-[500px] rounded-lg border border-gray-200 bg-white"
                  />
                ) : (
                  <div className="flex flex-col items-center justify-center text-gray-400 py-16 w-full flex-1">
                    <svg className="w-16 h-16 mb-3 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    <p className="text-sm">Cargando vista previa del PDF...</p>
                  </div>
                )}
              </div>
            </div>

            {/* Actions */}
            <div className="px-6 py-3 border-t border-gray-100 bg-gray-50/50 rounded-b-xl shrink-0 flex items-center justify-between">
              <button
                onClick={onClose}
                className="px-4 py-2 text-gray-600 dark:text-gray-400 border border-gray-200 rounded-lg text-sm hover:bg-gray-100 transition-colors"
              >
                Cerrar
              </button>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleDownloadPdf}
                  disabled={downloadingPdf || items.length === 0}
                  className="px-4 py-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg hover:bg-green-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {downloadingPdf ? 'Generando...' : 'Descargar PDF'}
                </button>
                <button
                  onClick={() => handleSaveRemito(false)}
                  disabled={saving || items.length === 0}
                  className="px-5 py-2 bg-indigo-600 text-white rounded-lg text-sm font-semibold hover:bg-indigo-700 transition-colors disabled:opacity-60 disabled:cursor-not-allowed inline-flex items-center gap-2"
                >
                  {saving ? (
                    <>
                      <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      Guardando...
                    </>
                  ) : (
                    'Guardar cambios'
                  )}
                </button>
              </div>
            </div>
          </>
        ) : null}
      </div>
    </div>
  )
}
