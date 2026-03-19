import React, { useState, useEffect } from 'react'
import { Button } from '@/components/ui/Button'
import { api } from '@/services/api'
import { toast } from '@/hooks/useToast'
import { cn } from '@/lib/utils'

interface Plan {
  id: string
  name: string
  displayName: string
  priceArs: number
  description: string
  popular: boolean
  limits: {
    invoicesPerMonth: number
    usersMax: number
    aiEnabled: boolean
    aiLevel: string
    portalEnabled: boolean
    crmEnabled: boolean
    reportsAdvanced: boolean
  }
}

interface UpgradeModalProps {
  open: boolean
  onClose: () => void
  currentPlan?: string
  message?: string | null
}

function formatPrice(priceArs: number): string {
  if (priceArs === 0) return 'Gratis'
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(priceArs)
}

export const UpgradeModal: React.FC<UpgradeModalProps> = ({
  open,
  onClose,
  currentPlan,
  message,
}) => {
  const [plans, setPlans] = useState<Plan[]>([])
  const [loading, setLoading] = useState(false)
  const [subscribing, setSubscribing] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      loadPlans()
    }
  }, [open])

  const loadPlans = async () => {
    setLoading(true)
    try {
      const result = await api.getBillingPlans()
      setPlans(result.plans || [])
    } catch (e: any) {
      toast.error('Error al cargar planes')
    } finally {
      setLoading(false)
    }
  }

  const handleSubscribe = async (planId: string) => {
    setSubscribing(planId)
    try {
      const result = await api.createBillingSubscription(planId)
      if (result.init_point) {
        // Redirect to MercadoPago checkout
        window.location.href = result.init_point
      } else {
        toast.success('Plan actualizado correctamente')
        onClose()
      }
    } catch (e: any) {
      toast.error(e.message || 'Error al iniciar suscripcion')
    } finally {
      setSubscribing(null)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="px-6 py-5 border-b border-gray-100">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold text-gray-900">Elegí tu plan</h2>
              {message && (
                <p className="text-sm text-red-600 mt-1">{message}</p>
              )}
            </div>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 transition-colors"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Plans grid */}
        <div className="p-6">
          {loading ? (
            <div className="flex justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {plans.map((plan) => {
                const isCurrent = currentPlan === plan.id
                const isUnlimited = !Number.isFinite(plan.limits.invoicesPerMonth)

                return (
                  <div
                    key={plan.id}
                    className={cn(
                      'relative rounded-xl border-2 p-5 transition-all',
                      plan.popular
                        ? 'border-blue-500 shadow-lg shadow-blue-100'
                        : 'border-gray-200 hover:border-gray-300',
                      isCurrent && 'ring-2 ring-green-500 border-green-400'
                    )}
                  >
                    {plan.popular && (
                      <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-blue-600 text-white text-xs font-bold px-3 py-1 rounded-full">
                        Mas popular
                      </div>
                    )}

                    <div className="text-center mb-4">
                      <h3 className="text-lg font-bold text-gray-900">{plan.displayName}</h3>
                      <p className="text-xs text-gray-500 mt-1">{plan.description}</p>
                    </div>

                    <div className="text-center mb-5">
                      <span className="text-3xl font-bold text-gray-900">
                        {formatPrice(plan.priceArs)}
                      </span>
                      <span className="text-sm text-gray-500">/mes</span>
                    </div>

                    <ul className="space-y-2 mb-5 text-sm">
                      <li className="flex items-center gap-2">
                        <span className="text-green-500 font-bold text-xs">OK</span>
                        <span>
                          {isUnlimited ? 'Comprobantes ilimitados' : `${plan.limits.invoicesPerMonth} comprobantes/mes`}
                        </span>
                      </li>
                      <li className="flex items-center gap-2">
                        <span className="text-green-500 font-bold text-xs">OK</span>
                        <span>
                          {!Number.isFinite(plan.limits.usersMax)
                            ? 'Usuarios ilimitados'
                            : `${plan.limits.usersMax} usuarios`
                          }
                        </span>
                      </li>
                      <li className="flex items-center gap-2">
                        <span className={cn(
                          'font-bold text-xs',
                          plan.limits.aiEnabled ? 'text-green-500' : 'text-gray-300'
                        )}>
                          {plan.limits.aiEnabled ? 'OK' : '--'}
                        </span>
                        <span className={!plan.limits.aiEnabled ? 'text-gray-400' : ''}>
                          {plan.limits.aiLevel === 'full' ? 'IA completa' :
                           plan.limits.aiLevel === 'basic' ? 'IA basica' : 'Sin IA'}
                        </span>
                      </li>
                      <li className="flex items-center gap-2">
                        <span className={cn(
                          'font-bold text-xs',
                          plan.limits.portalEnabled ? 'text-green-500' : 'text-gray-300'
                        )}>
                          {plan.limits.portalEnabled ? 'OK' : '--'}
                        </span>
                        <span className={!plan.limits.portalEnabled ? 'text-gray-400' : ''}>
                          Portal clientes
                        </span>
                      </li>
                      <li className="flex items-center gap-2">
                        <span className={cn(
                          'font-bold text-xs',
                          plan.limits.crmEnabled ? 'text-green-500' : 'text-gray-300'
                        )}>
                          {plan.limits.crmEnabled ? 'OK' : '--'}
                        </span>
                        <span className={!plan.limits.crmEnabled ? 'text-gray-400' : ''}>
                          CRM / Pipeline
                        </span>
                      </li>
                      <li className="flex items-center gap-2">
                        <span className={cn(
                          'font-bold text-xs',
                          plan.limits.reportsAdvanced ? 'text-green-500' : 'text-gray-300'
                        )}>
                          {plan.limits.reportsAdvanced ? 'OK' : '--'}
                        </span>
                        <span className={!plan.limits.reportsAdvanced ? 'text-gray-400' : ''}>
                          Reportes avanzados
                        </span>
                      </li>
                    </ul>

                    {isCurrent ? (
                      <div className="text-center text-sm font-medium text-green-600 py-2">
                        Plan actual
                      </div>
                    ) : (
                      <Button
                        variant={plan.popular ? 'primary' : 'secondary'}
                        className="w-full"
                        loading={subscribing === plan.id}
                        onClick={() => handleSubscribe(plan.id)}
                      >
                        Elegir {plan.displayName}
                      </Button>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          <p className="text-xs text-gray-400 text-center mt-6">
            Todos los planes incluyen facturacion electronica AFIP, soporte por email y actualizaciones automaticas.
            Pago mensual via MercadoPago. Podes cancelar en cualquier momento.
          </p>
        </div>
      </div>
    </div>
  )
}
