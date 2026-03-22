import React from 'react'
import { Card, CardContent } from '@/components/ui/Card'
import { PortalConfigSection } from '@/components/portal/PortalConfigSection'

export const PortalConfig: React.FC = () => {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Portal de Clientes</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Configura lo que tus clientes pueden ver en su portal</p>
        </div>
        <div className="flex items-center gap-2">
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
      </div>

      <Card>
        <CardContent className="pt-6">
          <PortalConfigSection />
        </CardContent>
      </Card>
    </div>
  )
}
