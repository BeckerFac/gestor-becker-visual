import React, { useState, useEffect, useCallback } from 'react'
import { api } from '@/services/api'
import { toast } from '@/hooks/useToast'
import { cn } from '@/lib/utils'

interface CobroInvoiceLinkerProps {
  cobroId: string
  cobroAmount: number
  enterpriseId?: string
  businessUnitId?: string
  onClose: () => void
  onLinked: () => void
}

interface AvailableInvoice {
  id: string
  invoice_number: number
  invoice_type: string
  invoice_date: string
  total_amount: string
  remaining_balance: string
  payment_status: string
  enterprise_name: string
}

export const CobroInvoiceLinker: React.FC<CobroInvoiceLinkerProps> = ({
  cobroId,
  cobroAmount,
  enterpriseId,
  businessUnitId,
  onClose,
  onLinked,
}) => {
  const [availableInvoices, setAvailableInvoices] = useState<AvailableInvoice[]>([])
  const [allocations, setAllocations] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [cobroBalance, setCobroBalance] = useState(cobroAmount)
  const [creditoDisponible, setCreditoDisponible] = useState(0)

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const invoices = await api.getAvailableInvoicesForLinking({
        enterprise_id: enterpriseId,
        business_unit_id: businessUnitId,
      })
      setAvailableInvoices(invoices)
      // Try to get precise unallocated balance, fallback to full amount
      try {
        const balance = await api.getCobroBalance(cobroId)
        setCobroBalance(balance.unallocated)
      } catch {
        setCobroBalance(cobroAmount)
      }
      // Load available credit for this enterprise
      if (enterpriseId) {
        try {
          const creditos = await api.getCreditoDisponible(enterpriseId)
          const totalCredito = creditos.reduce((sum: number, c: any) => sum + parseFloat(c.disponible || '0'), 0)
          setCreditoDisponible(totalCredito)
        } catch {
          setCreditoDisponible(0)
        }
      }
    } catch (err) {
      toast.error('Error cargando facturas')
    } finally {
      setLoading(false)
    }
  }, [cobroId, enterpriseId, businessUnitId])

  useEffect(() => { loadData() }, [loadData])

  const totalAllocated = Object.values(allocations).reduce((sum, val) => sum + (val || 0), 0)
  const remaining = cobroBalance - totalAllocated

  const handleAllocationChange = (invoiceId: string, value: string) => {
    const numVal = parseFloat(value) || 0
    setAllocations(prev => ({
      ...prev,
      [invoiceId]: numVal,
    }))
  }

  const handleAutoFill = (invoiceId: string, maxAmount: number) => {
    const availableFromCobro = cobroBalance - totalAllocated + (allocations[invoiceId] || 0)
    const autoAmount = Math.min(maxAmount, availableFromCobro)
    setAllocations(prev => ({
      ...prev,
      [invoiceId]: Math.round(autoAmount * 100) / 100,
    }))
  }

  const handleSubmit = async () => {
    const entries = Object.entries(allocations).filter(([, amount]) => amount > 0)
    if (entries.length === 0) {
      toast.error('Selecciona al menos una factura')
      return
    }

    setSubmitting(true)
    let successCount = 0
    let errorCount = 0

    for (const [invoiceId, amount] of entries) {
      try {
        await api.linkCobroToInvoice(cobroId, invoiceId, amount)
        successCount++
      } catch (err: any) {
        toast.error(err.message || `Error vinculando factura`)
        errorCount++
      }
    }

    if (successCount > 0) {
      toast.success(`${successCount} factura${successCount > 1 ? 's' : ''} vinculada${successCount > 1 ? 's' : ''}`)
      onLinked()
    }
    setSubmitting(false)
    if (errorCount === 0) onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl max-w-3xl w-full max-h-[80vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              Vincular cobro a facturas
            </h2>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="mt-2 flex gap-4 text-sm">
            <span className="text-gray-500 dark:text-gray-400">
              Monto cobro: <span className="font-medium text-gray-900 dark:text-gray-100">${cobroAmount.toLocaleString('es-AR', { minimumFractionDigits: 2 })}</span>
            </span>
            <span className={cn(
              'font-medium',
              remaining > 0 ? 'text-yellow-600' : remaining === 0 ? 'text-green-600' : 'text-red-600'
            )}>
              Sin asignar: ${remaining.toLocaleString('es-AR', { minimumFractionDigits: 2 })}
            </span>
          </div>
        </div>

        {/* Credit banner */}
        {creditoDisponible > 0.01 && (
          <div className="mx-6 mt-4 px-4 py-3 bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-800 rounded-lg">
            <div className="flex items-center justify-between">
              <div className="text-sm text-green-800 dark:text-green-200">
                Esta empresa tiene <span className="font-bold">${creditoDisponible.toLocaleString('es-AR', { minimumFractionDigits: 2 })}</span> de credito disponible de cobros anteriores
              </div>
            </div>
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loading ? (
            <div className="text-center py-8 text-gray-500">Cargando facturas...</div>
          ) : availableInvoices.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              No hay facturas pendientes de cobro para este cliente
            </div>
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
                {availableInvoices.map((inv) => {
                  const remainingInv = parseFloat(inv.remaining_balance)
                  const allocation = allocations[inv.id] || 0
                  return (
                    <tr key={inv.id} className="border-b dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-750">
                      <td className="py-2">
                        <span className="font-medium">{inv.invoice_type} {inv.invoice_number}</span>
                      </td>
                      <td className="py-2 text-gray-500">
                        {new Date(inv.invoice_date).toLocaleDateString('es-AR')}
                      </td>
                      <td className="py-2 text-right">${parseFloat(inv.total_amount).toLocaleString('es-AR', { minimumFractionDigits: 2 })}</td>
                      <td className="py-2 text-right text-orange-600 dark:text-orange-400">
                        ${remainingInv.toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                      </td>
                      <td className="py-2 text-right">
                        <input
                          type="number"
                          min="0"
                          max={remainingInv}
                          step="0.01"
                          value={allocation || ''}
                          onChange={(e) => handleAllocationChange(inv.id, e.target.value)}
                          placeholder="0.00"
                          className="w-28 px-2 py-1 border rounded text-right text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100"
                        />
                      </td>
                      <td className="py-2 text-center">
                        <button
                          onClick={() => handleAutoFill(inv.id, remainingInv)}
                          title="Completar automaticamente"
                          className="text-blue-500 hover:text-blue-700 text-xs font-medium"
                        >
                          Auto
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-700 flex justify-between items-center">
          <div className="text-sm text-gray-500">
            {Object.values(allocations).filter(v => v > 0).length} factura(s) seleccionada(s)
          </div>
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
            >
              Cancelar
            </button>
            <button
              onClick={handleSubmit}
              disabled={submitting || totalAllocated === 0}
              className={cn(
                'px-4 py-2 text-sm font-medium rounded-lg text-white',
                submitting || totalAllocated === 0
                  ? 'bg-gray-400 cursor-not-allowed'
                  : 'bg-blue-600 hover:bg-blue-700'
              )}
            >
              {submitting ? 'Vinculando...' : `Vincular $${totalAllocated.toLocaleString('es-AR', { minimumFractionDigits: 2 })}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
