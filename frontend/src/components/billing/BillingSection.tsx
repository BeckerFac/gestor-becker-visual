import React, { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { PlanBadge } from './PlanBadge'
import { UsageMeter } from './UsageMeter'
import { UpgradeModal } from './UpgradeModal'
import { api } from '@/services/api'
import { toast } from '@/hooks/useToast'

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

interface SubscriptionData {
  plan: string
  billing_period: 'monthly' | 'annual' | null
  status: string
  plan_details: {
    displayName: string
    billingPeriod: 'monthly' | 'annual' | 'none'
    priceArs: number
    priceArsMonthly: number
    basePlanGroup: string
    features: PlanFeatures
    limits: {
      invoicesPerMonth: number
      usersMax: number
      aiEnabled: boolean
      aiLevel: string
      storageMb: number
    }
  }
  usage: {
    invoices_count: number
    orders_count: number
    users_count: number
    total_documents: number
    storage_mb: number
  }
  days_remaining: number | null
  is_trial: boolean
  is_estandar: boolean
  is_premium: boolean
  can_use: boolean
  trial_ends_at: string | null
  current_period_end: string | null
}

const FEATURE_LABELS: Array<{ key: keyof PlanFeatures; label: string }> = [
  { key: 'facturacion', label: 'Facturacion AFIP' },
  { key: 'pedidos', label: 'Pedidos' },
  { key: 'stock', label: 'Stock' },
  { key: 'reportesBasicos', label: 'Reportes basicos' },
  { key: 'crm', label: 'CRM' },
  { key: 'portal', label: 'Portal clientes' },
  { key: 'reportesAvanzados', label: 'Reportes avanzados' },
  { key: 'aiChat', label: 'IA Chat' },
  { key: 'aiInsights', label: 'IA Insights' },
  { key: 'aiNarratives', label: 'IA Narrativas' },
  { key: 'customBranding', label: 'Branding' },
]

export const BillingSection: React.FC = () => {
  const [subscription, setSubscription] = useState<SubscriptionData | null>(null)
  const [loading, setLoading] = useState(true)
  const [showUpgrade, setShowUpgrade] = useState(false)
  const [showCancel, setShowCancel] = useState(false)
  const [cancelling, setCancelling] = useState(false)

  const loadSubscription = async () => {
    try {
      setLoading(true)
      const data = await api.getBillingSubscription()
      setSubscription(data)
    } catch (e: any) {
      console.error('Error loading subscription:', e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadSubscription()
  }, [])

  const handleCancel = async () => {
    setCancelling(true)
    try {
      await api.cancelBillingSubscription()
      toast.success('Suscripcion cancelada. Mantenes acceso hasta el final del periodo.')
      await loadSubscription()
    } catch (e: any) {
      toast.error(e.message || 'Error al cancelar')
    } finally {
      setCancelling(false)
      setShowCancel(false)
    }
  }

  if (loading) {
    return (
      <Card>
        <CardHeader><h3 className="text-lg font-semibold">Plan y Facturacion</h3></CardHeader>
        <CardContent>
          <div className="animate-pulse space-y-4">
            <div className="h-4 bg-gray-200 rounded w-1/3" />
            <div className="h-4 bg-gray-200 rounded w-2/3" />
            <div className="h-4 bg-gray-200 rounded w-1/2" />
          </div>
        </CardContent>
      </Card>
    )
  }

  if (!subscription) return null

  const { plan_details, usage, days_remaining, is_trial, is_estandar, is_premium, status } = subscription
  const limits = plan_details.limits
  const features = plan_details.features

  // Determine billing period label
  const periodLabel = plan_details.billingPeriod === 'annual'
    ? 'Anual'
    : plan_details.billingPeriod === 'monthly'
      ? 'Mensual'
      : ''

  // Display name with period
  const planDisplayName = periodLabel
    ? `${plan_details.displayName} ${periodLabel}`
    : plan_details.displayName

  // Show usage meters only for Estandar (Premium is unlimited)
  const showUsageMeters = is_estandar

  // Determine CTA button text
  const isTrialOrExpired = is_trial || status === 'expired'
  const showChangeToPremium = is_estandar
  const showChangeToAnnual = (is_estandar || is_premium) && plan_details.billingPeriod === 'monthly'

  function formatPrice(priceArs: number): string {
    if (priceArs === 0) return 'Gratis'
    return new Intl.NumberFormat('es-AR', {
      style: 'currency',
      currency: 'ARS',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(priceArs)
  }

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">Plan y Facturacion</h3>
            <PlanBadge plan={subscription.plan} status={status} size="md" />
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-6">
            {/* Current Plan Info */}
            <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
              <div>
                <p className="font-semibold text-gray-900 dark:text-gray-100">
                  Plan {planDisplayName}
                </p>
                <p className="text-sm text-gray-500">
                  {plan_details.priceArs > 0
                    ? plan_details.billingPeriod === 'annual'
                      ? `${formatPrice(plan_details.priceArsMonthly)}/mes (${formatPrice(plan_details.priceArs)}/año)`
                      : `${formatPrice(plan_details.priceArs)}/mes`
                    : 'Gratis'
                  }
                </p>
                {is_trial && days_remaining !== null && (
                  <p className="text-sm text-yellow-600 font-medium mt-1">
                    Te quedan {days_remaining} {days_remaining === 1 ? 'dia' : 'dias'} de prueba
                  </p>
                )}
                {status === 'expired' && (
                  <p className="text-sm text-red-600 font-medium mt-1">
                    Tu periodo de prueba expiro
                  </p>
                )}
                {status === 'past_due' && (
                  <p className="text-sm text-yellow-600 font-medium mt-1">
                    Pago pendiente
                  </p>
                )}
                {status === 'active' && subscription.current_period_end && (
                  <p className="text-sm text-gray-500 mt-1">
                    Proximo cobro: {new Date(subscription.current_period_end).toLocaleDateString('es-AR')}
                  </p>
                )}
              </div>
              <div className="flex flex-col gap-2 items-end">
                {/* Trial/Expired users: "Elegir Plan" */}
                {isTrialOrExpired && (
                  <Button variant="primary" onClick={() => setShowUpgrade(true)}>
                    Elegir Plan
                  </Button>
                )}

                {/* Estandar users: "Cambiar a Premium" */}
                {showChangeToPremium && (
                  <Button variant="primary" onClick={() => setShowUpgrade(true)}>
                    Cambiar a Premium
                  </Button>
                )}

                {/* Monthly users: "Cambiar a anual" */}
                {showChangeToAnnual && (
                  <Button variant="secondary" onClick={() => setShowUpgrade(true)}>
                    Cambiar a anual (ahorra 32%)
                  </Button>
                )}

                {/* Cancel button for active paid plans */}
                {status === 'active' && !is_trial && (
                  <Button variant="secondary" onClick={() => setShowCancel(true)}>
                    Cancelar
                  </Button>
                )}
              </div>
            </div>

            {/* Usage meters - only for Estandar (Premium is unlimited) */}
            {showUsageMeters && (
              <div>
                <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Uso este mes</h4>
                <div className="space-y-3">
                  <UsageMeter
                    label="Comprobantes"
                    current={usage.total_documents}
                    limit={limits.invoicesPerMonth}
                    unit="este mes"
                  />
                  <UsageMeter
                    label="Usuarios"
                    current={usage.users_count}
                    limit={limits.usersMax}
                  />
                </div>
              </div>
            )}

            {/* Premium unlimited indicator */}
            {is_premium && (
              <div className="text-sm text-green-600 font-medium p-3 bg-green-50 rounded-lg">
                Comprobantes y usuarios ilimitados
              </div>
            )}

            {/* Features */}
            <div>
              <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Funciones incluidas</h4>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-sm">
                {FEATURE_LABELS.map(({ key, label }) => {
                  const included = features[key]
                  return (
                    <div key={key} className={included ? 'text-green-600' : 'text-gray-400'}>
                      {included ? 'OK' : '--'} {label}
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <UpgradeModal
        open={showUpgrade}
        onClose={() => { setShowUpgrade(false); loadSubscription() }}
        currentPlan={subscription.plan}
        currentPlanGroup={plan_details.basePlanGroup}
        isTrialOrExpired={isTrialOrExpired}
        isEstandar={is_estandar}
        isPremium={is_premium}
      />

      <ConfirmDialog
        open={showCancel}
        title="Cancelar Suscripcion"
        message="Al cancelar, mantenes acceso hasta el final del periodo actual. Despues de eso, tu cuenta quedara en modo lectura."
        confirmLabel="Cancelar Suscripcion"
        variant="danger"
        loading={cancelling}
        onConfirm={handleCancel}
        onCancel={() => setShowCancel(false)}
      />
    </>
  )
}
