import React from 'react'
import { HelpTip } from '@/components/shared/HelpTip'

interface Enterprise { id: string; name: string; cuit?: string | null }
interface Customer { id: string; name: string; cuit: string; enterprise_id?: string | null }

interface EnterpriseCustomerSelectorProps {
  enterprises: Enterprise[]
  customers: Customer[]
  selectedEnterpriseId: string
  selectedCustomerId: string
  onEnterpriseChange: (id: string) => void
  onCustomerChange: (id: string) => void
  enterpriseRequired?: boolean
  customerRequired?: boolean
  enterpriseLabel?: string
  customerLabel?: string
  enterpriseHelpText?: string
  className?: string
}

export const EnterpriseCustomerSelector: React.FC<EnterpriseCustomerSelectorProps> = ({
  enterprises,
  customers,
  selectedEnterpriseId,
  selectedCustomerId,
  onEnterpriseChange,
  onCustomerChange,
  enterpriseRequired = false,
  customerRequired = false,
  enterpriseLabel = 'Empresa',
  customerLabel = 'Cliente / Contacto',
  enterpriseHelpText,
  className = '',
}) => {
  const filteredCustomers = selectedEnterpriseId
    ? customers.filter(c => c.enterprise_id === selectedEnterpriseId)
    : customers

  const handleEnterpriseChange = (id: string) => {
    onEnterpriseChange(id)
    if (id && selectedCustomerId) {
      const customer = customers.find(c => c.id === selectedCustomerId)
      if (customer && customer.enterprise_id !== id) {
        onCustomerChange('')
      }
    }
  }

  return (
    <div className={`grid grid-cols-1 md:grid-cols-2 gap-4 ${className}`}>
      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-gray-700">
          {enterpriseLabel} {enterpriseRequired && <span className="text-red-500">*</span>}
          {enterpriseHelpText && <HelpTip text={enterpriseHelpText} />}
        </label>
        <select
          className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          value={selectedEnterpriseId}
          onChange={e => handleEnterpriseChange(e.target.value)}
          required={enterpriseRequired}
        >
          <option value="">Todas las empresas</option>
          {enterprises.map(e => (
            <option key={e.id} value={e.id}>{e.name}{e.cuit ? ` (${e.cuit})` : ''}</option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-gray-700">
          {customerLabel} {customerRequired && <span className="text-red-500">*</span>}
          {selectedEnterpriseId && (
            <span className="ml-1 text-xs text-gray-400">
              ({filteredCustomers.length} contacto{filteredCustomers.length !== 1 ? 's' : ''})
            </span>
          )}
        </label>
        <select
          className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          value={selectedCustomerId}
          onChange={e => onCustomerChange(e.target.value)}
          required={customerRequired}
        >
          <option value="">Seleccionar contacto...</option>
          {filteredCustomers.map(c => (
            <option key={c.id} value={c.id}>{c.name}{c.cuit ? ` (${c.cuit})` : ''}</option>
          ))}
        </select>
        {selectedEnterpriseId && filteredCustomers.length === 0 && (
          <p className="text-xs text-amber-600 mt-1">
            Esta empresa no tiene contactos asignados.
          </p>
        )}
      </div>
    </div>
  )
}
