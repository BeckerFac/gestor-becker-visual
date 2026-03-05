import React, { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { DataTable } from '@/components/shared/DataTable'
import { formatCurrency, formatDate } from '@/lib/utils'
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
      setShowForm(false)
      setForm({ number: '', bank: '', drawer: '', amount: '', issue_date: '', due_date: '', customer_id: '', order_id: '', notes: '' })
      await loadData()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const handleStatusToggle = async (chequeId: string, currentStatus: string) => {
    try {
      const newStatus = currentStatus === 'a_cobrar' ? 'cobrado' : 'a_cobrar'
      await api.updateChequeStatus(chequeId, newStatus)
      await loadData()
    } catch (e: any) {
      setError(e.message)
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
    { key: 'due_date' as const, label: 'Fecha Cobro', render: (v: any) => formatDate(v) },
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
          <p className="text-sm text-gray-500 mt-1">Gestión de cheques a cobrar</p>
        </div>
        <Button variant="primary" onClick={() => setShowForm(!showForm)}>
          {showForm ? 'Cancelar' : '+ Nuevo Cheque'}
        </Button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
          {error}<button onClick={() => setError(null)} className="ml-2 font-bold">×</button>
        </div>
      )}

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
              <Button type="submit" variant="primary" loading={saving}>Cargar Cheque</Button>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Table */}
      {loading ? (
        <Card><CardContent><p className="text-center py-8 text-gray-500">Cargando cheques...</p></CardContent></Card>
      ) : cheques.length === 0 ? (
        <Card><CardContent><p className="text-center py-8 text-gray-500">No hay cheques registrados</p></CardContent></Card>
      ) : (
        <DataTable columns={columns} data={cheques} />
      )}
    </div>
  )
}
