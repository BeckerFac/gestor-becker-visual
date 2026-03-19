import React, { useState, useCallback } from 'react'
import { api } from '@/services/api'

interface CompanyFormData {
  name: string
  cuit: string
  razon_social: string
  condicion_iva: string
  address: string
  city: string
  province: string
  phone: string
  email: string
  punto_venta: string
  logo_url: string
}

interface StepCompanyDataProps {
  data: CompanyFormData
  onChange: (data: CompanyFormData) => void
}

const CONDICIONES_IVA = [
  'IVA Responsable Inscripto',
  'Monotributo',
  'IVA Sujeto Exento',
  'Consumidor Final',
  'Responsable No Inscripto',
  'IVA No Responsable',
]

export const StepCompanyData: React.FC<StepCompanyDataProps> = ({ data, onChange }) => {
  const [lookingUp, setLookingUp] = useState(false)
  const [lookupError, setLookupError] = useState<string | null>(null)
  const [lookupSuccess, setLookupSuccess] = useState(false)

  const updateField = useCallback((field: keyof CompanyFormData, value: string) => {
    onChange({ ...data, [field]: value })
  }, [data, onChange])

  const handleCUITLookup = useCallback(async () => {
    const cleanCuit = data.cuit.replace(/[^0-9]/g, '')
    if (cleanCuit.length !== 11) {
      setLookupError('El CUIT debe tener 11 digitos')
      return
    }

    setLookingUp(true)
    setLookupError(null)
    setLookupSuccess(false)

    try {
      const result = await api.lookupCUIT(cleanCuit)

      if (result.found && result.data) {
        const updates: Partial<CompanyFormData> = {}
        if (result.data.razonSocial) {
          updates.razon_social = result.data.razonSocial
          if (!data.name) updates.name = result.data.razonSocial
        }
        if (result.data.condicionIVA) updates.condicion_iva = result.data.condicionIVA
        if (result.data.domicilioFiscal) updates.address = result.data.domicilioFiscal
        if (result.data.provincia) updates.province = result.data.provincia
        if (result.data.localidad) updates.city = result.data.localidad

        onChange({ ...data, ...updates })
        setLookupSuccess(true)
      } else {
        setLookupError('No se encontraron datos para este CUIT. Completa los campos manualmente.')
      }
    } catch {
      setLookupError('AFIP no responde. Completa los datos manualmente.')
    } finally {
      setLookingUp(false)
    }
  }, [data, onChange])

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
          Empecemos con los datos de tu empresa
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Ingresa tu CUIT y completamos todo automaticamente
        </p>
      </div>

      {/* CUIT with lookup */}
      <div className="space-y-1">
        <label className="text-sm font-medium text-gray-700 dark:text-gray-300">CUIT *</label>
        <div className="flex gap-2">
          <input
            type="text"
            value={data.cuit}
            onChange={(e) => {
              updateField('cuit', e.target.value)
              setLookupError(null)
              setLookupSuccess(false)
            }}
            placeholder="20123456789"
            maxLength={13}
            inputMode="numeric"
            className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            onClick={handleCUITLookup}
            disabled={lookingUp || data.cuit.replace(/[^0-9]/g, '').length < 11}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
          >
            {lookingUp ? (
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            )}
            Buscar
          </button>
        </div>
        {lookupError && (
          <div className="flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400 mt-1">
            <svg className="w-4 h-4 shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 6a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 6zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
            </svg>
            {lookupError}
          </div>
        )}
        {lookupSuccess && (
          <div className="flex items-center gap-2 text-xs text-green-600 dark:text-green-400 mt-1">
            <svg className="w-4 h-4 shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clipRule="evenodd" />
            </svg>
            Datos completados desde AFIP
          </div>
        )}
      </div>

      {/* Company name and Razon social */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1">
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Nombre comercial *</label>
          <input
            type="text"
            value={data.name}
            onChange={(e) => updateField('name', e.target.value)}
            placeholder="Mi Empresa"
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div className="space-y-1">
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Razon social</label>
          <input
            type="text"
            value={data.razon_social}
            onChange={(e) => updateField('razon_social', e.target.value)}
            placeholder="Razon Social S.R.L."
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      {/* Condicion IVA and Punto de Venta */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1">
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Condicion ante IVA</label>
          <select
            value={data.condicion_iva}
            onChange={(e) => updateField('condicion_iva', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">Seleccionar...</option>
            {CONDICIONES_IVA.map((cond) => (
              <option key={cond} value={cond}>{cond}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Punto de venta</label>
          <input
            type="number"
            value={data.punto_venta}
            onChange={(e) => updateField('punto_venta', e.target.value)}
            placeholder="Ej: 1"
            min="1"
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      {/* Address */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="space-y-1 sm:col-span-1">
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Direccion</label>
          <input
            type="text"
            value={data.address}
            onChange={(e) => updateField('address', e.target.value)}
            placeholder="Av. Corrientes 1234"
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div className="space-y-1">
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Ciudad</label>
          <input
            type="text"
            value={data.city}
            onChange={(e) => updateField('city', e.target.value)}
            placeholder="CABA"
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div className="space-y-1">
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Provincia</label>
          <input
            type="text"
            value={data.province}
            onChange={(e) => updateField('province', e.target.value)}
            placeholder="Buenos Aires"
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>
    </div>
  )
}
