import React, { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
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
import { PermissionGate, useCan } from '@/components/shared/PermissionGate'
import { HelpTip } from '@/components/shared/HelpTip'
import { checkEnterpriseFiscalData } from '@/utils/fiscal'
import { useCircuitAccess } from '@/hooks/useCircuitAccess'
import { ContextMenuBase, type ContextMenuItem } from '@/components/ui/ContextMenuBase'
import { useContextMenu } from '@/hooks/useContextMenu'

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
  default_fiscal_type?: 'fiscal' | 'no_fiscal' | null
  role?: 'client' | 'supplier' | 'both' | null
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
  default_discount: '',
  // Nor feedback item 3: default Sol/Luna circuit per enterprise.
  default_fiscal_type: 'fiscal' as 'fiscal' | 'no_fiscal',
  // Wave 2B-1 H22: client / supplier / both.
  role: 'client' as 'client' | 'supplier' | 'both',
}

const emptyContactForm = {
  cuit: '', name: '', contact_name: '', phone: '', email: '',
  tax_condition: 'Responsable Inscripto', credit_limit: '', payment_terms: '30',
  notes: '', role: '', enterprise_id: '',
}

export const Enterprises: React.FC = () => {
  const navigate = useNavigate()
  // Nor feedback item 3: gate Sol/Luna UI behind circuit access.
  // Non-Luna users never see Luna surfaces (pill toggle, chip, etc.).
  const { canAccessLuna } = useCircuitAccess()
  // Right-click context menu (Crear Pedido / Vista Global / Cuenta Corriente).
  const contextMenu = useContextMenu<Enterprise>()
  const canCreateOrder = useCan('orders', 'create')
  const canViewCC = useCan('cuenta_corriente', 'view')
  const [enterprises, setEnterprises] = useState<Enterprise[]>([])
  const [contacts, setContacts] = useState<Contact[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [expandedContacts, setExpandedContacts] = useState<Contact[]>([])

  // Auto-open form if navigated with ?new=1
  const [showEnterpriseForm, setShowEnterpriseForm] = useState(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('new') === '1') {
      window.history.replaceState({}, '', window.location.pathname)
      return true
    }
    return false
  })
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
  const [roleFilter, setRoleFilter] = useState<'all' | 'client' | 'supplier'>('all')
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

  // PR7-T14: abrir form en edicion cuando se navega con ?edit=<id>.
  // Usado por el CTA "Completar datos fiscales" del modal de factura e InvoicePreviewModal.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const editId = params.get('edit')
    if (editId && enterprises.length > 0) {
      const ent = enterprises.find(e => e.id === editId)
      if (ent) {
        handleEditEnterprise(ent)
        window.history.replaceState({}, '', window.location.pathname)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enterprises])

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
      const { same_fiscal_address, price_list_id, default_discount, ...formData } = enterpriseForm
      const payload = {
        ...formData,
        default_discount: parseFloat(default_discount) || 0,
        // Nor feedback item 3: force 'fiscal' for non-Luna users regardless
        // of form state. Prevents ever persisting 'no_fiscal' without access.
        default_fiscal_type: canAccessLuna ? formData.default_fiscal_type : 'fiscal',
        fiscal_address: same_fiscal_address ? null : formData.fiscal_address,
        fiscal_city: same_fiscal_address ? null : formData.fiscal_city,
        fiscal_province: same_fiscal_address ? null : formData.fiscal_province,
        fiscal_postal_code: same_fiscal_address ? null : formData.fiscal_postal_code,
      }
      // Option B: validar datos AFIP obligatorios solo al crear
      if (!editingEnterpriseId) {
        const check = checkEnterpriseFiscalData({
          name: formData.name,
          razon_social: formData.razon_social,
          cuit: formData.cuit,
          tax_condition: formData.tax_condition,
          address: formData.address,
          fiscal_address: same_fiscal_address ? formData.address : formData.fiscal_address,
        })
        if (!check.complete) {
          toast.error(`Faltan datos obligatorios para facturar en AFIP: ${check.missing.join(', ')}`)
          setSaving(false)
          return
        }
      }
      if (editingEnterpriseId) {
        await api.updateEnterprise(editingEnterpriseId, payload)
        // PR4-T: no silenciar errores de vincular lista de precios.
        // Antes: `.catch(() => {})` mostraba toast "actualizada" aunque la
        // vinculacion hubiera fallado, creando estado inconsistente.
        if (price_list_id !== originalPriceListId) {
          try {
            await api.linkEnterpriseToPriceList(editingEnterpriseId, price_list_id || '')
          } catch (linkErr: any) {
            toast.error('Empresa actualizada pero fallo vincular lista de precios: ' + (linkErr?.message || ''))
            setShowEnterpriseForm(false)
            setEditingEnterpriseId(null)
            setEnterpriseForm(emptyEnterpriseForm)
            await loadData()
            return
          }
        }
        toast.success('Empresa actualizada correctamente')
      } else {
        const created = await api.createEnterprise(payload)
        if (price_list_id && created?.id) {
          try {
            await api.linkEnterpriseToPriceList(created.id, price_list_id)
          } catch (linkErr: any) {
            toast.error('Empresa creada pero fallo vincular lista de precios: ' + (linkErr?.message || ''))
          }
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
      default_discount: (ent as any).default_discount || '',
      default_fiscal_type: ent.default_fiscal_type === 'no_fiscal' ? 'no_fiscal' : 'fiscal',
      role: (ent.role === 'supplier' || ent.role === 'both') ? ent.role : 'client',
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
      const cuitClean = (contactForm.cuit || '').replace(/[-\s]/g, '').trim();
      const payload = {
        ...contactForm,
        cuit: cuitClean || null,
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
  const filteredEnterprises = enterprises.filter(e => {
    const matchSearch = e.name.toLowerCase().includes(search.toLowerCase()) || (e.cuit || '').includes(search)
    if (!matchSearch) return false
    if (roleFilter === 'all') return true
    if (roleFilter === 'supplier') return e.role === 'supplier' || e.role === 'both'
    // 'client' — treat NULL/undefined as 'client' for backward compat.
    return !e.role || e.role === 'client' || e.role === 'both'
  })

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
              {!editingEnterpriseId && (
                <div className="bg-yellow-50 border border-yellow-200 text-yellow-900 p-3 rounded-lg text-sm mb-4">
                  ⚠ Al crear una empresa son obligatorios los datos fiscales (CUIT, razon social, condicion IVA, direccion) para poder facturar en AFIP.
                </div>
              )}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                <Input label="Nombre Comercial *" placeholder="Nombre de la empresa" value={enterpriseForm.name} onChange={e => setEnterpriseForm({ ...enterpriseForm, name: e.target.value })} required />
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Razon Social{!editingEnterpriseId && <span className="text-red-600"> *</span>}<HelpTip text="Nombre legal de la empresa como figura en AFIP." /></label>
                  <Input placeholder="Razon social legal" value={enterpriseForm.razon_social} onChange={e => setEnterpriseForm({ ...enterpriseForm, razon_social: e.target.value })} required={!editingEnterpriseId} />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300">CUIT{!editingEnterpriseId && !enterpriseForm.tax_condition.toLowerCase().includes('consumidor final') && <span className="text-red-600"> *</span>}<HelpTip text="CUIT de 11 digitos. Se valida automaticamente." /></label>
                  <Input placeholder="20-12345678-9" value={enterpriseForm.cuit} onChange={e => setEnterpriseForm({ ...enterpriseForm, cuit: e.target.value })} required={!editingEnterpriseId && !enterpriseForm.tax_condition.toLowerCase().includes('consumidor final')} />
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                <Input label="Telefono" placeholder="+54 11 1234-5678" value={enterpriseForm.phone} onChange={e => setEnterpriseForm({ ...enterpriseForm, phone: e.target.value })} />
                <Input label="Email" type="email" placeholder="email@empresa.com" value={enterpriseForm.email} onChange={e => setEnterpriseForm({ ...enterpriseForm, email: e.target.value })} />
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Condicion IVA{!editingEnterpriseId && <span className="text-red-600"> *</span>}<HelpTip text="Necesario para determinar el tipo de factura cuando factures a esta empresa." /></label>
                  <select required={!editingEnterpriseId} className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-base bg-white dark:bg-gray-700 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500" value={enterpriseForm.tax_condition} onChange={e => setEnterpriseForm({ ...enterpriseForm, tax_condition: e.target.value })}>
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
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Descuento Predeterminado %</label>
                  <input
                    type="number" min="0" max="100" step="0.5"
                    placeholder="0"
                    className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-base bg-white dark:bg-gray-700 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    value={enterpriseForm.default_discount}
                    onChange={e => setEnterpriseForm({ ...enterpriseForm, default_discount: e.target.value })}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    Tipo de empresa
                    <HelpTip text="Cliente = le vendes. Proveedor = le compras. Ambos = ambas cosas." />
                  </label>
                  <div className="flex items-center gap-3 pt-2">
                    <label className="inline-flex items-center gap-1 text-sm cursor-pointer">
                      <input
                        type="radio"
                        name="enterprise_role"
                        value="client"
                        checked={enterpriseForm.role === 'client'}
                        onChange={() => setEnterpriseForm({ ...enterpriseForm, role: 'client' })}
                      />
                      <span>Cliente</span>
                    </label>
                    <label className="inline-flex items-center gap-1 text-sm cursor-pointer">
                      <input
                        type="radio"
                        name="enterprise_role"
                        value="supplier"
                        checked={enterpriseForm.role === 'supplier'}
                        onChange={() => setEnterpriseForm({ ...enterpriseForm, role: 'supplier' })}
                      />
                      <span>Proveedor</span>
                    </label>
                    <label className="inline-flex items-center gap-1 text-sm cursor-pointer">
                      <input
                        type="radio"
                        name="enterprise_role"
                        value="both"
                        checked={enterpriseForm.role === 'both'}
                        onChange={() => setEnterpriseForm({ ...enterpriseForm, role: 'both' })}
                      />
                      <span>Ambos</span>
                    </label>
                  </div>
                </div>
              </div>

              {/* Nor feedback item 3: circuit default per enterprise.
                  Hidden for non-Luna users (they implicitly use 'fiscal'). */}
              {canAccessLuna && (
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    Circuito default para facturar
                    <HelpTip text="Al crear un pedido para esta empresa, el circuito (Sol/Luna) se pre-selecciona con este valor. Podes cambiarlo por pedido." />
                  </label>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setEnterpriseForm({ ...enterpriseForm, default_fiscal_type: 'fiscal' })}
                      className={`px-2 py-0.5 rounded-full text-xs font-medium transition-colors ${enterpriseForm.default_fiscal_type === 'fiscal' ? 'bg-amber-200 text-amber-900' : 'bg-gray-100 text-gray-400 hover:bg-amber-50 dark:bg-gray-700 dark:text-gray-500'}`}
                      aria-label="Sol (fiscal)"
                      aria-pressed={enterpriseForm.default_fiscal_type === 'fiscal'}
                    >☀️ Sol</button>
                    <button
                      type="button"
                      onClick={() => setEnterpriseForm({ ...enterpriseForm, default_fiscal_type: 'no_fiscal' })}
                      className={`px-2 py-0.5 rounded-full text-xs font-medium transition-colors ${enterpriseForm.default_fiscal_type === 'no_fiscal' ? 'bg-indigo-200 text-indigo-900' : 'bg-gray-100 text-gray-400 hover:bg-indigo-50 dark:bg-gray-700 dark:text-gray-500'}`}
                      aria-label="Luna (no fiscal)"
                      aria-pressed={enterpriseForm.default_fiscal_type === 'no_fiscal'}
                    >🌙 Luna</button>
                  </div>
                </div>
              )}

              {/* Direccion de la empresa */}
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Direccion de la Empresa</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                  <Input label={!editingEnterpriseId ? 'Direccion *' : 'Direccion'} placeholder="Av. Ejemplo 1234" value={enterpriseForm.address} onChange={e => setEnterpriseForm({ ...enterpriseForm, address: e.target.value })} required={!editingEnterpriseId && enterpriseForm.same_fiscal_address} />
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
                    <Input label={!editingEnterpriseId ? 'Direccion Fiscal *' : 'Direccion Fiscal'} placeholder="Av. Fiscal 5678" value={enterpriseForm.fiscal_address} onChange={e => setEnterpriseForm({ ...enterpriseForm, fiscal_address: e.target.value })} required={!editingEnterpriseId && !enterpriseForm.same_fiscal_address} />
                    <Input label="Ciudad" placeholder="Buenos Aires" value={enterpriseForm.fiscal_city} onChange={e => setEnterpriseForm({ ...enterpriseForm, fiscal_city: e.target.value })} />
                    <Input label="Provincia" placeholder="CABA" value={enterpriseForm.fiscal_province} onChange={e => setEnterpriseForm({ ...enterpriseForm, fiscal_province: e.target.value })} />
                    <Input label="Codigo Postal" placeholder="C1234ABC" value={enterpriseForm.fiscal_postal_code} onChange={e => setEnterpriseForm({ ...enterpriseForm, fiscal_postal_code: e.target.value })} />
                  </div>
                )}
              </div>

              <div className="col-span-full">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-1">Notas</label>
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
              <Input label="CUIT (opcional)" placeholder="20-12345678-9" value={contactForm.cuit} onChange={e => setContactForm({ ...contactForm, cuit: e.target.value })} />
              <Input label="Nombre *" placeholder="Nombre del contacto" value={contactForm.name} onChange={e => setContactForm({ ...contactForm, name: e.target.value })} required />
              <Input label="Cargo / Contacto" placeholder="Nombre del referente" value={contactForm.contact_name} onChange={e => setContactForm({ ...contactForm, contact_name: e.target.value })} />
              <Input label="Rol" placeholder="Comprador, Gerente, etc." value={contactForm.role} onChange={e => setContactForm({ ...contactForm, role: e.target.value })} />
              <Input label="Teléfono" placeholder="+54 11 1234-5678" value={contactForm.phone} onChange={e => setContactForm({ ...contactForm, phone: e.target.value })} />
              <Input label="Email" type="email" placeholder="email@empresa.com" value={contactForm.email} onChange={e => setContactForm({ ...contactForm, email: e.target.value })} />
              <div className="col-span-full">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-1">Notas</label>
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

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setRoleFilter('all')}
          className={`px-3 py-1 rounded-full text-sm font-medium transition-colors ${roleFilter === 'all' ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-200'}`}
          aria-pressed={roleFilter === 'all'}
        >Todos</button>
        <button
          type="button"
          onClick={() => setRoleFilter('client')}
          className={`px-3 py-1 rounded-full text-sm font-medium transition-colors ${roleFilter === 'client' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-200'}`}
          aria-pressed={roleFilter === 'client'}
        >Clientes</button>
        <button
          type="button"
          onClick={() => setRoleFilter('supplier')}
          className={`px-3 py-1 rounded-full text-sm font-medium transition-colors ${roleFilter === 'supplier' ? 'bg-purple-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-200'}`}
          aria-pressed={roleFilter === 'supplier'}
        >Proveedores</button>
      </div>

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
                onContextMenu={(e) => contextMenu.openMenu(e, ent)}
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
                      {/* Wave 2B-1 H22: client / supplier / both badge. */}
                      {(() => {
                        const role = ent.role || 'client'
                        const cfg: Record<string, { label: string; cls: string }> = {
                          client: { label: 'Cliente', cls: 'bg-blue-100 text-blue-800' },
                          supplier: { label: 'Proveedor', cls: 'bg-purple-100 text-purple-800' },
                          both: { label: 'Cliente + Proveedor', cls: 'bg-emerald-100 text-emerald-800' },
                        }
                        const c = cfg[role] || cfg.client
                        return (
                          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${c.cls}`} title={`Tipo: ${c.label}`}>
                            {c.label}
                          </span>
                        )
                      })()}
                      {/* Nor feedback item 3: circuit default chip.
                          Only visible for Luna-enabled users. */}
                      {canAccessLuna && (
                        <span
                          className={`text-xs font-medium px-2 py-0.5 rounded-full ${ent.default_fiscal_type === 'no_fiscal' ? 'bg-indigo-100 text-indigo-800' : 'bg-amber-100 text-amber-900'}`}
                          title={ent.default_fiscal_type === 'no_fiscal' ? 'Circuito default: Luna (no fiscal)' : 'Circuito default: Sol (fiscal)'}
                        >
                          {ent.default_fiscal_type === 'no_fiscal' ? '🌙 Luna' : '☀️ Sol'}
                        </span>
                      )}
                      {/* AFIP fiscal data warning badge */}
                      {(() => {
                        const fiscal = checkEnterpriseFiscalData(ent as any)
                        if (fiscal.complete) return null
                        return (
                          <button
                            type="button"
                            title={`Faltan: ${fiscal.missing.join(', ')}. Click para completar.`}
                            onClick={(e) => {
                              e.stopPropagation()
                              handleEditEnterprise(ent)
                              setTimeout(() => window.scrollTo({ top: 0, behavior: 'smooth' }), 50)
                            }}
                            className="text-xs font-medium px-2 py-0.5 rounded-full bg-red-100 text-red-800 hover:bg-red-200"
                          >
                            ⚠ Datos AFIP incompletos
                          </button>
                        )
                      })()}
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
                    {/* Nor feedback item 5: crear pedido directamente desde la empresa. */}
                    <PermissionGate module="orders" action="create">
                      <button
                        onClick={() => navigate(`/orders?nuevo=true&enterprise_id=${ent.id}`)}
                        className="text-blue-600 hover:underline text-sm font-medium"
                      >
                        + Nuevo Pedido
                      </button>
                    </PermissionGate>
                    <PermissionGate module="enterprises" action="create">
                      <button onClick={() => handleAddContact(ent.id)} className="text-green-600 hover:underline text-sm">+ Contacto</button>
                    </PermissionGate>
                    <PermissionGate module="enterprises" action="edit">
                      <button onClick={() => handleEditEnterprise(ent)} className="text-blue-600 hover:underline text-sm">Editar</button>
                    </PermissionGate>
                    <PermissionGate module="enterprises" action="delete">
                      <button onClick={() => handleDeleteEnterprise(ent)} className="text-red-600 hover:underline text-sm">Eliminar</button>
                    </PermissionGate>
                    {/* Kebab menu: same actions as right-click context menu (Crear Pedido / Vista Global / Cuenta Corriente). */}
                    <button
                      type="button"
                      onClick={(e) => contextMenu.openMenu(e, ent)}
                      aria-label="Más acciones"
                      title="Más acciones"
                      className="ml-1 px-2 py-1 text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded text-base leading-none"
                    >
                      ⋮
                    </button>
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
                            <td className="py-2 font-mono text-gray-600 dark:text-gray-400">{c.cuit}</td>
                            <td className="py-2 text-gray-600 dark:text-gray-400">{c.role || '-'}</td>
                            <td className="py-2 text-gray-600 dark:text-gray-400">{c.phone || '-'}</td>
                            <td className="py-2 text-gray-600 dark:text-gray-400">{c.email || '-'}</td>
                            <td className="py-2">
                              <div className="flex gap-2">
                                {/* Nor feedback item 5: crear pedido desde un contacto. */}
                                <PermissionGate module="orders" action="create">
                                  <button
                                    onClick={() => navigate(`/orders?nuevo=true&customer_id=${c.id}`)}
                                    className="text-blue-600 hover:underline font-medium"
                                  >
                                    + Pedido
                                  </button>
                                </PermissionGate>
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
                        <td className="py-2 font-mono text-gray-600 dark:text-gray-400">{c.cuit}</td>
                        <td className="py-2 text-gray-600 dark:text-gray-400">{c.phone || '-'}</td>
                        <td className="py-2 text-gray-600 dark:text-gray-400">{c.email || '-'}</td>
                        <td className="py-2">
                          <div className="flex gap-2">
                            {/* Nor feedback item 5: crear pedido desde contacto sin empresa. */}
                            <PermissionGate module="orders" action="create">
                              <button
                                onClick={() => navigate(`/orders?nuevo=true&customer_id=${c.id}`)}
                                className="text-blue-600 hover:underline font-medium"
                              >
                                + Pedido
                              </button>
                            </PermissionGate>
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

      {/* Right-click / kebab menu: quick jump to Crear Pedido / Vista Global / Cuenta Corriente. */}
      {contextMenu.menu && (() => {
        const ent = contextMenu.menu.item
        const items: ContextMenuItem[] = []
        if (canCreateOrder) {
          items.push({
            id: 'create-order',
            label: 'Crear pedido',
            icon: <span>➕</span>,
            onClick: () => navigate(`/orders?nuevo=true&enterprise_id=${ent.id}`),
          })
        }
        items.push({
          id: 'global-view',
          label: 'Vista global',
          icon: <span>🔍</span>,
          onClick: () => navigate(`/global?enterprise_id=${ent.id}`),
        })
        if (canViewCC) {
          items.push({
            id: 'cuenta-corriente',
            label: 'Cuenta corriente',
            icon: <span>📒</span>,
            onClick: () => navigate(`/cuenta-corriente?enterprise_id=${ent.id}`),
          })
        }
        if (items.length === 0) return null
        return (
          <ContextMenuBase
            x={contextMenu.menu.x}
            y={contextMenu.menu.y}
            header={{
              title: ent.name,
              subtitle: ent.cuit || ent.razon_social || undefined,
            }}
            items={items}
            onClose={contextMenu.closeMenu}
          />
        )
      })()}
    </div>
  )
}
