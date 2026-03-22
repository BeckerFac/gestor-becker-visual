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

const getPeriods = (): Period[] => {
  const now = new Date()
  const today = now.toISOString().split('T')[0]

  const startOfWeek = new Date(now)
  const dayOfWeek = now.getDay()
  startOfWeek.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1))

  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)

  const start3Months = new Date(now.getFullYear(), now.getMonth() - 2, 1)

  const startOfYear = new Date(now.getFullYear(), 0, 1)

  return [
    { label: 'Hoy', value: 'hoy', dateFrom: today, dateTo: today },
    { label: 'Semana', value: 'semana', dateFrom: startOfWeek.toISOString().split('T')[0], dateTo: today },
    { label: 'Mes', value: 'mes', dateFrom: startOfMonth.toISOString().split('T')[0], dateTo: today },
    { label: '3 Meses', value: '3meses', dateFrom: start3Months.toISOString().split('T')[0], dateTo: today },
    { label: 'Anual', value: 'anual', dateFrom: startOfYear.toISOString().split('T')[0], dateTo: today },
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
