import React from 'react'
import { cn } from '@/lib/utils'

type StatusColor = 'gray' | 'yellow' | 'blue' | 'green' | 'red' | 'purple' | 'orange'

const colorMap: Record<StatusColor, string> = {
  gray: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
  yellow: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300',
  blue: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  green: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  red: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  purple: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
  orange: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300',
}

// Default status-to-color mapping for common statuses across the app
const defaultStatusColors: Record<string, StatusColor> = {
  // Orders
  pendiente: 'yellow',
  en_produccion: 'blue',
  produccion: 'blue',
  terminado: 'green',
  listo: 'purple',
  entregado: 'green',
  facturado: 'green',
  cancelado: 'red',
  // Cheques
  a_cobrar: 'yellow',
  endosado: 'blue',
  depositado: 'purple',
  cobrado: 'green',
  rechazado: 'red',
  cartera: 'blue',
  // Quotes
  draft: 'gray',
  sent: 'blue',
  accepted: 'green',
  rejected: 'red',
  expired: 'yellow',
  // Invoices
  autorizada: 'green',
  authorized: 'green',
  emitido: 'green',
  rechazada: 'red',
  cancelled: 'red',
  borrador: 'gray',
  // Payments
  pagado: 'green',
  pago_parcial: 'orange',
  no_pagado: 'red',
  // Remitos
  en_preparacion: 'blue',
  despachado: 'purple',
  recibido: 'green',
  // Cobros/Pagos
  parcial: 'orange',
  completo: 'green',
  anulado: 'red',
  // Generic
  active: 'green',
  inactive: 'gray',
  activo: 'green',
  inactivo: 'gray',
}

// Spanish labels for all statuses across the app
export const STATUS_LABELS: Record<string, string> = {
  // Orders
  pendiente: 'Pendiente',
  en_produccion: 'En Produccion',
  terminado: 'Terminado',
  listo: 'Listo',
  entregado: 'Entregado',
  facturado: 'Facturado',
  cancelado: 'Cancelado',
  // Cheques
  a_cobrar: 'A Cobrar',
  endosado: 'Endosado',
  depositado: 'Depositado',
  cobrado: 'Cobrado',
  rechazado: 'Rechazado',
  // Quotes
  draft: 'Borrador',
  sent: 'Enviada',
  accepted: 'Aceptada',
  rejected: 'Rechazada',
  expired: 'Vencida',
  // Invoices
  authorized: 'Autorizada',
  emitido: 'Emitido',
  cancelled: 'Cancelada',
  // Payments
  pagado: 'Pagado',
  pago_parcial: 'Pago Parcial',
  no_pagado: 'No Pagado',
  // Generic
  active: 'Activo',
  inactive: 'Inactivo',
  completo: 'Completo',
  parcial: 'Parcial',
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
