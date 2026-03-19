import React, { useEffect, useState } from 'react'

export const LegalPrivacidad: React.FC = () => {
  const [html, setHtml] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/legal/politica-de-privacidad.html')
      .then((res) => res.text())
      .then((text) => {
        // Extract body content from the full HTML
        const bodyMatch = text.match(/<body[^>]*>([\s\S]*?)<\/body>/i)
        setHtml(bodyMatch ? bodyMatch[1] : text)
      })
      .catch(() => setHtml('<p>Error al cargar la politica de privacidad.</p>'))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="min-h-screen bg-white dark:bg-gray-900">
      <div className="max-w-4xl mx-auto px-4 py-8">
        <a
          href="/"
          className="inline-flex items-center text-blue-600 dark:text-blue-400 hover:underline mb-6 text-sm"
        >
          &larr; Volver al inicio
        </a>
        {loading ? (
          <div className="text-center py-16 text-gray-500">Cargando...</div>
        ) : (
          <div
            className="prose dark:prose-invert max-w-none"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        )}
      </div>
    </div>
  )
}
