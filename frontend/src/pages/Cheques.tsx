import React, { useState, useEffect, useRef } from 'react'
import { Card, CardContent, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { SkeletonTable } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/shared/EmptyState'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { DateRangeFilter } from '@/components/shared/DateRangeFilter'
import { toast } from '@/hooks/useToast'
import { DataTable } from '@/components/shared/DataTable'
import { formatCurrency, formatDate } from '@/lib/utils'
import { ExportCSVButton } from '@/components/shared/ExportCSV'
import { api } from '@/services/api'
import { PermissionGate } from '@/components/shared/PermissionGate'
import { StatusBadge } from '@/components/ui/StatusBadge'

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
  customer_id: string | null
  customer_name: string | null
  order_number: number | null
  notes: string | null
  collected_date: string | null
  created_at: string
}

interface Customer { id: string; name: string }

const STATUS_LABELS: Record<string, string> = {
  a_cobrar: 'A Cobrar',
  endosado: 'Endosado',
  depositado: 'Depositado',
  cobrado: 'Cobrado',
  rechazado: 'Rechazado',
}

const STATUS_COLORS: Record<string, string> = {
  a_cobrar: 'bg-yellow-100 text-yellow-700',
  endosado: 'bg-blue-100 text-blue-700',
  depositado: 'bg-purple-100 text-purple-700',
  cobrado: 'bg-green-100 text-green-700',
  rechazado: 'bg-red-100 text-red-700',
}

const CHEQUE_TYPES: { value: string; label: string }[] = [
  { value: 'comun', label: 'Comun' },
  { value: 'cruzado', label: 'Cruzado' },
  { value: 'no_a_la_orden', label: 'No a la Orden' },
  { value: 'cruzado_no_a_la_orden', label: 'Cruzado No a la Orden' },
]

const CHEQUE_TYPE_LABELS: Record<string, string> = Object.fromEntries(CHEQUE_TYPES.map(t => [t.value, t.label]))

const VALID_TRANSITIONS: Record<string, string[]> = {
  a_cobrar: ['endosado', 'depositado', 'cobrado', 'rechazado'],
  endosado: ['cobrado', 'rechazado', 'a_cobrar'],
  depositado: ['cobrado', 'rechazado', 'a_cobrar'],
  rechazado: ['a_cobrar'],
  cobrado: ['a_cobrar'],
}

function getDueDateAlert(dueDate: string, status: string): { label: string; className: string } | null {
  if (status !== 'a_cobrar') return null
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
  number: '', bank: '', drawer: '', drawer_cuit: '', cheque_type: 'comun',
  amount: '', issue_date: '', due_date: '', customer_id: '',
  order_id: '', notes: '',
}

