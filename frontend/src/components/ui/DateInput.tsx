import React, { useState, useRef, useCallback } from 'react'
import { cn } from '@/lib/utils'

interface DateInputProps {
  value: string // ISO format: YYYY-MM-DD
  onChange: (value: string) => void
  label?: string
  error?: string
  required?: boolean
  className?: string
  id?: string
  placeholder?: string
  disabled?: boolean
}

function isoToDdMmYyyy(iso: string): string {
  if (!iso) return ''
  const parts = iso.split('-')
  if (parts.length !== 3) return iso
  return `${parts[2]}/${parts[1]}/${parts[0]}`
}

function ddMmYyyyToIso(display: string): string {
  const clean = display.replace(/[^\d/]/g, '')
  const parts = clean.split('/')
  if (parts.length !== 3) return ''
  const [dd, mm, yyyy] = parts
  if (!dd || !mm || !yyyy || yyyy.length !== 4) return ''
  const day = parseInt(dd, 10)
  const month = parseInt(mm, 10)
  const year = parseInt(yyyy, 10)
  if (isNaN(day) || isNaN(month) || isNaN(year)) return ''
  if (day < 1 || day > 31 || month < 1 || month > 12 || year < 1900 || year > 2100) return ''
  return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`
}

function autoFormatInput(raw: string): string {
  // Strip non-digits
  const digits = raw.replace(/\D/g, '')
  if (digits.length <= 2) return digits
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4, 8)}`
}

export const DateInput: React.FC<DateInputProps> = ({
  value,
  onChange,
  label,
  error,
  required,
  className,
  id,
  disabled,
}) => {
  const [displayValue, setDisplayValue] = useState(() => isoToDdMmYyyy(value))
  const [isFocused, setIsFocused] = useState(false)
  const [validationError, setValidationError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  // Sync display value when ISO value changes externally
  const lastValueRef = useRef(value)
  if (value !== lastValueRef.current) {
    lastValueRef.current = value
    if (!isFocused) {
      // Only update display if not currently editing
      const newDisplay = isoToDdMmYyyy(value)
      if (newDisplay !== displayValue) {
        setDisplayValue(newDisplay)
      }
    }
  }

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value
    const formatted = autoFormatInput(raw)
    setDisplayValue(formatted)
    setValidationError('')

    // Auto-convert when complete (DD/MM/YYYY = 10 chars)
    if (formatted.length === 10) {
      const iso = ddMmYyyyToIso(formatted)
      if (iso) {
        onChange(iso)
        lastValueRef.current = iso
      }
    }
  }, [onChange])

  const handleFocus = useCallback(() => {
    setIsFocused(true)
    setDisplayValue(isoToDdMmYyyy(value))
  }, [value])

  const handleBlur = useCallback(() => {
    setIsFocused(false)
    if (!displayValue) {
      onChange('')
      lastValueRef.current = ''
      setValidationError('')
      return
    }
    const iso = ddMmYyyyToIso(displayValue)
    if (iso) {
      onChange(iso)
      lastValueRef.current = iso
      setDisplayValue(isoToDdMmYyyy(iso))
      setValidationError('')
    } else {
      setValidationError('Formato invalido (DD/MM/AAAA)')
    }
  }, [displayValue, onChange])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      (e.target as HTMLInputElement).blur()
    }
  }, [])

  const displayError = error || validationError

  return (
    <div className="flex flex-col gap-1">
      {label && (
        <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
          {label}
        </label>
      )}
      <input
        ref={inputRef}
        id={id}
        type="text"
        inputMode="numeric"
        placeholder="DD/MM/AAAA"
        value={displayValue}
        onChange={handleChange}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        required={required}
        disabled={disabled}
        maxLength={10}
        className={cn(
          'px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-base bg-white dark:bg-gray-700 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 focus:border-transparent',
          displayError && 'border-red-500 focus:ring-red-500',
          className
        )}
      />
      {displayError && <span className="text-sm text-red-500">{displayError}</span>}
    </div>
  )
}
