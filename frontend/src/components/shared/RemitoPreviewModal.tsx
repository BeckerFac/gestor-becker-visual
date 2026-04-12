import React, { useState, useEffect, useRef } from 'react'
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
  status: 'pendiente' | 'entregado' | 'firmado' | 'anulado'
  customer_id?: string | null
  enterprise_id?: string | null
  customer?: { id: string; name: string; cuit?: string; email?: string; phone?: string; address?: string } | null
  enterprise?: { id: string; name: string; razon_social?: string; cuit?: string; tax_condition?: string; address?: string; city?: string; province?: string } | null
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
  /** @deprecated remitos are immutable — modal is read-only. Kept for API compat. */
  onSaved?: () => void
}

// ─── Constants ──────────────────────────────────────────────────────────────────

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  pendiente: { label: 'Pendiente', color: 'bg-yellow-100 text-yellow-800' },
  entregado: { label: 'Entregado', color: 'bg-blue-100 text-blue-800' },
  firmado:   { label: 'Firmado',   color: 'bg-green-100 text-green-800' },
  anulado:   { label: 'Anulado',   color: 'bg-red-100 text-red-800 line-through' },
}

const TIPO_MAP: Record<string, { label: string; color: string }> = {
  entrega:   { label: 'Entrega',   color: 'bg-blue-100 text-blue-700' },
  recepcion: { label: 'Recepcion', color: 'bg-green-100 text-green-700' },
}

function fmtRemitoNumber(n: number) {
  return `#${String(n || 0).padStart(6, '0')}`
}

// ─── Component ──────────────────────────────────────────────────────────────────

export function RemitoPreviewModal({
  remitoId,
  onClose,
}: RemitoPreviewModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null)

  const [loading, setLoading] = useState(true)
  const [downloadingPdf, setDownloadingPdf] = useState(false)
  const [remito, setRemito] = useState<RemitoData | null>(null)
  const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // ── Load remito + PDF ─────────────────────────────────────────────────────

  useEffect(() => {
    const loadData = async () => {
      setLoading(true)
      try {
        const [detail, blob] = await Promise.all([
          api.getRemito(remitoId),
          api.getRemitoPdf(remitoId),
        ])
        setRemito(detail)
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

  // ── Escape key ────────────────────────────────────────────────────────────

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

  // ── Download PDF ──────────────────────────────────────────────────────────

  const handleDownloadPdf = async () => {
    setDownloadingPdf(true)
    try {
      const blob = await api.getRemitoPdf(remitoId)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `Remito_${String(remito?.remito_number || 0).padStart(6, '0')}.pdf`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch {
      toast.error('Error al descargar PDF')
    } finally {
      setDownloadingPdf(false)
    }
  }

  // ── Derived values ────────────────────────────────────────────────────────

  const statusInfo = STATUS_MAP[remito?.status || ''] || { label: remito?.status || '', color: 'bg-gray-100 text-gray-700 dark:text-gray-300' }
  const tipoInfo = TIPO_MAP[remito?.tipo || ''] || { label: remito?.tipo || '', color: 'bg-gray-100 text-gray-700 dark:text-gray-300' }
  const isAnulado = remito?.status === 'anulado'

  // Small helpers for read-only display
  const Field = ({ label, value }: { label: string; value: React.ReactNode }) => (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">{label}</span>
      <span className="text-sm text-gray-800 dark:text-gray-200">{value || <span className="text-gray-400 italic">—</span>}</span>
    </div>
  )

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Detalle del remito"
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
            <div className={`flex items-center justify-between px-6 py-3 border-b border-gray-100 shrink-0 ${isAnulado ? 'bg-red-50/50' : ''}`}>
              <div className="flex items-center gap-3">
                {/* R badge */}
                <div className="w-10 h-12 border-2 border-gray-800 flex items-center justify-center bg-white shrink-0">
                  <span className="text-2xl font-bold text-gray-900 leading-none">R</span>
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

            {/* Read-only notice */}
            <div className="mx-6 mt-3 px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-xs text-gray-600 flex items-center gap-2">
              <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
              Los remitos no se pueden modificar una vez creados. Para corregir, anula este remito y crea uno nuevo.
            </div>

            {/* Error banner */}
            {error && (
              <div className="mx-6 mt-2 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 flex items-center justify-between">
                <span>{error}</span>
                <button onClick={() => setError(null)} className="ml-2 font-bold text-red-500">x</button>
              </div>
            )}

            {/* Split panel: read-only data + PDF preview */}
            <div className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-hidden">

              {/* Left: read-only fields */}
              <div className="lg:w-[40%] overflow-y-auto p-5 space-y-4 lg:border-r border-gray-100">

                <div>
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Destinatario</p>
                  <div className="grid grid-cols-1 gap-2">
                    <Field label="Empresa" value={remito.enterprise?.name || remito.enterprise?.razon_social} />
                    {remito.enterprise?.cuit && <Field label="CUIT" value={remito.enterprise.cuit} />}
                    {remito.enterprise?.tax_condition && <Field label="IVA" value={remito.enterprise.tax_condition} />}
                    <Field label="Cliente" value={remito.customer?.name} />
                  </div>
                </div>

                <div>
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Datos de entrega</p>
                  <div className="grid grid-cols-1 gap-2">
                    <Field label="Direccion" value={remito.delivery_address} />
                    <div className="grid grid-cols-2 gap-2">
                      <Field label="Receptor" value={remito.receiver_name} />
                      <Field label="Transporte" value={remito.transport} />
                    </div>
                  </div>
                </div>

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

                <div>
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
                    Items ({remito.items?.length || 0})
                  </p>
                  {!remito.items || remito.items.length === 0 ? (
                    <div className="text-center py-4 text-sm text-gray-400 italic">
                      Sin items
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      {remito.items.map((item, idx) => (
                        <div key={idx} className="flex gap-2 items-center bg-gray-50 p-2 rounded-lg text-sm">
                          <span className="font-mono text-xs text-gray-500 w-10 text-right">{Number(item.quantity) || 0}</span>
                          <span className="flex-1 min-w-0 truncate text-gray-800 dark:text-gray-200">{item.product_name}</span>
                          <span className="text-[10px] text-gray-400 uppercase">{item.unit}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {remito.notes && (
                  <div>
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Observaciones</p>
                    <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap bg-gray-50 rounded-lg p-2">{remito.notes}</p>
                  </div>
                )}
              </div>

              {/* Right: PDF preview */}
              <div className="lg:w-[60%] bg-gray-50 p-5 overflow-y-auto flex flex-col items-center">
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

            {/* Actions: solo Cerrar + Descargar PDF (no hay Guardar) */}
            <div className="px-6 py-3 border-t border-gray-100 bg-gray-50/50 rounded-b-xl shrink-0 flex items-center justify-between">
              <button
                onClick={onClose}
                className="px-4 py-2 text-gray-600 dark:text-gray-400 border border-gray-200 rounded-lg text-sm hover:bg-gray-100 transition-colors"
              >
                Cerrar
              </button>
              <button
                onClick={handleDownloadPdf}
                disabled={downloadingPdf}
                className="px-4 py-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg hover:bg-green-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {downloadingPdf ? 'Generando...' : 'Descargar PDF'}
              </button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  )
}
