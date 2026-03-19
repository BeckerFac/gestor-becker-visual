import React from 'react'
import { Link } from 'react-router-dom'
import { Card, CardContent } from '@/components/ui/Card'

export const NotFound: React.FC = () => {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center px-4">
      <Card className="w-full max-w-md text-center">
        <CardContent className="py-12">
          <div className="text-7xl font-bold text-gray-200 dark:text-gray-700 mb-4">404</div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">
            Pagina no encontrada
          </h1>
          <p className="text-gray-500 dark:text-gray-400 mb-8">
            La pagina que buscas no existe o fue movida.
          </p>
          <Link
            to="/dashboard"
            className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition-colors min-h-[44px]"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            Ir al Dashboard
          </Link>
        </CardContent>
      </Card>
    </div>
  )
}
