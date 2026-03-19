import React, { useState, useEffect, useRef } from 'react'
import { api } from '@/services/api'

interface Props {
  reportType: 'ventas' | 'rentabilidad' | 'clientes' | 'cobranzas' | 'inventario' | 'conversion'
  reportData: Record<string, any> | null
}

export const AIReportNarrative: React.FC<Props> = ({ reportType, reportData }) => {
  const [narrative, setNarrative] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [hasAccess, setHasAccess] = useState<boolean | null>(null)
  const [error, setError] = useState(false)
  const lastDataHash = useRef<string>('')

  useEffect(() => {
    // Check AI access once
    const checkAccess = async () => {
      try {
        const status = await api.getAiStatus()
        setHasAccess(status.configured && status.has_plan_access)
      } catch {
        setHasAccess(false)
      }
    }
    checkAccess()
  }, [])

  useEffect(() => {
    if (!reportData || hasAccess !== true) {
      setNarrative('')
      return
    }

    // Simple hash to detect data changes
    const dataHash = `${reportType}_${JSON.stringify(reportData).length}`
    if (dataHash === lastDataHash.current) return
    lastDataHash.current = dataHash

    const generateNarrative = async () => {
      setLoading(true)
      setError(false)
      try {
        const result = await api.generateAiNarrative(reportType, reportData)
        setNarrative(result.narrative || '')
      } catch {
        setError(true)
        setNarrative('')
      } finally {
        setLoading(false)
      }
    }

    generateNarrative()
  }, [reportType, reportData, hasAccess])

  // Don't render if no access or no narrative
  if (hasAccess === false) return null
  if (!loading && !narrative && !error) return null

  return (
    <div className="mb-4 rounded-xl border border-purple-100 dark:border-purple-900/40 bg-gradient-to-r from-purple-50/50 to-indigo-50/50 dark:from-purple-950/10 dark:to-indigo-950/10 px-4 py-3">
      <div className="flex items-start gap-3">
        <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center flex-shrink-0 mt-0.5">
          <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-purple-600 dark:text-purple-400 mb-1">
            Resumen IA
          </p>
          {loading ? (
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
              <span className="text-sm text-gray-500 dark:text-gray-400">Analizando datos...</span>
            </div>
          ) : error ? (
            <p className="text-sm text-gray-400 dark:text-gray-500 italic">
              No se pudo generar el resumen. Intenta recargar la pagina.
            </p>
          ) : (
            <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
              {narrative}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
