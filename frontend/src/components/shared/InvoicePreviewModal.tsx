import React, { useState, useEffect, useRef } from 'react'
import { formatCurrency, formatDate } from '@/lib/utils'
import { InvoiceTemplate } from './InvoiceTemplate'
import type { PreviewItem } from '@/hooks/useInvoicePreview'

const INVOICE_TYPES = ['A', 'B', 'C']

const VAT_PRESETS = [
  { value: 0, label: '0%' },
  { value: 10.5, label: '10.5%' },
  { value: 21, label: '21%' },
  { value: 27, label: '27%' },
]

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
  const [showConfirmAuthorize, setShowConfirmAuthorize] = useState(false)

  // Local editable state for fields not managed by the hook
  const [localCustomerName, setLocalCustomerName] = useState('')
  const [localCustomerCuit, setLocalCustomerCuit] = useState('')
  const [localInvoiceDate, setLocalInvoiceDate] = useState('')
  const [localNotes, setLocalNotes] = useState('')

  // Initialize local state from invoice data
  useEffect(() => {
    if (invoice) {
      setLocalCustomerName(invoice.customer?.name || '')
      setLocalCustomerCuit(invoice.customer?.cuit || '')
      const dateRaw = invoice.invoice_date || invoice.created_at
      if (dateRaw) {
        const d = new Date(dateRaw)
        if (!isNaN(d.getTime())) {
          const yyyy = d.getFullYear()
          const mm = String(d.getMonth() + 1).padStart(2, '0')
          const dd = String(d.getDate()).padStart(2, '0')
          setLocalInvoiceDate(`${yyyy}-${mm}-${dd}`)
        }
      }
      setLocalNotes(invoice.notes || '')
    }
  }, [invoice])

  // CUIT validation
  const isFiscal = !invoice?.fiscal_type || invoice?.fiscal_type === 'fiscal'
  const needsCuit = isFiscal && invoiceType === 'A'
  const missingCuit = needsCuit && !localCustomerCuit

  // Focus trap + Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    dialogRef.current?.focus()
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

  // Format date for display in preview
  const displayDate = localInvoiceDate
    ? formatDate(localInvoiceDate)
    : formatDate(invoice?.invoice_date || invoice?.created_at)

  // Map items for InvoiceTemplate
  const templateItems = items.map(i => ({
    name: i.product_name,
    quantity: i.quantity,
    unitPrice: i.unit_price,
    vatRate: i.vat_rate,
  }))

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
        className="bg-white rounded-xl shadow-2xl w-full max-w-6xl max-h-[90vh] flex flex-col mx-4 outline-none"
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
            <div className="flex items-center justify-between px-6 py-3 border-b border-gray-100 shrink-0">
              <div>
                <h3 className="text-lg font-bold text-gray-900">
                  {authorized ? 'Factura Autorizada' : 'Borrador de Factura'}
                </h3>
                <p className="text-sm text-gray-500">
                  #{String(invoice.invoice_number).padStart(8, '0')}
                  {localCustomerName && ` \u2014 ${localCustomerName}`}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {authorized ? (
                  <span className="px-3 py-1 bg-green-100 text-green-800 rounded-full text-xs font-semibold">Autorizada AFIP</span>
                ) : (
                  <span className="px-3 py-1 bg-amber-50 text-amber-700 rounded-full text-xs font-semibold">Borrador</span>
                )}
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

              {/* Left: Form */}
              <div className="flex-1 overflow-y-auto p-5 space-y-4 lg:border-r border-gray-100">

                {/* Invoice config row */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-medium text-gray-400" htmlFor="inv-type">Tipo</label>
                    {!authorized ? (
                      <select
                        id="inv-type"
                        className="px-2 py-1.5 border border-gray-200 rounded-lg text-sm bg-white focus:border-indigo-300 focus:ring-1 focus:ring-indigo-200 outline-none transition-colors"
                        value={invoiceType}
                        onChange={e => onInvoiceTypeChange(e.target.value)}
                      >
                        {INVOICE_TYPES.map(t => <option key={t} value={t}>Factura {t}</option>)}
                      </select>
                    ) : (
                      <p className="px-2 py-1.5 text-sm font-semibold text-gray-700">Factura {invoice.invoice_type}</p>
                    )}
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-medium text-gray-400" htmlFor="inv-pv">Punto de Venta</label>
                    {!authorized ? (
                      <input
                        id="inv-pv"
                        type="number" min="1" max="99999"
                        className="px-2 py-1.5 border border-gray-200 rounded-lg text-sm focus:border-indigo-300 focus:ring-1 focus:ring-indigo-200 outline-none transition-colors"
                        value={puntoVenta}
                        onChange={e => onPuntoVentaChange(parseInt(e.target.value) || 1)}
                      />
                    ) : (
                      <p className="px-2 py-1.5 text-sm font-semibold text-gray-700">{invoice.punto_venta || '-'}</p>
                    )}
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-medium text-gray-400" htmlFor="inv-date">Fecha</label>
                    {!authorized ? (
                      <input
                        id="inv-date"
                        type="date"
                        className="px-2 py-1.5 border border-gray-200 rounded-lg text-sm focus:border-indigo-300 focus:ring-1 focus:ring-indigo-200 outline-none transition-colors"
                        value={localInvoiceDate}
                        onChange={e => setLocalInvoiceDate(e.target.value)}
                      />
                    ) : (
                      <p className="px-2 py-1.5 text-sm text-gray-700">{displayDate}</p>
                    )}
                  </div>
                  {authorized && invoice.cae && (
                    <div className="flex flex-col gap-1">
                      <label className="text-xs font-medium text-gray-400">CAE</label>
                      <p className="px-2 py-1.5 text-sm font-mono font-semibold text-green-700">{invoice.cae}</p>
                    </div>
                  )}
                </div>

                {/* Customer info */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-medium text-gray-400" htmlFor="cust-name">Cliente</label>
                    {!authorized ? (
                      <input
                        id="cust-name"
                        type="text"
                        placeholder="Consumidor Final"
                        className="px-2 py-1.5 border border-gray-200 rounded-lg text-sm focus:border-indigo-300 focus:ring-1 focus:ring-indigo-200 outline-none transition-colors"
                        value={localCustomerName}
                        onChange={e => setLocalCustomerName(e.target.value)}
                      />
                    ) : (
                      <p className="px-2 py-1.5 text-sm font-semibold text-gray-700">{localCustomerName || 'Consumidor Final'}</p>
                    )}
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-medium text-gray-400" htmlFor="cust-cuit">CUIT Cliente</label>
                    {!authorized ? (
                      <input
                        id="cust-cuit"
                        type="text"
                        placeholder="XX-XXXXXXXX-X"
                        className={`px-2 py-1.5 border rounded-lg text-sm outline-none transition-colors ${
                          missingCuit
                            ? 'border-red-300 bg-red-50/50 focus:border-red-400 focus:ring-1 focus:ring-red-200'
                            : 'border-gray-200 focus:border-indigo-300 focus:ring-1 focus:ring-indigo-200'
                        }`}
                        value={localCustomerCuit}
                        onChange={e => setLocalCustomerCuit(e.target.value)}
                      />
                    ) : (
                      <p className="px-2 py-1.5 text-sm text-gray-700">{localCustomerCuit || '-'}</p>
                    )}
                    {missingCuit && (
                      <p className="text-xs text-red-500">Requerido para Factura A</p>
                    )}
                  </div>
                </div>

                {/* Items table */}
                <div>
                  <p className="text-xs font-medium text-gray-400 mb-2">Items</p>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-gray-400 text-xs">
                          <th className="px-2 py-1.5 text-left font-medium">Producto</th>
                          <th className="px-2 py-1.5 text-center font-medium w-16">Cant.</th>
                          <th className="px-2 py-1.5 text-right font-medium w-24">P. Unit.</th>
                          <th className="px-2 py-1.5 text-center font-medium w-20">IVA</th>
                          <th className="px-2 py-1.5 text-right font-medium w-24">Subtotal</th>
                        </tr>
                      </thead>
                      <tbody>
                        {items.map((item, idx) => {
                          const itemSubtotal = item.quantity * item.unit_price
                          const isZeroPrice = item.unit_price === 0
                          return (
                            <tr key={item.id || idx} className={`border-t border-gray-100 ${isZeroPrice && !authorized ? 'bg-red-50/50' : ''}`}>
                              <td className="px-2 py-1.5">
                                {!authorized ? (
                                  <input
                                    className="w-full px-1.5 py-1 border border-gray-200 rounded text-sm focus:border-indigo-300 focus:ring-1 focus:ring-indigo-200 outline-none transition-colors"
                                    value={item.product_name}
                                    onChange={e => updateItem(idx, 'product_name', e.target.value)}
                                    aria-label={`Nombre producto item ${idx + 1}`}
                                  />
                                ) : (
                                  <span>{item.product_name}</span>
                                )}
                              </td>
                              <td className="px-2 py-1.5 text-center">
                                {!authorized ? (
                                  <input
                                    type="number" min="1"
                                    className="w-14 px-1 py-1 border border-gray-200 rounded text-sm text-center focus:border-indigo-300 focus:ring-1 focus:ring-indigo-200 outline-none transition-colors"
                                    value={item.quantity}
                                    onChange={e => updateItem(idx, 'quantity', parseInt(e.target.value) || 0)}
                                    aria-label={`Cantidad item ${idx + 1}`}
                                  />
                                ) : (
                                  <span>{item.quantity}</span>
                                )}
                              </td>
                              <td className="px-2 py-1.5 text-right">
                                {!authorized ? (
                                  <input
                                    type="number" step="0.01" min="0"
                                    className={`w-22 px-1 py-1 border rounded text-sm text-right outline-none transition-colors ${
                                      isZeroPrice
                                        ? 'border-red-300 focus:border-red-400 focus:ring-1 focus:ring-red-200'
                                        : 'border-gray-200 focus:border-indigo-300 focus:ring-1 focus:ring-indigo-200'
                                    }`}
                                    value={item.unit_price}
                                    onChange={e => updateItem(idx, 'unit_price', parseFloat(e.target.value) || 0)}
                                    aria-label={`Precio unitario item ${idx + 1}`}
                                  />
                                ) : (
                                  <span>{formatCurrency(item.unit_price)}</span>
                                )}
                              </td>
                              <td className="px-2 py-1.5 text-center">
                                {!authorized ? (
                                  <select
                                    className="w-18 px-1 py-1 border border-gray-200 rounded text-sm text-center focus:border-indigo-300 focus:ring-1 focus:ring-indigo-200 outline-none transition-colors"
                                    value={item.vat_rate}
                                    onChange={e => updateItem(idx, 'vat_rate', parseFloat(e.target.value))}
                                    aria-label={`Tasa IVA item ${idx + 1}`}
                                  >
                                    {VAT_PRESETS.map(p => (
                                      <option key={p.value} value={p.value}>{p.label}</option>
                                    ))}
                                  </select>
                                ) : (
                                  <span>{item.vat_rate}%</span>
                                )}
                              </td>
                              <td className="px-2 py-1.5 text-right font-medium text-gray-700">
                                {formatCurrency(itemSubtotal)}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
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
                {!authorized && (
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-medium text-gray-400" htmlFor="inv-notes">Observaciones</label>
                    <textarea
                      id="inv-notes"
                      rows={2}
                      placeholder="Notas internas..."
                      className="px-2 py-1.5 border border-gray-200 rounded-lg text-sm resize-none focus:border-indigo-300 focus:ring-1 focus:ring-indigo-200 outline-none transition-colors"
                      value={localNotes}
                      onChange={e => setLocalNotes(e.target.value)}
                    />
                  </div>
                )}
              </div>

              {/* Right: Preview */}
              <div className="flex-1 bg-gray-50 p-5 overflow-y-auto flex items-start justify-center">
                <div className="w-full max-w-sm">
                  <InvoiceTemplate
                    companyName={invoice.enterprise?.name || 'BeckerVisual'}
                    companyCuit={invoice.enterprise?.cuit || '27-23091318-3'}
                    companyAddress={invoice.enterprise?.address}
                    customerName={localCustomerName || 'Consumidor Final'}
                    customerCuit={localCustomerCuit}
                    taxCondition={TAX_CONDITION_MAP[invoiceType]}
                    invoiceType={invoiceType}
                    invoiceNumber={String(invoice.invoice_number)}
                    puntoVenta={puntoVenta}
                    invoiceDate={displayDate}
                    items={templateItems}
                    subtotal={subtotal}
                    vatAmount={vatAmount}
                    total={total}
                    cae={invoice.cae}
                    caeExpiry={invoice.cae_expiry_date ? formatDate(invoice.cae_expiry_date) : undefined}
                    authorized={authorized}
                    missingCuit={missingCuit}
                  />
                </div>
              </div>
            </div>

            {/* Confirmation preview before AFIP authorization */}
            {showConfirmAuthorize && !authorized && (
              <div className="px-6 py-3 bg-amber-50 border-t border-amber-200 shrink-0">
                <p className="text-sm font-semibold text-amber-800 mb-2">Resumen antes de autorizar con AFIP:</p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-1 text-xs text-gray-700">
                  <div><span className="text-gray-400">Cliente:</span> {localCustomerName || 'Consumidor Final'}</div>
                  <div><span className="text-gray-400">CUIT:</span> {localCustomerCuit || '-'}</div>
                  <div><span className="text-gray-400">Tipo:</span> Factura {invoiceType}</div>
                  <div><span className="text-gray-400">PV:</span> {puntoVenta}</div>
                  <div><span className="text-gray-400">Fecha:</span> {displayDate}</div>
                  <div><span className="text-gray-400">Items:</span> {items.length}</div>
                  <div><span className="text-gray-400">Subtotal:</span> {formatCurrency(subtotal)}</div>
                  <div><span className="text-gray-400">IVA:</span> {formatCurrency(vatAmount)}</div>
                  <div className="col-span-2 sm:col-span-4 text-sm font-bold text-gray-900 pt-1 border-t border-amber-200 mt-1">
                    Total: {formatCurrency(total)}
                  </div>
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="px-6 py-3 border-t border-gray-100 bg-gray-50/50 rounded-b-xl shrink-0">
              {authorizeProgress && (
                <div className="mb-2 flex items-center gap-2 justify-center">
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
                <div className="mb-2 p-2 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
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
                        className="px-4 py-2 text-gray-600 border border-gray-200 rounded-lg text-sm hover:bg-gray-100 transition-colors"
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
                          className="px-5 py-2 bg-green-600 text-white rounded-lg text-sm font-semibold hover:bg-green-700 transition-colors disabled:opacity-60"
                          title={missingCuit ? 'El cliente no tiene CUIT cargado' : ''}
                        >
                          {authFailed ? 'Reintentar AFIP' : 'Autorizar con AFIP'}
                        </button>
                      ) : (
                        <button
                          onClick={() => { setShowConfirmAuthorize(false); onAuthorize() }}
                          disabled={authorizing}
                          className="px-5 py-2 bg-red-600 text-white rounded-lg text-sm font-semibold hover:bg-red-700 transition-colors disabled:opacity-60 animate-pulse"
                        >
                          {authorizing ? 'Autorizando...' : 'Confirmar y Autorizar'}
                        </button>
                      )}
                      {showConfirmAuthorize && !authorizing && (
                        <button
                          onClick={() => setShowConfirmAuthorize(false)}
                          className="px-3 py-2 text-gray-500 border border-gray-200 rounded-lg text-sm hover:bg-gray-100 transition-colors"
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
                      className="px-4 py-2 text-gray-600 border border-gray-200 rounded-lg text-sm hover:bg-gray-100 transition-colors"
                    >
                      Cerrar
                    </button>
                    <button
                      onClick={() => onDownloadPdf(invoice.id, invoice)}
                      className="px-5 py-2 bg-indigo-600 text-white rounded-lg text-sm font-semibold hover:bg-indigo-700 transition-colors"
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
