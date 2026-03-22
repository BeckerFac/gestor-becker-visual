import React, { useState, useEffect, useCallback } from 'react'
import { Card, CardContent } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { PortalConfigSection } from '@/components/portal/PortalConfigSection'
import { api } from '@/services/api'
import { toast } from '@/hooks/useToast'

interface Enterprise {
  id: string
  name: string
  cuit: string | null
  access_code?: string | null
  status: string
}

export const PortalConfig: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'empresas' | 'config'>('empresas')
  const [enterprises, setEnterprises] = useState<Enterprise[]>([])
  const [loading, setLoading] = useState(true)

  const loadEnterprises = useCallback(async () => {
    try {
      setLoading(true)
      const data = await api.getEnterprises()
      setEnterprises(data || [])
    } catch (e: any) {
      toast.error('Error cargando empresas')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadEnterprises() }, [loadEnterprises])

  const handleGenerateCode = async (enterprise: Enterprise) => {
    try {
      const code = Array.from(crypto.getRandomValues(new Uint8Array(6)))
        .map(b => b.toString(36).padStart(2, '0'))
        .join('')
        .substring(0, 12)
        .toUpperCase()
      await api.updateEnterprise(enterprise.id, { access_code: code })
      toast.success(`Codigo generado para ${enterprise.name}`)
      await loadEnterprises()
    } catch (e: any) {
      toast.error(e?.response?.data?.error || 'Error generando codigo')
    }
  }

  const handleRevokeCode = async (enterprise: Enterprise) => {
    try {
      await api.updateEnterprise(enterprise.id, { access_code: null })
      toast.success(`Acceso revocado para ${enterprise.name}`)
      await loadEnterprises()
    } catch (e: any) {
      toast.error(e?.response?.data?.error || 'Error revocando acceso')
    }
  }

  const handleCopyCode = (code: string) => {
    navigator.clipboard.writeText(code)
    toast.success('Codigo copiado')
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Portal de Clientes</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Gestiona el acceso y configuracion del portal para tus clientes</p>
        </div>
        <a
          href="/portal"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
        >
          Abrir portal
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
        </a>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 dark:bg-gray-800 p-1 rounded-lg w-fit">
        <button
          className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${activeTab === 'empresas' ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
          onClick={() => setActiveTab('empresas')}
        >
          Empresas ({enterprises.length})
        </button>
        <button
          className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${activeTab === 'config' ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
          onClick={() => setActiveTab('config')}
        >
          Configuracion
        </button>
      </div>

      {/* Tab content */}
      {activeTab === 'empresas' && (
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              Genera un codigo de acceso para cada empresa. Tus clientes usaran este codigo para ingresar al portal y ver sus pedidos, facturas y cotizaciones.
            </p>
            {loading ? (
              <p className="text-center py-8 text-gray-400">Cargando empresas...</p>
            ) : enterprises.length === 0 ? (
              <p className="text-center py-8 text-gray-400">No hay empresas registradas. Crea una desde el apartado de Empresas.</p>
            ) : (
              <div className="space-y-3">
                {enterprises.map(ent => (
                  <div key={ent.id} className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-800/50 rounded-lg border border-gray-200 dark:border-gray-700">
                    <div className="flex items-center gap-3">
                      <div className={`w-2.5 h-2.5 rounded-full ${ent.access_code ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600'}`} />
                      <div>
                        <p className="font-medium text-gray-900 dark:text-white">{ent.name}</p>
                        {ent.cuit && <p className="text-xs text-gray-500">{ent.cuit}</p>}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      {ent.access_code ? (
                        <>
                          <code className="text-sm bg-white dark:bg-gray-900 px-3 py-1.5 rounded border border-gray-200 dark:border-gray-600 font-mono tracking-wider text-gray-800 dark:text-gray-200">
                            {ent.access_code}
                          </code>
                          <button
                            onClick={() => handleCopyCode(ent.access_code!)}
                            className="p-1.5 text-gray-400 hover:text-blue-600 transition-colors"
                            title="Copiar codigo"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                          </button>
                          <button
                            onClick={() => handleRevokeCode(ent)}
                            className="text-xs text-red-500 hover:text-red-700 font-medium"
                          >
                            Revocar
                          </button>
                        </>
                      ) : (
                        <Button size="sm" variant="outline" onClick={() => handleGenerateCode(ent)}>
                          Generar codigo
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {activeTab === 'config' && (
        <Card>
          <CardContent className="pt-6">
            <PortalConfigSection />
          </CardContent>
        </Card>
      )}
    </div>
  )
}
