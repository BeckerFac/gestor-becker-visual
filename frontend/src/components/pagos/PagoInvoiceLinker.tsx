import React, { useState, useEffect, useCallback } from 'react'
import { api } from '@/services/api'
import { toast } from '@/hooks/useToast'
import { cn } from '@/lib/utils'
import { formatCurrency, formatDate } from '@/lib/utils'

interface PagoInvoiceLinkerProps {
  pagoId: string
  pagoAmount: number
  enterpriseId?: string
  businessUnitId?: string
  onClose: () => void
  onLinked: () => void
}

export const PagoInvoiceLinker: React.FC<PagoInvoiceLinkerProps> = ({
  pagoId,
  pagoAmount,
  enterpriseId,
  businessUnitId,
  onClose,
  onLinked,
}) => {
  const [availableInvoices, setAvailableInvoices] = useState<any[]>([])
  const [allocations, setAllocations] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [expandedPiIds, setExpandedPiIds] = useState<Set<string>>(new Set())
  const [loadedPiItems, setLoadedPiItems] = useState<Record<string, any[]>>({})
  const [itemAllocations, setItemAllocations] = useState<Record<string, number>>({})

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const invoices = await api.getAvailablePurchaseInvoicesForLinking({
        enterprise_id: enterpriseId,
        business_unit_id: businessUnitId,
      })
      setAvailableInvoices(invoices || [])
    } catch {
      toast.error('Error cargando facturas de compra')
    } finally {
      setLoading(false)
    }
  }, [enterpriseId, businessUnitId])

  useEffect(() => { loadData() }, [loadData])

  const totalAllocated = Object.values(allocations).reduce((sum, val) => sum + (val || 0), 0)
  const remaining = pagoAmount - totalAllocated

  const handleToggleExpand = async (piId: string) => {
    const next = new Set(expandedPiIds)
    if (next.has(piId)) {
      next.delete(piId)
    } else {
      next.add(piId)
      if (!loadedPiItems[piId]) {
        try {
          const items = await api.getPurchaseInvoiceItems(piId)
          setLoadedPiItems(prev => ({ ...prev, [piId]: items }))
        } catch { /* ignore */ }
      }
    }
    setExpandedPiIds(next)
  }

  const handleSubmit = async () => {
    const entries = Object.entries(allocations).filter(([, amount]) => amount > 0)
    if (entries.length === 0) {
      toast.error('Selecciona al menos una factura')
      return
    }

    setSubmitting(true)
    let successCount = 0

    for (const [purchaseInvoiceId, amount] of entries) {
      try {
        const piItems = loadedPiItems[purchaseInvoiceId] || []
        const details = piItems
          .filter((ii: any) => itemAllocations[ii.id] && itemAllocations[ii.id] > 0)
          .map((ii: any) => ({ purchase_invoice_item_id: ii.id, amount: itemAllocations[ii.id] }))

        await api.linkPagoToPurchaseInvoice(pagoId, purchaseInvoiceId, amount)
        successCount++
      } catch (err: any) {
        toast.error(err.message || 'Error vinculando')
      }
    }

    if (successCount > 0) {
      toast.success(`${successCount} factura${successCount > 1 ? 's' : ''} vinculada${successCount > 1 ? 's' : ''}`)
      onLinked()
    }
    setSubmitting(false)
  }

  const fmt = (n: any) => formatCurrency(n)

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl max-w-3xl w-full max-h-[80vh] overflow-hidden flex flex-col">
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Vincular pago a facturas de compra</h2>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-xl">&times;</button>
          </div>
          <div className="mt-2 flex gap-4 text-sm">
            <span className="text-gray-500">Monto pago: <span className="font-medium text-gray-900 dark:text-gray-100">{fmt(pagoAmount)}</span></span>
            <span className={cn('font-medium', remaining > 0 ? 'text-yellow-600' : remaining === 0 ? 'text-green-600' : 'text-red-600')}>
              Sin asignar: {fmt(remaining)}
            </span>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loading ? (
            <div className="text-center py-8 text-gray-500">Cargando facturas...</div>
          ) : availableInvoices.length === 0 ? (
            <div className="text-center py-8 text-gray-500">No hay facturas de compra pendientes para este proveedor</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 dark:text-gray-400 border-b dark:border-gray-700">
                  <th className="pb-2">Factura</th>
                  <th className="pb-2">Fecha</th>
                  <th className="pb-2 text-right">Total</th>
                  <th className="pb-2 text-right">Restante</th>
                  <th className="pb-2 text-right">Aplicar</th>
                  <th className="pb-2 w-10"></th>
                </tr>
              </thead>
              <tbody>
                {availableInvoices.map((pi) => {
                  const remainingInv = parseFloat(pi.remaining_balance || '0')
                  const allocation = allocations[pi.id] || 0
                  const isExpanded = expandedPiIds.has(pi.id)
                  const piItems = loadedPiItems[pi.id] || []

                  return (
                    <React.Fragment key={pi.id}>
                      <tr className="border-b dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-750">
                        <td className="py-2">
                          <button onClick={() => handleToggleExpand(pi.id)} className="font-medium text-purple-700 dark:text-purple-300 flex items-center gap-1 hover:underline">
                            <span className="text-gray-400 text-xs">{isExpanded ? '▼' : '▶'}</span>
                            {pi.invoice_type} {pi.invoice_number}
                          </button>
                        </td>
                        <td className="py-2 text-gray-500">{formatDate(pi.invoice_date)}</td>
                        <td className="py-2 text-right">{fmt(pi.total_amount)}</td>
                        <td className="py-2 text-right text-orange-600">{fmt(remainingInv)}</td>
                        <td className="py-2 text-right">
                          <input type="number" min="0" max={remainingInv} step="0.01" value={allocation || ''}
                            onChange={(e) => setAllocations(prev => ({ ...prev, [pi.id]: parseFloat(e.target.value) || 0 }))}
                            placeholder="0.00"
                            className="w-28 px-2 py-1 border rounded text-right text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100"
                          />
                        </td>
                        <td className="py-2 text-center">
                          <button onClick={() => {
                            const avail = pagoAmount - totalAllocated + (allocations[pi.id] || 0)
                            setAllocations(prev => ({ ...prev, [pi.id]: Math.round(Math.min(remainingInv, avail) * 100) / 100 }))
                          }} className="text-purple-500 hover:text-purple-700 text-xs font-medium">Todo</button>
                        </td>
                      </tr>
                      {isExpanded && piItems.length > 0 && piItems.map((ii: any) => {
                        const itemRemaining = parseFloat(ii.remaining || '0')
                        return (
                          <tr key={ii.id} className="bg-purple-50/50 dark:bg-purple-950/10 border-t border-purple-100">
                            <td className="py-1.5 pl-6 text-xs" colSpan={2}>
                              <span className="font-medium text-gray-700 dark:text-gray-300">{ii.product_name}</span>
                              <span className="ml-2 text-gray-400">{parseFloat(ii.quantity)}x {fmt(ii.unit_price)}</span>
                            </td>
                            <td className="py-1.5 text-right text-xs">{fmt(ii.subtotal)}</td>
                            <td className="py-1.5 text-right text-xs">{fmt(itemRemaining)}</td>
                            <td className="py-1.5 text-right">
                              {itemRemaining > 0 ? (
                                <input type="number" step="0.01" min="0" max={itemRemaining} placeholder="0.00"
                                  value={itemAllocations[ii.id] || ''}
                                  onChange={e => {
                                    setItemAllocations(prev => ({ ...prev, [ii.id]: parseFloat(e.target.value) || 0 }))
                                    // Sync PI total
                                    setTimeout(() => {
                                      let newTotal = 0
                                      for (const it of piItems) {
                                        newTotal += it.id === ii.id ? (parseFloat(e.target.value) || 0) : (itemAllocations[it.id] || 0)
                                      }
                                      if (newTotal > 0) setAllocations(prev => ({ ...prev, [pi.id]: Math.round(newTotal * 100) / 100 }))
                                    }, 0)
                                  }}
                                  className="w-24 px-2 py-1 border border-purple-300 rounded text-right text-xs dark:bg-gray-700 dark:border-purple-700 dark:text-gray-100"
                                />
                              ) : <span className="text-xs text-green-500">Pagado</span>}
                            </td>
                            <td></td>
                          </tr>
                        )
                      })}
                      {isExpanded && piItems.length === 0 && (
                        <tr className="bg-purple-50/30"><td colSpan={6} className="px-6 py-2 text-xs text-gray-400 italic">Sin items detallados</td></tr>
                      )}
                    </React.Fragment>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-700 flex justify-between items-center">
          <div className="text-sm text-gray-500">{Object.values(allocations).filter(v => v > 0).length} factura(s)</div>
          <div className="flex gap-3">
            <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg">Cancelar</button>
            <button onClick={handleSubmit} disabled={submitting || totalAllocated === 0}
              className={cn('px-4 py-2 text-sm font-medium rounded-lg text-white', submitting || totalAllocated === 0 ? 'bg-gray-400 cursor-not-allowed' : 'bg-purple-600 hover:bg-purple-700')}>
              {submitting ? 'Vinculando...' : `Vincular ${fmt(totalAllocated)}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
