import React from 'react'
import { useAuthStore } from '@/stores/authStore'

export const TrialBanner: React.FC = () => {
  const subscription = useAuthStore((state) => state.subscription)

  if (!subscription) return null

  const { subscription_status, subscription_days_remaining, subscription_is_read_only } = subscription

  // Don't show banner for active paid plans
  if (subscription_status === 'active') return null

  let bgColor = 'bg-blue-600'
  let message = ''

  if (subscription_status === 'trial' && subscription_days_remaining !== null) {
    if (subscription_days_remaining > 7) {
      bgColor = 'bg-blue-600'
      message = `Periodo de prueba: ${subscription_days_remaining} dias restantes`
    } else if (subscription_days_remaining > 3) {
      bgColor = 'bg-yellow-600'
      message = `Tu prueba gratuita vence en ${subscription_days_remaining} dias. Actualiza tu plan para no perder acceso.`
    } else if (subscription_days_remaining > 0) {
      bgColor = 'bg-orange-600'
      message = `ATENCION: Tu prueba gratuita vence en ${subscription_days_remaining} dia${subscription_days_remaining > 1 ? 's' : ''}. Actualiza ahora.`
    } else {
      bgColor = 'bg-red-600'
      message = 'Tu periodo de prueba ha vencido. Actualiza tu plan para seguir operando.'
    }
  } else if (subscription_status === 'grace') {
    bgColor = 'bg-red-600'
    message = `Periodo de gracia: ${subscription_days_remaining} dia${(subscription_days_remaining ?? 0) > 1 ? 's' : ''} restantes. Tu cuenta esta en modo solo lectura.`
  } else if (subscription_status === 'expired') {
    bgColor = 'bg-red-700'
    message = 'Tu cuenta ha expirado. Actualiza tu plan para recuperar el acceso completo.'
  } else if (subscription_status === 'cancelled') {
    bgColor = 'bg-gray-700'
    message = 'Tu suscripcion fue cancelada. Reactiva tu plan para seguir usando el sistema.'
  }

  if (!message) return null

  return (
    <div className={`${bgColor} text-white px-4 py-2 text-center text-sm flex items-center justify-center gap-3`}>
      <span>{message}</span>
      {(subscription_status !== 'active') && (
        <a
          href="/settings"
          className="bg-white text-gray-900 dark:text-gray-100 px-3 py-1 rounded text-xs font-semibold hover:bg-gray-100 transition-colors"
        >
          {subscription_is_read_only ? 'Actualizar plan' : 'Ver planes'}
        </a>
      )}
    </div>
  )
}
