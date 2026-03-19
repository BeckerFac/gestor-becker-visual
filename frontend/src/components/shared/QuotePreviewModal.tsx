import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { formatCurrency, formatDate } from '@/lib/utils'
import { api } from '@/services/api'
import { toast } from '@/hooks/useToast'

// ─── Types ─────────────────────────────────────────────────────────────────────

interface QuoteItem {
  id?: string
  product_id?: string | null
  product_name: string
  description: string
  quantity: number
  unit_price: number
  vat_rate: number
  subtotal: number
}

interface Customer {
  id: string
  name: string
  cuit: string
  enterprise_id?: string | null
}

interface Enterprise {
  id: string
  name: string
  cuit?: string | null
}

interface QuoteData {
  id: string
  quote_number: number
  title: string
  status: string
  subtotal: string
  vat_amount: string
  total_amount: string
  valid_until: string | null
  notes: string | null
  customer_id?: string | null
  enterprise_id?: string | null
  customer?: { id: string; name: string; cuit: string } | null
  enterprise?: { id: string; name: string } | null
  items?: QuoteItem[]
  created_at: string
}

interface QuotePreviewModalProps {
  quoteId: string
  customers: Customer[]
  enterprises: Enterprise[]
  onClose: () => void
  onSaved: () => void
}

// ─── Constants ──────────────────────────────────────────────────────────────────

const TEMPLATES = [
  { value: 'clasico', label: 'Clasico', desc: 'Formal y profesional', gradient: 'bg-gray-800' },
  { value: 'moderno', label: 'Moderno', desc: 'Minimalista y limpio', gradient: 'bg-gradient-to-r from-blue-400 to-blue-600' },
  { value: 'ejecutivo', label: 'Ejecutivo', desc: 'Corporativo y elegante', gradient: 'bg-gradient-to-r from-indigo-600 to-purple-600' },
]

const VAT_PRESETS = [
  { value: 0, label: '0%' },
  { value: 10.5, label: '10.5%' },
  { value: 21, label: '21%' },
  { value: 27, label: '27%' },
]

const MAX_BANNER_SIZE = 2 * 1024 * 1024 // 2MB

// ─── Component ──────────────────────────────────────────────────────────────────

