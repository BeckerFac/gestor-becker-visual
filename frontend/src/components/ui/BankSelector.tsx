import React, { useState, useCallback } from 'react'
import { api } from '@/services/api'
import { toast } from '@/hooks/useToast'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'

interface Bank {
  id: string
  bank_name: string
}

interface BankSelectorProps {
  banks: Bank[]
  value: string
  onChange: (bankId: string) => void
  onBanksChange: (banks: Bank[]) => void
  label?: string
  required?: boolean
  className?: string
}

export const BankSelector: React.FC<BankSelectorProps> = ({
  banks,
  value,
  onChange,
  onBanksChange,
  label = 'Banco',
  required,
  className,
}) => {
  const [isCreating, setIsCreating] = useState(false)
  const [newBankName, setNewBankName] = useState('')
  const [saving, setSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Bank | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [hoveredBankId, setHoveredBankId] = useState<string | null>(null)

  const handleSelectChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value
    if (val === '__new__') {
      setIsCreating(true)
      setNewBankName('')
    } else {
      onChange(val)
    }
  }, [onChange])

  const handleSaveNewBank = useCallback(async () => {
    const trimmed = newBankName.trim()
    if (!trimmed) {
      toast.error('Ingresa un nombre de banco')
      return
    }
    setSaving(true)
    try {
      const created = await api.createBank({ bank_name: trimmed })
      const updatedBanks = [...banks, created].sort((a, b) =>
        a.bank_name.localeCompare(b.bank_name)
      )
      onBanksChange(updatedBanks)
      onChange(created.id)
      setIsCreating(false)
      setNewBankName('')
      toast.success(`Banco "${trimmed}" creado`)
    } catch (e: any) {
      toast.error(e.message || 'Error al crear banco')
    } finally {
      setSaving(false)
    }
  }, [newBankName, banks, onBanksChange, onChange])

  const handleCancelCreate = useCallback(() => {
    setIsCreating(false)
    setNewBankName('')
  }, [])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleSaveNewBank()
    } else if (e.key === 'Escape') {
      handleCancelCreate()
    }
  }, [handleSaveNewBank, handleCancelCreate])

  const handleDeleteBank = useCallback(async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await api.deleteBank(deleteTarget.id)
      const updatedBanks = banks.filter(b => b.id !== deleteTarget.id)
      onBanksChange(updatedBanks)
      if (value === deleteTarget.id) {
        onChange('')
      }
      setDeleteTarget(null)
      toast.success(`Banco "${deleteTarget.bank_name}" eliminado`)
    } catch (e: any) {
      const msg = e.response?.data?.error || e.message || 'Error al eliminar banco'
      toast.error(msg)
    } finally {
      setDeleting(false)
    }
  }, [deleteTarget, banks, value, onBanksChange, onChange])

  if (isCreating) {
    return (
      <div className="flex flex-col gap-1">
        {label && (
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">{label}</label>
        )}
        <div className="flex items-center gap-2">
          <input
            type="text"
            className="flex-1 px-3 py-2 border border-blue-400 dark:border-blue-500 rounded-lg text-base bg-white dark:bg-gray-700 dark:text-gray-100 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Nombre del nuevo banco..."
            value={newBankName}
            onChange={e => setNewBankName(e.target.value)}
            onKeyDown={handleKeyDown}
            autoFocus
            disabled={saving}
          />
          <button
            type="button"
            onClick={handleSaveNewBank}
            disabled={saving}
            className="px-3 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors whitespace-nowrap"
          >
            {saving ? '...' : 'Guardar'}
          </button>
          <button
            type="button"
            onClick={handleCancelCreate}
            disabled={saving}
            className="px-2 py-2 text-gray-500 hover:text-gray-700 dark:text-gray-300 text-sm transition-colors"
          >
            Cancelar
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-1">
      {label && (
        <label className="text-sm font-medium text-gray-700 dark:text-gray-300">{label}</label>
      )}
      <div className="relative">
        <select
          className={`w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 dark:text-gray-100 ${className || ''}`}
          value={value}
          onChange={handleSelectChange}
          required={required}
        >
          <option value="">Seleccionar banco...</option>
          {banks.map(b => (
            <option key={b.id} value={b.id}>{b.bank_name}</option>
          ))}
          <option value="__new__">+ Agregar nuevo banco...</option>
        </select>
        {/* Delete buttons shown as overlay list when bank is selected */}
        {value && banks.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {banks.map(b => (
              <span
                key={b.id}
                className={`inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded transition-colors ${
                  b.id === value
                    ? 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200'
                    : 'hidden'
                }`}
                onMouseEnter={() => setHoveredBankId(b.id)}
                onMouseLeave={() => setHoveredBankId(null)}
              >
                {b.bank_name}
                {hoveredBankId === b.id && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      setDeleteTarget(b)
                    }}
                    className="ml-0.5 text-red-500 hover:text-red-700 font-bold transition-colors"
                    title={`Eliminar ${b.bank_name}`}
                  >
                    x
                  </button>
                )}
              </span>
            ))}
          </div>
        )}
      </div>
      <ConfirmDialog
        open={!!deleteTarget}
        title="Eliminar banco"
        message={`Eliminar el banco "${deleteTarget?.bank_name}"? Solo se puede eliminar si no tiene transacciones asociadas.`}
        confirmLabel="Eliminar"
        variant="danger"
        loading={deleting}
        onConfirm={handleDeleteBank}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}
