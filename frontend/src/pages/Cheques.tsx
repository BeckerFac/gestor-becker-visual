import React, { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { SkeletonTable } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { toast } from '@/hooks/useToast'
import { DataTable } from '@/components/shared/DataTable'
import { formatCurrency, formatDate } from '@/lib/utils'
import { ExportCSVButton } from '@/components/shared/ExportCSV'
import { api } from '@/services/api'

interface Cheque {
  id: string
  number: string
  bank: string
  drawer: string
  amount: string
  issue_date: string
  due_date: string
  status: string
  customer_name: string | null
  order_number: number | null
  notes: string | null
  collected_date: string | null
  created_at: string
}

interface Customer { id: string; name: string }

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

export const Cheques: React.FC = () => {
  const [cheques, setCheques] = useState<Cheque[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [filterStatus, setFilterStatus] = useState<string>('')
  const [customers, setCustomers] = useState<Customer[]>([])
  const [summary, setSummary] = useState({ total_a_cobrar: 0, total_cobrado: 0, count_a_cobrar: 0, count_cobrado: 0 })

  const [form, setForm] = useState({
    number: '', bank: '', drawer: '', amount: '',
    issue_date: '', due_date: '', customer_id: '',
    order_id: '', notes: '',
  })

  const loadData = async () => {
    try {
      setLoading(true)
      const [chequesRes, summaryRes, custRes] = await Promise.all([
        api.getCheques(filterStatus || undefined).catch(() => []),
        api.getChequesSummary().catch(() => ({ total_a_cobrar: 0, total_cobrado: 0, count_a_cobrar: 0, count_cobrado: 0 })),
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

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      await api.createCheque({
        number: form.number,
        bank: form.bank,
        drawer: form.drawer,
        amount: parseFloat(form.amount),
        issue_date: form.issue_date,
        due_date: form.due_date,
        customer_id: form.customer_id || null,
        order_id: form.order_id || null,
        notes: form.notes || null,
      })
      toast.success('Cheque cargado correctamente')
      setShowForm(false)
      setForm({ number: '', bank: '', drawer: '', amount: '', issue_date: '', due_date: '', customer_id: '', order_id: '', notes: '' })
      await loadData()
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setSaving(false)
    }
  }

  const handleStatusToggle = async (chequeId: string, currentStatus: string) => {
    try {
      const newStatus = currentStatus === 'a_cobrar' ? 'cobrado' : 'a_cobrar'
      await api.updateChequeStatus(chequeId, newStatus)
      toast.success(newStatus === 'cobrado' ? 'Cheque marcado como cobrado' : 'Cheque vuelto a pendiente')
      await loadData()
    } catch (e: any) {
      toast.error(e.message)
    }
  }

  const columns = [
    { key: 'number' as const, label: 'Número', render: (v: any) => <span className="font-mono font-bold">{v}</span> },
    { key: 'bank' as const, label: 'Banco' },
    { key: 'drawer' as const, label: 'Librador' },
    { key: 'amount' as const, label: 'Monto', render: (v: any) => (
      <span className="font-bold text-green-700">{formatCurrency(parseFloat(v || '0'))}</span>
    )},
    { key: 'issue_date' as const, label: 'Fecha Emisión', render: (v: any) => formatDate(v) },
    { key: 'due_date' as const, label: 'Fecha Cobro', render: (v: any, row: Cheque) => {
      const alert = getDueDateAlert(v, row.status)
      return (
        <div className="flex items-center gap-1.5">
          <span>{formatDate(v)}</span>
          {alert && <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold whitespace-nowrap ${alert.className}`}>{alert.label}</span>}
        </div>
      )
    }},
    { key: 'customer_name' as const, label: 'Cliente', render: (v: any) => v || '-' },
    { key: 'status' as const, label: 'Estado', render: (v: any) => (
      v === 'cobrado'
        ? <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">Cobrado</span>
        : <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-700">A Cobrar</span>
    )},
    { key: 'id' as const, label: 'Acciones', render: (_: any, row: Cheque) => (
      <button
        onClick={(e) => { e.stopPropagation(); handleStatusToggle(row.id, row.status) }}
        className={`text-xs font-medium px-2 py-1 rounded transition-colors ${
          row.status === 'a_cobrar'
            ? 'bg-green-600 text-white hover:bg-green-700'
            : 'bg-yellow-600 text-white hover:bg-yellow-700'
        }`}
      >
        {row.status === 'a_cobrar' ? 'Marcar Cobrado' : 'Volver a Pendiente'}
      </button>
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
              banco: c.bank,
              librador: c.drawer,
              monto: parseFloat(c.amount || '0'),
              emision: formatDate(c.issue_date),
              cobro: formatDate(c.due_date),
              cliente: c.customer_name || '-',
              estado: c.status === 'cobrado' ? 'Cobrado' : 'A Cobrar',
              notas: c.notes || '-',
            }))}
            columns={[
              { key: 'numero', label: 'Numero' },
              { key: 'banco', label: 'Banco' },
              { key: 'librador', label: 'Librador' },
              { key: 'monto', label: 'Monto' },
              { key: 'emision', label: 'Fecha Emision' },
              { key: 'cobro', label: 'Fecha Cobro' },
              { key: 'cliente', label: 'Cliente' },
              { key: 'estado', label: 'Estado' },
              { key: 'notas', label: 'Notas' },
            ]}
            filename="cheques"
          />
          <Button variant={showForm ? 'danger' : 'primary'} onClick={() => setShowForm(!showForm)}>
            {showForm ? 'Cancelar' : '+ Nuevo Cheque'}
          </Button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
          {error}<button onClick={() => setError(null)} className="ml-2 font-bold">×</button>
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
            <span className="text-lg">{vencidos.length > 0 ? '!' : '!'}</span>
            <span>
              {vencidos.length > 0 && <>{vencidos.length} cheque{vencidos.length > 1 ? 's' : ''} vencido{vencidos.length > 1 ? 's' : ''}. </>}
              {porVencer.length > 0 && <>{porVencer.length} cheque{porVencer.length > 1 ? 's' : ''} por vencer en los proximos 7 dias.</>}
            </span>
          </div>
        )
      })()}

      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="border border-yellow-200 bg-yellow-50">
          <CardContent className="pt-4">
            <p className="text-sm text-yellow-700">Total a Cobrar ({summary.count_a_cobrar})</p>
            <p className="text-2xl font-bold text-yellow-800">{formatCurrency(summary.total_a_cobrar)}</p>
          </CardContent>
        </Card>
        <Card className="border border-green-200 bg-green-50">
          <CardContent className="pt-4">
            <p className="text-sm text-green-700">Total Cobrado ({summary.count_cobrado})</p>
            <p className="text-2xl font-bold text-green-800">{formatCurrency(summary.total_cobrado)}</p>
          </CardContent>
        </Card>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-lg w-fit">
        <button
          className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${filterStatus === '' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
          onClick={() => setFilterStatus('')}
        >
          Todos
        </button>
        <button
          className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${filterStatus === 'a_cobrar' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
          onClick={() => setFilterStatus('a_cobrar')}
        >
          A Cobrar
        </button>
        <button
          className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${filterStatus === 'cobrado' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
          onClick={() => setFilterStatus('cobrado')}
        >
          Cobrados
        </button>
      </div>

      {/* Create form */}
      {showForm && (
        <Card>
          <CardHeader><h3 className="text-lg font-semibold">Nuevo Cheque</h3></CardHeader>
          <CardContent>
            <form onSubmit={handleCreate} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                <Input label="Número de Cheque *" placeholder="Ej: 12345678" value={form.number} onChange={e => setForm({ ...form, number: e.target.value })} required />
                <Input label="Banco *" placeholder="Ej: Banco Nación" value={form.bank} onChange={e => setForm({ ...form, bank: e.target.value })} required />
                <Input label="Librador *" placeholder="Nombre del emisor" value={form.drawer} onChange={e => setForm({ ...form, drawer: e.target.value })} required />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                <Input label="Monto *" type="number" step="0.01" placeholder="0.00" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} required />
                <Input label="Fecha de Emisión *" type="date" value={form.issue_date} onChange={e => setForm({ ...form, issue_date: e.target.value })} required />
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
              <Button type="submit" variant="success" loading={saving}>Cargar Cheque</Button>
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
            action={{ label: '+ Nuevo Cheque', onClick: () => setShowForm(true) }}
          />
        </CardContent></Card>
      ) : (
        <DataTable columns={columns} data={cheques} />
      )}
    </div>
  )
}
