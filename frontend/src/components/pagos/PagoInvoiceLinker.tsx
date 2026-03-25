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
  const [creditoDisponible, setCreditoDisponible] = useState(0)

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const invoices = await api.getAvailablePurchaseInvoicesForLinking({
        enterprise_id: enterpriseId,
        business_unit_id: businessUnitId,
      })
      setAvailableInvoices(invoices || [])
      // Load available credit for this provider
      if (enterpriseId) {
        try {
          const creditos = await api.getCreditoProveedorDisponible(enterpriseId)
          const totalCredito = creditos.reduce((sum: number, c: any) => sum + parseFloat(c.disponible || '0'), 0)
          setCreditoDisponible(totalCredito)
        } catch {
          setCreditoDisponible(0)
        }
      }
    } catch {
      toast.error('Error cargando facturas de compra')
    } finally {
      setLoading(false)
    }
  }, [enterpriseId, businessUnitId])

  useEffect(() => { loadData() }, [loadData])

  const totalAllocated = Object.values(allocations).reduce((sum, val) => sum + (val || 0), 0)
  const remaining = pagoAmount - totalAllocated

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

        {/* Credit banner */}
        {creditoDisponible > 0.01 && (
          <div className="mx-6 mt-4 px-4 py-3 bg-purple-50 dark:bg-purple-900/30 border border-purple-200 dark:border-purple-800 rounded-lg">
            <div className="flex items-center justify-between">
              <div className="text-sm text-purple-800 dark:text-purple-200">
                Este proveedor tiene <span className="font-bold">{formatCurrency(creditoDisponible)}</span> de credito disponible de pagos anteriores
              </div>
            </div>
          </div>
        )}

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

                  return (
                    <tr key={pi.id} className="border-b dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-750">
                      <td className="py-2">
                        <span className="font-medium text-purple-700 dark:text-purple-300">
                          {pi.invoice_type} {pi.invoice_number}
                        </span>
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
