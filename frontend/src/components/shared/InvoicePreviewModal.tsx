import React, { useState, useEffect, useRef } from 'react'
import { formatCurrency, formatDate } from '@/lib/utils'
import type { PreviewItem } from '@/hooks/useInvoicePreview'

const INVOICE_TYPES = ['A', 'B', 'C']

const TAX_CONDITION_MAP: Record<string, string> = {
  A: 'Responsable Inscripto',
  B: 'Consumidor Final / Exento',
  C: 'Monotributista',
}

interface InvoicePreviewModalProps {
  invoice: any
  loading: boolean
  orderId: string
  authorizing: boolean
  authorizeProgress: string
  puntoVenta: number
  invoiceType: string
  items: PreviewItem[]
  authorized: boolean
  authFailed?: boolean
  authErrorMsg?: string
  onClose: () => void
  onPuntoVentaChange: (v: number) => void
  onInvoiceTypeChange: (v: string) => void
  onItemsChange: (items: PreviewItem[]) => void
  onAuthorize: () => void
  onDeleteDraft: (invoiceId: string, orderId: string) => void
  onDownloadPdf: (invoiceId: string, invoice: any) => void
  pdfBlobUrl?: string | null
}

export function InvoicePreviewModal({
  invoice,
  loading,
  orderId,
  authorizing,
  authorizeProgress,
  puntoVenta,
  invoiceType,
  items,
  authorized,
  authFailed,
  authErrorMsg,
  onClose,
  onPuntoVentaChange,
  onInvoiceTypeChange,
  onItemsChange,
  onAuthorize,
  onDeleteDraft,
  onDownloadPdf,
  pdfBlobUrl,
}: InvoicePreviewModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const [activeTab, setActiveTab] = useState<'datos' | 'pdf'>('datos')
  const [showConfirmAuthorize, setShowConfirmAuthorize] = useState(false)

  // CUIT validation: for fiscal type A, CUIT is required
  const customerCuit = invoice?.customer?.cuit || ''
  const isFiscal = !invoice?.fiscal_type || invoice?.fiscal_type === 'fiscal'
  const needsCuit = isFiscal && invoiceType === 'A'
  const missingCuit = needsCuit && !customerCuit

  // Focus trap + Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    // Focus the dialog on mount
    dialogRef.current?.focus()
    // Prevent body scroll
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = ''
    }
  }, [onClose])

  const updateItem = (idx: number, field: string, value: any) => {
    onItemsChange(items.map((it, i) => i === idx ? { ...it, [field]: value } : it))
  }

  const subtotal = items.reduce((sum, i) => sum + (i.quantity * i.unit_price), 0)
  const vatAmount = items.reduce((sum, i) => sum + (i.quantity * i.unit_price * i.vat_rate / 100), 0)
  const total = subtotal + vatAmount

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={authorized ? 'Factura autorizada' : 'Borrador de factura'}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto mx-4 outline-none"
        onClick={e => e.stopPropagation()}
      >
        {loading ? (
          <div className="p-8 text-center">
            <svg className="animate-spin h-8 w-8 text-indigo-600 mx-auto mb-3" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/>
            </svg>
            <p className="text-sm text-gray-500">Cargando factura...</p>
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <div>
                <h3 className="text-lg font-bold text-gray-900">
                  {authorized ? 'Factura Autorizada' : 'Borrador de Factura'}
                </h3>
                <p className="text-sm text-gray-500">
                  #{String(invoice.invoice_number).padStart(8, '0')}
                  {invoice.customer?.name && ` - ${invoice.customer.name}`}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {authorized ? (
                  <span className="px-3 py-1 bg-green-100 text-green-800 rounded-full text-xs font-semibold">Autorizada AFIP</span>
                ) : (
                  <span className="px-3 py-1 bg-yellow-100 text-yellow-800 rounded-full text-xs font-semibold">Borrador</span>
                )}
                <button
                  onClick={onClose}
                  className="text-gray-400 hover:text-gray-600 text-xl leading-none"
                  aria-label="Cerrar modal"
                >
                  &times;
                </button>
              </div>
            </div>

            {/* Tabs */}
            <div className="px-6 pt-4">
              <div className="flex gap-1 bg-gray-100 p-1 rounded-lg mb-4">
                <button
                  className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${activeTab === 'datos' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                  onClick={() => setActiveTab('datos')}
                >
                  Datos
                </button>
                <button
                  className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${activeTab === 'pdf' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                  onClick={() => setActiveTab('pdf')}
                >
                  Vista PDF
                </button>
              </div>
            </div>

            {/* Tab: Vista PDF */}
            {activeTab === 'pdf' && (
              <div className="px-6 py-4">
                {pdfBlobUrl ? (
                  <iframe
                    src={pdfBlobUrl}
                    className="w-full h-[70vh] border border-gray-200 rounded-lg"
                    title="Vista previa PDF"
                  />
                ) : (
                  <div className="flex items-center justify-center h-[70vh] text-gray-500">
                    Cargando PDF...
                  </div>
                )}
              </div>
            )}

            {/* Tab: Datos (Invoice details) */}
            {activeTab === 'datos' && (
            <div className="px-6 py-4 space-y-4">
              {/* Company + Customer info */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-gray-500 mb-1">Emisor</p>
                  <p className="text-sm font-semibold">BeckerVisual</p>
                  <p className="text-xs text-gray-500">CUIT: {invoice.enterprise?.cuit || '27-23091318-3'}</p>
                  <p className="text-xs text-gray-500">Cond. fiscal: {TAX_CONDITION_MAP[invoiceType] || 'Resp. Inscripto'}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500 mb-1">Cliente</p>
                  <p className="text-sm font-semibold">{invoice.customer?.name || 'Consumidor Final'}</p>
                  <p className="text-xs text-gray-500">CUIT: {invoice.customer?.cuit || '-'}</p>
                  {missingCuit && (
                    <p className="text-xs text-red-600 font-semibold mt-1">
                      El cliente no tiene CUIT cargado. Requerido para Factura A.
                    </p>
                  )}
                </div>
              </div>

              {/* Editable fields (only for drafts) */}
              {!authorized && (
                <div className="grid grid-cols-3 gap-3 bg-gray-50 p-3 rounded-lg">
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-medium text-gray-500" htmlFor="inv-type">Tipo de Factura</label>
                    <select
                      id="inv-type"
                      className="px-2 py-1.5 border border-gray-300 rounded-lg text-sm"
                      value={invoiceType}
                      onChange={e => onInvoiceTypeChange(e.target.value)}
                    >
                      {INVOICE_TYPES.map(t => <option key={t} value={t}>Factura {t}</option>)}
                    </select>
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-medium text-gray-500" htmlFor="inv-pv">Punto de Venta</label>
                    <input
                      id="inv-pv"
                      type="number" min="1" max="99999"
                      className="px-2 py-1.5 border border-gray-300 rounded-lg text-sm"
                      value={puntoVenta}
                      onChange={e => onPuntoVentaChange(parseInt(e.target.value) || 1)}
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-medium text-gray-500">Fecha</label>
                    <p className="px-2 py-1.5 text-sm text-gray-700">{formatDate(invoice.invoice_date || invoice.created_at)}</p>
                  </div>
                </div>
              )}

              {authorized && (
                <div className="grid grid-cols-3 gap-3 bg-green-50 p-3 rounded-lg">
                  <div>
                    <p className="text-xs text-gray-500">Tipo</p>
                    <p className="text-sm font-semibold">Factura {invoice.invoice_type}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Punto de Venta</p>
                    <p className="text-sm font-semibold">{invoice.punto_venta || '-'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">CAE</p>
                    <p className="text-sm font-mono font-semibold text-green-700">{invoice.cae || '-'}</p>
                  </div>
                </div>
              )}

              {/* Items table */}
              <div>
                <p className="text-xs font-medium text-gray-500 mb-2">Items</p>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 text-gray-500 text-xs">
                      <th className="px-3 py-2 text-left">Producto</th>
                      <th className="px-3 py-2 text-center">Cant.</th>
                      <th className="px-3 py-2 text-right">P. Unit.</th>
                      <th className="px-3 py-2 text-center">% IVA</th>
                      <th className="px-3 py-2 text-right">Subtotal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item, idx) => {
                      const itemSubtotal = item.quantity * item.unit_price
                      return (
                        <tr key={item.id || idx} className="border-t border-gray-100">
                          <td className="px-3 py-2">
                            {!authorized ? (
                              <input
                                className="w-full px-1 py-0.5 border border-gray-200 rounded text-sm"
                                value={item.product_name}
                                onChange={e => updateItem(idx, 'product_name', e.target.value)}
                                aria-label={`Nombre producto item ${idx + 1}`}
                              />
                            ) : (
                              <span>{item.product_name}</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-center">
                            {!authorized ? (
                              <input
                                type="number" min="1"
                                className="w-16 px-1 py-0.5 border border-gray-200 rounded text-sm text-center"
                                value={item.quantity}
                                onChange={e => updateItem(idx, 'quantity', parseInt(e.target.value) || 0)}
                                aria-label={`Cantidad item ${idx + 1}`}
                              />
                            ) : (
                              <span>{item.quantity}</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right">
                            {!authorized ? (
                              <input
                                type="number" step="0.01" min="0"
                                className="w-24 px-1 py-0.5 border border-gray-200 rounded text-sm text-right"
                                value={item.unit_price}
                                onChange={e => updateItem(idx, 'unit_price', parseFloat(e.target.value) || 0)}
                                aria-label={`Precio unitario item ${idx + 1}`}
                              />
                            ) : (
                              <span>{formatCurrency(item.unit_price)}</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-center">
                            {!authorized ? (
                              <>
                                <input
                                  type="number" step="0.01" placeholder="21"
                                  list={`modal-vat-list-${idx}`}
                                  className="w-16 px-1 py-0.5 border border-gray-200 rounded text-sm"
                                  value={item.vat_rate}
                                  onChange={e => updateItem(idx, 'vat_rate', parseFloat(e.target.value) || 0)}
                                  aria-label={`Tasa IVA item ${idx + 1}`}
                                />
                                <datalist id={`modal-vat-list-${idx}`}>
                                  <option value="0">0%</option>
                                  <option value="10.5">10.5%</option>
                                  <option value="21">21%</option>
                                  <option value="27">27%</option>
                                </datalist>
                              </>
                            ) : (
                              <span>{item.vat_rate}%</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right font-medium">{formatCurrency(itemSubtotal)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {/* Totals */}
              <div className="flex justify-end">
                <div className="w-64 space-y-1 text-sm">
                  <div className="flex justify-between text-gray-600">
                    <span>Neto Gravado:</span>
                    <span className="font-medium">{formatCurrency(subtotal)}</span>
                  </div>
                  <div className="flex justify-between text-gray-600">
                    <span>IVA:</span>
                    <span className="font-medium">{formatCurrency(vatAmount)}</span>
                  </div>
                  <div className="flex justify-between text-lg font-bold text-gray-900 pt-2 border-t border-gray-300">
                    <span>TOTAL:</span>
                    <span>{formatCurrency(total)}</span>
                  </div>
                </div>
              </div>
            </div>
            )}

            {/* Confirmation preview before AFIP authorization */}
            {showConfirmAuthorize && !authorized && (
              <div className="px-6 py-3 bg-yellow-50 border-t border-yellow-200">
                <p className="text-sm font-semibold text-yellow-800 mb-2">Resumen antes de autorizar con AFIP:</p>
                <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-gray-700">
                  <div><span className="text-gray-500">Cliente:</span> {invoice.customer?.name || 'Consumidor Final'}</div>
                  <div><span className="text-gray-500">CUIT:</span> {invoice.customer?.cuit || '-'}</div>
                  <div><span className="text-gray-500">Tipo:</span> Factura {invoiceType}</div>
                  <div><span className="text-gray-500">Punto de Venta:</span> {puntoVenta}</div>
                  <div><span className="text-gray-500">Fecha:</span> {formatDate(invoice.invoice_date || invoice.created_at)}</div>
                  <div><span className="text-gray-500">Items:</span> {items.length}</div>
                  <div><span className="text-gray-500">Subtotal:</span> {formatCurrency(subtotal)}</div>
                  <div><span className="text-gray-500">IVA:</span> {formatCurrency(vatAmount)}</div>
                  <div className="col-span-2 text-sm font-bold text-gray-900 pt-1 border-t border-yellow-200 mt-1">
                    Total: {formatCurrency(total)}
                  </div>
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 rounded-b-xl">
              {authorizeProgress && (
                <div className="mb-3 flex items-center gap-2 justify-center">
                  {authorizing && (
                    <svg className="animate-spin h-4 w-4 text-indigo-600" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/>
                    </svg>
                  )}
                  <span className={`text-sm font-medium ${authorized ? 'text-green-700' : 'text-indigo-700'}`}>
                    {authorizeProgress}
                  </span>
                </div>
              )}

              {authFailed && authErrorMsg && (
                <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                  <strong>Error AFIP:</strong> {authErrorMsg}
                </div>
              )}

              <div className="flex items-center justify-between gap-3">
                {!authorized ? (
                  <>
                    <button
                      onClick={() => onDeleteDraft(invoice.id, orderId)}
                      className="px-4 py-2 text-red-600 border border-red-200 rounded-lg text-sm hover:bg-red-50 transition-colors"
                    >
                      Eliminar Borrador
                    </button>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={onClose}
                        className="px-4 py-2 text-gray-600 border border-gray-300 rounded-lg text-sm hover:bg-gray-100 transition-colors"
                      >
                        Cerrar
                      </button>
                      {!showConfirmAuthorize ? (
                        <button
                          onClick={() => {
                            if (missingCuit) return
                            setShowConfirmAuthorize(true)
                          }}
                          disabled={authorizing || missingCuit}
                          className="px-6 py-2 bg-green-600 text-white rounded-lg text-sm font-semibold hover:bg-green-700 transition-colors disabled:opacity-60"
                          title={missingCuit ? 'El cliente no tiene CUIT cargado' : ''}
                        >
                          {authFailed ? 'Reintentar AFIP' : 'Autorizar con AFIP'}
                        </button>
                      ) : (
                        <button
                          onClick={() => { setShowConfirmAuthorize(false); onAuthorize() }}
                          disabled={authorizing}
                          className="px-6 py-2 bg-red-600 text-white rounded-lg text-sm font-semibold hover:bg-red-700 transition-colors disabled:opacity-60 animate-pulse"
                        >
                          {authorizing ? 'Autorizando...' : 'Confirmar y Autorizar'}
                        </button>
                      )}
                      {showConfirmAuthorize && !authorizing && (
                        <button
                          onClick={() => setShowConfirmAuthorize(false)}
                          className="px-3 py-2 text-gray-500 border border-gray-300 rounded-lg text-sm hover:bg-gray-100 transition-colors"
                        >
                          Cancelar
                        </button>
                      )}
                      {authFailed && (
                        <button
                          onClick={() => onDownloadPdf(invoice.id, invoice)}
                          className="px-4 py-2 bg-orange-500 text-white rounded-lg text-sm font-semibold hover:bg-orange-600 transition-colors"
                        >
                          Descargar PDF (borrador)
                        </button>
                      )}
                    </div>
                  </>
                ) : (
                  <>
                    <button
                      onClick={onClose}
                      className="px-4 py-2 text-gray-600 border border-gray-300 rounded-lg text-sm hover:bg-gray-100 transition-colors"
                    >
                      Cerrar
                    </button>
                    <button
                      onClick={() => onDownloadPdf(invoice.id, invoice)}
                      className="px-6 py-2 bg-indigo-600 text-white rounded-lg text-sm font-semibold hover:bg-indigo-700 transition-colors"
                    >
                      Descargar PDF
                    </button>
                  </>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
