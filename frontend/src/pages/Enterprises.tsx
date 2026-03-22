import React, { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { SkeletonTable } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/shared/EmptyState'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { toast } from '@/hooks/useToast'
import { ExportCSVButton } from '@/components/shared/ExportCSV'
import { ExportExcelButton } from '@/components/shared/ExportExcel'
import { TagBadges } from '@/components/shared/TagBadges'
import { TagManager } from '@/components/shared/TagManager'
import { api } from '@/services/api'
import { formatCurrency } from '@/lib/utils'
import { PermissionGate } from '@/components/shared/PermissionGate'
import { HelpTip } from '@/components/shared/HelpTip'

interface Enterprise {
  id: string
  name: string
  razon_social: string | null
  cuit: string | null
  address: string | null
  city: string | null
  province: string | null
  postal_code: string | null
  fiscal_address: string | null
  fiscal_city: string | null
  fiscal_province: string | null
  fiscal_postal_code: string | null
  phone: string | null
  email: string | null
  tax_condition: string | null
  notes: string | null
  status: string
  contact_count: number
  tags: { id: string; name: string; color: string }[]
  access_code?: string | null
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
  name: '', razon_social: '', cuit: '', address: '', city: '', province: '', postal_code: '',
  fiscal_address: '', fiscal_city: '', fiscal_province: '', fiscal_postal_code: '',
  same_fiscal_address: true,
  phone: '', email: '', tax_condition: 'Responsable Inscripto', notes: '',
  price_list_id: '',
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
  const [originalPriceListId, setOriginalPriceListId] = useState('')
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
  const [availableTags, setAvailableTags] = useState<{ id: string; name: string; color: string }[]>([])
  const [priceLists, setPriceLists] = useState<any[]>([])
  const [enterpriseHealth, setEnterpriseHealth] = useState<Map<string, { total_overdue: number; oldest_days: number }>>(new Map())

  const loadTags = async () => {
    try { setAvailableTags(await api.getTags()) } catch {}
  }

  const loadData = async () => {
    try {
      setLoading(true)
      const [entRes, custRes, plRes, agingRes] = await Promise.all([
        api.getEnterprises().catch((err: any) => {
          setError(`Error cargando empresas: ${err?.response?.data?.error || err?.message || 'Error desconocido'}`)
          return []
        }),
        api.getCustomers().catch(() => ({ items: [] })),
        api.getPriceLists().catch(() => []),
        api.getAgingReport().catch(() => null),
      ])
      setEnterprises(entRes || [])
      setContacts((custRes.items || custRes || []))
      setPriceLists(Array.isArray(plRes) ? plRes : [])

      // Build enterprise health map from aging data (only authorized invoices, not orders)
      if (agingRes && agingRes.details) {
        const healthMap = new Map<string, { total_overdue: number; oldest_days: number }>()
        for (const item of agingRes.details) {
          if (item.days_overdue <= 0) continue
          if (item.document_type !== 'invoice') continue // only count invoices, not unfactured orders
          const key = item.enterprise_name
          const existing = healthMap.get(key)
          if (existing) {
            existing.total_overdue += item.remaining
            existing.oldest_days = Math.max(existing.oldest_days, item.days_overdue)
          } else {
            healthMap.set(key, { total_overdue: item.remaining, oldest_days: item.days_overdue })
          }
        }
        setEnterpriseHealth(healthMap)
      }
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadData(); loadTags() }, [])

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
      const { same_fiscal_address, price_list_id, ...formData } = enterpriseForm
      const payload = {
        ...formData,
        fiscal_address: same_fiscal_address ? null : formData.fiscal_address,
        fiscal_city: same_fiscal_address ? null : formData.fiscal_city,
        fiscal_province: same_fiscal_address ? null : formData.fiscal_province,
        fiscal_postal_code: same_fiscal_address ? null : formData.fiscal_postal_code,
      }
      if (editingEnterpriseId) {
        await api.updateEnterprise(editingEnterpriseId, payload)
        // Link price list only if it actually changed
        if (price_list_id !== originalPriceListId) {
          await api.linkEnterpriseToPriceList(editingEnterpriseId, price_list_id || '').catch(() => {})
        }
        toast.success('Empresa actualizada correctamente')
      } else {
        const created = await api.createEnterprise(payload)
        // Link price list to newly created enterprise
        if (price_list_id && created?.id) {
          await api.linkEnterpriseToPriceList(created.id, price_list_id).catch(() => {})
        }
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
    const hasSameFiscal = !ent.fiscal_address && !ent.fiscal_city && !ent.fiscal_province && !ent.fiscal_postal_code
    setEnterpriseForm({
      name: ent.name, razon_social: ent.razon_social || '', cuit: ent.cuit || '',
      address: ent.address || '', city: ent.city || '', province: ent.province || '',
      postal_code: ent.postal_code || '',
      fiscal_address: ent.fiscal_address || '', fiscal_city: ent.fiscal_city || '',
      fiscal_province: ent.fiscal_province || '', fiscal_postal_code: ent.fiscal_postal_code || '',
      same_fiscal_address: hasSameFiscal,
      phone: ent.phone || '', email: ent.email || '',
      tax_condition: ent.tax_condition || 'Responsable Inscripto', notes: ent.notes || '',
      price_list_id: (ent as any).price_list_id || '',
    })
    setEditingEnterpriseId(ent.id)
    setOriginalPriceListId((ent as any).price_list_id || '')
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

  const unassignedContacts = contacts.filter(c => !c.enterprise_id)
  const filteredEnterprises = enterprises.filter(e =>
    e.name.toLowerCase().includes(search.toLowerCase()) ||
    (e.cuit || '').includes(search)
  )

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Empresas</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{enterprises.length} empresa{enterprises.length !== 1 ? 's' : ''} · {contacts.length} contacto{contacts.length !== 1 ? 's' : ''}</p>
        </div>
        <div className="flex items-center gap-2">
          <ExportCSVButton
            data={filteredEnterprises.map(e => ({
              nombre: e.name,
              razon_social: e.razon_social || '-',
              cuit: e.cuit || '-',
              direccion: e.address || '-',
              ciudad: e.city || '-',
              provincia: e.province || '-',
              codigo_postal: e.postal_code || '-',
              dir_fiscal: e.fiscal_address || e.address || '-',
              telefono: e.phone || '-',
              email: e.email || '-',
              condicion_iva: e.tax_condition || '-',
              contactos: e.contact_count,
              estado: e.status === 'active' ? 'Activa' : 'Inactiva',
            }))}
            columns={[
              { key: 'nombre', label: 'Empresa' },
              { key: 'razon_social', label: 'Razon Social' },
              { key: 'cuit', label: 'CUIT' },
              { key: 'direccion', label: 'Direccion' },
              { key: 'ciudad', label: 'Ciudad' },
              { key: 'provincia', label: 'Provincia' },
              { key: 'codigo_postal', label: 'CP' },
              { key: 'dir_fiscal', label: 'Dir. Fiscal' },
              { key: 'telefono', label: 'Telefono' },
              { key: 'email', label: 'Email' },
              { key: 'condicion_iva', label: 'Cond. IVA' },
              { key: 'contactos', label: 'Contactos' },
              { key: 'estado', label: 'Estado' },
            ]}
            filename="empresas"
          />
          <ExportExcelButton
            data={filteredEnterprises.map(e => ({
              nombre: e.name,
              razon_social: e.razon_social || '-',
              cuit: e.cuit || '-',
              direccion: e.address || '-',
              ciudad: e.city || '-',
              provincia: e.province || '-',
              codigo_postal: e.postal_code || '-',
              dir_fiscal: e.fiscal_address || e.address || '-',
              telefono: e.phone || '-',
              email: e.email || '-',
              condicion_iva: e.tax_condition || '-',
              contactos: e.contact_count,
              estado: e.status === 'active' ? 'Activa' : 'Inactiva',
            }))}
            columns={[
              { key: 'nombre', label: 'Empresa' },
              { key: 'razon_social', label: 'Razon Social' },
              { key: 'cuit', label: 'CUIT' },
              { key: 'direccion', label: 'Direccion' },
              { key: 'ciudad', label: 'Ciudad' },
              { key: 'provincia', label: 'Provincia' },
              { key: 'codigo_postal', label: 'CP' },
              { key: 'dir_fiscal', label: 'Dir. Fiscal' },
              { key: 'telefono', label: 'Telefono' },
              { key: 'email', label: 'Email' },
              { key: 'condicion_iva', label: 'Cond. IVA' },
              { key: 'contactos', label: 'Contactos' },
              { key: 'estado', label: 'Estado' },
            ]}
            filename="empresas"
          />
          <PermissionGate module="enterprises" action="create">
            <Button variant={showEnterpriseForm ? 'danger' : 'primary'} onClick={() => { setEnterpriseForm(emptyEnterpriseForm); setEditingEnterpriseId(null); setShowEnterpriseForm(!showEnterpriseForm); setShowContactForm(false) }}>
              {showEnterpriseForm ? 'Cancelar' : '+ Nueva Empresa'}
            </Button>
          </PermissionGate>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 px-4 py-3 rounded-lg">
          {error}
          <button onClick={() => setError(null)} className="ml-2 font-bold">×</button>
        </div>
      )}

      <>
      {/* Enterprise Form */}
      {showEnterpriseForm && (
        <Card>
          <CardHeader><h3 className="text-lg font-semibold">{editingEnterpriseId ? 'Editar Empresa' : 'Nueva Empresa'}</h3></CardHeader>
          <CardContent>
            <form onSubmit={handleEnterpriseSubmit} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                <Input label="Nombre Comercial *" placeholder="Nombre de la empresa" value={enterpriseForm.name} onChange={e => setEnterpriseForm({ ...enterpriseForm, name: e.target.value })} required />
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Razon Social<HelpTip text="Nombre legal de la empresa como figura en AFIP." /></label>
                  <Input placeholder="Razon social legal" value={enterpriseForm.razon_social} onChange={e => setEnterpriseForm({ ...enterpriseForm, razon_social: e.target.value })} />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300">CUIT<HelpTip text="CUIT de 11 digitos. Se valida automaticamente." /></label>
                  <Input placeholder="20-12345678-9" value={enterpriseForm.cuit} onChange={e => setEnterpriseForm({ ...enterpriseForm, cuit: e.target.value })} />
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                <Input label="Telefono" placeholder="+54 11 1234-5678" value={enterpriseForm.phone} onChange={e => setEnterpriseForm({ ...enterpriseForm, phone: e.target.value })} />
                <Input label="Email" type="email" placeholder="email@empresa.com" value={enterpriseForm.email} onChange={e => setEnterpriseForm({ ...enterpriseForm, email: e.target.value })} />
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Condicion IVA<HelpTip text="Necesario para determinar el tipo de factura cuando factures a esta empresa." /></label>
                  <select className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-base bg-white dark:bg-gray-700 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500" value={enterpriseForm.tax_condition} onChange={e => setEnterpriseForm({ ...enterpriseForm, tax_condition: e.target.value })}>
                    <option>Responsable Inscripto</option>
                    <option>Monotributo</option>
                    <option>Exento</option>
                    <option>Consumidor Final</option>
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Lista de Precios</label>
                  <select className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-base bg-white dark:bg-gray-700 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500" value={enterpriseForm.price_list_id} onChange={e => setEnterpriseForm({ ...enterpriseForm, price_list_id: e.target.value })}>
                    <option value="">Sin lista de precios</option>
                    {priceLists.map((pl: any) => <option key={pl.id} value={pl.id}>{pl.name} ({pl.type})</option>)}
                  </select>
                </div>
              </div>

              {/* Direccion de la empresa */}
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                <h4 className="text-sm font-semibold text-gray-700 mb-3">Direccion de la Empresa</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                  <Input label="Direccion" placeholder="Av. Ejemplo 1234" value={enterpriseForm.address} onChange={e => setEnterpriseForm({ ...enterpriseForm, address: e.target.value })} />
                  <Input label="Ciudad" placeholder="Buenos Aires" value={enterpriseForm.city} onChange={e => setEnterpriseForm({ ...enterpriseForm, city: e.target.value })} />
                  <Input label="Provincia" placeholder="CABA" value={enterpriseForm.province} onChange={e => setEnterpriseForm({ ...enterpriseForm, province: e.target.value })} />
                  <Input label="Codigo Postal" placeholder="C1234ABC" value={enterpriseForm.postal_code} onChange={e => setEnterpriseForm({ ...enterpriseForm, postal_code: e.target.value })} />
                </div>
              </div>

              {/* Direccion fiscal */}
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-sm font-semibold text-blue-700">Direccion Fiscal<HelpTip text="Domicilio fiscal registrado en AFIP." /></h4>
                  <label className="flex items-center gap-2 text-sm text-blue-600 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={enterpriseForm.same_fiscal_address}
                      onChange={e => {
                        const checked = e.target.checked
                        setEnterpriseForm(prev => ({
                          ...prev,
                          same_fiscal_address: checked,
                          fiscal_address: checked ? '' : prev.fiscal_address,
                          fiscal_city: checked ? '' : prev.fiscal_city,
                          fiscal_province: checked ? '' : prev.fiscal_province,
                          fiscal_postal_code: checked ? '' : prev.fiscal_postal_code,
                        }))
                      }}
                      className="rounded border-blue-300"
                    />
                    Igual a direccion de empresa
                  </label>
                </div>
                {!enterpriseForm.same_fiscal_address && (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    <Input label="Direccion Fiscal" placeholder="Av. Fiscal 5678" value={enterpriseForm.fiscal_address} onChange={e => setEnterpriseForm({ ...enterpriseForm, fiscal_address: e.target.value })} />
                    <Input label="Ciudad" placeholder="Buenos Aires" value={enterpriseForm.fiscal_city} onChange={e => setEnterpriseForm({ ...enterpriseForm, fiscal_city: e.target.value })} />
                    <Input label="Provincia" placeholder="CABA" value={enterpriseForm.fiscal_province} onChange={e => setEnterpriseForm({ ...enterpriseForm, fiscal_province: e.target.value })} />
                    <Input label="Codigo Postal" placeholder="C1234ABC" value={enterpriseForm.fiscal_postal_code} onChange={e => setEnterpriseForm({ ...enterpriseForm, fiscal_postal_code: e.target.value })} />
                  </div>
                )}
              </div>

              <div className="col-span-full">
                <label className="text-sm font-medium text-gray-700 block mb-1">Notas</label>
                <textarea className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-base bg-white dark:bg-gray-700 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y" rows={2} placeholder="Observaciones..." value={enterpriseForm.notes} onChange={e => setEnterpriseForm({ ...enterpriseForm, notes: e.target.value })} />
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
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Empresa</label>
                <select className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-base bg-white dark:bg-gray-700 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500" value={contactForm.enterprise_id} onChange={e => setContactForm({ ...contactForm, enterprise_id: e.target.value })}>
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
                <textarea className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-base bg-white dark:bg-gray-700 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y" rows={2} placeholder="Observaciones..." value={contactForm.notes} onChange={e => setContactForm({ ...contactForm, notes: e.target.value })} />
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
            actionLabel={!search ? '+ Nueva Empresa' : undefined}
            onAction={!search ? () => { setEnterpriseForm(emptyEnterpriseForm); setEditingEnterpriseId(null); setShowEnterpriseForm(true) } : undefined}
          />
        </CardContent></Card>
      ) : (
        <div className="space-y-3">
          {filteredEnterprises.map(ent => (
            <Card key={ent.id}>
              <div
                className="px-6 py-4 flex items-center justify-between cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
                onClick={() => handleExpandEnterprise(ent.id)}
              >
                <div className="flex items-center gap-4">
                  <span className="text-2xl">{expandedId === ent.id ? '▼' : '▶'}</span>
                  <div>
                    <div className="flex items-center gap-2">
                      {/* Payment health traffic light */}
                      {(() => {
                        const health = enterpriseHealth.get(ent.name)
                        if (!health) {
                          return <div className="w-3 h-3 rounded-full bg-green-500 flex-shrink-0" title="Todo al dia" />
                        }
                        if (health.oldest_days > 30) {
                          return <div className="w-3 h-3 rounded-full bg-red-500 flex-shrink-0" title={`Factura pendiente ${health.oldest_days}d - ${formatCurrency(health.total_overdue)}`} />
                        }
                        return <div className="w-3 h-3 rounded-full bg-yellow-500 flex-shrink-0" title={`Factura pendiente ${health.oldest_days}d - ${formatCurrency(health.total_overdue)}`} />
                      })()}
                      <h3 className="font-semibold text-gray-900 dark:text-gray-100">{ent.name}</h3>
                      {ent.razon_social && ent.razon_social !== ent.name && (
                        <span className="text-xs text-gray-400">({ent.razon_social})</span>
                      )}
                      <TagBadges tags={ent.tags} />
                      {/* Overdue debt badge */}
                      {enterpriseHealth.has(ent.name) && (
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                          (enterpriseHealth.get(ent.name)?.oldest_days || 0) > 30
                            ? 'bg-red-100 text-red-800'
                            : 'bg-yellow-100 text-yellow-800'
                        }`}>
                          {formatCurrency(enterpriseHealth.get(ent.name)?.total_overdue || 0)} pendiente
                        </span>
                      )}
                    </div>
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
                  <div className="flex gap-2 items-center" onClick={e => e.stopPropagation()}>
                    <PermissionGate module="enterprises" action="create">
                      <button onClick={() => handleAddContact(ent.id)} className="text-green-600 hover:underline text-sm">+ Contacto</button>
                    </PermissionGate>
                    <PermissionGate module="enterprises" action="edit">
                      <button onClick={() => handleEditEnterprise(ent)} className="text-blue-600 hover:underline text-sm">Editar</button>
                    </PermissionGate>
                    <PermissionGate module="enterprises" action="delete">
                      <button onClick={() => handleDeleteEnterprise(ent)} className="text-red-600 hover:underline text-sm">Eliminar</button>
                    </PermissionGate>
                  </div>
                </div>
              </div>

              {expandedId === ent.id && (
                <div className="border-t border-gray-200 bg-gray-50 px-6 py-4 space-y-4">
                  <div>
                    <p className="text-xs font-medium text-gray-500 mb-1">Etiquetas</p>
                    <TagManager
                      entityId={ent.id}
                      entityType="enterprise"
                      availableTags={availableTags}
                      assignedTags={ent.tags}
                      onTagsChange={loadData}
                      onTagCreated={loadTags}
                    />
                  </div>
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
                          <th className="pb-2 font-medium">Acciones</th>
                        </tr>
                      </thead>
                      <tbody>
                        {expandedContacts.map(c => (
                          <tr key={c.id} className="border-b border-gray-100">
                            <td className="py-2 font-medium text-gray-900 dark:text-gray-100">{c.name}</td>
                            <td className="py-2 font-mono text-gray-600">{c.cuit}</td>
                            <td className="py-2 text-gray-600">{c.role || '-'}</td>
                            <td className="py-2 text-gray-600">{c.phone || '-'}</td>
                            <td className="py-2 text-gray-600">{c.email || '-'}</td>
                            <td className="py-2">
                              <div className="flex gap-2">
                                <PermissionGate module="enterprises" action="edit">
                                  <button onClick={() => handleEditContact(c)} className="text-blue-600 hover:underline">Editar</button>
                                </PermissionGate>
                                <PermissionGate module="enterprises" action="delete">
                                  <button onClick={() => handleDeleteContact(c)} className="text-red-600 hover:underline">Eliminar</button>
                                </PermissionGate>
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
                        <td className="py-2 font-medium text-gray-900 dark:text-gray-100">{c.name}</td>
                        <td className="py-2 font-mono text-gray-600">{c.cuit}</td>
                        <td className="py-2 text-gray-600">{c.phone || '-'}</td>
                        <td className="py-2 text-gray-600">{c.email || '-'}</td>
                        <td className="py-2">
                          <div className="flex gap-2">
                            <PermissionGate module="enterprises" action="edit">
                              <button onClick={() => handleEditContact(c)} className="text-blue-600 hover:underline">Editar</button>
                            </PermissionGate>
                            <PermissionGate module="enterprises" action="delete">
                              <button onClick={() => handleDeleteContact(c)} className="text-red-600 hover:underline">Eliminar</button>
                            </PermissionGate>
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

      </>

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
