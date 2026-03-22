import React, { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, CardContent } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { SkeletonTable } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/shared/EmptyState'
import { DateRangeFilter } from '@/components/shared/DateRangeFilter'
import { toast } from '@/hooks/useToast'
import { DataTable } from '@/components/shared/DataTable'
import { formatCurrency, formatDate } from '@/lib/utils'
import { ExportCSVButton } from '@/components/shared/ExportCSV'
import { ExportExcelButton } from '@/components/shared/ExportExcel'
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
  cobro_id: string | null
  cobro_reference: string | null
  notes: string | null
  collected_date: string | null
  created_at: string
}

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

export const Cheques: React.FC = () => {
  const navigate = useNavigate()
  const [cheques, setCheques] = useState<Cheque[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filterStatus, setFilterStatus] = useState<string>('')
  const [summary, setSummary] = useState({
    total_a_cobrar: 0, total_cobrado: 0, count_a_cobrar: 0, count_cobrado: 0,
    total_endosado: 0, total_depositado: 0, total_rechazado: 0,
    count_endosado: 0, count_depositado: 0, count_rechazado: 0,
    vencidos_count: 0, vencidos_amount: 0,
    vencen_semana_count: 0, vencen_semana_amount: 0,
  })

  const [search, setSearch] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [chequeHistory, setChequeHistory] = useState<any[]>([])
  const [dueDateFrom, setDueDateFrom] = useState('')
  const [dueDateTo, setDueDateTo] = useState('')

  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)

  const loadData = async () => {
    try {
      setLoading(true)
      const [chequesRes, summaryRes] = await Promise.all([
        api.getCheques({
          status: filterStatus || undefined,
          search: search || undefined,
          due_from: dueDateFrom || undefined,
          due_to: dueDateTo || undefined,
        }).catch((err: any) => {
          setError(`Error cargando cheques: ${err?.response?.data?.error || err?.message || 'Error desconocido'}`)
          return []
        }),
        api.getChequesSummary().catch(() => ({
          total_a_cobrar: 0, total_cobrado: 0, count_a_cobrar: 0, count_cobrado: 0,
          total_endosado: 0, total_depositado: 0, total_rechazado: 0,
          count_endosado: 0, count_depositado: 0, count_rechazado: 0,
          vencidos_count: 0, vencidos_amount: 0,
          vencen_semana_count: 0, vencen_semana_amount: 0,
        })),
      ])
      setCheques(Array.isArray(chequesRes) ? chequesRes : chequesRes.items || [])
      setSummary(summaryRes)
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
    { key: 'cobro_id' as const, label: 'Cobro', render: (_: any, row: Cheque) => (
      <div onClick={e => e.stopPropagation()}>
        {row.cobro_id ? (
          <button
            onClick={() => navigate('/cobros')}
            className="text-xs px-2 py-0.5 rounded bg-blue-100 text-blue-700 hover:bg-blue-200 font-medium transition-colors"
          >
            {row.cobro_reference || 'Ver cobro'}
          </button>
        ) : (
          <span className="text-xs text-gray-400">-</span>
        )}
      </div>
    )},
    { key: 'id' as const, label: 'Estado', render: (_: any, row: Cheque) => (
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
      </div>
    )},
  ]

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Cheques</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Gestion de cheques a cobrar</p>
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
              { key: 'monto', label: 'Monto', type: 'currency' as const },
              { key: 'emision', label: 'Fecha Emision' },
              { key: 'cobro', label: 'Fecha Cobro' },
              { key: 'cliente', label: 'Cliente' },
              { key: 'estado', label: 'Estado' },
              { key: 'notas', label: 'Notas' },
            ]}
            filename="cheques"
          />
          <ExportExcelButton
            data={cheques.map(c => ({
              numero: c.number,
              tipo: CHEQUE_TYPE_LABELS[c.cheque_type] || c.cheque_type || 'Comun',
              banco: c.bank,
              librador: c.drawer,
              cuit_librador: c.drawer_cuit || '-',
              monto: parseFloat(c.amount || '0'),
              emision: c.issue_date,
              cobro: c.due_date,
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
              { key: 'monto', label: 'Monto', type: 'currency' as const },
              { key: 'emision', label: 'Fecha Emision', type: 'date' as const },
              { key: 'cobro', label: 'Fecha Cobro', type: 'date' as const },
              { key: 'cliente', label: 'Cliente' },
              { key: 'estado', label: 'Estado' },
              { key: 'notas', label: 'Notas' },
            ]}
            filename="cheques"
          />
        </div>
      </div>

      {error && (
        <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 px-4 py-3 rounded-lg">
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

      {/* Table */}
      {loading ? (
        <Card><CardContent><SkeletonTable rows={5} cols={4} /></CardContent></Card>
      ) : cheques.length === 0 ? (
        <Card><CardContent>
          <EmptyState
            title="Sin cheques registrados"
            description="Los cheques se crean automaticamente desde Cobros cuando el metodo de pago es cheque"
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
                      <h4 className="font-semibold text-gray-900 dark:text-gray-100">Cheque N. {cheque.number}</h4>
                      <p className="text-sm text-gray-600">
                        {cheque.bank} - {cheque.drawer}
                        {cheque.drawer_cuit && <span className="font-mono text-gray-400 ml-1">({cheque.drawer_cuit})</span>}
                      </p>
                    </div>
                    <button onClick={() => { setExpandedId(null); setChequeHistory([]) }} className="text-gray-400 hover:text-gray-600 text-lg">x</button>
                  </div>

                  {/* Cheque details grid */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4 text-sm">
                    <div>
                      <span className="text-xs text-gray-500 block">Tipo</span>
                      <span className="font-medium">{CHEQUE_TYPE_LABELS[cheque.cheque_type] || cheque.cheque_type || 'Comun'}</span>
                    </div>
                    <div>
                      <span className="text-xs text-gray-500 block">Monto</span>
                      <span className="font-bold text-green-700">{formatCurrency(parseFloat(cheque.amount || '0'))}</span>
                    </div>
                    <div>
                      <span className="text-xs text-gray-500 block">Emision</span>
                      <span className="font-medium">{formatDate(cheque.issue_date)}</span>
                    </div>
                    <div>
                      <span className="text-xs text-gray-500 block">Vencimiento</span>
                      <span className="font-medium">{formatDate(cheque.due_date)}</span>
                    </div>
                    <div>
                      <span className="text-xs text-gray-500 block">Librador</span>
                      <span className="font-medium">{cheque.drawer}</span>
                      {cheque.drawer_cuit && <span className="block text-xs font-mono text-gray-400">{cheque.drawer_cuit}</span>}
                    </div>
                    <div>
                      <span className="text-xs text-gray-500 block">Estado</span>
                      <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[cheque.status] || 'bg-gray-100 text-gray-700'}`}>
                        {STATUS_LABELS[cheque.status] || cheque.status}
                      </span>
                    </div>
                    {cheque.collected_date && (
                      <div>
                        <span className="text-xs text-gray-500 block">Cobrado el</span>
                        <span className="font-medium text-green-700">{formatDate(cheque.collected_date)}</span>
                      </div>
                    )}
                    {cheque.customer_name && (
                      <div>
                        <span className="text-xs text-gray-500 block">Cliente</span>
                        <span className="font-medium">{cheque.customer_name}</span>
                      </div>
                    )}
                  </div>

                  {cheque.notes && (
                    <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">Notas: {cheque.notes}</p>
                  )}

                  {/* Link to cobro */}
                  {cheque.cobro_id && (
                    <div className="mb-4 p-2 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg inline-flex items-center gap-2">
                      <span className="text-sm text-blue-700 dark:text-blue-300">Vinculado a cobro:</span>
                      <button
                        onClick={() => navigate('/cobros')}
                        className="text-sm font-medium text-blue-600 hover:text-blue-800 underline transition-colors"
                      >
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

    </div>
  )
}
