import React, { useEffect, useCallback } from 'react'
import { useBusinessUnitStore, BusinessUnit } from '@/stores/businessUnitStore'
import { api } from '@/services/api'
import { cn } from '@/lib/utils'

interface BusinessUnitSelectorProps {
  compact?: boolean
  className?: string
}

export const BusinessUnitSelector: React.FC<BusinessUnitSelectorProps> = ({ compact, className }) => {
  // Use individual selectors to avoid infinite re-renders (Zustand best practice)
  const units = useBusinessUnitStore(s => s.units)
  const activeUnitId = useBusinessUnitStore(s => s.activeUnitId)
  const loaded = useBusinessUnitStore(s => s.loaded)

  const loadUnits = useCallback(() => {
    if (!loaded) {
      api.getBusinessUnits()
        .then((data: BusinessUnit[]) => useBusinessUnitStore.getState().setUnits(data))
        .catch(() => useBusinessUnitStore.getState().setUnits([]))
    }
  }, [loaded])

  useEffect(() => { loadUnits() }, [loadUnits])

  if (!loaded || units.length <= 1) {
    return null
  }

  const activeUnit = units.find(u => u.id === activeUnitId)

  return (
    <div className={cn('px-3', className)}>
      {!compact && (
        <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
          Razon social
        </label>
      )}
      <select
        value={activeUnitId || ''}
        onChange={(e) => useBusinessUnitStore.getState().setActiveUnitId(e.target.value)}
        className={cn(
          'w-full rounded-lg border border-gray-200 dark:border-gray-700',
          'bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100',
          'text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent',
          'cursor-pointer transition-colors',
          compact ? 'px-2 py-1' : 'px-3 py-2'
        )}
        title={activeUnit?.name || 'Seleccionar razon social'}
      >
        {units.filter(u => u.active).map(unit => (
          <option key={unit.id} value={unit.id}>
            {unit.name}
            {unit.is_fiscal ? ' (Fiscal)' : ''}
          </option>
        ))}
      </select>
    </div>
  )
}
