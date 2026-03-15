import React, { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { PermissionMatrix } from '@/components/users/PermissionMatrix'
import { toast } from '@/hooks/useToast'
import { formatDate } from '@/lib/utils'
import { ExportCSVButton } from '@/components/shared/ExportCSV'
import { api } from '@/services/api'
import { useAuthStore } from '@/stores/authStore'

interface UserRecord {
  id: string
  name: string
  email: string
  role: string
  active: boolean
  last_login: string | null
  created_at: string
}

const ROLE_BADGES: Record<string, string> = {
  admin: 'bg-purple-100 text-purple-800',
  gerente: 'bg-blue-100 text-blue-800',
  vendedor: 'bg-green-100 text-green-800',
  contable: 'bg-yellow-100 text-yellow-800',
  stock_manager: 'bg-orange-100 text-orange-800',
  viewer: 'bg-gray-100 text-gray-800',
}

const ROLE_LABELS: Record<string, string> = {
  admin: 'Admin',
  gerente: 'Gerente',
  vendedor: 'Vendedor',
  contable: 'Contable',
  stock_manager: 'Gestor de Stock',
  viewer: 'Solo Lectura',
}

const ROLE_OPTIONS = ['admin', 'gerente', 'vendedor', 'contable', 'stock_manager', 'viewer']

const emptyForm = { name: '', email: '', password: '', role: 'vendedor' }

export const Users: React.FC = () => {
  const currentUser = useAuthStore(s => s.user)

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

  useEffect(() => { loadUsers() }, [loadUsers])

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
      // Reload permissions after applying template
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

  // --- Helpers ---
  const isCurrentUser = (userId: string) => currentUser?.id === userId
  const isAdmin = (user: UserRecord) => user.role === 'admin'
  const canDeactivate = (user: UserRecord) => !isAdmin(user) && !isCurrentUser(user.id)
  const deleteTargetUser = users.find(u => u.id === deleteTarget)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Gestion de Usuarios</h1>
          <p className="text-sm text-gray-500 mt-1">
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
          <Button
            variant={showForm ? 'danger' : 'primary'}
            onClick={showForm ? handleCloseForm : handleOpenCreate}
          >
            {showForm ? 'Cancelar' : '+ Nuevo Usuario'}
          </Button>
        </div>
      </div>

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
                  placeholder="Minimo 6 caracteres"
                  value={form.password}
                  onChange={e => setForm({ ...form, password: e.target.value })}
                  required
                  minLength={6}
                />
              )}
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-gray-700">Rol</label>
                <select
                  value={form.role}
                  onChange={e => setForm({ ...form, role: e.target.value })}
                  className="px-3 py-2 border border-gray-300 rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {ROLE_OPTIONS.map(role => (
                    <option key={role} value={role}>
                      {ROLE_LABELS[role]}
                    </option>
                  ))}
                </select>
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

      {/* User list */}
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
                <tr className="bg-gray-50 text-left text-sm font-medium text-gray-500">
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
                          {isAdmin(user) && (
                            <span className="text-xs px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 font-medium">
                              Admin
                            </span>
                          )}
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
                          <button
                            onClick={() => handleOpenEdit(user)}
                            className="text-blue-600 hover:underline text-sm"
                          >
                            Editar
                          </button>
                          <button
                            onClick={() => handleOpenResetPassword(user.id)}
                            className="text-amber-600 hover:underline text-sm"
                          >
                            Reset Pass
                          </button>
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
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
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
              placeholder="Minimo 6 caracteres"
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              minLength={6}
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
                disabled={newPassword.length < 6}
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
