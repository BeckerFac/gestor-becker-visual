import React, { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { DataTable } from '@/components/shared/DataTable'
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
  credit_limit: string | null
  payment_terms: number | null
  notes: string | null
  status: string
  access_code: string | null
}

const emptyForm = {
  cuit: '', name: '', contact_name: '', address: '', city: '', province: '',
  phone: '', email: '', tax_condition: 'Responsable Inscripto', credit_limit: '', payment_terms: '30', notes: '',
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

  const loadCustomers = async () => {
    try {
      setLoading(true)
      const res = await api.getCustomers()
      setCustomers(res.items || res || [])
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadCustomers() }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const payload = {
        ...form,
        credit_limit: form.credit_limit ? parseFloat(form.credit_limit) : null,
        payment_terms: form.payment_terms ? parseInt(form.payment_terms) : null,
      }
      if (editingId) {
        await api.updateCustomer(editingId, payload)
      } else {
        await api.createCustomer(payload)
      }
      setShowForm(false)
      setEditingId(null)
      setForm(emptyForm)
      await loadCustomers()
    } catch (e: any) {
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
      alert(`Código de acceso generado para ${customer.name}: ${code}\n\nEl cliente puede ingresar al portal en /portal con su CUIT y este código.`)
      await loadCustomers()
    } catch (e: any) {
      setError(e.message)
    }
  }

  const handleDelete = async (customer: Customer) => {
    if (!confirm(`¿Eliminar cliente "${customer.name}"?`)) return
    try {
      await api.deleteCustomer(customer.id)
      await loadCustomers()
    } catch (e: any) {
      setError(e.message)
    }
  }

  const filtered = customers.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    c.cuit.includes(search) ||
    (c.email || '').toLowerCase().includes(search.toLowerCase())
  )

  const columns = [
    { key: 'cuit' as const, label: 'CUIT' },
    { key: 'name' as const, label: 'Razón Social' },
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
      <span className="font-mono text-xs bg-green-50 text-green-700 px-2 py-1 rounded border border-green-200">{v}</span>
    ) : (
      <button onClick={(e) => { e.stopPropagation(); handleGenerateCode(row) }} className="text-blue-600 hover:underline text-xs">Generar</button>
    )},
    { key: 'id' as const, label: 'Acciones', render: (_: any, row: Customer) => (
      <div className="flex gap-2">
        <button onClick={(e) => { e.stopPropagation(); handleEdit(row) }} className="text-blue-600 hover:underline text-sm">Editar</button>
        <button onClick={(e) => { e.stopPropagation(); handleDelete(row) }} className="text-red-600 hover:underline text-sm">Eliminar</button>
      </div>
    )},
  ]

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Clientes</h1>
          <p className="text-sm text-gray-500 mt-1">{customers.length} clientes registrados</p>
        </div>
        <Button variant="primary" onClick={() => { setForm(emptyForm); setEditingId(null); setShowForm(!showForm) }}>
          {showForm ? 'Cancelar' : '+ Nuevo Cliente'}
        </Button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
          {error}
          <button onClick={() => setError(null)} className="ml-2 font-bold">×</button>
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
                <label className="text-sm font-medium text-gray-700">Condición IVA</label>
                <select className="px-3 py-2 border border-gray-300 rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-blue-500" value={form.tax_condition} onChange={e => setForm({ ...form, tax_condition: e.target.value })}>
                  <option>Responsable Inscripto</option>
                  <option>Monotributo</option>
                  <option>Exento</option>
                  <option>Consumidor Final</option>
                </select>
              </div>
              <Input label="Dirección" placeholder="Av. Ejemplo 1234" value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} />
              <Input label="Ciudad" placeholder="Buenos Aires" value={form.city} onChange={e => setForm({ ...form, city: e.target.value })} />
              <Input label="Provincia" placeholder="CABA" value={form.province} onChange={e => setForm({ ...form, province: e.target.value })} />
              <Input label="Límite de Crédito ($)" type="number" placeholder="0.00" value={form.credit_limit} onChange={e => setForm({ ...form, credit_limit: e.target.value })} />
              <Input label="Plazo de Pago (días)" type="number" placeholder="30" value={form.payment_terms} onChange={e => setForm({ ...form, payment_terms: e.target.value })} />
              <div className="col-span-full">
                <label className="text-sm font-medium text-gray-700 block mb-1">Notas / Aclaraciones</label>
                <textarea
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
                  rows={2}
                  placeholder="Observaciones, condiciones especiales, datos adicionales..."
                  value={form.notes}
                  onChange={e => setForm({ ...form, notes: e.target.value })}
                />
              </div>
              <div className="flex items-end">
                <Button type="submit" variant="primary" loading={saving} className="w-full">{editingId ? 'Guardar Cambios' : 'Crear Cliente'}</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <Input placeholder="Buscar por nombre, CUIT o email..." value={search} onChange={e => setSearch(e.target.value)} />

      {loading ? (
        <Card><CardContent><p className="text-center py-8 text-gray-500">Cargando clientes...</p></CardContent></Card>
      ) : (
        <DataTable columns={columns} data={filtered} />
      )}
    </div>
  )
}
