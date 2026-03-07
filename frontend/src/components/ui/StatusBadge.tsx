import React from 'react'
import { cn } from '@/lib/utils'

type StatusColor = 'gray' | 'yellow' | 'blue' | 'green' | 'red' | 'purple' | 'orange'

const colorMap: Record<StatusColor, string> = {
  gray: 'bg-gray-100 text-gray-700',
  yellow: 'bg-yellow-100 text-yellow-800',
  blue: 'bg-blue-100 text-blue-700',
  green: 'bg-green-100 text-green-700',
  red: 'bg-red-100 text-red-700',
  purple: 'bg-purple-100 text-purple-700',
  orange: 'bg-orange-100 text-orange-700',
}

// Default status-to-color mapping for common statuses across the app
const defaultStatusColors: Record<string, StatusColor> = {
  // Orders
  pendiente: 'yellow',
  en_produccion: 'blue',
  produccion: 'blue',
  listo: 'purple',
  entregado: 'green',
  facturado: 'green',
  cancelado: 'red',
  // Invoices
  autorizada: 'green',
  rechazada: 'red',
  borrador: 'gray',
  // Remitos
  en_preparacion: 'blue',
  despachado: 'purple',
  recibido: 'green',
  // Cheques
  cartera: 'blue',
  depositado: 'green',
  rechazado: 'red',
  endosado: 'purple',
  // Cobros/Pagos
  parcial: 'orange',
  completo: 'green',
  anulado: 'red',
  // Generic
  activo: 'green',
  inactivo: 'gray',
}

interface StatusBadgeProps {
  status: string
  label?: string
  color?: StatusColor
  className?: string
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({
  status,
  label,
  color,
  className,
}) => {
  const resolvedColor = color || defaultStatusColors[status.toLowerCase()] || 'gray'
  const displayLabel = label || status.replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase())

  return (
    <span
      className={cn(
        'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium whitespace-nowrap',
        colorMap[resolvedColor],
        className
      )}
    >
      {displayLabel}
    </span>
  )
}
