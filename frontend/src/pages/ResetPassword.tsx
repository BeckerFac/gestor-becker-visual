import React, { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { api } from '@/services/api'

const resetSchema = z.object({
  password: z.string()
    .min(8, 'Minimo 8 caracteres')
    .regex(/[A-Z]/, 'Debe contener al menos una mayuscula')
    .regex(/[a-z]/, 'Debe contener al menos una minuscula')
    .regex(/[0-9]/, 'Debe contener al menos un numero'),
  confirmPassword: z.string(),
}).refine(data => data.password === data.confirmPassword, {
  message: 'Las contrasenas no coinciden',
  path: ['confirmPassword'],
})

type ResetFormData = z.infer<typeof resetSchema>

export const ResetPassword: React.FC = () => {
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token')
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const form = useForm<ResetFormData>({
    resolver: zodResolver(resetSchema),
  })

  const onSubmit = async (data: ResetFormData) => {
    if (!token) {
      setError('Token no proporcionado')
      return
    }
    setLoading(true)
    setError(null)
    try {
      await api.resetPassword(token, data.password)
      setSuccess(true)
    } catch (err: any) {
      setError(err?.message || 'Error al restablecer la contrasena')
    } finally {
      setLoading(false)
    }
  }

  const darkWrapper = (children: React.ReactNode) => (
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
        </div>
        {/* Glass card */}
        <div className="bg-white/[0.03] backdrop-blur-xl border border-white/[0.06] rounded-2xl p-8 shadow-2xl shadow-black/20">
          {children}
        </div>
      </div>
    </div>
  )

  if (!token) {
    return darkWrapper(
      <div className="text-center">
        <h2 className="text-xl font-bold text-red-400 mb-4">Enlace invalido</h2>
        <p className="text-gray-500 mb-4">
          El enlace de restablecimiento es invalido o ha expirado.
        </p>
        <Link to="/forgot-password" className="text-gray-500 hover:text-gray-300 transition-colors">
          Solicitar nuevo enlace
        </Link>
      </div>
    )
  }

  return darkWrapper(
    <>
      <div className="text-center mb-6">
        <p className="text-gray-500">Nueva contrasena</p>
      </div>

      {success ? (
        <div className="text-center space-y-4">
          <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-4">
            <p className="text-emerald-400 font-medium">
              Tu contrasena fue restablecida exitosamente.
            </p>
          </div>
          <Link to="/" className="text-gray-500 hover:text-gray-300 text-sm font-medium transition-colors">
            Iniciar sesion
          </Link>
        </div>
      ) : (
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
          {error && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3">
              <p className="text-red-400 text-sm">{error}</p>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-400 mb-1.5">Nueva contrasena</label>
            <input
              type="password"
              placeholder="Minimo 8 caracteres, 1 mayuscula, 1 numero"
              {...form.register('password')}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500/40 transition-colors"
            />
            {form.formState.errors.password?.message && (
              <p className="text-red-400 text-xs mt-1">{form.formState.errors.password.message}</p>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-1.5">Confirmar contrasena</label>
            <input
              type="password"
              placeholder="Repetir contrasena"
              {...form.register('confirmPassword')}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500/40 transition-colors"
            />
            {form.formState.errors.confirmPassword?.message && (
              <p className="text-red-400 text-xs mt-1">{form.formState.errors.confirmPassword.message}</p>
            )}
          </div>

          <div className="text-xs text-gray-600 dark:text-gray-400 space-y-1">
            <p>La contrasena debe contener:</p>
            <ul className="list-disc pl-4">
              <li>Minimo 8 caracteres</li>
              <li>Al menos 1 mayuscula</li>
              <li>Al menos 1 minuscula</li>
              <li>Al menos 1 numero</li>
            </ul>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-semibold py-3 rounded-xl transition-all duration-200 shadow-lg shadow-blue-600/20 disabled:opacity-50"
          >
            {loading ? 'Restableciendo...' : 'Restablecer contrasena'}
          </button>
        </form>
      )}
    </>
  )
}
