import React from 'react'
import { useNavigate } from 'react-router-dom'

export const UnauthorizedPage: React.FC = () => {
  const navigate = useNavigate()
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4">
      <div className="text-6xl font-bold text-gray-300 mb-4">403</div>
      <h2 className="text-xl font-semibold text-gray-700 mb-2">Acceso restringido</h2>
      <p className="text-gray-500 mb-6">No tiene permisos para acceder a esta seccion. Contacte a su administrador.</p>
      <button
        onClick={() => navigate('/dashboard')}
        className="px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
      >
        Volver al inicio
      </button>
    </div>
  )
}
