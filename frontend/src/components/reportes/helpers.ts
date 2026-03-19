import { formatCurrency } from '@/lib/utils'
import type { DatePreset } from './types'

// -- Date helpers --

export function getMonthRange(offset: number = 0): { from: string; to: string } {
  const now = new Date()
  const y = now.getFullYear()
  const m = now.getMonth() + offset
  const start = new Date(y, m, 1)
  const end = new Date(y, m + 1, 0)
  return {
    from: fmtIso(start),
    to: fmtIso(end),
  }
}

export function getQuarterRange(): { from: string; to: string } {
  const now = new Date()
  const q = Math.floor(now.getMonth() / 3)
  const start = new Date(now.getFullYear(), q * 3, 1)
  const end = new Date(now.getFullYear(), q * 3 + 3, 0)
  return { from: fmtIso(start), to: fmtIso(end) }
}

export function getYearRange(): { from: string; to: string } {
  const y = new Date().getFullYear()
  return { from: `${y}-01-01`, to: `${y}-12-31` }
}

export function getSixMonthsRange(): { from: string; to: string } {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth() - 5, 1)
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0)
  return { from: fmtIso(start), to: fmtIso(end) }
}

export function fmtIso(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Format a number as Argentine currency */
export const fmtCurrency = (n: number | null | undefined): string => formatCurrency(n ?? 0)

/** Format a number as Argentine currency, showing negatives in red-friendly format with sign */
export function fmtSigned(n: number): string {
  if (n < 0) return `-${formatCurrency(Math.abs(n))}`
  return formatCurrency(n)
}

/** Resolve a date preset string to a from/to range */
export function resolvePreset(preset: DatePreset): { from: string; to: string } {
  switch (preset) {
    case 'este_mes': return getMonthRange(0)
    case 'mes_anterior': return getMonthRange(-1)
    case 'trimestre': return getQuarterRange()
    case 'anio': return getYearRange()
  }
}

/** Validate that from <= to */
export function validateDateRange(from: string, to: string): string | null {
  if (!from || !to) return null
  if (from > to) return 'La fecha "Desde" no puede ser posterior a la fecha "Hasta"'
  return null
}

/** Check if date range exceeds 1 year (for Libro IVA) */
export function isRangeOverOneYear(from: string, to: string): boolean {
  if (!from || !to) return false
  const d1 = new Date(from)
  const d2 = new Date(to)
  const diff = d2.getTime() - d1.getTime()
  const oneYear = 365.25 * 24 * 60 * 60 * 1000
  return diff > oneYear
}

/** Get active preset key from current dates, or null if none matches */
export function getActivePreset(dateFrom: string, dateTo: string): DatePreset | null {
  const presets: DatePreset[] = ['este_mes', 'mes_anterior', 'trimestre', 'anio']
  for (const p of presets) {
    const range = resolvePreset(p)
    if (range.from === dateFrom && range.to === dateTo) return p
  }
  return null
}

/** Build the Excel filename with report type and date range */
export function buildExcelFilename(tabKey: string, dateFrom: string, dateTo: string): string {
  const tabLabels: Record<string, string> = {
    ventas: 'Libro_IVA_Ventas',
    compras: 'Libro_IVA_Compras',
    posicion: 'Posicion_IVA',
    flujo: 'Flujo_Caja',
  }
  const label = tabLabels[tabKey] || 'Reporte'
  const from = dateFrom.replace(/-/g, '')
  const to = dateTo.replace(/-/g, '')
  return `${label}_${from}_${to}`
}
