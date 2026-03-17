import React from 'react'
import { Card, CardContent } from '@/components/ui/Card'

interface EmptyStateProps {
  icon?: string
  title: string
  description?: string
  actionLabel?: string
  onAction?: () => void
  /** Use 'filtered' when the empty state is due to filters, not lack of data */
  variant?: 'empty' | 'filtered'
}

/**
 * Edge cases:
 * - Should NEVER show while loading (parent should check loading state first)
 * - 'filtered' variant shows different message and reset hint
 * - No action button if onAction not provided
 */
export const EmptyState: React.FC<EmptyStateProps> = ({
  icon = '📭',
  title,
  description,
  actionLabel,
  onAction,
  variant = 'empty',
}) => {
  return (
    <Card>
      <CardContent>
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <span className="text-4xl mb-3">{variant === 'filtered' ? '🔍' : icon}</span>
          <h3 className="text-lg font-semibold text-gray-700 dark:text-gray-300 mb-1">{title}</h3>
          {description && (
            <p className="text-sm text-gray-500 dark:text-gray-400 max-w-md mb-4">{description}</p>
          )}
          {variant === 'filtered' && (
            <p className="text-xs text-gray-400 dark:text-gray-500 mb-4">Intentá ajustando los filtros o limpiándolos</p>
          )}
          {actionLabel && onAction && (
            <button
              onClick={onAction}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
            >
              {actionLabel}
            </button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
