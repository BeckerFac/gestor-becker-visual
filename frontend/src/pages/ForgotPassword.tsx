import React, { useState } from 'react'
import { Link } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { api } from '@/services/api'

const forgotSchema = z.object({
  email: z.string().email('Email invalido'),
})

type ForgotFormData = z.infer<typeof forgotSchema>

export const ForgotPassword: React.FC = () => {
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)

  const form = useForm<ForgotFormData>({
    resolver: zodResolver(forgotSchema),
  })

  const onSubmit = async (data: ForgotFormData) => {
    setLoading(true)
    try {
      await api.forgotPassword(data.email)
      setSent(true)
    } catch {
      // Always show success to prevent user enumeration
      setSent(true)
    } finally {
      setLoading(false)
    }
  }

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
          <p className="text-gray-500 mt-1">Restablecer contrasena</p>
        </div>
        {/* Glass card */}
        <div className="bg-white/[0.03] backdrop-blur-xl border border-white/[0.06] rounded-2xl p-8 shadow-2xl shadow-black/20">
          {sent ? (
            <div className="text-center space-y-4">
              <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-4">
                <p className="text-emerald-400 text-sm">
                  Si el email esta registrado, recibiras un enlace para restablecer tu contrasena.
                  Revisa tu bandeja de entrada y spam.
                </p>
              </div>
              <Link to="/" className="text-gray-500 hover:text-gray-300 text-sm transition-colors">
                Volver al login
              </Link>
            </div>
          ) : (
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
              <p className="text-gray-500 text-sm">
                Ingresa tu email y te enviaremos un enlace para restablecer tu contrasena.
              </p>
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-1.5">Email</label>
                <input
                  type="email"
                  placeholder="tu@email.com"
                  {...form.register('email')}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500/40 transition-colors"
                />
                {form.formState.errors.email?.message && (
                  <p className="text-red-400 text-xs mt-1">{form.formState.errors.email.message}</p>
                )}
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-semibold py-3 rounded-xl transition-all duration-200 shadow-lg shadow-blue-600/20 disabled:opacity-50"
              >
                {loading ? 'Enviando...' : 'Enviar enlace'}
              </button>

              <div className="text-center">
                <Link to="/" className="text-gray-500 hover:text-gray-300 text-sm transition-colors">
                  Volver al login
                </Link>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
