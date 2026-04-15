import React, { useState, useEffect, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Card, CardContent } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { SkeletonTable } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/shared/EmptyState'
import { DateRangeFilter } from '@/components/shared/DateRangeFilter'
import { toast } from '@/hooks/useToast'
import { DataTable } from '@/components/shared/DataTable'
import { formatCurrency, formatDate } from '@/lib/utils'
import { num } from '@/utils/num'
import { ExportCSVButton } from '@/components/shared/ExportCSV'
import { ExportExcelButton } from '@/components/shared/ExportExcel'
import { api } from '@/services/api'
import { PermissionGate } from '@/components/shared/PermissionGate'
import { StatusBadge } from '@/components/ui/StatusBadge'

type Direction = 'recibido' | 'emitido'

interface Cheque {
  id: string
  number: string
  bank: string
  drawer: string
  drawer_cuit: string | null
  cheque_type: string
  amount: string
  issue_date: string
  due_date: string
  status: string
  direction?: Direction
  issuer_type?: 'propio' | 'tercero' | null
  customer_id: string | null
  customer_name: string | null
  order_number: number | null
  cobro_id: string | null
  cobro_reference: string | null
  notes: string | null
  collected_date: string | null
  created_at: string
}

interface Enterprise {
  id: string
  name: string
  cuit?: string
}

// Status labels (recibido + emitido + shared anulado)
const STATUS_LABELS: Record<string, string> = {
  // recibido
  a_cobrar: 'En Cartera',
  endosado: 'Endosado',
  depositado: 'Depositado',
  cobrado: 'Cobrado',
  rechazado: 'Rechazado',
  // emitido
  emitido: 'Pendiente',
  entregado: 'Entregado',
  // shared
  anulado: 'Anulado',
}

const STATUS_COLORS: Record<string, string> = {
  a_cobrar: 'bg-yellow-100 text-yellow-700',
  endosado: 'bg-blue-100 text-blue-700',
  depositado: 'bg-purple-100 text-purple-700',
  cobrado: 'bg-green-100 text-green-700',
  rechazado: 'bg-red-100 text-red-700',
  emitido: 'bg-yellow-100 text-yellow-700',
  entregado: 'bg-blue-100 text-blue-700',
  anulado: 'bg-gray-200 text-gray-600',
}

const CHEQUE_TYPES: { value: string; label: string }[] = [
  { value: 'comun', label: 'Comun' },
  { value: 'cruzado', label: 'Cruzado' },
  { value: 'no_a_la_orden', label: 'No a la Orden' },
  { value: 'cruzado_no_a_la_orden', label: 'Cruzado No a la Orden' },
]
const CHEQUE_TYPE_LABELS: Record<string, string> = Object.fromEntries(CHEQUE_TYPES.map(t => [t.value, t.label]))

// State machines mirrored from backend (cheques.service.ts)
const VALID_TRANSITIONS_RECIBIDO: Record<string, string[]> = {
  a_cobrar: ['endosado', 'depositado', 'cobrado', 'rechazado', 'anulado'],
  endosado: ['cobrado', 'rechazado'],
  depositado: ['cobrado', 'rechazado', 'a_cobrar'],
  rechazado: ['a_cobrar', 'anulado'],
  cobrado: ['a_cobrar'],
  anulado: [],
}
const VALID_TRANSITIONS_EMITIDO: Record<string, string[]> = {
  emitido: ['entregado', 'anulado'],
  entregado: ['cobrado', 'rechazado'],
  cobrado: [],
  rechazado: ['anulado'],
  anulado: [],
}
const getValidTransitions = (direction: Direction) =>
  direction === 'emitido' ? VALID_TRANSITIONS_EMITIDO : VALID_TRANSITIONS_RECIBIDO

// Status filter options per direction
const STATUS_TABS_RECIBIDO = [
  { value: '', label: 'Todos' },
  { value: 'a_cobrar', label: 'En Cartera' },
  { value: 'endosado', label: 'Endosado' },
  { value: 'depositado', label: 'Depositado' },
  { value: 'cobrado', label: 'Cobrado' },
  { value: 'rechazado', label: 'Rechazado' },
  { value: 'anulado', label: 'Anulado' },
]
const STATUS_TABS_EMITIDO = [
  { value: '', label: 'Todos' },
  { value: 'emitido', label: 'Pendientes' },
  { value: 'entregado', label: 'Entregados' },
  { value: 'cobrado', label: 'Cobrados' },
  { value: 'rechazado', label: 'Rechazados' },
  { value: 'anulado', label: 'Anulados' },
]

