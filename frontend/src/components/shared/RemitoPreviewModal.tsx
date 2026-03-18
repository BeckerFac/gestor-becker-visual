import React, { useEffect, useRef } from 'react'
import { formatDate } from '@/lib/utils'

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
  customer?: { id: string; name: string; cuit?: string; email?: string; phone?: string; address?: string } | null
  order?: { id: string; order_number: number; title: string } | null
  items?: RemitoItem[]
}

interface RemitoPreviewModalProps {
  remito: RemitoData | null
  pdfBlobUrl: string | null
  loading: boolean
  downloadingPdf?: boolean
  onClose: () => void
  onDownloadPdf: () => void
}

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  pendiente: { label: 'Pendiente', color: 'bg-yellow-100 text-yellow-800' },
  entregado: { label: 'Entregado', color: 'bg-blue-100 text-blue-800' },
  firmado:   { label: 'Firmado',   color: 'bg-green-100 text-green-800' },
}

const TIPO_MAP: Record<string, { label: string; color: string }> = {
  entrega:   { label: 'Entrega',   color: 'bg-blue-100 text-blue-700' },
  recepcion: { label: 'Recepcion', color: 'bg-green-100 text-green-700' },
}

function fmtRemitoNumber(n: number) {
  return `#${String(n || 0).padStart(6, '0')}`
}

export function RemitoPreviewModal({
  remito,
  pdfBlobUrl,
  loading,
  downloadingPdf,
  onClose,
  onDownloadPdf,
}: RemitoPreviewModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null)

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
    }
  }, [onClose])

  const statusInfo = STATUS_MAP[remito?.status || ''] || { label: remito?.status || '', color: 'bg-gray-100 text-gray-700' }
  const tipoInfo = TIPO_MAP[remito?.tipo || ''] || { label: remito?.tipo || '', color: 'bg-gray-100 text-gray-700' }
  const items = remito?.items || []

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
                  <span className="text-lg font-bold text-gray-900 leading-none">R</span>
                  <span className="text-[7px] text-gray-500 border-t border-gray-800 w-full text-center leading-tight pt-0.5">COD. 91</span>
                </div>
                <div>
                  <h3 className="text-lg font-bold text-gray-900">
                    Remito {fmtRemitoNumber(remito.remito_number)}
                  </h3>
                  <p className="text-sm text-gray-500">
                    {remito.customer?.name || 'Sin cliente'}
                    {' - '}
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
                  className="text-gray-400 hover:text-gray-600 transition-colors ml-2"
                  aria-label="Cerrar modal"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Split panel content */}
            <div className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-hidden">

              {/* Left: Remito details */}
              <div className="lg:w-[40%] overflow-y-auto p-5 space-y-4 lg:border-r border-gray-100">

                {/* Customer info */}
                <div>
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Destinatario</p>
                  <div className="bg-gray-50 rounded-lg p-3 space-y-1">
                    <p className="font-semibold text-gray-900">{remito.customer?.name || 'Sin especificar'}</p>
                    {remito.customer?.cuit && <p className="text-sm text-gray-600">CUIT: {remito.customer.cuit}</p>}
                    {remito.customer?.address && <p className="text-sm text-gray-600">{remito.customer.address}</p>}
                    {remito.customer?.email && <p className="text-sm text-gray-600">{remito.customer.email}</p>}
                    {remito.customer?.phone && <p className="text-sm text-gray-600">Tel: {remito.customer.phone}</p>}
                  </div>
                </div>

                {/* Delivery info */}
                {(remito.delivery_address || remito.receiver_name || remito.transport) && (
                  <div>
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Datos de entrega</p>
                    <div className="bg-indigo-50 rounded-lg p-3 space-y-1.5">
                      {remito.delivery_address && (
                        <div>
                          <span className="text-xs font-semibold text-indigo-600 uppercase">Direccion:</span>
                          <p className="text-sm text-gray-800">{remito.delivery_address}</p>
                        </div>
                      )}
                      {remito.receiver_name && (
                        <div>
                          <span className="text-xs font-semibold text-indigo-600 uppercase">Receptor:</span>
                          <p className="text-sm text-gray-800">{remito.receiver_name}</p>
                        </div>
                      )}
                      {remito.transport && (
                        <div>
                          <span className="text-xs font-semibold text-indigo-600 uppercase">Transporte:</span>
                          <p className="text-sm text-gray-800">{remito.transport}</p>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Order reference */}
                {remito.order && (
                  <div>
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Pedido asociado</p>
                    <div className="bg-blue-50 rounded-lg p-3">
                      <span className="font-mono text-sm bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">
                        #{String(remito.order.order_number).padStart(4, '0')}
                      </span>
                      <span className="ml-2 text-sm text-gray-700">{remito.order.title}</span>
                    </div>
                  </div>
                )}

                {/* Items */}
                <div>
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
                    Items ({items.length})
                  </p>
                  {items.length > 0 ? (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-gray-400 text-xs border-b border-gray-200">
                            <th className="px-2 py-1.5 text-left font-medium">#</th>
                            <th className="px-2 py-1.5 text-left font-medium">Producto</th>
                            <th className="px-2 py-1.5 text-center font-medium w-16">Cant.</th>
                            <th className="px-2 py-1.5 text-center font-medium w-20">Unidad</th>
                          </tr>
                        </thead>
                        <tbody>
                          {items.map((item, idx) => (
                            <tr key={item.id || idx} className="border-t border-gray-100">
                              <td className="px-2 py-1.5 text-gray-400">{idx + 1}</td>
                              <td className="px-2 py-1.5">
                                <span className="font-medium text-gray-900">{item.product_name}</span>
                                {item.description && (
                                  <span className="block text-xs text-gray-500">{item.description}</span>
                                )}
                              </td>
                              <td className="px-2 py-1.5 text-center font-semibold text-gray-700">{item.quantity}</td>
                              <td className="px-2 py-1.5 text-center text-gray-600">{item.unit}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="text-sm text-gray-400 italic">Sin items</p>
                  )}
                </div>

                {/* Notes */}
                {remito.notes && (
                  <div>
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Observaciones</p>
                    <div className="bg-amber-50 border-l-4 border-amber-400 p-3">
                      <p className="text-sm text-amber-900">{remito.notes}</p>
                    </div>
                  </div>
                )}
              </div>

              {/* Right: PDF preview */}
              <div className="lg:w-[60%] bg-gray-50 p-5 overflow-y-auto flex items-start justify-center">
                {pdfBlobUrl ? (
                  <iframe
                    src={pdfBlobUrl}
                    title="Vista previa del remito PDF"
                    className="w-full h-full min-h-[500px] rounded-lg border border-gray-200 bg-white"
                  />
                ) : (
                  <div className="flex flex-col items-center justify-center text-gray-400 py-16 w-full">
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
                className="px-4 py-2 text-gray-600 border border-gray-200 rounded-lg text-sm hover:bg-gray-100 transition-colors"
              >
                Cerrar
              </button>
              <button
                onClick={onDownloadPdf}
                disabled={downloadingPdf}
                className="px-5 py-2 bg-green-600 text-white rounded-lg text-sm font-semibold hover:bg-green-700 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
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