export const Cheques: React.FC = () => {
  const [cheques, setCheques] = useState<Cheque[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [filterStatus, setFilterStatus] = useState<string>('')
  const [customers, setCustomers] = useState<Customer[]>([])
  const [summary, setSummary] = useState({
    total_a_cobrar: 0, total_cobrado: 0, count_a_cobrar: 0, count_cobrado: 0,
    total_endosado: 0, total_depositado: 0, total_rechazado: 0,
    count_endosado: 0, count_depositado: 0, count_rechazado: 0,
    vencidos_count: 0, vencidos_amount: 0,
    vencen_semana_count: 0, vencen_semana_amount: 0,
  })

  const [form, setForm] = useState(emptyForm)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Cheque | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [search, setSearch] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [chequeHistory, setChequeHistory] = useState<any[]>([])
  const [dueDateFrom, setDueDateFrom] = useState('')
  const [dueDateTo, setDueDateTo] = useState('')

  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)

  const loadData = async () => {
    try {
      setLoading(true)
      const [chequesRes, summaryRes, custRes] = await Promise.all([
        api.getCheques({
          status: filterStatus || undefined,
          search: search || undefined,
          due_from: dueDateFrom || undefined,
          due_to: dueDateTo || undefined,
        }).catch(() => []),
        api.getChequesSummary().catch(() => ({
          total_a_cobrar: 0, total_cobrado: 0, count_a_cobrar: 0, count_cobrado: 0,
          total_endosado: 0, total_depositado: 0, total_rechazado: 0,
          count_endosado: 0, count_depositado: 0, count_rechazado: 0,
          vencidos_count: 0, vencidos_amount: 0,
          vencen_semana_count: 0, vencen_semana_amount: 0,
        })),
        api.getCustomers().catch(() => ({ items: [] })),
      ])
      setCheques(Array.isArray(chequesRes) ? chequesRes : chequesRes.items || [])
      setSummary(summaryRes)
      setCustomers(custRes.items || custRes || [])
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadData() }, [filterStatus])

  // Debounced search/date filter reload
  useEffect(() => {
    if (searchTimeout.current) clearTimeout(searchTimeout.current)
    searchTimeout.current = setTimeout(() => {
      loadData()
    }, 300)
    return () => {
      if (searchTimeout.current) clearTimeout(searchTimeout.current)
    }
  }, [search, dueDateFrom, dueDateTo])

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const payload = {
        number: form.number,
        bank: form.bank,
        drawer: form.drawer,
        drawer_cuit: form.drawer_cuit || null,
        cheque_type: form.cheque_type || 'comun',
        amount: parseFloat(form.amount),
        issue_date: form.issue_date,
        due_date: form.due_date,
        customer_id: form.customer_id || null,
        order_id: form.order_id || null,
        notes: form.notes || null,
      }
      if (editingId) {
        await api.updateCheque(editingId, payload)
        toast.success('Cheque actualizado correctamente')
      } else {
        await api.createCheque(payload)
        toast.success('Cheque cargado correctamente')
      }
      setShowForm(false)
      setEditingId(null)
      setForm(emptyForm)
      await loadData()
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setSaving(false)
    }
  }

  const handleEdit = (cheque: Cheque) => {
    setForm({
      number: cheque.number,
      bank: cheque.bank,
      drawer: cheque.drawer,
      drawer_cuit: cheque.drawer_cuit || '',
      cheque_type: cheque.cheque_type || 'comun',
      amount: cheque.amount,
      issue_date: cheque.issue_date?.split('T')[0] || '',
      due_date: cheque.due_date?.split('T')[0] || '',
      customer_id: cheque.customer_id || '',
      order_id: '',
      notes: cheque.notes || '',
    })
    setEditingId(cheque.id)
    setShowForm(true)
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await api.deleteCheque(deleteTarget.id)
      toast.success('Cheque eliminado')
      setDeleteTarget(null)
      await loadData()
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setDeleting(false)
    }
  }

  const handleStatusChange = async (chequeId: string, newStatus: string) => {
    try {
      await api.updateChequeStatus(chequeId, newStatus)
      toast.success(`Cheque actualizado a ${STATUS_LABELS[newStatus]}`)
      await loadData()
    } catch (e: any) {
      toast.error(e.message)
    }
  }

  const handleRowClick = async (cheque: Cheque) => {
    if (expandedId === cheque.id) {
      setExpandedId(null)
      setChequeHistory([])
      return
    }
    setExpandedId(cheque.id)
    try {
      const history = await api.getChequeHistory(cheque.id)
      setChequeHistory(Array.isArray(history) ? history : [])
    } catch {
      setChequeHistory([])
    }
  }

  const columns = [
    { key: 'number' as const, label: 'Numero', render: (v: any) => <span className="font-mono font-bold">{v}</span> },
    { key: 'cheque_type' as const, label: 'Tipo', render: (v: any) => (
      <span className="px-1.5 py-0.5 rounded text-xs bg-gray-100 text-gray-700 font-medium">{CHEQUE_TYPE_LABELS[v] || v || 'Comun'}</span>
    )},
    { key: 'bank' as const, label: 'Banco' },
    { key: 'drawer' as const, label: 'Librador', render: (v: any, row: Cheque) => (
      <div>
        <span>{v}</span>
        {row.drawer_cuit && <span className="block text-xs text-gray-400 font-mono">{row.drawer_cuit}</span>}
      </div>
    )},
    { key: 'amount' as const, label: 'Monto', render: (v: any) => (
      <span className="font-bold text-green-700">{formatCurrency(parseFloat(v || '0'))}</span>
    )},
    { key: 'issue_date' as const, label: 'Emision', render: (v: any) => formatDate(v) },
    { key: 'due_date' as const, label: 'Cobro', render: (v: any, row: Cheque) => {
      const alert = getDueDateAlert(v, row.status)
      return (
        <div className="flex items-center gap-1.5">
          <span>{formatDate(v)}</span>
          {alert && <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold whitespace-nowrap ${alert.className}`}>{alert.label}</span>}
        </div>
      )
    }},
    { key: 'customer_name' as const, label: 'Cliente', render: (v: any) => v || '-' },
    { key: 'id' as const, label: 'Estado / Acciones', render: (_: any, row: Cheque) => (
      <div className="flex items-center gap-1.5" onClick={e => e.stopPropagation()}>
        <PermissionGate module="cheques" action="edit">
          <select
            className={`text-xs border rounded px-1 py-0.5 font-medium ${STATUS_COLORS[row.status] || 'bg-gray-100 text-gray-700'}`}
            value={row.status}
            onChange={e => handleStatusChange(row.id, e.target.value)}
          >
            <option value={row.status}>{STATUS_LABELS[row.status]}</option>
            {(VALID_TRANSITIONS[row.status] || []).map((s: string) => (
              <option key={s} value={s}>{STATUS_LABELS[s]}</option>
            ))}
          </select>
        </PermissionGate>
        {row.status === 'a_cobrar' && (
          <>
            <PermissionGate module="cheques" action="edit">
              <button onClick={e => { e.stopPropagation(); handleEdit(row) }} className="text-xs px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 hover:bg-blue-200">Editar</button>
            </PermissionGate>
            <PermissionGate module="cheques" action="delete">
              <button onClick={e => { e.stopPropagation(); setDeleteTarget(row) }} className="text-xs px-1.5 py-0.5 rounded bg-red-100 text-red-700 hover:bg-red-200">Eliminar</button>
            </PermissionGate>
          </>
        )}
      </div>
    )},
  ]

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Cheques</h1>
          <p className="text-sm text-gray-500 mt-1">Gestion de cheques a cobrar</p>
        </div>
        <div className="flex items-center gap-2">
          <ExportCSVButton
            data={cheques.map(c => ({
              numero: c.number,
              tipo: CHEQUE_TYPE_LABELS[c.cheque_type] || c.cheque_type || 'Comun',
              banco: c.bank,
              librador: c.drawer,
              cuit_librador: c.drawer_cuit || '-',
              monto: parseFloat(c.amount || '0'),
              emision: formatDate(c.issue_date),
              cobro: formatDate(c.due_date),
              cliente: c.customer_name || '-',
              estado: STATUS_LABELS[c.status] || c.status,
              notas: c.notes || '-',
            }))}
            columns={[
              { key: 'numero', label: 'Numero' },
              { key: 'tipo', label: 'Tipo' },
              { key: 'banco', label: 'Banco' },
              { key: 'librador', label: 'Librador' },
              { key: 'cuit_librador', label: 'CUIT Librador' },
              { key: 'monto', label: 'Monto' },
              { key: 'emision', label: 'Fecha Emision' },
              { key: 'cobro', label: 'Fecha Cobro' },
              { key: 'cliente', label: 'Cliente' },
              { key: 'estado', label: 'Estado' },
              { key: 'notas', label: 'Notas' },
            ]}
            filename="cheques"
          />
          <PermissionGate module="cheques" action="create">
            <Button variant={showForm ? 'danger' : 'primary'} onClick={() => { setForm(emptyForm); setEditingId(null); setShowForm(!showForm) }}>
              {showForm ? 'Cancelar' : '+ Nuevo Cheque'}
            </Button>
          </PermissionGate>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
          {error}<button onClick={() => setError(null)} className="ml-2 font-bold">x</button>
        </div>
      )}

      {/* Vencimiento alert banner */}
      {(() => {
        const alertCheques = cheques.filter(c => c.status === 'a_cobrar' && getDueDateAlert(c.due_date, c.status))
        const vencidos = alertCheques.filter(c => { const d = new Date(c.due_date + 'T00:00:00'); d.setHours(0,0,0,0); const t = new Date(); t.setHours(0,0,0,0); return d < t })
        const porVencer = alertCheques.filter(c => !vencidos.includes(c))
        if (alertCheques.length === 0) return null
        return (
          <div className={`px-4 py-3 rounded-lg flex items-center gap-3 text-sm font-medium ${
            vencidos.length > 0 ? 'bg-red-50 border border-red-200 text-red-800' : 'bg-yellow-50 border border-yellow-200 text-yellow-800'
          }`}>
            <span className="text-lg">!</span>
            <span>
              {vencidos.length > 0 && <>{vencidos.length} cheque{vencidos.length > 1 ? 's' : ''} vencido{vencidos.length > 1 ? 's' : ''}. </>}
              {porVencer.length > 0 && <>{porVencer.length} cheque{porVencer.length > 1 ? 's' : ''} por vencer en los proximos 7 dias.</>}
            </span>
          </div>
        )
      })()}

      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="border border-yellow-200 bg-yellow-50">
          <CardContent className="pt-4">
            <p className="text-sm text-yellow-700">A Cobrar ({summary.count_a_cobrar})</p>
            <p className="text-2xl font-bold text-yellow-800">{formatCurrency(summary.total_a_cobrar)}</p>
          </CardContent>
        </Card>
        <Card className="border border-red-200 bg-red-50">
          <CardContent className="pt-4">
            <p className="text-sm text-red-700">Vencidos ({summary.vencidos_count || 0})</p>
            <p className="text-2xl font-bold text-red-800">{formatCurrency(summary.vencidos_amount || 0)}</p>
          </CardContent>
        </Card>
        <Card className="border border-orange-200 bg-orange-50">
          <CardContent className="pt-4">
            <p className="text-sm text-orange-700">Vencen esta semana ({summary.vencen_semana_count || 0})</p>
            <p className="text-2xl font-bold text-orange-800">{formatCurrency(summary.vencen_semana_amount || 0)}</p>
          </CardContent>
        </Card>
        <Card className="border border-green-200 bg-green-50">
          <CardContent className="pt-4">
            <p className="text-sm text-green-700">Cobrados ({summary.count_cobrado})</p>
            <p className="text-2xl font-bold text-green-800">{formatCurrency(summary.total_cobrado)}</p>
          </CardContent>
        </Card>
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
          label="Fecha cobro"
        />
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-lg w-fit flex-wrap">
        {[
          { value: '', label: 'Todos' },
          { value: 'a_cobrar', label: 'A Cobrar' },
          { value: 'endosado', label: 'Endosado' },
          { value: 'depositado', label: 'Depositado' },
          { value: 'cobrado', label: 'Cobrados' },
          { value: 'rechazado', label: 'Rechazados' },
        ].map(tab => (
          <button
            key={tab.value}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${filterStatus === tab.value ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
            onClick={() => setFilterStatus(tab.value)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Create/Edit form */}
      {showForm && (
        <Card>
          <CardHeader><h3 className="text-lg font-semibold">{editingId ? 'Editar Cheque' : 'Nuevo Cheque'}</h3></CardHeader>
          <CardContent>
            <form onSubmit={handleCreate} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <Input label="Numero de Cheque *" placeholder="Ej: 12345678" value={form.number} onChange={e => setForm({ ...form, number: e.target.value })} required />
                <Input label="Banco *" placeholder="Ej: Banco Nacion" value={form.bank} onChange={e => setForm({ ...form, bank: e.target.value })} required />
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-gray-700">Tipo de Cheque</label>
                  <select className="px-3 py-2 border border-gray-300 rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-blue-500" value={form.cheque_type} onChange={e => setForm({ ...form, cheque_type: e.target.value })}>
                    {CHEQUE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
                <Input label="Monto *" type="number" step="0.01" placeholder="0.00" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} required />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <Input label="Librador *" placeholder="Nombre del emisor" value={form.drawer} onChange={e => setForm({ ...form, drawer: e.target.value })} required />
                <Input label="CUIT del Librador" placeholder="20-12345678-9" value={form.drawer_cuit} onChange={e => setForm({ ...form, drawer_cuit: e.target.value })} />
                <Input label="Fecha de Emision *" type="date" value={form.issue_date} onChange={e => setForm({ ...form, issue_date: e.target.value })} required />
                <Input label="Fecha de Cobro *" type="date" value={form.due_date} onChange={e => setForm({ ...form, due_date: e.target.value })} required />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-gray-700">Cliente (opcional)</label>
                  <select className="px-3 py-2 border border-gray-300 rounded-lg" value={form.customer_id} onChange={e => setForm({ ...form, customer_id: e.target.value })}>
                    <option value="">Sin cliente asociado</option>
                    {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <Input label="Notas" placeholder="Observaciones..." value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
              </div>
              <Button type="submit" variant="success" loading={saving}>{editingId ? 'Guardar Cambios' : 'Cargar Cheque'}</Button>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Table */}
      {loading ? (
        <Card><CardContent><SkeletonTable rows={5} cols={4} /></CardContent></Card>
      ) : cheques.length === 0 ? (
        <Card><CardContent>
          <EmptyState
            title="Sin cheques registrados"
            description="Carga el primer cheque para empezar a gestionarlos"
            actionLabel="+ Nuevo Cheque"
            onAction={() => { setForm(emptyForm); setEditingId(null); setShowForm(true) }}
          />
        </CardContent></Card>
      ) : (
        <>
          <DataTable columns={columns} data={cheques} onRowClick={handleRowClick} />

          {/* Expanded detail with history */}
          {expandedId && (() => {
            const cheque = cheques.find(c => c.id === expandedId)
            if (!cheque) return null
            return (
              <Card className="border-blue-200 bg-blue-50/30 animate-fadeIn">
                <CardContent className="pt-4">
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <h4 className="font-semibold text-gray-900">Cheque N. {cheque.number}</h4>
                      <p className="text-sm text-gray-600">
                        {cheque.bank} - {cheque.drawer}
                        {cheque.drawer_cuit && <span className="font-mono text-gray-400 ml-1">({cheque.drawer_cuit})</span>}
                      </p>
                      {cheque.cheque_type && cheque.cheque_type !== 'comun' && (
                        <span className="inline-block mt-1 px-2 py-0.5 rounded text-xs bg-blue-50 text-blue-700 font-medium">{CHEQUE_TYPE_LABELS[cheque.cheque_type] || cheque.cheque_type}</span>
                      )}
                      {cheque.notes && <p className="text-sm text-gray-500 mt-1">Notas: {cheque.notes}</p>}
                      {cheque.collected_date && (
                        <p className="text-sm text-green-700 mt-1">Cobrado el: {formatDate(cheque.collected_date)}</p>
                      )}
                    </div>
                    <button onClick={() => { setExpandedId(null); setChequeHistory([]) }} className="text-gray-400 hover:text-gray-600 text-lg">x</button>
                  </div>

                  {chequeHistory.length > 0 ? (
                    <div>
                      <h5 className="text-sm font-semibold text-gray-700 mb-2">Historial de estados</h5>
                      <div className="space-y-2">
                        {chequeHistory.map((h: any, i: number) => (
                          <div key={h.id || i} className="flex items-center gap-3 text-sm border-l-2 border-blue-300 pl-3 py-1">
                            <StatusBadge
                              status={h.old_status || ''}
                              label={STATUS_LABELS[h.old_status] || h.old_status || '\u2014'}
                            />
                            <span className="text-gray-400">-&gt;</span>
                            <StatusBadge
                              status={h.new_status || ''}
                              label={STATUS_LABELS[h.new_status] || h.new_status}
                            />
                            <span className="text-gray-400 text-xs">{formatDate(h.created_at)}</span>
                            {h.changed_by_name && <span className="text-gray-500 text-xs">por {h.changed_by_name}</span>}
                            {h.notes && <span className="text-gray-500 text-xs italic">- {h.notes}</span>}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-gray-500">Sin historial de cambios de estado.</p>
                  )}
                </CardContent>
              </Card>
            )
          })()}
        </>
      )}

      {/* Confirm delete dialog */}
      <ConfirmDialog
        open={!!deleteTarget}
        title="Eliminar Cheque"
        message={`Eliminar cheque N. ${deleteTarget?.number} por ${formatCurrency(parseFloat(deleteTarget?.amount || '0'))}?`}
        confirmLabel="Eliminar"
        variant="danger"
        loading={deleting}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}
