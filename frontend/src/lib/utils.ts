import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatCurrency(value: number | string | null | undefined, currency: string = 'ARS'): string {
  const num = Number(value ?? 0)
  if (isNaN(num)) {
    return new Intl.NumberFormat('es-AR', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(0)
  }
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num)
}

export function formatDate(date: Date | string | null | undefined, format: string = 'DD/MM/YYYY'): string {
  if (date == null) return '-'
  const d = typeof date === 'string' ? new Date(date) : date
  if (isNaN(d.getTime())) return '-'
  const day = String(d.getDate()).padStart(2, '0')
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const year = d.getFullYear()

  if (format === 'DD/MM/YYYY') return `${day}/${month}/${year}`
  if (format === 'YYYY-MM-DD') return `${year}-${month}-${day}`
  return `${day}/${month}/${year}`
}

export function formatDateTime(date: Date | string | null | undefined): string {
  if (date == null) return '-'
  const d = typeof date === 'string' ? new Date(date) : date
  if (isNaN(d.getTime())) return '-'
  return d.toLocaleString('es-AR')
}
