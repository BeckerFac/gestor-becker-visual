import React from 'react'

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
 * - dateFrom > dateTo → visually warn (red border on dateTo)
 * - Only one date set → still valid (acts as "from" or "until" filter)
 * - Both empty → no filter applied
 * - Future dates → allowed (for estimated delivery etc.)
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
      <label className="text-xs font-medium text-gray-500">{label}</label>
      <div className="flex items-center gap-1">
        <input
          type="date"
          className="px-2 py-1.5 border border-gray-300 rounded-lg text-sm flex-1 min-w-0"
          value={dateFrom}
          onChange={e => onDateFromChange(e.target.value)}
          placeholder="Desde"
        />
        <span className="text-gray-400 text-xs">—</span>
        <input
          type="date"
          className={`px-2 py-1.5 border rounded-lg text-sm flex-1 min-w-0 ${
            isInvalidRange ? 'border-red-400 bg-red-50' : 'border-gray-300'
          }`}
          value={dateTo}
          onChange={e => onDateToChange(e.target.value)}
          placeholder="Hasta"
        />
        {(dateFrom || dateTo) && onClear && (
          <button
            onClick={onClear}
            className="text-gray-400 hover:text-gray-600 text-sm px-1"
            title="Limpiar fechas"
          >
            ×
          </button>
        )}
      </div>
      {isInvalidRange && (
        <p className="text-xs text-red-500">La fecha "desde" no puede ser posterior a "hasta"</p>
      )}
    </div>
  )
}
