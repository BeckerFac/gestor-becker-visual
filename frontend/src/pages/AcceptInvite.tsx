import React, { useEffect, useState } from 'react'
import { Link, useSearchParams, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { api } from '@/services/api'

const acceptSchema = z.object({
  name: z.string().min(2, 'El nombre es requerido'),
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

type AcceptFormData = z.infer<typeof acceptSchema>

interface InvitationInfo {
  id: string
  email: string
  name: string | null
  role: string
  company_id: string
  company_name: string
}

export const AcceptInvite: React.FC = () => {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const token = searchParams.get('token')

  const [invitation, setInvitation] = useState<InvitationInfo | null>(null)
  const [validating, setValidating] = useState(true)
  const [validationError, setValidationError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const form = useForm<AcceptFormData>({
    resolver: zodResolver(acceptSchema),
  })

  useEffect(() => {
    if (!token) {
      setValidating(false)
      setValidationError('Token de invitacion no proporcionado')
      return
    }

    api.validateInvitation(token)
      .then((data) => {
        setInvitation(data)
        if (data.name) {
          form.setValue('name', data.name)
        }
      })
      .catch((err: any) => {
        setValidationError(err?.message || 'Invitacion invalida o expirada')
      })
      .finally(() => setValidating(false))
  }, [token, form])

  const onSubmit = async (data: AcceptFormData) => {
    if (!token) return
    setLoading(true)
    setSubmitError(null)
    try {
      await api.acceptInvitation(token, { name: data.name, password: data.password })
      setSuccess(true)
    } catch (err: any) {
      setSubmitError(err?.message || 'Error al aceptar la invitacion')
    } finally {
      setLoading(false)
    }
  }

  const roleLabels: Record<string, string> = {
    owner: 'Propietario',
    admin: 'Administrador',
    gerente: 'Gerente',
    editor: 'Editor',
    vendedor: 'Vendedor',
    contable: 'Contable',
    viewer: 'Visualizador',
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

  if (validating) {
    return darkWrapper(
      <div className="text-center py-4">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-500 mx-auto mb-4" />
        <p className="text-gray-500">Validando invitacion...</p>
      </div>
    )
  }

  if (validationError) {
    return darkWrapper(
      <div className="text-center">
        <h2 className="text-xl font-bold text-red-400 mb-4">Invitacion invalida</h2>
        <p className="text-gray-500 mb-4">{validationError}</p>
        <Link to="/" className="text-gray-500 hover:text-gray-300 transition-colors">Ir al login</Link>
      </div>
    )
  }

  if (success) {
    return darkWrapper(
      <div className="text-center space-y-4">
        <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-4">
          <p className="text-emerald-400 font-medium">
            Tu cuenta fue creada exitosamente.
          </p>
        </div>
        <p className="text-gray-500">
          Ya podes iniciar sesion con tu email y contrasena.
        </p>
        <Link
          to="/"
          className="inline-block bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white px-6 py-2.5 rounded-xl transition-all duration-200 shadow-lg shadow-blue-600/20 font-semibold"
        >
          Iniciar sesion
        </Link>
      </div>
    )
  }

  return darkWrapper(
    <>
      <div className="text-center mb-6">
        <p className="text-gray-500">Aceptar invitacion</p>
      </div>

      {invitation && (
        <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-4 mb-6">
          <p className="text-blue-300 text-sm">
            Fuiste invitado a unirte a <strong className="text-blue-200">{invitation.company_name}</strong> como{' '}
            <strong className="text-blue-200">{roleLabels[invitation.role] || invitation.role}</strong>.
          </p>
          <p className="text-blue-400/70 text-xs mt-1">
            Email: {invitation.email}
          </p>
        </div>
      )}

      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
        {submitError && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3">
            <p className="text-red-400 text-sm">{submitError}</p>
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-gray-400 mb-1.5">Nombre completo</label>
          <input
            type="text"
            placeholder="Tu nombre"
            {...form.register('name')}
            className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500/40 transition-colors"
          />
          {form.formState.errors.name?.message && (
            <p className="text-red-400 text-xs mt-1">{form.formState.errors.name.message}</p>
          )}
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-400 mb-1.5">Contrasena</label>
          <input
            type="password"
            placeholder="Minimo 8 caracteres"
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

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-semibold py-3 rounded-xl transition-all duration-200 shadow-lg shadow-blue-600/20 disabled:opacity-50"
        >
          {loading ? 'Creando cuenta...' : 'Crear cuenta y unirme'}
        </button>
      </form>
    </>
  )
}
