import React, { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { SkeletonTable } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { toast } from '@/hooks/useToast'
import { ExportCSVButton } from '@/components/shared/ExportCSV'
import { api } from '@/services/api'

interface Enterprise {
  id: string
  name: string
  cuit: string | null
  address: string | null
  city: string | null
  province: string | null
  phone: string | null
  email: string | null
  tax_condition: string | null
  notes: string | null
  status: string
  contact_count: number
}

interface Contact {
  id: string
  cuit: string
  name: string
  contact_name: string | null
  phone: string | null
  email: string | null
  role: string | null
  enterprise_id: string | null
  notes: string | null
  status: string
  access_code: string | null
}

const emptyEnterpriseForm = {
  name: '', cuit: '', address: '', city: '', province: '',
  phone: '', email: '', tax_condition: 'Responsable Inscripto', notes: '',
}

const emptyContactForm = {
  cuit: '', name: '', contact_name: '', phone: '', email: '',
  tax_condition: 'Responsable Inscripto', credit_limit: '', payment_terms: '30',
  notes: '', role: '', enterprise_id: '',
}

export const Enterprises: React.FC = () => {
  const [enterprises, setEnterprises] = useState<Enterprise[]>([])
  const [contacts, setContacts] = useState<Contact[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [expandedContacts, setExpandedContacts] = useState<Contact[]>([])

  const [showEnterpriseForm, setShowEnterpriseForm] = useState(false)
  const [editingEnterpriseId, setEditingEnterpriseId] = useState<string | null>(null)
  const [enterpriseForm, setEnterpriseForm] = useState(emptyEnterpriseForm)

  const [showContactForm, setShowContactForm] = useState(false)
  const [editingContactId, setEditingContactId] = useState<string | null>(null)
  const [contactForm, setContactForm] = useState(emptyContactForm)
  const [contactForEnterprise, setContactForEnterprise] = useState<string | null>(null)

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<{ type: 'enterprise'; item: Enterprise } | { type: 'contact'; item: Contact } | null>(null)
  const [deleting, setDeleting] = useState(false)

  const loadData = async () => {
    try {
      setLoading(true)
      const [entRes, custRes] = await Promise.all([
        api.getEnterprises(),
        api.getCustomers(),
      ])
      setEnterprises(entRes || [])
      setContacts((custRes.items || custRes || []))
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadData() }, [])

  const handleExpandEnterprise = async (enterpriseId: string) => {
    if (expandedId === enterpriseId) {
      setExpandedId(null)
      return
    }
    try {
      const detail = await api.getEnterprise(enterpriseId)
      setExpandedContacts(detail.contacts || [])
      setExpandedId(enterpriseId)
    } catch (e: any) {
      setError(e.message)
    }
  }

  // Enterprise CRUD
  const handleEnterpriseSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      if (editingEnterpriseId) {
        await api.updateEnterprise(editingEnterpriseId, enterpriseForm)
        toast.success('Empresa actualizada correctamente')
      } else {
        await api.createEnterprise(enterpriseForm)
        toast.success('Empresa creada correctamente')
      }
      setShowEnterpriseForm(false)
      setEditingEnterpriseId(null)
      setEnterpriseForm(emptyEnterpriseForm)
      await loadData()
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setSaving(false)
    }
  }

  const handleEditEnterprise = (ent: Enterprise) => {
    setEnterpriseForm({
      name: ent.name, cuit: ent.cuit || '', address: ent.address || '',
      city: ent.city || '', province: ent.province || '', phone: ent.phone || '',
      email: ent.email || '', tax_condition: ent.tax_condition || 'Responsable Inscripto',
      notes: ent.notes || '',
    })
    setEditingEnterpriseId(ent.id)
    setShowEnterpriseForm(true)
    setShowContactForm(false)
  }

  const handleDeleteEnterprise = (ent: Enterprise) => {
    setDeleteTarget({ type: 'enterprise', item: ent })
  }

  const confirmDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      if (deleteTarget.type === 'enterprise') {
        await api.deleteEnterprise(deleteTarget.item.id)
        if (expandedId === deleteTarget.item.id) setExpandedId(null)
        toast.success('Empresa eliminada correctamente')
      } else {
        await api.deleteCustomer(deleteTarget.item.id)
        toast.success('Contacto eliminado correctamente')
      }
      await loadData()
      if (expandedId && deleteTarget.type === 'contact') {
        const detail = await api.getEnterprise(expandedId)
        setExpandedContacts(detail.contacts || [])
      }
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setDeleting(false)
      setDeleteTarget(null)
    }
  }

  // Contact CRUD
  const handleAddContact = (enterpriseId: string) => {
    setContactForm({ ...emptyContactForm, enterprise_id: enterpriseId })
    setContactForEnterprise(enterpriseId)
    setEditingContactId(null)
    setShowContactForm(true)
    setShowEnterpriseForm(false)
  }

  const handleEditContact = (contact: Contact) => {
    setContactForm({
      cuit: contact.cuit || '', name: contact.name, contact_name: contact.contact_name || '',
      phone: contact.phone || '', email: contact.email || '',
      tax_condition: 'Responsable Inscripto', credit_limit: '', payment_terms: '30',
      notes: contact.notes || '', role: contact.role || '',
      enterprise_id: contact.enterprise_id || '',
    })
    setEditingContactId(contact.id)
    setContactForEnterprise(contact.enterprise_id)
    setShowContactForm(true)
    setShowEnterpriseForm(false)
  }

  const handleContactSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const payload = {
        ...contactForm,
        credit_limit: contactForm.credit_limit ? parseFloat(contactForm.credit_limit) : null,
        payment_terms: contactForm.payment_terms ? parseInt(contactForm.payment_terms) : null,
        enterprise_id: contactForm.enterprise_id || null,
      }
      if (editingContactId) {
        await api.updateCustomer(editingContactId, payload)
        toast.success('Contacto actualizado correctamente')
      } else {
        await api.createCustomer(payload)
        toast.success('Contacto creado correctamente')
      }
      setShowContactForm(false)
      setEditingContactId(null)
      setContactForm(emptyContactForm)
      setContactForEnterprise(null)
      await loadData()
      if (expandedId) {
        const detail = await api.getEnterprise(expandedId)
        setExpandedContacts(detail.contacts || [])
      }
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteContact = (contact: Contact) => {
    setDeleteTarget({ type: 'contact', item: contact })
  }

  const handleGenerateCode = async (contact: Contact) => {
    const code = Math.random().toString(36).substring(2, 8).toUpperCase()
    try {
      await api.updateCustomer(contact.id, { access_code: code })
      toast.success(`Código de acceso generado para ${contact.name}: ${code}`)
      await loadData()
      if (expandedId) {
        const detail = await api.getEnterprise(expandedId)
        setExpandedContacts(detail.contacts || [])
      }
    } catch (e: any) {
      setError(e.message)
    }
  }

  const unassignedContacts = contacts.filter(c => !c.enterprise_id)
  const filteredEnterprises = enterprises.filter(e =>
    e.name.toLowerCase().includes(search.toLowerCase()) ||
    (e.cuit || '').includes(search)
  )

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Empresas</h1>
          <p className="text-sm text-gray-500 mt-1">{enterprises.length} empresa{enterprises.length !== 1 ? 's' : ''} · {contacts.length} contacto{contacts.length !== 1 ? 's' : ''}</p>
        </div>
        <div className="flex items-center gap-2">
          <ExportCSVButton
            data={filteredEnterprises.map(e => ({
              nombre: e.name,
              cuit: e.cuit || '-',
              direccion: e.address || '-',
              ciudad: e.city || '-',
              provincia: e.province || '-',
              telefono: e.phone || '-',
              email: e.email || '-',
              condicion_iva: e.tax_condition || '-',
              contactos: e.contact_count,
              estado: e.status === 'active' ? 'Activa' : 'Inactiva',
            }))}
            columns={[
              { key: 'nombre', label: 'Empresa' },
              { key: 'cuit', label: 'CUIT' },
              { key: 'direccion', label: 'Direccion' },
              { key: 'ciudad', label: 'Ciudad' },
              { key: 'provincia', label: 'Provincia' },
              { key: 'telefono', label: 'Telefono' },
              { key: 'email', label: 'Email' },
              { key: 'condicion_iva', label: 'Cond. IVA' },
              { key: 'contactos', label: 'Contactos' },
              { key: 'estado', label: 'Estado' },
            ]}
            filename="empresas"
          />
          <Button variant={showEnterpriseForm ? 'danger' : 'primary'} onClick={() => { setEnterpriseForm(emptyEnterpriseForm); setEditingEnterpriseId(null); setShowEnterpriseForm(!showEnterpriseForm); setShowContactForm(false) }}>
            {showEnterpriseForm ? 'Cancelar' : '+ Nueva Empresa'}
          </Button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
          {error}
          <button onClick={() => setError(null)} className="ml-2 font-bold">×</button>
        </div>
      )}

      {/* Enterprise Form */}
      {showEnterpriseForm && (
        <Card>
          <CardHeader><h3 className="text-lg font-semibold">{editingEnterpriseId ? 'Editar Empresa' : 'Nueva Empresa'}</h3></CardHeader>
          <CardContent>
            <form onSubmit={handleEnterpriseSubmit} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <Input label="Razón Social *" placeholder="Nombre de la empresa" value={enterpriseForm.name} onChange={e => setEnterpriseForm({ ...enterpriseForm, name: e.target.value })} required />
              <Input label="CUIT" placeholder="20-12345678-9" value={enterpriseForm.cuit} onChange={e => setEnterpriseForm({ ...enterpriseForm, cuit: e.target.value })} />
              <Input label="Teléfono" placeholder="+54 11 1234-5678" value={enterpriseForm.phone} onChange={e => setEnterpriseForm({ ...enterpriseForm, phone: e.target.value })} />
              <Input label="Email" type="email" placeholder="email@empresa.com" value={enterpriseForm.email} onChange={e => setEnterpriseForm({ ...enterpriseForm, email: e.target.value })} />
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-gray-700">Condición IVA</label>
                <select className="px-3 py-2 border border-gray-300 rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-blue-500" value={enterpriseForm.tax_condition} onChange={e => setEnterpriseForm({ ...enterpriseForm, tax_condition: e.target.value })}>
                  <option>Responsable Inscripto</option>
                  <option>Monotributo</option>
                  <option>Exento</option>
                  <option>Consumidor Final</option>
                </select>
              </div>
              <Input label="Dirección" placeholder="Av. Ejemplo 1234" value={enterpriseForm.address} onChange={e => setEnterpriseForm({ ...enterpriseForm, address: e.target.value })} />
              <Input label="Ciudad" placeholder="Buenos Aires" value={enterpriseForm.city} onChange={e => setEnterpriseForm({ ...enterpriseForm, city: e.target.value })} />
              <Input label="Provincia" placeholder="CABA" value={enterpriseForm.province} onChange={e => setEnterpriseForm({ ...enterpriseForm, province: e.target.value })} />
              <div className="col-span-full">
                <label className="text-sm font-medium text-gray-700 block mb-1">Notas</label>
                <textarea className="w-full px-3 py-2 border border-gray-300 rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y" rows={2} placeholder="Observaciones..." value={enterpriseForm.notes} onChange={e => setEnterpriseForm({ ...enterpriseForm, notes: e.target.value })} />
              </div>
              <div className="flex items-end">
                <Button type="submit" variant="success" loading={saving} className="w-full">{editingEnterpriseId ? 'Guardar' : 'Crear Empresa'}</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Contact Form */}
      {showContactForm && (
        <Card>
          <CardHeader><h3 className="text-lg font-semibold">{editingContactId ? 'Editar Contacto' : 'Nuevo Contacto'}</h3></CardHeader>
          <CardContent>
            <form onSubmit={handleContactSubmit} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-gray-700">Empresa</label>
                <select className="px-3 py-2 border border-gray-300 rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-blue-500" value={contactForm.enterprise_id} onChange={e => setContactForm({ ...contactForm, enterprise_id: e.target.value })}>
                  <option value="">Sin empresa</option>
                  {enterprises.map(ent => <option key={ent.id} value={ent.id}>{ent.name}</option>)}
                </select>
              </div>
              <Input label="CUIT *" placeholder="20-12345678-9" value={contactForm.cuit} onChange={e => setContactForm({ ...contactForm, cuit: e.target.value })} required />
              <Input label="Nombre *" placeholder="Nombre del contacto" value={contactForm.name} onChange={e => setContactForm({ ...contactForm, name: e.target.value })} required />
              <Input label="Cargo / Contacto" placeholder="Nombre del referente" value={contactForm.contact_name} onChange={e => setContactForm({ ...contactForm, contact_name: e.target.value })} />
              <Input label="Rol" placeholder="Comprador, Gerente, etc." value={contactForm.role} onChange={e => setContactForm({ ...contactForm, role: e.target.value })} />
              <Input label="Teléfono" placeholder="+54 11 1234-5678" value={contactForm.phone} onChange={e => setContactForm({ ...contactForm, phone: e.target.value })} />
              <Input label="Email" type="email" placeholder="email@empresa.com" value={contactForm.email} onChange={e => setContactForm({ ...contactForm, email: e.target.value })} />
              <div className="col-span-full">
                <label className="text-sm font-medium text-gray-700 block mb-1">Notas</label>
                <textarea className="w-full px-3 py-2 border border-gray-300 rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y" rows={2} placeholder="Observaciones..." value={contactForm.notes} onChange={e => setContactForm({ ...contactForm, notes: e.target.value })} />
              </div>
              <div className="flex items-end gap-2">
                <Button type="submit" variant="success" loading={saving} className="w-full">{editingContactId ? 'Guardar' : 'Crear Contacto'}</Button>
                <Button type="button" variant="secondary" onClick={() => { setShowContactForm(false); setContactForEnterprise(null) }} className="w-full">Cancelar</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <Input placeholder="Buscar empresa por nombre o CUIT..." value={search} onChange={e => setSearch(e.target.value)} />

      {loading ? (
        <Card><CardContent><SkeletonTable rows={5} cols={4} /></CardContent></Card>
      ) : filteredEnterprises.length === 0 ? (
        <Card><CardContent>
          <EmptyState
            title="Sin empresas"
            description={search ? 'No se encontraron empresas con esa busqueda' : 'Crea la primera empresa para empezar'}
            action={!search ? { label: '+ Nueva Empresa', onClick: () => { setEnterpriseForm(emptyEnterpriseForm); setEditingEnterpriseId(null); setShowEnterpriseForm(true) } } : undefined}
          />
        </CardContent></Card>
      ) : (
        <div className="space-y-3">
          {filteredEnterprises.map(ent => (
            <Card key={ent.id}>
              <div
                className="px-6 py-4 flex items-center justify-between cursor-pointer hover:bg-gray-50 transition-colors"
                onClick={() => handleExpandEnterprise(ent.id)}
              >
                <div className="flex items-center gap-4">
                  <span className="text-2xl">{expandedId === ent.id ? '▼' : '▶'}</span>
                  <div>
                    <h3 className="font-semibold text-gray-900">{ent.name}</h3>
                    <p className="text-sm text-gray-500">
                      {ent.cuit && <span className="font-mono">{ent.cuit}</span>}
                      {ent.cuit && ent.email && ' · '}
                      {ent.email && <span>{ent.email}</span>}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-sm text-gray-500">{ent.contact_count} contacto{Number(ent.contact_count) !== 1 ? 's' : ''}</span>
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${ent.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                    {ent.status === 'active' ? 'Activa' : 'Inactiva'}
                  </span>
                  <div className="flex gap-2" onClick={e => e.stopPropagation()}>
                    <button onClick={() => handleAddContact(ent.id)} className="text-green-600 hover:underline text-sm">+ Contacto</button>
                    <button onClick={() => handleEditEnterprise(ent)} className="text-blue-600 hover:underline text-sm">Editar</button>
                    <button onClick={() => handleDeleteEnterprise(ent)} className="text-red-600 hover:underline text-sm">Eliminar</button>
                  </div>
                </div>
              </div>

              {expandedId === ent.id && (
                <div className="border-t border-gray-200 bg-gray-50 px-6 py-4">
                  {expandedContacts.length === 0 ? (
                    <p className="text-sm text-gray-500 text-center py-4">Sin contactos. <button onClick={() => handleAddContact(ent.id)} className="text-blue-600 hover:underline">Agregar uno</button></p>
                  ) : (
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-gray-500 border-b">
                          <th className="pb-2 font-medium">Nombre</th>
                          <th className="pb-2 font-medium">CUIT</th>
                          <th className="pb-2 font-medium">Rol</th>
                          <th className="pb-2 font-medium">Teléfono</th>
                          <th className="pb-2 font-medium">Email</th>
                          <th className="pb-2 font-medium">Portal</th>
                          <th className="pb-2 font-medium">Acciones</th>
                        </tr>
                      </thead>
                      <tbody>
                        {expandedContacts.map(c => (
                          <tr key={c.id} className="border-b border-gray-100">
                            <td className="py-2 font-medium text-gray-900">{c.name}</td>
                            <td className="py-2 font-mono text-gray-600">{c.cuit}</td>
                            <td className="py-2 text-gray-600">{c.role || '-'}</td>
                            <td className="py-2 text-gray-600">{c.phone || '-'}</td>
                            <td className="py-2 text-gray-600">{c.email || '-'}</td>
                            <td className="py-2">
                              {c.access_code ? (
                                <span className="font-mono text-xs bg-green-50 text-green-700 px-2 py-0.5 rounded border border-green-200">{c.access_code}</span>
                              ) : (
                                <button onClick={() => handleGenerateCode(c)} className="text-blue-600 hover:underline text-xs">Generar</button>
                              )}
                            </td>
                            <td className="py-2">
                              <div className="flex gap-2">
                                <button onClick={() => handleEditContact(c)} className="text-blue-600 hover:underline">Editar</button>
                                <button onClick={() => handleDeleteContact(c)} className="text-red-600 hover:underline">Eliminar</button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </Card>
          ))}

          {/* Unassigned contacts */}
          {unassignedContacts.length > 0 && (
            <Card>
              <div className="px-6 py-4 bg-yellow-50 border-b border-yellow-200">
                <h3 className="font-semibold text-yellow-800">Sin empresa asignada ({unassignedContacts.length})</h3>
                <p className="text-xs text-yellow-600">Estos contactos no están vinculados a ninguna empresa</p>
              </div>
              <div className="px-6 py-4">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-gray-500 border-b">
                      <th className="pb-2 font-medium">Nombre</th>
                      <th className="pb-2 font-medium">CUIT</th>
                      <th className="pb-2 font-medium">Teléfono</th>
                      <th className="pb-2 font-medium">Email</th>
                      <th className="pb-2 font-medium">Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {unassignedContacts.map(c => (
                      <tr key={c.id} className="border-b border-gray-100">
                        <td className="py-2 font-medium text-gray-900">{c.name}</td>
                        <td className="py-2 font-mono text-gray-600">{c.cuit}</td>
                        <td className="py-2 text-gray-600">{c.phone || '-'}</td>
                        <td className="py-2 text-gray-600">{c.email || '-'}</td>
                        <td className="py-2">
                          <div className="flex gap-2">
                            <button onClick={() => handleEditContact(c)} className="text-blue-600 hover:underline">Editar</button>
                            <button onClick={() => handleDeleteContact(c)} className="text-red-600 hover:underline">Eliminar</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </div>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        title={deleteTarget?.type === 'enterprise' ? 'Eliminar Empresa' : 'Eliminar Contacto'}
        message={
          deleteTarget?.type === 'enterprise'
            ? `¿Eliminar empresa "${deleteTarget.item.name}"? Los contactos se desvinculan pero no se eliminan.`
            : `¿Eliminar contacto "${deleteTarget?.item.name}"?`
        }
        confirmLabel="Eliminar"
        variant="danger"
        loading={deleting}
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}