function getDueDateAlert(dueDate: string, status: string): { label: string; className: string } | null {
  const activeStates = ['a_cobrar', 'emitido', 'entregado']
  if (!activeStates.includes(status)) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const due = new Date(dueDate + 'T00:00:00')
  const diffDays = Math.ceil((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
  if (diffDays < 0) return { label: `Vencido (${Math.abs(diffDays)}d)`, className: 'bg-red-100 text-red-700 border border-red-300' }
  if (diffDays === 0) return { label: 'Vence hoy', className: 'bg-red-100 text-red-700 border border-red-300 animate-pulse' }
  if (diffDays <= 3) return { label: `Vence en ${diffDays}d`, className: 'bg-orange-100 text-orange-700 border border-orange-300' }
  if (diffDays <= 7) return { label: `Vence en ${diffDays}d`, className: 'bg-yellow-100 text-yellow-700 border border-yellow-300' }
  return null
}

const emptyForm = {
  direction: 'recibido' as Direction,
  issuer_type: 'tercero' as 'propio' | 'tercero',
  number: '',
  bank: '',
  drawer: '',
  drawer_cuit: '',
  cheque_type: 'comun',
  amount: '',
  issue_date: new Date().toISOString().split('T')[0],
  due_date: new Date().toISOString().split('T')[0],
  notes: '',
}

export const Cheques: React.FC = () => {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const direction: Direction = (searchParams.get('direction') as Direction) === 'emitido' ? 'emitido' : 'recibido'

  const [cheques, setCheques] = useState<Cheque[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filterStatus, setFilterStatus] = useState<string>('')
  const [summary, setSummary] = useState<any>({})

  const [search, setSearch] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [chequeHistory, setChequeHistory] = useState<any[]>([])
  const [dueDateFrom, setDueDateFrom] = useState('')
  const [dueDateTo, setDueDateTo] = useState('')

  // Create form
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ ...emptyForm, direction })
  const [companyFiscal, setCompanyFiscal] = useState<{ name?: string; cuit?: string } | null>(null)

  // Endorse modal
  const [endorseTarget, setEndorseTarget] = useState<Cheque | null>(null)
  const [enterprises, setEnterprises] = useState<Enterprise[]>([])
  const [endorseEnterpriseId, setEndorseEnterpriseId] = useState('')
  const [endorseNotes, setEndorseNotes] = useState('')
  const [endorsing, setEndorsing] = useState(false)

  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)

  const setDirection = (d: Direction) => {
    setSearchParams(prev => { const np = new URLSearchParams(prev); np.set('direction', d); return np })
    setFilterStatus('')
    setExpandedId(null)
  }

  const loadData = async () => {
    try {
      setLoading(true)
      const [chequesRes, summaryRes] = await Promise.all([
        api.getCheques({
          direction,
          status: filterStatus || undefined,
          search: search || undefined,
          due_from: dueDateFrom || undefined,
          due_to: dueDateTo || undefined,
        }).catch((err: any) => {
          setError(`Error cargando cheques: ${err?.response?.data?.error || err?.message || 'Error desconocido'}`)
          return []
        }),
        api.getChequesSummary().catch(() => ({})),
      ])
      setCheques(Array.isArray(chequesRes) ? chequesRes : chequesRes.items || [])
      setSummary(summaryRes || {})
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadData() }, [filterStatus, direction])

  useEffect(() => {
    if (searchTimeout.current) clearTimeout(searchTimeout.current)
    searchTimeout.current = setTimeout(() => { loadData() }, 300)
    return () => { if (searchTimeout.current) clearTimeout(searchTimeout.current) }
  }, [search, dueDateFrom, dueDateTo])

  // Load company fiscal data once (for emitido + propio auto-fill)
  useEffect(() => {
    api.getMyCompany().then((c: any) => {
      if (c) setCompanyFiscal({ name: c.legal_name || c.name, cuit: c.cuit })
    }).catch(() => {})
  }, [])

  // Sync form direction with tab when opening
  useEffect(() => {
    setForm(prev => ({
      ...prev,
      direction,
      issuer_type: direction === 'emitido' ? 'propio' : 'tercero',
    }))
  }, [direction])

  // Auto-fill drawer when emitido + propio
  useEffect(() => {
    if (form.direction === 'emitido' && form.issuer_type === 'propio' && companyFiscal) {
      setForm(prev => ({
        ...prev,
        drawer: companyFiscal.name || prev.drawer,
        drawer_cuit: companyFiscal.cuit || prev.drawer_cuit,
      }))
    }
  }, [form.direction, form.issuer_type, companyFiscal])

  const handleStatusChange = async (chequeId: string, newStatus: string) => {
    try {
      await api.updateChequeStatus(chequeId, newStatus)
      toast.success(`Cheque actualizado a ${STATUS_LABELS[newStatus] || newStatus}`)
      await loadData()
    } catch (e: any) {
      toast.error(e?.response?.data?.error || e.message || 'Error actualizando estado')
    }
  }

  const handleRowClick = async (cheque: Cheque) => {
    if (expandedId === cheque.id) {
      setExpandedId(null); setChequeHistory([]); return
    }
    setExpandedId(cheque.id)
    try {
      const history = await api.getChequeHistory(cheque.id)
      setChequeHistory(Array.isArray(history) ? history : [])
    } catch { setChequeHistory([]) }
  }

  const handleCreate = async () => {
    if (!form.number || !form.bank || !form.drawer || !form.amount || !form.issue_date || !form.due_date) {
      toast.error('Completa numero, banco, librador, monto y fechas')
      return
    }
    if (new Date(form.due_date) < new Date(form.issue_date)) {
      toast.error('La fecha de vencimiento debe ser >= fecha de emision')
      return
    }
    const amount = parseFloat(form.amount)
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error('Monto invalido')
      return
    }
    try {
      setSaving(true)
      await api.createCheque({
        direction: form.direction,
        issuer_type: form.issuer_type,
        number: form.number,
        bank: form.bank,
        drawer: form.drawer,
        drawer_cuit: form.drawer_cuit || undefined,
        cheque_type: form.cheque_type,
        amount,
        issue_date: form.issue_date,
        due_date: form.due_date,
        notes: form.notes || undefined,
      })
      toast.success('Cheque creado')
      setShowForm(false)
      setForm({ ...emptyForm, direction, issuer_type: direction === 'emitido' ? 'propio' : 'tercero' })
      loadData()
    } catch (e: any) {
      const msg = e?.response?.data?.error || e?.message || 'Error al crear cheque'
      if (/duplicate|unique|ya existe/i.test(msg)) {
        toast.error(`Ya existe un cheque con banco "${form.bank}" numero "${form.number}" en ${direction}`)
      } else {
        toast.error(msg)
      }
    } finally {
      setSaving(false)
    }
  }

  const openEndorseModal = async (cheque: Cheque) => {
    setEndorseTarget(cheque)
    setEndorseEnterpriseId('')
    setEndorseNotes('')
    if (enterprises.length === 0) {
      try {
        const ent = await api.getEnterprises()
        setEnterprises(Array.isArray(ent) ? ent : ent?.items || [])
      } catch { /* ignore */ }
    }
  }

  const handleEndorse = async () => {
    if (!endorseTarget || !endorseEnterpriseId) {
      toast.error('Selecciona el proveedor destinatario')
      return
    }
    try {
      setEndorsing(true)
      await api.endorseCheque(endorseTarget.id, {
        enterprise_id: endorseEnterpriseId,
        amount: parseFloat(endorseTarget.amount),
        notes: endorseNotes || undefined,
      })
      toast.success('Cheque endosado y pago de emision creado')
      setEndorseTarget(null)
      loadData()
    } catch (e: any) {
      toast.error(e?.response?.data?.error || e?.message || 'Error al endosar cheque')
    } finally {
      setEndorsing(false)
    }
  }

  const validTransitions = getValidTransitions(direction)

  const columns = [
    { key: 'number' as const, label: 'Numero', render: (v: any) => <span className="font-mono font-bold">{v}</span> },
    { key: 'cheque_type' as const, label: 'Tipo', render: (v: any) => (
      <span className="px-1.5 py-0.5 rounded text-xs bg-gray-100 text-gray-700 dark:text-gray-300 font-medium">{CHEQUE_TYPE_LABELS[v] || v || 'Comun'}</span>
    )},
    { key: 'bank' as const, label: 'Banco' },
    { key: 'drawer' as const, label: direction === 'emitido' ? 'Librador (Propio/3ro)' : 'Librador', render: (v: any, row: Cheque) => (
      <div>
        <span>{v}</span>
        {row.drawer_cuit && <span className="block text-xs text-gray-400 font-mono">{row.drawer_cuit}</span>}
        {row.issuer_type && <span className="block text-[10px] uppercase text-gray-400">{row.issuer_type}</span>}
      </div>
    )},
    { key: 'amount' as const, label: 'Monto', render: (v: any) => (
      <span className="font-bold text-green-700">{formatCurrency(num(v))}</span>
    )},
    { key: 'due_date' as const, label: 'Vencimiento', render: (v: any, row: Cheque) => {
      const alert = getDueDateAlert(v, row.status)
      return (
        <div className="flex items-center gap-1.5">
          <span>{formatDate(v)}</span>
          {alert && <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold whitespace-nowrap ${alert.className}`}>{alert.label}</span>}
        </div>
      )
    }},
    ...(direction === 'recibido'
      ? [{ key: 'customer_name' as const, label: 'Cliente', render: (v: any) => v || '-' }]
      : []),
    { key: 'id' as const, label: 'Estado', render: (_: any, row: Cheque) => (
      <div className="flex items-center gap-1.5" onClick={e => e.stopPropagation()}>
        <PermissionGate module="cheques" action="edit">
          <select
            className={`text-xs border rounded px-1 py-0.5 font-medium ${STATUS_COLORS[row.status] || 'bg-gray-100 text-gray-700 dark:text-gray-300'}`}
            value={row.status}
            onChange={e => handleStatusChange(row.id, e.target.value)}
          >
            <option value={row.status}>{STATUS_LABELS[row.status] || row.status}</option>
            {(validTransitions[row.status] || []).map((s: string) => (
              <option key={s} value={s}>{STATUS_LABELS[s] || s}</option>
            ))}
          </select>
          {direction === 'recibido' && row.status === 'a_cobrar' && (
            <button
              onClick={() => openEndorseModal(row)}
              className="text-xs px-2 py-0.5 rounded bg-blue-100 text-blue-700 hover:bg-blue-200 font-medium"
              title="Endosar a proveedor"
            >
              Endosar
            </button>
          )}
        </PermissionGate>
      </div>
    )},
  ]

  // KPIs per direction (read from backend split keys; fallback to legacy flat)
  const kpis = direction === 'recibido'
    ? [
        { label: 'En Cartera', count: summary.r_count_a_cobrar ?? summary.count_a_cobrar ?? 0, total: summary.r_total_a_cobrar ?? summary.total_a_cobrar ?? 0, color: 'yellow' },
        { label: 'Depositados', count: summary.r_count_depositado ?? summary.count_depositado ?? 0, total: summary.r_total_depositado ?? summary.total_depositado ?? 0, color: 'purple' },
        { label: 'Rechazados', count: summary.r_count_rechazado ?? summary.count_rechazado ?? 0, total: summary.r_total_rechazado ?? summary.total_rechazado ?? 0, color: 'red' },
        { label: 'Endosados', count: summary.r_count_endosado ?? summary.count_endosado ?? 0, total: summary.r_total_endosado ?? summary.total_endosado ?? 0, color: 'blue' },
      ]
    : [
        { label: 'Pendientes', count: summary.e_count_emitido ?? 0, total: summary.e_total_emitido ?? 0, color: 'yellow' },
        { label: 'Entregados', count: summary.e_count_entregado ?? 0, total: summary.e_total_entregado ?? 0, color: 'blue' },
        { label: 'Cobrados', count: summary.e_count_cobrado ?? 0, total: summary.e_total_cobrado ?? 0, color: 'green' },
        { label: 'Rechazados', count: summary.e_count_rechazado ?? 0, total: summary.e_total_rechazado ?? 0, color: 'red' },
      ]

  const colorClass = (c: string) => ({
    yellow: 'border-yellow-200 bg-yellow-50 text-yellow-800',
    purple: 'border-purple-200 bg-purple-50 text-purple-800',
    red: 'border-red-200 bg-red-50 text-red-800',
    blue: 'border-blue-200 bg-blue-50 text-blue-800',
    green: 'border-green-200 bg-green-50 text-green-800',
  } as Record<string, string>)[c] || 'border-gray-200 bg-gray-50 text-gray-800'

  const statusTabs = direction === 'recibido' ? STATUS_TABS_RECIBIDO : STATUS_TABS_EMITIDO

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Cheques</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {direction === 'recibido' ? 'Cheques recibidos de clientes' : 'Cheques emitidos a proveedores'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <PermissionGate module="cheques" action="create">
            <Button onClick={() => setShowForm(true)}>+ Nuevo Cheque</Button>
          </PermissionGate>
          <ExportCSVButton
            data={cheques.map(c => ({
              numero: c.number,
              tipo: CHEQUE_TYPE_LABELS[c.cheque_type] || c.cheque_type || 'Comun',
              banco: c.bank,
              librador: c.drawer,
              cuit_librador: c.drawer_cuit || '-',
              monto: num(c.amount),
              emision: formatDate(c.issue_date),
              vencimiento: formatDate(c.due_date),
              estado: STATUS_LABELS[c.status] || c.status,
              direccion: c.direction || direction,
              notas: c.notes || '-',
            }))}
            columns={[
              { key: 'numero', label: 'Numero' },
              { key: 'tipo', label: 'Tipo' },
              { key: 'banco', label: 'Banco' },
              { key: 'librador', label: 'Librador' },
              { key: 'cuit_librador', label: 'CUIT' },
              { key: 'monto', label: 'Monto' },
              { key: 'emision', label: 'Emision' },
              { key: 'vencimiento', label: 'Vencimiento' },
              { key: 'estado', label: 'Estado' },
              { key: 'direccion', label: 'Direccion' },
              { key: 'notas', label: 'Notas' },
            ]}
            filename={`cheques-${direction}`}
          />
          <ExportExcelButton
            data={cheques.map(c => ({
              numero: c.number,
              banco: c.bank,
              librador: c.drawer,
              monto: num(c.amount),
              emision: c.issue_date,
              vencimiento: c.due_date,
              estado: STATUS_LABELS[c.status] || c.status,
            }))}
            columns={[
              { key: 'numero', label: 'Numero' },
              { key: 'banco', label: 'Banco' },
              { key: 'librador', label: 'Librador' },
              { key: 'monto', label: 'Monto', type: 'currency' as const },
              { key: 'emision', label: 'Emision', type: 'date' as const },
              { key: 'vencimiento', label: 'Vencimiento', type: 'date' as const },
              { key: 'estado', label: 'Estado' },
            ]}
            filename={`cheques-${direction}`}
          />
        </div>
      </div>

      {/* Direction tabs */}
      <div className="flex gap-1 border-b border-gray-200 dark:border-gray-700">
        {([
          { value: 'recibido', label: 'Recibidos' },
          { value: 'emitido', label: 'Emitidos' },
        ] as { value: Direction; label: string }[]).map(t => (
          <button
            key={t.value}
            onClick={() => setDirection(t.value)}
            className={`px-4 py-2 -mb-px border-b-2 text-sm font-medium ${
              direction === t.value
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 px-4 py-3 rounded-lg">
          {error}<button onClick={() => setError(null)} className="ml-2 font-bold">x</button>
        </div>
      )}

      {/* KPI cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {kpis.map(k => (
          <Card key={k.label} className={`border ${colorClass(k.color)}`}>
            <CardContent className="pt-4">
              <p className="text-sm">{k.label} ({k.count})</p>
              <p className="text-2xl font-bold">{formatCurrency(k.total)}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Search and date filter */}
      <div className="flex items-center gap-4">
        <Input
          placeholder="Buscar por numero, banco, librador..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="flex-1"
        />
        <DateRangeFilter
          dateFrom={dueDateFrom}
          dateTo={dueDateTo}
          onDateFromChange={setDueDateFrom}
          onDateToChange={setDueDateTo}
          label="Vencimiento"
        />
      </div>

      {/* Status filter tabs */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-lg w-fit flex-wrap">
        {statusTabs.map(tab => (
          <button
            key={tab.value}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${filterStatus === tab.value ? 'bg-white text-gray-900 dark:text-gray-100 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
            onClick={() => setFilterStatus(tab.value)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Table */}
      {loading ? (
        <Card><CardContent><SkeletonTable rows={5} cols={4} /></CardContent></Card>
      ) : cheques.length === 0 ? (
        <Card><CardContent>
          <EmptyState
            title="Sin cheques"
            description={direction === 'recibido'
              ? 'Los cheques recibidos se crean desde Cobros o manualmente.'
              : 'Los cheques emitidos se crean desde Pagos o manualmente.'}
          />
        </CardContent></Card>
      ) : (
        <>
          <DataTable columns={columns} data={cheques} onRowClick={handleRowClick} />

          {expandedId && (() => {
            const cheque = cheques.find(c => c.id === expandedId)
            if (!cheque) return null
            return (
              <Card className="border-blue-200 bg-blue-50/30 animate-fadeIn">
                <CardContent className="pt-4">
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <h4 className="font-semibold text-gray-900 dark:text-gray-100">Cheque N. {cheque.number}</h4>
                      <p className="text-sm text-gray-600 dark:text-gray-400">
                        {cheque.bank} - {cheque.drawer}
                        {cheque.drawer_cuit && <span className="font-mono text-gray-400 ml-1">({cheque.drawer_cuit})</span>}
                      </p>
                    </div>
                    <button onClick={() => { setExpandedId(null); setChequeHistory([]) }} className="text-gray-400 hover:text-gray-600 text-lg">x</button>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4 text-sm">
                    <div><span className="text-xs text-gray-500 block">Tipo</span><span className="font-medium">{CHEQUE_TYPE_LABELS[cheque.cheque_type] || 'Comun'}</span></div>
                    <div><span className="text-xs text-gray-500 block">Monto</span><span className="font-bold text-green-700">{formatCurrency(num(cheque.amount))}</span></div>
                    <div><span className="text-xs text-gray-500 block">Emision</span><span className="font-medium">{formatDate(cheque.issue_date)}</span></div>
                    <div><span className="text-xs text-gray-500 block">Vencimiento</span><span className="font-medium">{formatDate(cheque.due_date)}</span></div>
                    <div>
                      <span className="text-xs text-gray-500 block">Estado</span>
                      <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[cheque.status] || 'bg-gray-100'}`}>
                        {STATUS_LABELS[cheque.status] || cheque.status}
                      </span>
                    </div>
                    {cheque.customer_name && (
                      <div><span className="text-xs text-gray-500 block">Cliente</span><span className="font-medium">{cheque.customer_name}</span></div>
                    )}
                  </div>

                  {cheque.notes && <p className="text-sm text-gray-500 mb-4">Notas: {cheque.notes}</p>}

                  {cheque.cobro_id && (
                    <div className="mb-4 p-2 bg-blue-50 border border-blue-200 rounded-lg inline-flex items-center gap-2">
                      <span className="text-sm text-blue-700">Vinculado a cobro:</span>
                      <button onClick={() => navigate('/cobros')} className="text-sm font-medium text-blue-600 hover:text-blue-800 underline">
                        {cheque.cobro_reference || 'Ver cobro'}
                      </button>
                    </div>
                  )}

                  {chequeHistory.length > 0 ? (
                    <div>
                      <h5 className="text-sm font-semibold text-gray-700 mb-2">Historial de estados</h5>
                      <div className="space-y-2">
                        {chequeHistory.map((h: any, i: number) => (
                          <div key={h.id || i} className="flex items-center gap-3 text-sm border-l-2 border-blue-300 pl-3 py-1">
                            <StatusBadge status={h.old_status || ''} label={STATUS_LABELS[h.old_status] || h.old_status || '-'} />
                            <span className="text-gray-400">-&gt;</span>
                            <StatusBadge status={h.new_status || ''} label={STATUS_LABELS[h.new_status] || h.new_status} />
                            <span className="text-gray-400 text-xs">{formatDate(h.created_at)}</span>
                            {h.changed_by_name && <span className="text-gray-500 text-xs">por {h.changed_by_name}</span>}
                            {h.notes && <span className="text-gray-500 text-xs italic">- {h.notes}</span>}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-gray-500">Sin historial.</p>
                  )}
                </CardContent>
              </Card>
            )
          })()}
        </>
      )}

      {/* Create form modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6">
            <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-4">
              Nuevo Cheque {form.direction === 'recibido' ? 'Recibido' : 'Emitido'}
            </h2>

            <div className="space-y-4">
              {form.direction === 'emitido' && (
                <div>
                  <label className="block text-sm font-medium mb-1">Tipo de librador *</label>
                  <div className="flex gap-2">
                    {(['propio', 'tercero'] as const).map(it => (
                      <button
                        key={it}
                        type="button"
                        onClick={() => setForm(p => ({ ...p, issuer_type: it }))}
                        className={`px-3 py-1.5 rounded-md text-sm font-medium border ${
                          form.issuer_type === it
                            ? 'bg-blue-600 text-white border-blue-600'
                            : 'bg-white text-gray-700 border-gray-300'
                        }`}
                      >
                        {it === 'propio' ? 'Propio (de la empresa)' : 'Tercero (endoso)'}
                      </button>
                    ))}
                  </div>
                  {form.issuer_type === 'propio' && companyFiscal && (
                    <p className="text-xs text-gray-500 mt-1">
                      Librador autocompletado desde datos fiscales de la empresa.
                    </p>
                  )}
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium mb-1">Numero *</label>
                  <Input value={form.number} onChange={e => setForm(p => ({ ...p, number: e.target.value }))} placeholder="00012345" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Banco *</label>
                  <Input value={form.bank} onChange={e => setForm(p => ({ ...p, bank: e.target.value }))} placeholder="Banco Galicia" />
                </div>
              </div>
              <p className="text-xs text-gray-500 -mt-2">
                Banco + numero deben ser unicos por direccion ({form.direction}).
              </p>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium mb-1">Librador *</label>
                  <Input value={form.drawer} onChange={e => setForm(p => ({ ...p, drawer: e.target.value }))} placeholder="Razon social" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">CUIT Librador</label>
                  <Input value={form.drawer_cuit} onChange={e => setForm(p => ({ ...p, drawer_cuit: e.target.value }))} placeholder="20-12345678-9" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium mb-1">Tipo de cheque</label>
                  <select
                    value={form.cheque_type}
                    onChange={e => setForm(p => ({ ...p, cheque_type: e.target.value }))}
                    className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm px-3 py-2"
                  >
                    {CHEQUE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Monto *</label>
                  <Input type="number" step="0.01" value={form.amount} onChange={e => setForm(p => ({ ...p, amount: e.target.value }))} placeholder="0.00" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium mb-1">Fecha emision *</label>
                  <Input type="date" value={form.issue_date} onChange={e => setForm(p => ({ ...p, issue_date: e.target.value }))} />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Fecha vencimiento *</label>
                  <Input
                    type="date"
                    value={form.due_date}
                    min={form.issue_date}
                    onChange={e => setForm(p => ({ ...p, due_date: e.target.value }))}
                  />
                  {form.due_date && form.issue_date && new Date(form.due_date) < new Date(form.issue_date) && (
                    <p className="text-xs text-red-600 mt-1">Vencimiento debe ser &gt;= emision</p>
                  )}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Notas</label>
                <Input value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} placeholder="Opcional" />
              </div>
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <Button variant="secondary" onClick={() => setShowForm(false)}>Cancelar</Button>
              <Button onClick={handleCreate} disabled={saving}>
                {saving ? 'Guardando...' : 'Crear cheque'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Endorse modal */}
      {endorseTarget && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-md p-6">
            <h2 className="text-lg font-bold mb-4">Endosar cheque a proveedor</h2>
            <p className="text-sm text-gray-600 mb-4">
              Cheque <span className="font-mono font-bold">{endorseTarget.number}</span> ({endorseTarget.bank}) por{' '}
              <span className="font-bold text-green-700">{formatCurrency(num(endorseTarget.amount))}</span>.
              Se creara automaticamente un pago de emision al proveedor seleccionado.
            </p>

            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium mb-1">Proveedor destinatario *</label>
                <select
                  value={endorseEnterpriseId}
                  onChange={e => setEndorseEnterpriseId(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm px-3 py-2"
                >
                  <option value="">Seleccionar...</option>
                  {enterprises.map(ent => (
                    <option key={ent.id} value={ent.id}>{ent.name}{ent.cuit ? ` (${ent.cuit})` : ''}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Notas</label>
                <Input value={endorseNotes} onChange={e => setEndorseNotes(e.target.value)} placeholder="Opcional" />
              </div>
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <Button variant="secondary" onClick={() => setEndorseTarget(null)}>Cancelar</Button>
              <Button onClick={handleEndorse} disabled={endorsing}>
                {endorsing ? 'Endosando...' : 'Endosar'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
