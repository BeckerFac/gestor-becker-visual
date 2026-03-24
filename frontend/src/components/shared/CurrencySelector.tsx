import React, { useState, useEffect, useCallback } from 'react'
import { api } from '@/services/api'
import { formatCurrency } from '@/lib/utils'

interface CurrencySelectorProps {
  currency: string
  exchangeRate: number | null
  onCurrencyChange: (currency: string) => void
  onExchangeRateChange: (rate: number | null) => void
  /** Amount in foreign currency to show ARS equivalent */
  foreignAmount?: number
  /** Compact mode for inline use */
  compact?: boolean
}

const CURRENCIES = [
  { code: 'ARS', label: 'ARS - Peso Argentino' },
  { code: 'USD', label: 'USD - Dolar Estadounidense' },
]

export const CurrencySelector: React.FC<CurrencySelectorProps> = ({
  currency,
  exchangeRate,
  onCurrencyChange,
  onExchangeRateChange,
  foreignAmount,
  compact = false,
}) => {
  const [loadingRate, setLoadingRate] = useState(false)
  const [rateError, setRateError] = useState<string | null>(null)

  const fetchRate = useCallback(async (curr: string) => {
    if (curr === 'ARS') {
      onExchangeRateChange(null)
      return
    }
    setLoadingRate(true)
    setRateError(null)
    try {
      const result = await api.getCurrencyRate(curr)
      onExchangeRateChange(result.rate)
    } catch {
      setRateError('No se pudo obtener la cotizacion')
    } finally {
      setLoadingRate(false)
    }
  }, [onExchangeRateChange])

  useEffect(() => {
    if (currency !== 'ARS' && !exchangeRate) {
      fetchRate(currency)
    }
  }, [currency]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleCurrencyChange = (newCurrency: string) => {
    onCurrencyChange(newCurrency)
    if (newCurrency === 'ARS') {
      onExchangeRateChange(null)
    } else {
      fetchRate(newCurrency)
    }
  }

  const arsEquivalent = foreignAmount && exchangeRate ? foreignAmount * exchangeRate : null

  if (compact) {
    return (
      <div className="flex items-center gap-2">
        <select
          className="px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded text-sm bg-white dark:bg-gray-700 dark:text-gray-100"
          value={currency}
          onChange={e => handleCurrencyChange(e.target.value)}
        >
          {CURRENCIES.map(c => (
            <option key={c.code} value={c.code}>{c.code}</option>
          ))}
        </select>
        {currency !== 'ARS' && (
          <div className="flex items-center gap-1 text-xs text-gray-500">
            {loadingRate ? (
              <span className="animate-pulse">Cargando...</span>
            ) : exchangeRate ? (
              <>
                <span>TC: {exchangeRate.toFixed(2)}</span>
                <button
                  type="button"
                  onClick={() => fetchRate(currency)}
                  className="text-blue-500 hover:text-blue-700 text-[10px]"
                  title="Actualizar cotizacion"
                >
                  ↻
                </button>
              </>
            ) : rateError ? (
              <span className="text-red-500">{rateError}</span>
            ) : null}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Moneda</label>
        <select
          className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 dark:text-gray-100"
          value={currency}
          onChange={e => handleCurrencyChange(e.target.value)}
        >
          {CURRENCIES.map(c => (
            <option key={c.code} value={c.code}>{c.label}</option>
          ))}
        </select>
      </div>

      {currency !== 'ARS' && (
        <div className="px-3 py-2 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg text-sm">
          <div className="flex items-center justify-between">
            <span className="text-blue-700 dark:text-blue-300 font-medium">
              Tipo de cambio:
            </span>
            <div className="flex items-center gap-2">
              {loadingRate ? (
                <span className="text-blue-500 animate-pulse">Consultando BCRA...</span>
              ) : exchangeRate ? (
                <>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    className="w-28 px-2 py-1 border border-blue-300 dark:border-blue-600 rounded text-sm text-right bg-white dark:bg-gray-700 dark:text-gray-100"
                    value={exchangeRate}
                    onChange={e => onExchangeRateChange(parseFloat(e.target.value) || null)}
                  />
                  <button
                    type="button"
                    onClick={() => fetchRate(currency)}
                    className="text-blue-600 hover:text-blue-800 text-xs"
                    title="Actualizar cotizacion"
                  >
                    ↻ BCRA
                  </button>
                </>
              ) : rateError ? (
                <div className="flex items-center gap-1">
                  <span className="text-red-500 text-xs">{rateError}</span>
                  <button
                    type="button"
                    onClick={() => fetchRate(currency)}
                    className="text-blue-600 hover:text-blue-800 text-xs"
                  >
                    Reintentar
                  </button>
                </div>
              ) : null}
            </div>
          </div>

          {arsEquivalent != null && arsEquivalent > 0 && (
            <div className="mt-1 text-xs text-blue-600 dark:text-blue-400">
              Equivalente: {formatCurrency(arsEquivalent, 'ARS')}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
