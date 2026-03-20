import React from 'react'
import { cn } from '@/lib/utils'

interface UsageMeterProps {
  label: string
  current: number
  limit: number
  unit?: string
}

export const UsageMeter: React.FC<UsageMeterProps> = ({
  label,
  current,
  limit,
  unit = '',
}) => {
  const safeCurrent = current ?? 0
  const safeLimit = limit ?? 0
  const isUnlimited = !Number.isFinite(safeLimit) || safeLimit === 0
  const percentage = isUnlimited ? 0 : Math.min(100, (safeCurrent / safeLimit) * 100)
  const isWarning = percentage >= 80
  const isExceeded = percentage >= 100

  const displayLimit = isUnlimited ? 'Ilimitado' : `${safeLimit.toLocaleString('es-AR')}`
  const displayCurrent = `${safeCurrent.toLocaleString('es-AR')}`

  return (
    <div className="space-y-1">
      <div className="flex justify-between text-sm">
        <span className="text-gray-600">{label}</span>
        <span className={cn(
          'font-medium',
          isExceeded ? 'text-red-600' : isWarning ? 'text-yellow-600' : 'text-gray-900'
        )}>
          {displayCurrent}/{displayLimit} {unit}
        </span>
      </div>
      {!isUnlimited && (
        <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
          <div
            className={cn(
              'h-full rounded-full transition-all duration-500',
              isExceeded ? 'bg-red-500' : isWarning ? 'bg-yellow-500' : 'bg-blue-500'
            )}
            style={{ width: `${Math.min(100, percentage)}%` }}
          />
        </div>
      )}
    </div>
  )
}
