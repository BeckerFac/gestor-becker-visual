import React, { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { DataTable } from '@/components/shared/DataTable'
import { SkeletonTable } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/shared/EmptyState'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { toast } from '@/hooks/useToast'
import { ExportCSVButton } from '@/components/shared/ExportCSV'
import { ExportExcelButton } from '@/components/shared/ExportExcel'
import { TagBadges } from '@/components/shared/TagBadges'
import { TagManager } from '@/components/shared/TagManager'
import { api } from '@/services/api'

interface Customer {
  id: string
  cuit: string
  name: string
  contact_name: string | null
  address: string | null
  city: string | null
  province: string | null
  phone: string | null
  email: string | null
  tax_condition: string | null
  condicion_iva: number | null
  credit_limit: string | null
  payment_terms: number | null
  notes: string | null
  status: string
  access_code: string | null
  tags: { id: string; name: string; color: string }[]
}

const CONDICION_IVA_OPTIONS = [
  { value: '', label: '-- Seleccionar --' },
  { value: '1', label: '1 - IVA Responsable Inscripto' },
  { value: '4', label: '4 - IVA Sujeto Exento' },
  { value: '5', label: '5 - Consumidor Final' },
  { value: '6', label: '6 - Responsable Monotributo' },
  { value: '7', label: '7 - Sujeto No Categorizado' },
  { value: '8', label: '8 - Proveedor del Exterior' },
  { value: '9', label: '9 - Cliente del Exterior' },
  { value: '10', label: '10 - IVA Liberado Ley 19.640' },
  { value: '13', label: '13 - Monotributista Social' },
  { value: '15', label: '15 - IVA No Alcanzado' },
  { value: '16', label: '16 - Monotributo Trab. Indep. Promovido' },
]

const emptyForm = {
  cuit: '', name: '', contact_name: '', address: '', city: '', province: '',
  phone: '', email: '', tax_condition: 'Responsable Inscripto', condicion_iva: '',
  credit_limit: '', payment_terms: '30', notes: '',
}

export const Customers: React.FC = () => {
  const [customers, setCustomers] = useState<Customer[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Customer | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [availableTags, setAvailableTags] = useState<{ id: string; name: string; color: string }[]>([])
  const [expandedCustomerId, setExpandedCustomerId] = useState<string | null>(null)

  const loadTags = async () => {
    try {
      const res = await api.getTags()
      setAvailableTags(Array.isArray(res) ? res : res?.items || [])
    } catch { /* ignore */ }
  }

  const loadCustomers = async () => {
    try {
      setLoading(true)
      const res = await api.getCustomers()
      setCustomers(Array.isArray(res) ? res : res?.items || [])
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadCustomers(); loadTags() }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const payload = {
        ...form,
        condicion_iva: form.condicion_iva ? parseInt(form.condicion_iva) : null,
        credit_limit: form.credit_limit ? parseFloat(form.credit_limit) : null,
        payment_terms: form.payment_terms ? parseInt(form.payment_terms) : null,
      }
      if (editingId) {
        await api.updateCustomer(editingId, payload)
        toast.success('Cliente actualizado')
      } else {
        await api.createCustomer(payload)
        toast.success('Cliente creado')
      }
      setShowForm(false)
      setEditingId(null)
      setForm(emptyForm)
      await loadCustomers()
    } catch (e: any) {
      toast.error(e.message)
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const handleEdit = (customer: Customer) => {
    setForm({
      cuit: customer.cuit, name: customer.name, contact_name: customer.contact_name || '',
      address: customer.address || '', city: customer.city || '', province: customer.province || '',
      phone: customer.phone || '', email: customer.email || '',
      tax_condition: customer.tax_condition || 'Responsable Inscripto',
      condicion_iva: customer.condicion_iva?.toString() || '',
      credit_limit: customer.credit_limit || '', payment_terms: customer.payment_terms?.toString() || '30',
      notes: customer.notes || '',
    })
    setEditingId(customer.id)
    setShowForm(true)
  }

  const handleGenerateCode = async (customer: Customer) => {
    const code = Math.random().toString(36).substring(2, 8).toUpperCase()
    try {
      await api.updateCustomer(customer.id, { access_code: code })
      toast.success(`Código generado: ${code}`)
      await loadCustomers()
    } catch (e: any) {
      toast.error(e.message)
    }
  }

  const handleRevokeCode = async (customer: Customer) => {
    if (!confirm(`Revocar acceso al portal para ${customer.name}?`)) return
    try {
      await api.updateCustomer(customer.id, { access_code: null })
      toast.success('Acceso revocado')
      await loadCustomers()
    } catch (e: any) {
      toast.error(e.message)
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await api.deleteCustomer(deleteTarget.id)
      toast.success('Cliente eliminado')
      await loadCustomers()
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setDeleting(false)
      setDeleteTarget(null)
    }
  }

  const filtered = customers.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    c.cuit.includes(search) ||
    (c.email || '').toLowerCase().includes(search.toLowerCase())
  )

  const columns = [
    { key: 'cuit' as const, label: 'CUIT' },
    { key: 'name' as const, label: 'Razón Social', render: (v: any, row: Customer) => (
      <div className="flex items-center gap-2">
        <span>{v}</span>
        <TagBadges tags={row.tags} />
      </div>
    )},
    { key: 'contact_name' as const, label: 'Contacto', render: (v: any) => v || '-' },
    { key: 'phone' as const, label: 'Teléfono', render: (v: any) => v || '-' },
    { key: 'email' as const, label: 'Email', render: (v: any) => v || '-' },
    { key: 'tax_condition' as const, label: 'Cond. IVA', render: (v: any) => v || '-' },
    { key: 'status' as const, label: 'Estado', render: (v: any) => (
      <span className={`px-2 py-1 rounded-full text-xs font-medium ${v === 'active' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
        {v === 'active' ? 'Activo' : 'Inactivo'}
      </span>
    )},
    { key: 'access_code' as const, label: 'Código Portal', render: (v: any, row: Customer) => v ? (
      <div className="flex items-center gap-2">
        <span className="font-mono text-xs bg-green-50 text-green-700 px-2 py-1 rounded border border-green-200">{v}</span>
        <button onClick={(e) => { e.stopPropagation(); handleRevokeCode(row) }} className="text-xs text-red-500 hover:text-red-700">Revocar</button>
      </div>
    ) : (
      <button onClick={(e) => { e.stopPropagation(); handleGenerateCode(row) }} className="text-blue-600 hover:underline text-xs">Generar</button>
    )},
    { key: 'id' as const, label: 'Acciones', render: (_: any, row: Customer) => (
      <div className="flex gap-2">
        <button onClick={(e) => { e.stopPropagation(); setExpandedCustomerId(expandedCustomerId === row.id ? null : row.id) }} className="text-purple-600 hover:underline text-sm">Tags</button>
        <button onClick={(e) => { e.stopPropagation(); handleEdit(row) }} className="text-blue-600 hover:underline text-sm">Editar</button>
        <button onClick={(e) => { e.stopPropagation(); setDeleteTarget(row) }} className="text-red-600 hover:underline text-sm">Eliminar</button>
      </div>
    )},
  ]

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Clientes</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{customers.length} clientes registrados</p>
        </div>
        <div className="flex items-center gap-2">
          <ExportCSVButton
            data={filtered.map(c => ({
              nombre: c.name,
              cuit: c.cuit,
              empresa: c.contact_name || '-',
              telefono: c.phone || '-',
              email: c.email || '-',
              estado: c.status === 'active' ? 'Activo' : 'Inactivo',
            }))}
            columns={[
              { key: 'nombre', label: 'Nombre' },
              { key: 'cuit', label: 'CUIT' },
              { key: 'empresa', label: 'Empresa' },
              { key: 'telefono', label: 'Telefono' },
              { key: 'email', label: 'Email' },
              { key: 'estado', label: 'Estado' },
            ]}
            filename="clientes"
          />
          <ExportExcelButton
            data={filtered.map(c => ({
              nombre: c.name,
              cuit: c.cuit,
              empresa: c.contact_name || '-',
              telefono: c.phone || '-',
              email: c.email || '-',
              estado: c.status === 'active' ? 'Activo' : 'Inactivo',
            }))}
            columns={[
              { key: 'nombre', label: 'Nombre' },
              { key: 'cuit', label: 'CUIT' },
              { key: 'empresa', label: 'Empresa' },
              { key: 'telefono', label: 'Telefono' },
              { key: 'email', label: 'Email' },
              { key: 'estado', label: 'Estado' },
            ]}
            filename="clientes"
          />
          <Button variant={showForm ? 'danger' : 'primary'} onClick={() => { setForm(emptyForm); setEditingId(null); setShowForm(!showForm) }}>
            {showForm ? 'Cancelar' : '+ Nuevo Cliente'}
          </Button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 px-4 py-3 rounded-lg">
          {error}
          <button onClick={() => setError(null)} className="ml-2 font-bold" aria-label="Cerrar error">x</button>
        </div>
      )}

      {showForm && (
        <Card>
          <CardHeader><h3 className="text-lg font-semibold">{editingId ? 'Editar Cliente' : 'Nuevo Cliente'}</h3></CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <Input label="CUIT *" placeholder="20-12345678-9" value={form.cuit} onChange={e => setForm({ ...form, cuit: e.target.value })} required />
              <Input label="Razón Social *" placeholder="Nombre de la empresa" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required />
              <Input label="Contacto" placeholder="Nombre del contacto" value={form.contact_name} onChange={e => setForm({ ...form, contact_name: e.target.value })} />
              <Input label="Teléfono" placeholder="+54 11 1234-5678" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} />
              <Input label="Email" type="email" placeholder="email@empresa.com" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Condición IVA</label>
                <select className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-base bg-white dark:bg-gray-700 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500" value={form.tax_condition} onChange={e => setForm({ ...form, tax_condition: e.target.value })}>
                  <option>Responsable Inscripto</option>
                  <option>Monotributo</option>
                  <option>Exento</option>
                  <option>Consumidor Final</option>
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Cond. IVA AFIP (RG 5616)</label>
                <select className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-base bg-white dark:bg-gray-700 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500" value={form.condicion_iva} onChange={e => setForm({ ...form, condicion_iva: e.target.value })}>
                  {CONDICION_IVA_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                <p className="text-xs text-gray-400">Obligatorio desde 01/04/2026 para facturacion AFIP</p>
              </div>
              <Input label="Dirección" placeholder="Av. Ejemplo 1234" value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} />
              <Input label="Ciudad" placeholder="Buenos Aires" value={form.city} onChange={e => setForm({ ...form, city: e.target.value })} />
              <Input label="Provincia" placeholder="CABA" value={form.province} onChange={e => setForm({ ...form, province: e.target.value })} />
              <Input label="Límite de Crédito ($)" type="number" placeholder="0.00" value={form.credit_limit} onChange={e => setForm({ ...form, credit_limit: e.target.value })} />
              <Input label="Plazo de Pago (días)" type="number" placeholder="30" value={form.payment_terms} onChange={e => setForm({ ...form, payment_terms: e.target.value })} />
              <div className="col-span-full">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-1">Notas / Aclaraciones</label>
                <textarea
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-base bg-white dark:bg-gray-700 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
                  rows={2}
                  placeholder="Observaciones, condiciones especiales, datos adicionales..."
                  value={form.notes}
                  onChange={e => setForm({ ...form, notes: e.target.value })}
                />
              </div>
              <div className="flex items-end">
                <Button type="submit" variant="success" loading={saving} className="w-full">{editingId ? 'Guardar Cambios' : 'Crear Cliente'}</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <Input placeholder="Buscar por nombre, CUIT o email..." value={search} onChange={e => setSearch(e.target.value)} />

      {loading ? (
        <SkeletonTable rows={6} cols={6} />
      ) : filtered.length === 0 ? (
        <EmptyState
          title={search ? 'Sin resultados' : 'Sin clientes'}
          description={search ? `No se encontraron clientes para "${search}"` : 'Crea tu primer cliente para empezar.'}
          actionLabel={!search ? '+ Nuevo Cliente' : undefined}
          onAction={!search ? () => setShowForm(true) : undefined}
        />
      ) : (
        <>
          <DataTable columns={columns} data={filtered} />
          {expandedCustomerId && (() => {
            const cust = customers.find(c => c.id === expandedCustomerId)
            if (!cust) return null
            return (
              <Card className="border-purple-200">
                <CardContent className="pt-4">
                  <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Etiquetas de {cust.name}</p>
                  <TagManager
                    entityId={cust.id}
                    entityType="customer"
                    availableTags={availableTags}
                    assignedTags={cust.tags}
                    onTagsChange={loadCustomers}
                    onTagCreated={loadTags}
                  />
                </CardContent>
              </Card>
            )
          })()}
        </>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        title="Eliminar cliente"
        message={`¿Seguro que querés eliminar "${deleteTarget?.name}"? Esta acción no se puede deshacer.`}
        confirmLabel="Eliminar"
        variant="danger"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
        loading={deleting}
      />
    </div>
  )
}
