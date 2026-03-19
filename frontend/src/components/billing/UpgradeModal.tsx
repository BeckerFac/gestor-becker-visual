import React, { useState, useEffect } from 'react'
import { Button } from '@/components/ui/Button'
import { api } from '@/services/api'
import { toast } from '@/hooks/useToast'
import { cn } from '@/lib/utils'

interface PlanFeatures {
  facturacion: boolean
  pedidos: boolean
  stock: boolean
  reportesBasicos: boolean
  reportesAvanzados: boolean
  crm: boolean
  portal: boolean
  aiChat: boolean
  aiInsights: boolean
  aiNarratives: boolean
  customBranding: boolean
}

interface Plan {
  id: string
  name: string
  displayName: string
  billingPeriod: 'monthly' | 'annual' | 'none'
  priceArs: number
  priceArsMonthly: number
  description: string
  popular: boolean
  basePlanGroup: string
  features: PlanFeatures
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

interface PlanGroup {
  group: string
  monthly: Plan
  annual: Plan
}

interface UpgradeModalProps {
  open: boolean
  onClose: () => void
  currentPlan?: string
  currentPlanGroup?: string
  isTrialOrExpired?: boolean
  isEstandar?: boolean
  isPremium?: boolean
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

const FEATURE_LIST: Array<{
  key: keyof PlanFeatures
  label: string
}> = [
  { key: 'facturacion', label: 'Facturacion electronica AFIP' },
  { key: 'pedidos', label: 'Gestion de pedidos' },
  { key: 'stock', label: 'Control de stock' },
  { key: 'reportesBasicos', label: 'Reportes basicos' },
  { key: 'crm', label: 'CRM / Pipeline' },
  { key: 'portal', label: 'Portal de clientes' },
  { key: 'reportesAvanzados', label: 'Reportes avanzados (Rentabilidad, Conversion)' },
  { key: 'aiChat', label: 'IA - Chat asistente' },
  { key: 'aiInsights', label: 'IA - Insights automaticos' },
  { key: 'aiNarratives', label: 'IA - Narrativas' },
  { key: 'customBranding', label: 'Branding personalizado (logo en facturas)' },
]

export const UpgradeModal: React.FC<UpgradeModalProps> = ({
  open,
  onClose,
  currentPlan,
  currentPlanGroup,
  isTrialOrExpired = true,
  isEstandar = false,
  isPremium = false,
  message,
}) => {
  const [planGroups, setPlanGroups] = useState<PlanGroup[]>([])
  const [annualDiscount, setAnnualDiscount] = useState(0.32)
  const [loading, setLoading] = useState(false)
  const [subscribing, setSubscribing] = useState<string | null>(null)
  const [billingPeriod, setBillingPeriod] = useState<'monthly' | 'annual'>('monthly')

  useEffect(() => {
    if (open) {
      loadPlans()
    }
  }, [open])

  const loadPlans = async () => {
    setLoading(true)
    try {
      const result = await api.getBillingPlans()
      setPlanGroups(result.plans_grouped || [])
      setAnnualDiscount(result.annual_discount || 0.32)
    } catch (e: any) {
      toast.error('Error al cargar planes')
    } finally {
      setLoading(false)
    }
  }

  const handleSubscribe = async (planGroup: PlanGroup) => {
    const plan = billingPeriod === 'annual' ? planGroup.annual : planGroup.monthly
    setSubscribing(plan.id)
    try {
      const result = await api.createBillingSubscription(plan.id)
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

  // Determine header text based on user state
  const headerText = isTrialOrExpired
    ? 'Elegí tu plan'
    : isEstandar
      ? 'Cambia a Premium'
      : 'Cambiar plan'

  // Filter plan groups based on user state
  // Premium users should not see this modal at all (handled by parent)
  // Estandar users only see Premium
  const visibleGroups = isEstandar
    ? planGroups.filter(g => g.group === 'premium')
    : planGroups

  const discountPercent = Math.round(annualDiscount * 100)

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-3xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="px-6 py-5 border-b border-gray-100">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold text-gray-900">{headerText}</h2>
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

          {/* Billing period toggle */}
          <div className="flex items-center justify-center mt-4 gap-3">
            <span className={cn(
              'text-sm font-medium',
              billingPeriod === 'monthly' ? 'text-gray-900' : 'text-gray-400'
            )}>
              Mensual
            </span>
            <button
              onClick={() => setBillingPeriod(prev => prev === 'monthly' ? 'annual' : 'monthly')}
              className={cn(
                'relative w-14 h-7 rounded-full transition-colors',
                billingPeriod === 'annual' ? 'bg-green-500' : 'bg-gray-300'
              )}
            >
              <span className={cn(
                'absolute top-0.5 w-6 h-6 bg-white rounded-full shadow transition-transform',
                billingPeriod === 'annual' ? 'translate-x-7' : 'translate-x-0.5'
              )} />
            </button>
            <span className={cn(
              'text-sm font-medium',
              billingPeriod === 'annual' ? 'text-gray-900' : 'text-gray-400'
            )}>
              Anual
            </span>
            {billingPeriod === 'annual' && (
              <span className="text-xs font-bold text-green-600 bg-green-50 px-2 py-0.5 rounded-full">
                Ahorra {discountPercent}%
              </span>
            )}
          </div>
        </div>

        {/* Plans grid */}
        <div className="p-6">
          {loading ? (
            <div className="flex justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
            </div>
          ) : (
            <div className={cn(
              'grid gap-6',
              visibleGroups.length === 1 ? 'grid-cols-1 max-w-md mx-auto' : 'grid-cols-1 md:grid-cols-2'
            )}>
              {visibleGroups.map((planGroup) => {
                const plan = billingPeriod === 'annual' ? planGroup.annual : planGroup.monthly
                const monthlyPlan = planGroup.monthly
                const isCurrentGroup = currentPlanGroup === planGroup.group
                const isGroupSubscribing = subscribing === plan.id
                const isUnlimitedDocs = !Number.isFinite(plan.limits.invoicesPerMonth)
                const isUnlimitedUsers = !Number.isFinite(plan.limits.usersMax)
                const isPremiumGroup = planGroup.group === 'premium'

                return (
                  <div
                    key={planGroup.group}
                    className={cn(
                      'relative rounded-xl border-2 p-6 transition-all',
                      isPremiumGroup
                        ? 'border-blue-500 shadow-lg shadow-blue-100'
                        : 'border-gray-200 hover:border-gray-300',
                      isCurrentGroup && 'ring-2 ring-green-500 border-green-400'
                    )}
                  >
                    {isPremiumGroup && (
                      <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-blue-600 text-white text-xs font-bold px-3 py-1 rounded-full">
                        Mas completo
                      </div>
                    )}

                    <div className="text-center mb-4">
                      <h3 className="text-xl font-bold text-gray-900">{plan.displayName}</h3>
                      <p className="text-xs text-gray-500 mt-1">{plan.description}</p>
                    </div>

                    {/* Price display */}
                    <div className="text-center mb-6">
                      {billingPeriod === 'annual' ? (
                        <>
                          <div className="text-sm text-gray-400 line-through">
                            {formatPrice(monthlyPlan.priceArs)}/mes
                          </div>
                          <span className="text-3xl font-bold text-gray-900">
                            {formatPrice(plan.priceArsMonthly)}
                          </span>
                          <span className="text-sm text-gray-500">/mes</span>
                          <div className="text-xs text-gray-400 mt-1">
                            {formatPrice(plan.priceArs)}/año
                          </div>
                        </>
                      ) : (
                        <>
                          <span className="text-3xl font-bold text-gray-900">
                            {formatPrice(plan.priceArs)}
                          </span>
                          <span className="text-sm text-gray-500">/mes</span>
                        </>
                      )}
                    </div>

                    {/* Limits summary */}
                    <div className="mb-4 p-3 bg-gray-50 rounded-lg space-y-1 text-sm">
                      <div className="flex justify-between">
                        <span className="text-gray-600">Comprobantes</span>
                        <span className="font-medium text-gray-900">
                          {isUnlimitedDocs ? 'Ilimitados' : `${plan.limits.invoicesPerMonth}/mes`}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600">Usuarios</span>
                        <span className="font-medium text-gray-900">
                          {isUnlimitedUsers ? 'Ilimitados' : plan.limits.usersMax}
                        </span>
                      </div>
                      {isPremiumGroup && (
                        <div className="flex justify-between">
                          <span className="text-gray-600">Soporte</span>
                          <span className="font-medium text-gray-900">Prioritario</span>
                        </div>
                      )}
                    </div>

                    {/* Features list */}
                    <ul className="space-y-2 mb-6 text-sm">
                      {FEATURE_LIST.map(({ key, label }) => {
                        const included = plan.features[key]
                        return (
                          <li key={key} className="flex items-start gap-2">
                            <span className={cn(
                              'font-bold text-xs mt-0.5 shrink-0',
                              included ? 'text-green-500' : 'text-gray-300'
                            )}>
                              {included ? 'OK' : '--'}
                            </span>
                            <span className={cn(
                              'leading-tight',
                              !included && 'text-gray-400'
                            )}>
                              {label}
                            </span>
                          </li>
                        )
                      })}
                    </ul>

                    {/* Action button */}
                    {isCurrentGroup ? (
                      <div className="text-center text-sm font-medium text-green-600 py-2">
                        Plan actual
                      </div>
                    ) : (
                      <Button
                        variant={isPremiumGroup ? 'primary' : 'secondary'}
                        className="w-full"
                        loading={isGroupSubscribing}
                        onClick={() => handleSubscribe(planGroup)}
                      >
                        {isEstandar ? `Cambiar a ${plan.displayName}` : `Elegir ${plan.displayName}`}
                      </Button>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          <p className="text-xs text-gray-400 text-center mt-6">
            Todos los planes incluyen facturacion electronica AFIP, soporte por email y actualizaciones automaticas.
            {billingPeriod === 'monthly'
              ? ' Pago mensual via MercadoPago. Podes cancelar en cualquier momento.'
              : ` Pago anual via MercadoPago con ${discountPercent}% de descuento. Podes cancelar en cualquier momento.`
            }
          </p>
        </div>
      </div>
    </div>
  )
}
