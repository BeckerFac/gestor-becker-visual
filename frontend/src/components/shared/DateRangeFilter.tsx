import React from 'react'
import { DateInput } from '@/components/ui/DateInput'

interface DateRangeFilterProps {
  dateFrom: string
  dateTo: string
  onDateFromChange: (date: string) => void
  onDateToChange: (date: string) => void
  onClear?: () => void
  label?: string
}

/**
 * Edge cases:
 * - dateFrom > dateTo -> visually warn (red border on dateTo)
 * - Only one date set -> still valid (acts as "from" or "until" filter)
 * - Both empty -> no filter applied
 * - Future dates -> allowed (for estimated delivery etc.)
 */
export const DateRangeFilter: React.FC<DateRangeFilterProps> = ({
  dateFrom,
  dateTo,
  onDateFromChange,
  onDateToChange,
  onClear,
  label = 'Rango de Fechas',
}) => {
  const isInvalidRange = dateFrom && dateTo && dateFrom > dateTo

  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-gray-500 dark:text-gray-400">{label}</label>
      <div className="flex items-center gap-1">
        <DateInput
          value={dateFrom}
          onChange={onDateFromChange}
          className="text-sm py-1.5 flex-1 min-w-0"
        />
        <span className="text-gray-400 text-xs">--</span>
        <DateInput
          value={dateTo}
          onChange={onDateToChange}
          className={`text-sm py-1.5 flex-1 min-w-0 ${
            isInvalidRange ? 'border-red-400 bg-red-50 dark:bg-red-900/20' : ''
          }`}
        />
        {(dateFrom || dateTo) && onClear && (
          <button
            onClick={onClear}
            className="text-gray-400 hover:text-gray-600 dark:text-gray-400 text-sm px-1"
            title="Limpiar fechas"
          >
            x
          </button>
        )}
      </div>
      {isInvalidRange && (
        <p className="text-xs text-red-500">La fecha "desde" no puede ser posterior a "hasta"</p>
      )}
    </div>
  )
}
