import React, { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api } from '@/services/api'

export const VerifyEmail: React.FC = () => {
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token')
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading')
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (!token) {
      setStatus('error')
      setMessage('Token de verificacion no proporcionado')
      return
    }

    api.verifyEmail(token)
      .then(() => {
        setStatus('success')
        setMessage('Tu email fue verificado exitosamente.')
      })
      .catch((err: any) => {
        setStatus('error')
        setMessage(err?.message || 'Error al verificar el email. El token puede haber expirado.')
      })
  }, [token])

  return (
    <div className="min-h-screen bg-[#0A0A0F] flex items-center justify-center px-4 relative overflow-hidden">
      {/* Background mesh */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-[40%] -left-[20%] w-[70%] h-[70%] rounded-full bg-blue-600/[0.07] blur-[120px]" />
        <div className="absolute -bottom-[30%] -right-[20%] w-[60%] h-[60%] rounded-full bg-indigo-600/[0.05] blur-[120px]" />
      </div>
      <div className="w-full max-w-[420px] relative z-10">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 mb-4 shadow-lg shadow-blue-500/20">
            <span className="text-2xl font-bold text-white">G</span>
          </div>
          <h1 className="text-3xl font-bold text-white tracking-tight">GESTIA</h1>
          <p className="text-gray-500 mt-1">Verificacion de Email</p>
        </div>
        {/* Glass card */}
        <div className="bg-white/[0.03] backdrop-blur-xl border border-white/[0.06] rounded-2xl p-8 shadow-2xl shadow-black/20 text-center">
          {status === 'loading' && (
            <div className="py-8">
              <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-500 mx-auto mb-4" />
              <p className="text-gray-500">Verificando...</p>
            </div>
          )}

          {status === 'success' && (
            <div className="space-y-4">
              <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-4">
                <p className="text-emerald-400 font-medium">{message}</p>
              </div>
              <Link
                to="/"
                className="inline-block bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white px-6 py-2.5 rounded-xl transition-all duration-200 shadow-lg shadow-blue-600/20 font-semibold"
              >
                Ir al login
              </Link>
            </div>
          )}

          {status === 'error' && (
            <div className="space-y-4">
              <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4">
                <p className="text-red-400">{message}</p>
              </div>
              <Link to="/" className="text-gray-500 hover:text-gray-300 text-sm transition-colors">
                Volver al login
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
