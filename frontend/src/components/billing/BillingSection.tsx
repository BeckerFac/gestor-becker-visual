import React, { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { PlanBadge } from './PlanBadge'
import { UsageMeter } from './UsageMeter'
import { UpgradeModal } from './UpgradeModal'
import { api } from '@/services/api'
import { toast } from '@/hooks/useToast'

interface SubscriptionData {
  plan: string
  status: string
  plan_details: {
    displayName: string
    priceArs: number
    limits: {
      invoicesPerMonth: number
      usersMax: number
      aiEnabled: boolean
      aiLevel: string
      storageMb: number
      portalEnabled: boolean
      crmEnabled: boolean
      reportsAdvanced: boolean
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
  can_use: boolean
  trial_ends_at: string | null
  current_period_end: string | null
}

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

  const { plan_details, usage, days_remaining, is_trial, status } = subscription
  const limits = plan_details.limits

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
                <p className="font-semibold text-gray-900">
                  Plan {plan_details.displayName}
                </p>
                <p className="text-sm text-gray-500">
                  {plan_details.priceArs > 0
                    ? `${formatPrice(plan_details.priceArs)}/mes`
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
              <div className="flex gap-2">
                <Button variant="primary" onClick={() => setShowUpgrade(true)}>
                  {is_trial || status === 'expired' ? 'Elegir Plan' : 'Cambiar Plan'}
                </Button>
                {status === 'active' && subscription.plan !== 'trial' && (
                  <Button variant="secondary" onClick={() => setShowCancel(true)}>
                    Cancelar
                  </Button>
                )}
              </div>
            </div>

            {/* Usage meters */}
            <div>
              <h4 className="text-sm font-semibold text-gray-700 mb-3">Uso este mes</h4>
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

            {/* Features */}
            <div>
              <h4 className="text-sm font-semibold text-gray-700 mb-2">Funciones incluidas</h4>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-sm">
                <div className={limits.aiEnabled ? 'text-green-600' : 'text-gray-400'}>
                  {limits.aiEnabled ? 'OK' : '--'} IA {limits.aiLevel === 'full' ? 'completa' : limits.aiLevel === 'basic' ? 'basica' : ''}
                </div>
                <div className={limits.portalEnabled ? 'text-green-600' : 'text-gray-400'}>
                  {limits.portalEnabled ? 'OK' : '--'} Portal clientes
                </div>
                <div className={limits.crmEnabled ? 'text-green-600' : 'text-gray-400'}>
                  {limits.crmEnabled ? 'OK' : '--'} CRM
                </div>
                <div className={limits.reportsAdvanced ? 'text-green-600' : 'text-gray-400'}>
                  {limits.reportsAdvanced ? 'OK' : '--'} Reportes avanzados
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <UpgradeModal
        open={showUpgrade}
        onClose={() => { setShowUpgrade(false); loadSubscription() }}
        currentPlan={subscription.plan}
      />

      <ConfirmDialog
        open={showCancel}
        title="Cancelar Suscripcion"
        message="Al cancelar, mantenes acceso hasta el final del periodo actual. Despues de eso, tu cuenta pasara al plan gratuito con funciones limitadas."
        confirmLabel="Cancelar Suscripcion"
        variant="danger"
        loading={cancelling}
        onConfirm={handleCancel}
        onCancel={() => setShowCancel(false)}
      />
    </>
  )
}