export function QuotePreviewModal({
  quoteId,
  customers,
  enterprises,
  onClose,
  onSaved,
}: QuotePreviewModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Loading states
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [downloadingPdf, setDownloadingPdf] = useState(false)
  const [refreshingPreview, setRefreshingPreview] = useState(false)
  const [uploadingBanner, setUploadingBanner] = useState(false)

  // Quote data
  const [quote, setQuote] = useState<QuoteData | null>(null)

  // Editable fields
  const [template, setTemplate] = useState('clasico')
  const [title, setTitle] = useState('')
  const [customerId, setCustomerId] = useState('')
  const [enterpriseId, setEnterpriseId] = useState('')
  const [validityDays, setValidityDays] = useState(15)
  const [notes, setNotes] = useState('')
  const [items, setItems] = useState<QuoteItem[]>([])

  // Banner
  const [bannerBase64, setBannerBase64] = useState<string | null>(null)
  const [bannerPreview, setBannerPreview] = useState<string | null>(null)

  // PDF preview
  const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null)

  // Error
  const [error, setError] = useState<string | null>(null)

  // ── Load quote data + banner ──────────────────────────────────────────────

  useEffect(() => {
    const loadData = async () => {
      setLoading(true)
      try {
        const [quoteData, bannerData] = await Promise.all([
          api.getQuote(quoteId),
          api.getQuoteBanner().catch(() => ({ banner: null })),
        ])
        setQuote(quoteData)
        setTitle(quoteData.title || '')
        setCustomerId(quoteData.customer_id || quoteData.customer?.id || '')
        setEnterpriseId(quoteData.enterprise_id || quoteData.enterprise?.id || '')
        setNotes(quoteData.notes || '')
        setItems(
          (quoteData.items || []).map((item: any) => ({
            ...item,
            quantity: Number(item.quantity) || 1,
            unit_price: Number(item.unit_price) || 0,
            vat_rate: Number(item.vat_rate) || 21,
            subtotal: Number(item.subtotal) || 0,
          }))
        )

        // Calculate validity days from valid_until
        if (quoteData.valid_until) {
          const validDate = new Date(quoteData.valid_until)
          const created = new Date(quoteData.created_at)
          const diffDays = Math.ceil((validDate.getTime() - created.getTime()) / (1000 * 60 * 60 * 24))
          setValidityDays(diffDays > 0 ? diffDays : 15)
        }

        // Load banner
        if (bannerData?.banner) {
          setBannerBase64(bannerData.banner)
          setBannerPreview(`data:image/png;base64,${bannerData.banner}`)
        }
      } catch (e: any) {
        setError(e.message)
        toast.error('Error al cargar la cotizacion')
      } finally {
        setLoading(false)
      }
    }
    loadData()
  }, [quoteId])

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
    setItems(prev => [...prev, {
      product_name: '',
      description: '',
      quantity: 1,
      unit_price: 0,
      vat_rate: 21,
      subtotal: 0,
    }])
  }

  const removeItem = (idx: number) => {
    if (items.length <= 1) return
    setItems(prev => prev.filter((_, i) => i !== idx))
  }

  // ── Totals ────────────────────────────────────────────────────────────────

  const subtotal = useMemo(() =>
    items.reduce((sum, i) => sum + (i.quantity * i.unit_price), 0), [items])

  const vatAmount = useMemo(() =>
    items.reduce((sum, i) => sum + (i.quantity * i.unit_price * i.vat_rate / 100), 0), [items])

  const total = subtotal + vatAmount

  // ── Filtered customers ────────────────────────────────────────────────────

  const filteredCustomers = enterpriseId
    ? customers.filter(c => c.enterprise_id === enterpriseId)
    : customers

  // ── Banner upload ─────────────────────────────────────────────────────────

  const handleBannerFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    // Validate format
    if (!['image/png', 'image/jpeg', 'image/jpg'].includes(file.type)) {
      toast.error('Solo se permiten imagenes PNG o JPEG')
      return
    }

    // Validate size
    if (file.size > MAX_BANNER_SIZE) {
      toast.error('La imagen no puede superar 2MB')
      return
    }

    setUploadingBanner(true)
    try {
      const reader = new FileReader()
      reader.onload = async () => {
        const dataUrl = reader.result as string
        const base64 = dataUrl.split(',')[1]
        const mimeType = file.type

        await api.uploadQuoteBanner(base64, mimeType)
        setBannerBase64(base64)
        setBannerPreview(dataUrl)
        toast.success('Banner actualizado')
        setUploadingBanner(false)
      }
      reader.onerror = () => {
        toast.error('Error al leer el archivo')
        setUploadingBanner(false)
      }
      reader.readAsDataURL(file)
    } catch (err: any) {
      toast.error(err.message || 'Error al subir banner')
      setUploadingBanner(false)
    }

    // Reset file input
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleDeleteBanner = async () => {
    try {
      await api.deleteQuoteBanner()
      setBannerBase64(null)
      setBannerPreview(null)
      toast.success('Banner eliminado')
    } catch (err: any) {
      toast.error(err.message || 'Error al eliminar banner')
    }
  }

  // ── Preview refresh ───────────────────────────────────────────────────────

  const handleRefreshPreview = async () => {
    setRefreshingPreview(true)
    setError(null)
    try {
      // Save current data first so the PDF reflects latest changes
      await handleSaveQuote(true)

      const blob = await api.getQuotePdf(quoteId, template)
      if (pdfBlobUrl) URL.revokeObjectURL(pdfBlobUrl)
      setPdfBlobUrl(URL.createObjectURL(blob))
    } catch (e: any) {
      setError(e.message)
      toast.error('Error al generar vista previa')
    } finally {
      setRefreshingPreview(false)
    }
  }

  // ── Save quote ────────────────────────────────────────────────────────────

  const handleSaveQuote = async (silent = false) => {
    if (items.length === 0) {
      toast.error('Agrega al menos un item')
      return
    }

    setSaving(true)
    setError(null)
    try {
      await api.updateQuote(quoteId, {
        title: title || 'Cotizacion',
        customer_id: customerId || null,
        enterprise_id: enterpriseId || null,
        validity_days: validityDays,
        notes: notes || null,
        items: items.map(item => ({
          product_id: item.product_id || null,
          product_name: item.product_name,
          description: item.description || null,
          quantity: Number(item.quantity) || 1,
          unit_price: Number(item.unit_price) || 0,
          vat_rate: Number(item.vat_rate) || 21,
        })),
      })
      if (!silent) {
        toast.success('Cotizacion guardada')
        onSaved()
      }
    } catch (e: any) {
      setError(e.message)
      if (!silent) toast.error('Error al guardar: ' + e.message)
      throw e // Re-throw so preview refresh knows it failed
    } finally {
      setSaving(false)
    }
  }

  // ── Download PDF ──────────────────────────────────────────────────────────

  const handleDownloadPdf = async () => {
    setDownloadingPdf(true)
    try {
      // Save first
      await handleSaveQuote(true)

      const blob = await api.getQuotePdf(quoteId, template)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `cotizacion-${quoteId.slice(0, 8)}.pdf`
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

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Vista previa de cotizacion"
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
            <p className="text-sm text-gray-500">Cargando cotizacion...</p>
          </div>
        ) : quote ? (
          <>
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-3 border-b border-gray-100 shrink-0">
              <div>
                <h3 className="text-lg font-bold text-gray-900">Cotizacion</h3>
                <p className="text-sm text-gray-500">
                  #{String(quote.quote_number || 0).padStart(4, '0')}
                  {title && ` \u2014 ${title}`}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className={`px-3 py-1 rounded-full text-xs font-semibold ${
                  quote.status === 'accepted' ? 'bg-green-100 text-green-800' :
                  quote.status === 'sent' ? 'bg-blue-100 text-blue-800' :
                  quote.status === 'rejected' ? 'bg-red-100 text-red-800' :
                  'bg-amber-50 text-amber-700'
                }`}>
                  {quote.status === 'draft' ? 'Borrador' :
                   quote.status === 'sent' ? 'Enviada' :
                   quote.status === 'accepted' ? 'Aceptada' :
                   quote.status === 'rejected' ? 'Rechazada' : quote.status}
                </span>
                <button
                  onClick={onClose}
                  className="text-gray-400 hover:text-gray-600 transition-colors ml-2"
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

              {/* Left: Form */}
              <div className="flex-1 overflow-y-auto p-5 space-y-4 lg:border-r border-gray-100">

                {/* Template selector */}
                <div>
                  <p className="text-xs font-medium text-gray-400 mb-2">Plantilla</p>
                  <div className="grid grid-cols-3 gap-2">
                    {TEMPLATES.map(t => (
                      <div
                        key={t.value}
                        onClick={() => setTemplate(t.value)}
                        className={`border-2 rounded-lg p-3 cursor-pointer transition-colors ${
                          template === t.value ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'
                        }`}
                      >
                        <div className={`h-1.5 ${t.gradient} rounded mb-1.5`} />
                        <div className="text-xs font-medium">{t.label}</div>
                        <div className="text-[10px] text-gray-500">{t.desc}</div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Banner */}
                <div>
                  <p className="text-xs font-medium text-gray-400 mb-2">Banner</p>
                  <div className="flex items-center gap-3">
                    {bannerPreview ? (
                      <div className="h-12 w-32 rounded border border-gray-200 overflow-hidden bg-gray-50 flex items-center justify-center">
                        <img src={bannerPreview} alt="Banner" className="max-h-full max-w-full object-contain" />
                      </div>
                    ) : (
                      <div className="h-12 w-32 rounded border border-dashed border-gray-300 flex items-center justify-center text-xs text-gray-400">
                        Sin banner
                      </div>
                    )}
                    <div className="flex flex-col gap-1">
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={uploadingBanner}
                        className="px-3 py-1 text-xs bg-blue-50 text-blue-700 border border-blue-200 rounded hover:bg-blue-100 transition-colors disabled:opacity-50"
                      >
                        {uploadingBanner ? 'Subiendo...' : (bannerPreview ? 'Cambiar' : 'Subir banner')}
                      </button>
                      {bannerPreview && (
                        <button
                          type="button"
                          onClick={handleDeleteBanner}
                          className="px-3 py-1 text-xs text-red-600 border border-red-200 rounded hover:bg-red-50 transition-colors"
                        >
                          Eliminar
                        </button>
                      )}
                    </div>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/png,image/jpeg"
                      className="hidden"
                      onChange={handleBannerFileSelect}
                    />
                  </div>
                  <p className="text-[10px] text-gray-400 mt-1">PNG o JPEG, max 2MB. Persiste para futuras cotizaciones.</p>
                </div>

                {/* Title + Validity */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-medium text-gray-400">Titulo</label>
                    <input
                      type="text"
                      placeholder="Ej: Cotizacion Banners"
                      className="px-2 py-1.5 border border-gray-200 rounded-lg text-sm focus:border-indigo-300 focus:ring-1 focus:ring-indigo-200 outline-none transition-colors"
                      value={title}
                      onChange={e => setTitle(e.target.value)}
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-medium text-gray-400">Validez (dias)</label>
                    <input
                      type="number"
                      min="1"
                      max="365"
                      className="px-2 py-1.5 border border-gray-200 rounded-lg text-sm focus:border-indigo-300 focus:ring-1 focus:ring-indigo-200 outline-none transition-colors"
                      value={validityDays}
                      onChange={e => setValidityDays(parseInt(e.target.value) || 15)}
                    />
                  </div>
                </div>

                {/* Enterprise + Customer */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-medium text-gray-400">Empresa</label>
                    <select
                      className="px-2 py-1.5 border border-gray-200 rounded-lg text-sm bg-white focus:border-indigo-300 focus:ring-1 focus:ring-indigo-200 outline-none transition-colors"
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
                      {enterpriseId && (
                        <span className="ml-1 text-gray-300">({filteredCustomers.length})</span>
                      )}
                    </label>
                    <select
                      className="px-2 py-1.5 border border-gray-200 rounded-lg text-sm bg-white focus:border-indigo-300 focus:ring-1 focus:ring-indigo-200 outline-none transition-colors"
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

                {/* Items table */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-medium text-gray-400">Items</p>
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
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-gray-400 text-xs">
                            <th className="px-2 py-1.5 text-left font-medium">Producto</th>
                            <th className="px-2 py-1.5 text-center font-medium w-14">Cant.</th>
                            <th className="px-2 py-1.5 text-right font-medium w-24">P. Unit.</th>
                            <th className="px-2 py-1.5 text-center font-medium w-16">IVA</th>
                            <th className="px-2 py-1.5 text-right font-medium w-24">Subtotal</th>
                            <th className="w-8"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {items.map((item, idx) => {
                            const itemSubtotal = item.quantity * item.unit_price
                            return (
                              <tr key={idx} className="border-t border-gray-100">
                                <td className="px-2 py-1.5">
                                  <input
                                    className="w-full px-1.5 py-1 border border-gray-200 rounded text-sm focus:border-indigo-300 focus:ring-1 focus:ring-indigo-200 outline-none"
                                    placeholder="Nombre del producto"
                                    value={item.product_name}
                                    onChange={e => updateItem(idx, 'product_name', e.target.value)}
                                  />
                                </td>
                                <td className="px-2 py-1.5 text-center">
                                  <input
                                    type="number"
                                    min="1"
                                    className="w-14 px-1 py-1 border border-gray-200 rounded text-sm text-center focus:border-indigo-300 focus:ring-1 focus:ring-indigo-200 outline-none"
                                    value={item.quantity}
                                    onChange={e => updateItem(idx, 'quantity', parseInt(e.target.value) || 0)}
                                  />
                                </td>
                                <td className="px-2 py-1.5 text-right">
                                  <input
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    className={`w-22 px-1 py-1 border rounded text-sm text-right outline-none ${
                                      item.unit_price === 0
                                        ? 'border-red-300 focus:border-red-400 focus:ring-1 focus:ring-red-200'
                                        : 'border-gray-200 focus:border-indigo-300 focus:ring-1 focus:ring-indigo-200'
                                    }`}
                                    value={item.unit_price}
                                    onChange={e => updateItem(idx, 'unit_price', parseFloat(e.target.value) || 0)}
                                  />
                                </td>
                                <td className="px-2 py-1.5 text-center">
                                  <select
                                    className="w-16 px-1 py-1 border border-gray-200 rounded text-sm text-center focus:border-indigo-300 focus:ring-1 focus:ring-indigo-200 outline-none"
                                    value={item.vat_rate}
                                    onChange={e => updateItem(idx, 'vat_rate', parseFloat(e.target.value))}
                                  >
                                    {VAT_PRESETS.map(p => (
                                      <option key={p.value} value={p.value}>{p.label}</option>
                                    ))}
                                  </select>
                                </td>
                                <td className="px-2 py-1.5 text-right font-medium text-gray-700">
                                  {formatCurrency(itemSubtotal)}
                                </td>
                                <td className="px-1 py-1.5">
                                  <button
                                    type="button"
                                    onClick={() => removeItem(idx)}
                                    disabled={items.length <= 1}
                                    className="w-6 h-6 flex items-center justify-center rounded text-red-400 hover:text-red-600 hover:bg-red-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                                  >
                                    x
                                  </button>
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* Totals */}
                <div className="flex justify-end">
                  <div className="w-56 space-y-1 text-sm">
                    <div className="flex justify-between text-gray-500">
                      <span>Neto Gravado</span>
                      <span>{formatCurrency(subtotal)}</span>
                    </div>
                    <div className="flex justify-between text-gray-500">
                      <span>IVA</span>
                      <span>{formatCurrency(vatAmount)}</span>
                    </div>
                    <div className={`flex justify-between text-base font-bold pt-1.5 border-t border-gray-200 ${total === 0 ? 'text-red-500' : 'text-gray-900'}`}>
                      <span>Total</span>
                      <span>{formatCurrency(total)}</span>
                    </div>
                  </div>
                </div>

                {/* Notes */}
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-gray-400">Observaciones</label>
                  <textarea
                    rows={2}
                    placeholder="Notas, condiciones, tiempos de entrega..."
                    className="px-2 py-1.5 border border-gray-200 rounded-lg text-sm resize-none focus:border-indigo-300 focus:ring-1 focus:ring-indigo-200 outline-none transition-colors"
                    value={notes}
                    onChange={e => setNotes(e.target.value)}
                  />
                </div>
              </div>

              {/* Right: PDF Preview */}
              <div className="flex-1 bg-gray-50 p-5 overflow-y-auto flex flex-col items-center">
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
                    title="Vista previa PDF cotizacion"
                    className="w-full flex-1 min-h-[500px] rounded-lg border border-gray-200 bg-white"
                  />
                ) : (
                  <div className="flex flex-col items-center justify-center text-gray-400 py-16 w-full flex-1">
                    <svg className="w-16 h-16 mb-3 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    <p className="text-sm">Hace click en "Actualizar vista previa" para generar el PDF</p>
                  </div>
                )}
              </div>
            </div>

            {/* Actions */}
            <div className="px-6 py-3 border-t border-gray-100 bg-gray-50/50 rounded-b-xl shrink-0 flex items-center justify-between">
              <button
                onClick={onClose}
                className="px-4 py-2 text-gray-600 border border-gray-200 rounded-lg text-sm hover:bg-gray-100 transition-colors"
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
                  onClick={() => handleSaveQuote(false)}
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
