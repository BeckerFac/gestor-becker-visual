import React, { useState, useEffect, useCallback } from 'react'
import { api } from '@/services/api'
import { toast } from '@/hooks/useToast'
import { cn } from '@/lib/utils'

interface InvoicePaymentDetailProps {
  invoiceId: string
  compactMode?: boolean
  onDataChange?: () => void
}

interface CobroApplication {
  id: string
  cobro_id: string
  amount_applied: string
  applied_at: string
  cobro_total: string
  payment_method: string
  payment_date: string
  reference: string
  cobro_notes: string
  bank_name: string
}

interface BalanceData {
  invoice_id: string
  invoice_number: number
  invoice_type: string
  total_amount: number
  total_applied: number
  remaining: number
  payment_status: string
  cobros_count: number
  cobros: CobroApplication[]
}

export const InvoicePaymentDetail: React.FC<InvoicePaymentDetailProps> = ({
  invoiceId,
  compactMode = false,
  onDataChange,
}) => {
  const [data, setData] = useState<BalanceData | null>(null)
  const [loading, setLoading] = useState(true)

  const loadData = useCallback(async () => {
    try {
      const balance = await api.getInvoiceBalance(invoiceId)
      setData(balance)
    } catch {
      // Invoice may not have any applications yet
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [invoiceId])

  useEffect(() => { loadData() }, [loadData])

  const handleUnlink = async (cobroId: string) => {
    if (!confirm('Desvincular este cobro de la factura?')) return
    try {
      await api.unlinkCobroFromInvoice(cobroId, invoiceId)
      toast.success('Cobro desvinculado')
      loadData()
      onDataChange?.()
    } catch (err: any) {
      toast.error(err.message || 'Error desvinculando')
    }
  }

  if (loading) return <div className="text-sm text-gray-400 py-2">Cargando cobros...</div>
  if (!data) return null

  const statusColor = data.payment_status === 'pagado'
    ? 'text-green-600 bg-green-50 dark:bg-green-900/20'
    : data.payment_status === 'parcial'
    ? 'text-yellow-600 bg-yellow-50 dark:bg-yellow-900/20'
    : 'text-gray-500 bg-gray-50 dark:bg-gray-800'

  if (compactMode) {
    return (
      <div className="flex items-center gap-2 text-xs">
        <span className={cn('px-2 py-0.5 rounded-full font-medium', statusColor)}>
          {data.payment_status === 'pagado' ? 'Pagado' : data.payment_status === 'parcial' ? 'Parcial' : 'Pendiente'}
        </span>
        {data.remaining > 0 && (
          <span className="text-gray-500">
            Resta: ${data.remaining.toLocaleString('es-AR', { minimumFractionDigits: 2 })}
          </span>
        )}
      </div>
    )
  }

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-4 mt-3">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
          Cobros vinculados
        </h4>
        <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium', statusColor)}>
          {data.payment_status === 'pagado' ? 'Pagado' : data.payment_status === 'parcial' ? 'Parcial' : 'Pendiente'}
        </span>
      </div>

      {/* Balance summary */}
      <div className="grid grid-cols-3 gap-2 mb-3 text-sm">
        <div>
          <span className="text-gray-500 dark:text-gray-400">Total factura</span>
          <p className="font-medium">${data.total_amount.toLocaleString('es-AR', { minimumFractionDigits: 2 })}</p>
        </div>
        <div>
          <span className="text-gray-500 dark:text-gray-400">Cobrado</span>
          <p className="font-medium text-green-600">${data.total_applied.toLocaleString('es-AR', { minimumFractionDigits: 2 })}</p>
        </div>
        <div>
          <span className="text-gray-500 dark:text-gray-400">Restante</span>
          <p className={cn('font-medium', data.remaining > 0 ? 'text-orange-600' : 'text-green-600')}>
            ${data.remaining.toLocaleString('es-AR', { minimumFractionDigits: 2 })}
          </p>
        </div>
      </div>

      {/* Progress bar */}
      <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2 mb-3">
        <div
          className={cn('h-2 rounded-full transition-all', data.payment_status === 'pagado' ? 'bg-green-500' : 'bg-blue-500')}
          style={{ width: `${Math.min(100, (data.total_applied / data.total_amount) * 100)}%` }}
        />
      </div>

      {/* Cobros list */}
      {data.cobros.length > 0 && (
        <div className="space-y-2">
          {data.cobros.map((cobro) => (
            <div key={cobro.id} className="flex items-center justify-between text-sm py-1 border-b border-gray-100 dark:border-gray-700 last:border-0">
              <div className="flex items-center gap-2">
                <span className="text-gray-400">
                  {new Date(cobro.payment_date).toLocaleDateString('es-AR')}
                </span>
                <span className="text-gray-600 dark:text-gray-300">
                  {cobro.payment_method}
                </span>
                {cobro.bank_name && (
                  <span className="text-gray-400 text-xs">({cobro.bank_name})</span>
                )}
                {cobro.reference && (
                  <span className="text-gray-400 text-xs">Ref: {cobro.reference}</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className="font-medium text-green-600">
                  +${parseFloat(cobro.amount_applied).toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                </span>
                <button
                  onClick={() => handleUnlink(cobro.cobro_id)}
                  title="Desvincular"
                  className="text-gray-400 hover:text-red-500 transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {data.cobros.length === 0 && (
        <p className="text-sm text-gray-400 text-center py-2">Sin cobros vinculados</p>
      )}
    </div>
  )
}
