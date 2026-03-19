import React, { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { PermissionMatrix } from '@/components/users/PermissionMatrix'
import { toast } from '@/hooks/useToast'
import { formatDate } from '@/lib/utils'
import { ExportCSVButton } from '@/components/shared/ExportCSV'
import { ExportExcelButton } from '@/components/shared/ExportExcel'
import { api } from '@/services/api'
import { useAuthStore } from '@/stores/authStore'
import { ROLE_HIERARCHY } from '@/shared/permissions.constants'

interface UserRecord {
  id: string
  name: string
  email: string
  role: string
  active: boolean
  last_login: string | null
  created_at: string
}

interface InvitationRecord {
  id: string
  email: string
  name: string | null
  role: string
  status: string
  expires_at: string
  created_at: string
  invited_by_name: string | null
}

const ROLE_BADGES: Record<string, string> = {
  owner: 'bg-amber-100 text-amber-800',
  admin: 'bg-purple-100 text-purple-800',
  gerente: 'bg-blue-100 text-blue-800',
  editor: 'bg-teal-100 text-teal-800',
  vendedor: 'bg-green-100 text-green-800',
  contable: 'bg-yellow-100 text-yellow-800',
  stock_manager: 'bg-orange-100 text-orange-800',
  viewer: 'bg-gray-100 text-gray-800',
}

const ROLE_LABELS: Record<string, string> = {
  owner: 'Owner',
  admin: 'Admin',
  gerente: 'Gerente',
  editor: 'Editor',
  vendedor: 'Vendedor',
  contable: 'Contable',
  stock_manager: 'Gestor de Stock',
  viewer: 'Solo Lectura',
}

// Roles that admins can assign (not owner)
const ASSIGNABLE_ROLES = ['admin', 'gerente', 'editor', 'vendedor', 'contable', 'stock_manager', 'viewer']

const emptyForm = { name: '', email: '', password: '', role: 'editor' }
const emptyInviteForm = { email: '', role: 'editor', name: '' }

export const Users: React.FC = () => {
  const currentUser = useAuthStore(s => s.user)
  const isOwner = currentUser?.role === 'owner'
  const isAdmin = currentUser?.role === 'admin' || isOwner

  const [users, setUsers] = useState<UserRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)

  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  const [permissionsUserId, setPermissionsUserId] = useState<string | null>(null)
  const [permissionsData, setPermissionsData] = useState<Record<string, string[]>>({})
  const [savingPerms, setSavingPerms] = useState(false)

  const [resetPasswordTarget, setResetPasswordTarget] = useState<string | null>(null)
  const [newPassword, setNewPassword] = useState('')
  const [resettingPassword, setResettingPassword] = useState(false)

  // Invitations
  const [invitations, setInvitations] = useState<InvitationRecord[]>([])
  const [showInviteForm, setShowInviteForm] = useState(false)
  const [inviteForm, setInviteForm] = useState(emptyInviteForm)
  const [sendingInvite, setSendingInvite] = useState(false)

  // Transfer ownership
  const [showTransferDialog, setShowTransferDialog] = useState(false)
  const [transferTargetId, setTransferTargetId] = useState<string | null>(null)
  const [transferring, setTransferring] = useState(false)

  // Sessions
  const [sessionsUserId, setSessionsUserId] = useState<string | null>(null)
  const [sessions, setSessions] = useState<{ id: string; created_at: string; expires_at: string }[]>([])
  const [loadingSessions, setLoadingSessions] = useState(false)

  // Tab
  const [activeTab, setActiveTab] = useState<'users' | 'invitations'>('users')

  const loadUsers = useCallback(async () => {
    try {
      setLoading(true)
      const data = await api.getUsers()
      setUsers(data || [])
    } catch (e: any) {
      toast.error(e.message || 'Error al cargar usuarios')
    } finally {
      setLoading(false)
    }
  }, [])

  const loadInvitations = useCallback(async () => {
    if (!isAdmin) return
    try {
      const data = await api.getInvitations()
      setInvitations(data || [])
    } catch (e: any) {
      // Silently fail - invitations may not be available
      console.error('Error loading invitations:', e)
    }
  }, [isAdmin])

  useEffect(() => { loadUsers(); loadInvitations() }, [loadUsers, loadInvitations])

  // --- Create / Edit ---
  const handleOpenCreate = () => {
    setForm(emptyForm)
    setEditingId(null)
    setShowForm(true)
  }

  const handleOpenEdit = (user: UserRecord) => {
    setForm({ name: user.name, email: user.email, password: '', role: user.role })
    setEditingId(user.id)
    setShowForm(true)
  }

  const handleCloseForm = () => {
    setShowForm(false)
    setEditingId(null)
    setForm(emptyForm)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      if (editingId) {
        await api.updateUser(editingId, { name: form.name, email: form.email, role: form.role })
        toast.success('Usuario actualizado')
      } else {
        await api.createUser({ name: form.name, email: form.email, password: form.password, role: form.role })
        toast.success('Usuario creado')
      }
      handleCloseForm()
      await loadUsers()
    } catch (e: any) {
      toast.error(e.message || 'Error al guardar usuario')
    } finally {
      setSaving(false)
    }
  }

  // --- Deactivate / Activate ---
  const handleToggleActive = (userId: string) => {
    setDeleteTarget(userId)
  }

  const confirmToggleActive = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      const target = users.find(u => u.id === deleteTarget)
      if (target?.active) {
        await api.deleteUser(deleteTarget)
        toast.success('Usuario desactivado')
      } else {
        await api.updateUser(deleteTarget, { active: true })
        toast.success('Usuario activado')
      }
      await loadUsers()
    } catch (e: any) {
      toast.error(e.message || 'Error al cambiar estado del usuario')
    } finally {
      setDeleting(false)
      setDeleteTarget(null)
    }
  }

  // --- Permissions ---
  const handleOpenPermissions = async (userId: string) => {
    if (permissionsUserId === userId) {
      setPermissionsUserId(null)
      return
    }
    try {
      const data = await api.getUserPermissions(userId)
      setPermissionsData(data?.permissions || data || {})
      setPermissionsUserId(userId)
    } catch (e: any) {
      toast.error(e.message || 'Error al cargar permisos')
    }
  }

  const handleSavePermissions = async () => {
    if (!permissionsUserId) return
    setSavingPerms(true)
    try {
      await api.setUserPermissions(permissionsUserId, permissionsData)
      toast.success('Permisos guardados')
    } catch (e: any) {
      toast.error(e.message || 'Error al guardar permisos')
    } finally {
      setSavingPerms(false)
    }
  }

  const handleApplyTemplate = async (template: string) => {
    if (!permissionsUserId) return
    setSavingPerms(true)
    try {
      await api.applyTemplate(permissionsUserId, template)
      const data = await api.getUserPermissions(permissionsUserId)
      setPermissionsData(data?.permissions || data || {})
      toast.success('Template aplicado')
    } catch (e: any) {
      toast.error(e.message || 'Error al aplicar template')
    } finally {
      setSavingPerms(false)
    }
  }

  // --- Reset Password ---
  const handleOpenResetPassword = (userId: string) => {
    setResetPasswordTarget(userId)
    setNewPassword('')
  }

  const handleResetPassword = async () => {
    if (!resetPasswordTarget || !newPassword) return
    setResettingPassword(true)
    try {
      await api.resetUserPassword(resetPasswordTarget, newPassword)
      toast.success('Contrasena restablecida')
      setResetPasswordTarget(null)
      setNewPassword('')
    } catch (e: any) {
      toast.error(e.message || 'Error al restablecer contrasena')
    } finally {
      setResettingPassword(false)
    }
  }

  // --- Invitations ---
  const handleSendInvite = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!inviteForm.email || !inviteForm.role) return
    setSendingInvite(true)
    try {
      const result = await api.createInvitation({
        email: inviteForm.email,
        role: inviteForm.role,
        name: inviteForm.name || undefined,
      })
      toast.success(`Invitacion enviada a ${inviteForm.email}`)
      // Show token for development (in production, send via email)
      if (result.token) {
        const inviteUrl = `${window.location.origin}/invite/${result.token}`
        console.log('Invitation URL:', inviteUrl)
        toast.success(`Link de invitacion copiado al portapapeles`)
        try { await navigator.clipboard.writeText(inviteUrl) } catch (_) { /* clipboard not available */ }
      }
      setShowInviteForm(false)
      setInviteForm(emptyInviteForm)
      await loadInvitations()
    } catch (e: any) {
      toast.error(e.message || 'Error al enviar invitacion')
    } finally {
      setSendingInvite(false)
    }
  }

  const handleCancelInvitation = async (id: string) => {
    try {
      await api.cancelInvitation(id)
      toast.success('Invitacion cancelada')
      await loadInvitations()
    } catch (e: any) {
      toast.error(e.message || 'Error al cancelar invitacion')
    }
  }

  const handleResendInvitation = async (id: string) => {
    try {
      const result = await api.resendInvitation(id)
      if (result.token) {
        const inviteUrl = `${window.location.origin}/invite/${result.token}`
        try { await navigator.clipboard.writeText(inviteUrl) } catch (_) { /* clipboard not available */ }
        toast.success('Invitacion reenviada - link copiado')
      } else {
        toast.success('Invitacion reenviada')
      }
    } catch (e: any) {
      toast.error(e.message || 'Error al reenviar invitacion')
    }
  }

  // --- Transfer Ownership ---
  const handleTransferOwnership = async () => {
    if (!transferTargetId) return
    setTransferring(true)
    try {
      await api.transferOwnership(transferTargetId)
      toast.success('Propiedad transferida exitosamente. Cerrando sesion...')
      // Force logout since role changed
      setTimeout(() => {
        useAuthStore.getState().clearAuth()
        window.location.href = '/'
      }, 2000)
    } catch (e: any) {
      toast.error(e.message || 'Error al transferir propiedad')
    } finally {
      setTransferring(false)
      setShowTransferDialog(false)
    }
  }

  // --- Sessions ---
  const handleOpenSessions = async (userId: string) => {
    if (sessionsUserId === userId) {
      setSessionsUserId(null)
      return
    }
    setLoadingSessions(true)
    try {
      const data = await api.getUserSessions(userId)
      setSessions(data || [])
      setSessionsUserId(userId)
    } catch (e: any) {
      toast.error(e.message || 'Error al cargar sesiones')
    } finally {
      setLoadingSessions(false)
    }
  }

  const handleRevokeAllSessions = async (userId: string) => {
    try {
      await api.revokeAllSessions(userId)
      toast.success('Todas las sesiones revocadas')
      setSessions([])
    } catch (e: any) {
      toast.error(e.message || 'Error al revocar sesiones')
    }
  }

  // --- Helpers ---
  const isCurrentUser = (userId: string) => currentUser?.id === userId
  const canModifyUser = (user: UserRecord) => {
    if (user.role === 'owner') return false
    if (isCurrentUser(user.id)) return false
    const myLevel = ROLE_HIERARCHY[currentUser?.role || ''] ?? 0
    const targetLevel = ROLE_HIERARCHY[user.role] ?? 0
    return myLevel > targetLevel
  }
  const canDeactivate = (user: UserRecord) => {
    return canModifyUser(user) && user.role !== 'owner'
  }
  const deleteTargetUser = users.find(u => u.id === deleteTarget)
  const admins = users.filter(u => u.role === 'admin' && u.active)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Gestion de Usuarios</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {users.length} usuario{users.length !== 1 ? 's' : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ExportCSVButton
            data={users.map(u => ({
              nombre: u.name,
              email: u.email,
              rol: ROLE_LABELS[u.role] || u.role,
              estado: u.active ? 'Activo' : 'Inactivo',
              ultimo_login: u.last_login ? formatDate(u.last_login) : 'Nunca',
            }))}
            columns={[
              { key: 'nombre', label: 'Nombre' },
              { key: 'email', label: 'Email' },
              { key: 'rol', label: 'Rol' },
              { key: 'estado', label: 'Estado' },
              { key: 'ultimo_login', label: 'Ultimo Login' },
            ]}
            filename="usuarios"
          />
          <ExportExcelButton
            data={users.map(u => ({
              nombre: u.name,
              email: u.email,
              rol: ROLE_LABELS[u.role] || u.role,
              estado: u.active ? 'Activo' : 'Inactivo',
              ultimo_login: u.last_login ? formatDate(u.last_login) : 'Nunca',
            }))}
            columns={[
              { key: 'nombre', label: 'Nombre' },
              { key: 'email', label: 'Email' },
              { key: 'rol', label: 'Rol' },
              { key: 'estado', label: 'Estado' },
              { key: 'ultimo_login', label: 'Ultimo Login' },
            ]}
            filename="usuarios"
          />
          {isAdmin && (
            <>
              <Button
                variant="outline"
                onClick={() => setShowInviteForm(prev => !prev)}
              >
                {showInviteForm ? 'Cancelar' : 'Invitar Usuario'}
              </Button>
              <Button
                variant={showForm ? 'danger' : 'primary'}
                onClick={showForm ? handleCloseForm : handleOpenCreate}
              >
                {showForm ? 'Cancelar' : '+ Nuevo Usuario'}
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Tabs */}
      {isAdmin && (
        <div className="flex gap-1 bg-gray-100 p-1 rounded-lg w-fit">
          <button
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${activeTab === 'users' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
            onClick={() => setActiveTab('users')}
          >
            Usuarios ({users.length})
          </button>
          <button
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${activeTab === 'invitations' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
            onClick={() => setActiveTab('invitations')}
          >
            Invitaciones ({invitations.filter(i => i.status === 'pending').length})
          </button>
        </div>
      )}

      {/* Invite user form */}
      {showInviteForm && isAdmin && (
        <Card className="animate-fadeIn">
          <CardHeader>
            <h3 className="text-lg font-semibold">Invitar Usuario por Email</h3>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSendInvite} className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Input
                label="Email *"
                type="email"
                placeholder="usuario@email.com"
                value={inviteForm.email}
                onChange={e => setInviteForm({ ...inviteForm, email: e.target.value })}
                required
              />
              <Input
                label="Nombre (opcional)"
                placeholder="Nombre completo"
                value={inviteForm.name}
                onChange={e => setInviteForm({ ...inviteForm, name: e.target.value })}
              />
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-gray-700">Rol *</label>
                <select
                  value={inviteForm.role}
                  onChange={e => setInviteForm({ ...inviteForm, role: e.target.value })}
                  className="px-3 py-2 border border-gray-300 rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {ASSIGNABLE_ROLES.map(role => (
                    <option key={role} value={role}>
                      {ROLE_LABELS[role]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-end col-span-full">
                <Button type="submit" variant="primary" loading={sendingInvite}>
                  Enviar Invitacion
                </Button>
              </div>
            </form>
            <p className="text-xs text-gray-500 mt-2">
              Se generara un link de invitacion valido por 7 dias. El usuario creara su contrasena al aceptar.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Create / Edit form */}
      {showForm && (
        <Card className="animate-fadeIn">
          <CardHeader>
            <h3 className="text-lg font-semibold">
              {editingId ? 'Editar Usuario' : 'Nuevo Usuario'}
            </h3>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Input
                label="Nombre *"
                placeholder="Nombre completo"
                value={form.name}
                onChange={e => setForm({ ...form, name: e.target.value })}
                required
              />
              <Input
                label="Email *"
                type="email"
                placeholder="usuario@empresa.com"
                value={form.email}
                onChange={e => setForm({ ...form, email: e.target.value })}
                required
              />
              {!editingId && (
                <Input
                  label="Contrasena *"
                  type="password"
                  placeholder="Minimo 8 caracteres"
                  value={form.password}
                  onChange={e => setForm({ ...form, password: e.target.value })}
                  required
                  minLength={8}
                />
              )}
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-gray-700">Rol</label>
                <select
                  value={form.role}
                  onChange={e => setForm({ ...form, role: e.target.value })}
                  className="px-3 py-2 border border-gray-300 rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-blue-500"
                  disabled={editingId === currentUser?.id}
                >
                  {ASSIGNABLE_ROLES.map(role => (
                    <option key={role} value={role}>
                      {ROLE_LABELS[role]}
                    </option>
                  ))}
                </select>
                {editingId === currentUser?.id && (
                  <p className="text-xs text-amber-600">No puede cambiar su propio rol</p>
                )}
              </div>
              <div className="flex items-end col-span-full">
                <Button type="submit" variant="success" loading={saving}>
                  {editingId ? 'Guardar Cambios' : 'Crear Usuario'}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Invitations tab */}
      {activeTab === 'invitations' && isAdmin && (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-700 text-left text-sm font-medium text-gray-500 dark:text-gray-300">
                  <th className="px-4 py-3">Email</th>
                  <th className="px-4 py-3">Nombre</th>
                  <th className="px-4 py-3">Rol</th>
                  <th className="px-4 py-3">Estado</th>
                  <th className="px-4 py-3">Invitado por</th>
                  <th className="px-4 py-3">Expira</th>
                  <th className="px-4 py-3">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {invitations.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
                      No hay invitaciones
                    </td>
                  </tr>
                ) : invitations.map(inv => (
                  <tr key={inv.id} className="border-b hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm">{inv.email}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{inv.name || '-'}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${ROLE_BADGES[inv.role] || 'bg-gray-100 text-gray-800'}`}>
                        {ROLE_LABELS[inv.role] || inv.role}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                        inv.status === 'pending' ? 'bg-yellow-100 text-yellow-800' :
                        inv.status === 'accepted' ? 'bg-green-100 text-green-800' :
                        'bg-red-100 text-red-800'
                      }`}>
                        {inv.status === 'pending' ? 'Pendiente' : inv.status === 'accepted' ? 'Aceptada' : 'Cancelada'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">{inv.invited_by_name || '-'}</td>
                    <td className="px-4 py-3 text-sm text-gray-500">
                      {inv.expires_at ? formatDate(inv.expires_at) : '-'}
                    </td>
                    <td className="px-4 py-3">
                      {inv.status === 'pending' && (
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleResendInvitation(inv.id)}
                            className="text-blue-600 hover:underline text-sm"
                          >
                            Reenviar
                          </button>
                          <button
                            onClick={() => handleCancelInvitation(inv.id)}
                            className="text-red-600 hover:underline text-sm"
                          >
                            Cancelar
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* User list */}
      {activeTab === 'users' && (
        <>
          {loading ? (
            <Card>
              <CardContent>
                <div className="animate-pulse space-y-3">
                  {[1, 2, 3].map(i => (
                    <div key={i} className="h-12 bg-gray-200 rounded" />
                  ))}
                </div>
              </CardContent>
            </Card>
          ) : users.length === 0 ? (
            <Card>
              <CardContent className="text-center py-12">
                <p className="text-gray-500">No hay usuarios registrados</p>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="bg-gray-50 dark:bg-gray-700 text-left text-sm font-medium text-gray-500 dark:text-gray-300">
                      <th className="px-4 py-3">Nombre</th>
                      <th className="px-4 py-3">Email</th>
                      <th className="px-4 py-3">Rol</th>
                      <th className="px-4 py-3">Estado</th>
                      <th className="px-4 py-3">Ultimo acceso</th>
                      <th className="px-4 py-3">Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map(user => (
                      <React.Fragment key={user.id}>
                        <tr className="border-b hover:bg-gray-50">
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-gray-900">{user.name}</span>
                              {isCurrentUser(user.id) && (
                                <span className="text-xs px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 font-medium">
                                  Tu
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-600">{user.email}</td>
                          <td className="px-4 py-3">
                            <span
                              className={`px-2 py-0.5 rounded-full text-xs font-medium ${ROLE_BADGES[user.role] || 'bg-gray-100 text-gray-800'}`}
                            >
                              {ROLE_LABELS[user.role] || user.role}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <span
                              className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                                user.active
                                  ? 'bg-green-100 text-green-800'
                                  : 'bg-red-100 text-red-800'
                              }`}
                            >
                              {user.active ? 'Activo' : 'Inactivo'}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-500">
                            {user.last_login ? formatDate(user.last_login) : 'Nunca'}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex flex-wrap gap-2">
                              {user.role !== 'owner' && user.role !== 'admin' && isAdmin && (
                                <button
                                  onClick={() => handleOpenPermissions(user.id)}
                                  className={`text-sm hover:underline ${
                                    permissionsUserId === user.id
                                      ? 'text-indigo-800 font-semibold'
                                      : 'text-indigo-600'
                                  }`}
                                >
                                  Permisos
                                </button>
                              )}
                              {canModifyUser(user) && (
                                <button
                                  onClick={() => handleOpenEdit(user)}
                                  className="text-blue-600 hover:underline text-sm"
                                >
                                  Editar
                                </button>
                              )}
                              {isAdmin && !isCurrentUser(user.id) && (
                                <button
                                  onClick={() => handleOpenResetPassword(user.id)}
                                  className="text-amber-600 hover:underline text-sm"
                                >
                                  Reset Pass
                                </button>
                              )}
                              {isAdmin && (
                                <button
                                  onClick={() => handleOpenSessions(user.id)}
                                  className={`text-sm hover:underline ${
                                    sessionsUserId === user.id ? 'text-gray-800 font-semibold' : 'text-gray-600'
                                  }`}
                                >
                                  Sesiones
                                </button>
                              )}
                              {canDeactivate(user) && (
                                <button
                                  onClick={() => handleToggleActive(user.id)}
                                  className={`hover:underline text-sm ${
                                    user.active ? 'text-red-600' : 'text-green-600'
                                  }`}
                                >
                                  {user.active ? 'Desactivar' : 'Activar'}
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                        {/* Inline permissions panel */}
                        {permissionsUserId === user.id && (
                          <tr>
                            <td colSpan={6} className="px-4 py-4 bg-gray-50/50 border-b">
                              <PermissionMatrix
                                permissions={permissionsData}
                                onChange={setPermissionsData}
                                onSave={handleSavePermissions}
                                onApplyTemplate={handleApplyTemplate}
                                saving={savingPerms}
                              />
                            </td>
                          </tr>
                        )}
                        {/* Inline sessions panel */}
                        {sessionsUserId === user.id && (
                          <tr>
                            <td colSpan={6} className="px-4 py-4 bg-blue-50/50 border-b">
                              <div className="space-y-3">
                                <div className="flex items-center justify-between">
                                  <h4 className="font-medium text-gray-800">
                                    Sesiones activas ({sessions.length})
                                  </h4>
                                  {sessions.length > 0 && (
                                    <Button
                                      variant="danger"
                                      size="sm"
                                      onClick={() => handleRevokeAllSessions(user.id)}
                                    >
                                      Cerrar todas las sesiones
                                    </Button>
                                  )}
                                </div>
                                {loadingSessions ? (
                                  <p className="text-sm text-gray-500">Cargando...</p>
                                ) : sessions.length === 0 ? (
                                  <p className="text-sm text-gray-500">No hay sesiones activas</p>
                                ) : (
                                  <div className="space-y-2">
                                    {sessions.map(session => (
                                      <div key={session.id} className="flex items-center justify-between bg-white rounded p-2 border">
                                        <div className="text-sm">
                                          <span className="text-gray-600">Iniciada: </span>
                                          <span className="font-medium">{formatDate(session.created_at)}</span>
                                          <span className="text-gray-400 mx-2">|</span>
                                          <span className="text-gray-600">Expira: </span>
                                          <span>{formatDate(session.expires_at)}</span>
                                        </div>
                                        <button
                                          onClick={async () => {
                                            try {
                                              await api.revokeSession(user.id, session.id)
                                              setSessions(prev => prev.filter(s => s.id !== session.id))
                                              toast.success('Sesion cerrada')
                                            } catch (e: any) {
                                              toast.error(e.message)
                                            }
                                          }}
                                          className="text-red-600 hover:underline text-sm"
                                        >
                                          Cerrar
                                        </button>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {/* Transfer Ownership (Owner only) */}
          {isOwner && admins.length > 0 && (
            <Card>
              <CardHeader>
                <h3 className="text-lg font-semibold text-amber-800">Transferir Propiedad</h3>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-gray-600 mb-4">
                  Transferir la propiedad de la empresa a otro Admin. Tu rol pasara a Admin.
                  Esta accion cerrara tu sesion.
                </p>
                <div className="flex items-center gap-3">
                  <select
                    value={transferTargetId || ''}
                    onChange={e => setTransferTargetId(e.target.value || null)}
                    className="px-3 py-2 border border-gray-300 rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-amber-500"
                  >
                    <option value="">Seleccionar Admin...</option>
                    {admins.map(admin => (
                      <option key={admin.id} value={admin.id}>
                        {admin.name} ({admin.email})
                      </option>
                    ))}
                  </select>
                  <Button
                    variant="warning"
                    disabled={!transferTargetId}
                    onClick={() => setShowTransferDialog(true)}
                  >
                    Transferir
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* Deactivate / Activate confirm dialog */}
      <ConfirmDialog
        open={!!deleteTarget}
        title={deleteTargetUser?.active ? 'Desactivar Usuario' : 'Activar Usuario'}
        message={
          deleteTargetUser?.active
            ? `El usuario "${deleteTargetUser?.name}" no podra acceder al sistema. Se puede reactivar luego.`
            : `Se reactivara el acceso de "${deleteTargetUser?.name}" al sistema.`
        }
        confirmLabel={deleteTargetUser?.active ? 'Desactivar' : 'Activar'}
        variant={deleteTargetUser?.active ? 'danger' : 'warning'}
        loading={deleting}
        onConfirm={confirmToggleActive}
        onCancel={() => setDeleteTarget(null)}
      />

      {/* Transfer ownership confirm dialog */}
      <ConfirmDialog
        open={showTransferDialog}
        title="Confirmar Transferencia de Propiedad"
        message={`Esta seguro que desea transferir la propiedad de la empresa a ${admins.find(a => a.id === transferTargetId)?.name || 'este usuario'}? Su rol pasara a Admin y se cerrara su sesion.`}
        confirmLabel="Transferir Propiedad"
        variant="danger"
        loading={transferring}
        onConfirm={handleTransferOwnership}
        onCancel={() => setShowTransferDialog(false)}
      />

      {/* Reset password dialog */}
      {resetPasswordTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" role="dialog" aria-modal="true">
          <div className="fixed inset-0 bg-black/50" onClick={() => setResetPasswordTarget(null)} />
          <div className="relative bg-white rounded-lg shadow-xl max-w-md w-full mx-4 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">
              Restablecer Contrasena
            </h3>
            <p className="text-sm text-gray-600 mb-4">
              Ingresa la nueva contrasena para{' '}
              <strong>{users.find(u => u.id === resetPasswordTarget)?.name}</strong>
            </p>
            <Input
              label="Nueva contrasena"
              type="password"
              placeholder="Minimo 8 caracteres"
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              minLength={8}
            />
            <div className="flex justify-end gap-3 mt-6">
              <Button
                variant="secondary"
                onClick={() => setResetPasswordTarget(null)}
                disabled={resettingPassword}
              >
                Cancelar
              </Button>
              <Button
                variant="primary"
                onClick={handleResetPassword}
                loading={resettingPassword}
                disabled={newPassword.length < 8}
              >
                Restablecer
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
