import React from 'react'

interface Period {
  label: string
  value: string
  dateFrom: string
  dateTo: string
}

interface PeriodSelectorProps {
  selected: string
  onChange: (period: Period) => void
}

// PR7-T6: calcular fechas usando hora local del browser (AR) en vez de toISOString
// que serializa a UTC. Esto evita el off-by-one cuando el cliente esta en AR
// despues de las 21:00 (00:00 UTC = dia siguiente).
const toLocalYMD = (d: Date): string => {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

const getPeriods = (): Period[] => {
  const now = new Date()
  const today = toLocalYMD(now)

  // PR7-T6: "Semana" = ultimos 7 dias (rolling window) en vez de semana ISO.
  // Antes: si hoy era lunes, startOfWeek=hoy → el filtro semana solo mostraba hoy
  // y se perdian pedidos del domingo/sabado que el usuario acababa de crear.
  const startOfWeek = new Date(now)
  startOfWeek.setDate(now.getDate() - 6) // hoy + 6 dias atras = 7 dias totales

  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)

  const start3Months = new Date(now.getFullYear(), now.getMonth() - 2, 1)

  const startOfYear = new Date(now.getFullYear(), 0, 1)

  return [
    { label: 'Hoy', value: 'hoy', dateFrom: today, dateTo: today },
    { label: 'Semana', value: 'semana', dateFrom: toLocalYMD(startOfWeek), dateTo: today },
    { label: 'Mes', value: 'mes', dateFrom: toLocalYMD(startOfMonth), dateTo: today },
    { label: '3 Meses', value: '3meses', dateFrom: toLocalYMD(start3Months), dateTo: today },
    { label: 'Anual', value: 'anual', dateFrom: toLocalYMD(startOfYear), dateTo: today },
    { label: 'Todos', value: 'todos', dateFrom: '', dateTo: '' },
  ]
}

export const PeriodSelector: React.FC<PeriodSelectorProps> = ({ selected, onChange }) => {
  const periods = getPeriods()

  return (
    <div className="flex flex-wrap gap-1">
      {periods.map(p => (
        <button
          key={p.value}
          onClick={() => onChange(p)}
          className={`px-3 py-1 text-xs font-medium rounded-full transition-colors ${
            selected === p.value
              ? 'bg-blue-600 text-white'
              : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
          }`}
        >
          {p.label}
        </button>
      ))}
    </div>
  )
}
