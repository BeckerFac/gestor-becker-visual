import React, { useState, useEffect, useMemo } from 'react'
import { Card, CardContent, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { SkeletonTable } from '@/components/ui/Skeleton'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Pagination } from '@/components/shared/Pagination'
import { EmptyState } from '@/components/shared/EmptyState'
import { toast } from '@/hooks/useToast'
import { api } from '@/services/api'
import { formatCurrency, formatDate } from '@/lib/utils'

// Types
interface Account {
  id: string
  code: string
  name: string
  type: string
  parent_id: string | null
  level: number
  is_header: boolean
}

interface EntryLine {
  id: string
  account_code: string
  account_name: string
  debit: string | number
  credit: string | number
  description: string | null
}

interface JournalEntry {
  id: string
  entry_number: number
  date: string
  description: string
  reference_type: string | null
  reference_id: string | null
  is_auto: boolean
  lines: EntryLine[]
  created_at: string
}

interface BalanceRow {
  id: string
  code: string
  name: string
  type: string
  level: number
  is_header: boolean
  total_debit: string | number
  total_credit: string | number
  balance: string | number
}

const TYPE_LABELS: Record<string, string> = {
  activo: 'Activo',
  pasivo: 'Pasivo',
  patrimonio: 'Patrimonio Neto',
  ingreso: 'Ingresos',
  egreso: 'Egresos',
}

const TYPE_COLORS: Record<string, string> = {
  activo: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  pasivo: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
  patrimonio: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  ingreso: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200',
  egreso: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200',
}

const REF_LABELS: Record<string, string> = {
  invoice: 'Factura',
  cobro: 'Cobro',
  pago: 'Pago',
  purchase_invoice: 'Factura Compra',
  adjustment: 'Ajuste',
}

const TABS = ['Plan de Cuentas', 'Libro Diario', 'Balance'] as const
type Tab = typeof TABS[number]

export const Contabilidad: React.FC = () => {
  const [activeTab, setActiveTab] = useState<Tab>('Plan de Cuentas')
  const [loading, setLoading] = useState(true)

  // Chart of accounts state
  const [accounts, setAccounts] = useState<Account[]>([])
  const [showNewAccount, setShowNewAccount] = useState(false)
  const [newAccount, setNewAccount] = useState({ code: '', name: '', type: 'activo', parent_id: '' })
  const [seeding, setSeeding] = useState(false)

  // Journal entries state
  const [entries, setEntries] = useState<JournalEntry[]>([])
  const [entriesTotal, setEntriesTotal] = useState(0)
  const [entriesPage, setEntriesPage] = useState(1)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<JournalEntry | null>(null)

  // Manual entry form
  const [showManualEntry, setShowManualEntry] = useState(false)
  const [manualEntry, setManualEntry] = useState({
    date: new Date().toISOString().split('T')[0],
    description: '',
    lines: [
      { accountCode: '', debit: '', credit: '', description: '' },
      { accountCode: '', debit: '', credit: '', description: '' },
    ],
  })

  // Balance state
  const [balance, setBalance] = useState<BalanceRow[]>([])
  const [balanceDateFrom, setBalanceDateFrom] = useState('')
  const [balanceDateTo, setBalanceDateTo] = useState('')

  const PAGE_SIZE = 20

  // Load data based on active tab
  useEffect(() => {
    loadData()
  }, [activeTab, entriesPage])

  const loadData = async () => {
    setLoading(true)
    try {
      if (activeTab === 'Plan de Cuentas') {
        const data = await api.getChartOfAccounts()
        setAccounts(data)
      } else if (activeTab === 'Libro Diario') {
        const data = await api.getAccountingEntries({
          date_from: dateFrom,
          date_to: dateTo,
          limit: PAGE_SIZE,
          offset: (entriesPage - 1) * PAGE_SIZE,
        })
        setEntries(data.entries)
        setEntriesTotal(data.total)
      } else if (activeTab === 'Balance') {
        const data = await api.getAccountingBalance({
          date_from: balanceDateFrom,
          date_to: balanceDateTo,
        })
        setBalance(data)
      }
    } catch (e: any) {
      toast.error(e?.response?.data?.error || e.message)
    } finally {
      setLoading(false)
    }
  }

  const handleSeed = async () => {
    setSeeding(true)
    try {
      const result = await api.seedChartOfAccounts()
      toast.success(`Plan de cuentas: ${result.created} creadas, ${result.skipped} existentes`)
      loadData()
    } catch (e: any) {
      toast.error(e?.response?.data?.error || e.message)
    } finally {
      setSeeding(false)
    }
  }

  const handleCreateAccount = async () => {
    try {
      await api.createAccount({
        code: newAccount.code,
        name: newAccount.name,
        type: newAccount.type,
        parent_id: newAccount.parent_id || undefined,
      })
      toast.success('Cuenta creada')
      setShowNewAccount(false)
      setNewAccount({ code: '', name: '', type: 'activo', parent_id: '' })
      loadData()
    } catch (e: any) {
      toast.error(e?.response?.data?.error || e.message)
    }
  }

  const handleCreateManualEntry = async () => {
    try {
      const lines = manualEntry.lines
        .filter(l => l.accountCode && (Number(l.debit) > 0 || Number(l.credit) > 0))
        .map(l => ({
          accountCode: l.accountCode,
          debit: Number(l.debit) || 0,
          credit: Number(l.credit) || 0,
          description: l.description || undefined,
        }))
      if (lines.length < 2) {
        toast.error('El asiento necesita al menos 2 lineas')
        return
      }
      await api.createManualEntry({
        date: manualEntry.date,
        description: manualEntry.description,
        lines,
      })
      toast.success('Asiento creado')
      setShowManualEntry(false)
      setManualEntry({
        date: new Date().toISOString().split('T')[0],
        description: '',
        lines: [
          { accountCode: '', debit: '', credit: '', description: '' },
          { accountCode: '', debit: '', credit: '', description: '' },
        ],
      })
      loadData()
    } catch (e: any) {
      toast.error(e?.response?.data?.error || e.message)
    }
  }

  const handleDeleteEntry = async () => {
    if (!deleteTarget) return
    try {
      await api.deleteAccountingEntry(deleteTarget.id)
      toast.success('Asiento eliminado')
      setDeleteTarget(null)
      loadData()
    } catch (e: any) {
      toast.error(e?.response?.data?.error || e.message)
    }
  }

  const addManualLine = () => {
    setManualEntry({
      ...manualEntry,
      lines: [...manualEntry.lines, { accountCode: '', debit: '', credit: '', description: '' }],
    })
  }

  const updateManualLine = (index: number, field: string, value: string) => {
    const newLines = manualEntry.lines.map((l, i) =>
      i === index ? { ...l, [field]: value } : l
    )
    setManualEntry({ ...manualEntry, lines: newLines })
  }

  const removeManualLine = (index: number) => {
    if (manualEntry.lines.length <= 2) return
    setManualEntry({
      ...manualEntry,
      lines: manualEntry.lines.filter((_, i) => i !== index),
    })
  }

  // Compute total debit/credit for manual entry
  const manualTotals = useMemo(() => {
    const debit = manualEntry.lines.reduce((s, l) => s + (Number(l.debit) || 0), 0)
    const credit = manualEntry.lines.reduce((s, l) => s + (Number(l.credit) || 0), 0)
    return { debit, credit, balanced: Math.abs(debit - credit) < 0.01 }
  }, [manualEntry.lines])

  // Balance totals
  const balanceTotals = useMemo(() => {
    const debit = balance.reduce((s, r) => s + Number(r.total_debit), 0)
    const credit = balance.reduce((s, r) => s + Number(r.total_credit), 0)
    return { debit, credit }
  }, [balance])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Contabilidad</h1>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200 dark:border-gray-700">
        {TABS.map(tab => (
          <button
            key={tab}
            onClick={() => { setActiveTab(tab); setLoading(true) }}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab
                ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {loading ? (
        <SkeletonTable rows={8} cols={5} />
      ) : (
        <>
          {/* Plan de Cuentas */}
          {activeTab === 'Plan de Cuentas' && (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold">Plan de Cuentas</h2>
                  <div className="flex gap-2">
                    <Button variant="outline" onClick={handleSeed} disabled={seeding}>
                      {seeding ? 'Cargando...' : 'Cargar Plan Base'}
                    </Button>
                    <Button onClick={() => setShowNewAccount(true)}>
                      + Nueva Cuenta
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {accounts.length === 0 ? (
                  <EmptyState
                    title="Sin plan de cuentas"
                    description="Cargue el plan de cuentas base argentino para comenzar."
                  />
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b dark:border-gray-700">
                          <th className="text-left py-2 px-3">Codigo</th>
                          <th className="text-left py-2 px-3">Nombre</th>
                          <th className="text-left py-2 px-3">Tipo</th>
                          <th className="text-center py-2 px-3">Nivel</th>
                        </tr>
                      </thead>
                      <tbody>
                        {accounts.map(acc => (
                          <tr
                            key={acc.id}
                            className={`border-b dark:border-gray-800 ${acc.is_header ? 'font-bold bg-gray-50 dark:bg-gray-900' : ''}`}
                          >
                            <td className="py-2 px-3" style={{ paddingLeft: `${(acc.level - 1) * 24 + 12}px` }}>
                              {acc.code}
                            </td>
                            <td className="py-2 px-3">{acc.name}</td>
                            <td className="py-2 px-3">
                              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${TYPE_COLORS[acc.type] || 'bg-gray-100 text-gray-800'}`}>
                                {TYPE_LABELS[acc.type] || acc.type}
                              </span>
                            </td>
                            <td className="py-2 px-3 text-center">{acc.level}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* New account form */}
                {showNewAccount && (
                  <div className="mt-4 p-4 border rounded-lg dark:border-gray-700 space-y-3">
                    <h3 className="font-medium">Nueva Cuenta</h3>
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                      <Input
                        label="Codigo"
                        value={newAccount.code}
                        onChange={e => setNewAccount({ ...newAccount, code: e.target.value })}
                        placeholder="ej: 1.1.1"
                      />
                      <Input
                        label="Nombre"
                        value={newAccount.name}
                        onChange={e => setNewAccount({ ...newAccount, name: e.target.value })}
                        placeholder="ej: Banco Nacion"
                      />
                      <div>
                        <label className="block text-sm font-medium mb-1">Tipo</label>
                        <select
                          className="w-full px-3 py-2 border rounded-lg dark:bg-gray-800 dark:border-gray-700"
                          value={newAccount.type}
                          onChange={e => setNewAccount({ ...newAccount, type: e.target.value })}
                        >
                          {Object.entries(TYPE_LABELS).map(([k, v]) => (
                            <option key={k} value={k}>{v}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium mb-1">Cuenta Padre</label>
                        <select
                          className="w-full px-3 py-2 border rounded-lg dark:bg-gray-800 dark:border-gray-700"
                          value={newAccount.parent_id}
                          onChange={e => setNewAccount({ ...newAccount, parent_id: e.target.value })}
                        >
                          <option value="">Sin padre</option>
                          {accounts.map(a => (
                            <option key={a.id} value={a.id}>{a.code} - {a.name}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button onClick={handleCreateAccount}>Guardar</Button>
                      <Button variant="outline" onClick={() => setShowNewAccount(false)}>Cancelar</Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Libro Diario */}
          {activeTab === 'Libro Diario' && (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <h2 className="text-lg font-semibold">Libro Diario</h2>
                  <div className="flex gap-2 items-end flex-wrap">
                    <Input
                      type="date"
                      label="Desde"
                      value={dateFrom}
                      onChange={e => setDateFrom(e.target.value)}
                    />
                    <Input
                      type="date"
                      label="Hasta"
                      value={dateTo}
                      onChange={e => setDateTo(e.target.value)}
                    />
                    <Button variant="outline" onClick={() => { setEntriesPage(1); loadData() }}>
                      Filtrar
                    </Button>
                    <Button onClick={() => setShowManualEntry(true)}>
                      + Asiento Manual
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {entries.length === 0 ? (
                  <EmptyState
                    title="Sin asientos"
                    description="Los asientos se crean automaticamente al operar, o puede crear uno manual."
                  />
                ) : (
                  <div className="space-y-3">
                    {entries.map(entry => (
                      <div key={entry.id} className="border rounded-lg dark:border-gray-700 p-3">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-3">
                            <span className="text-xs text-gray-500">#{entry.entry_number}</span>
                            <span className="font-medium">{formatDate(entry.date)}</span>
                            <span className="text-sm text-gray-600 dark:text-gray-400">{entry.description}</span>
                            {entry.reference_type && (
                              <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400">
                                {REF_LABELS[entry.reference_type] || entry.reference_type}
                              </span>
                            )}
                            {entry.is_auto && (
                              <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300">
                                Auto
                              </span>
                            )}
                          </div>
                          {!entry.is_auto && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-red-500 hover:text-red-700"
                              onClick={() => setDeleteTarget(entry)}
                            >
                              Eliminar
                            </Button>
                          )}
                        </div>
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="text-gray-500 text-xs">
                              <th className="text-left py-1">Cuenta</th>
                              <th className="text-right py-1 w-32">Debe</th>
                              <th className="text-right py-1 w-32">Haber</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(Array.isArray(entry.lines) ? entry.lines : []).map((line, i) => (
                              <tr key={i} className="border-t dark:border-gray-800">
                                <td className="py-1">
                                  <span className="text-gray-500 mr-2">{line.account_code}</span>
                                  {line.account_name}
                                </td>
                                <td className="py-1 text-right font-mono">
                                  {Number(line.debit) > 0 ? formatCurrency(Number(line.debit)) : ''}
                                </td>
                                <td className="py-1 text-right font-mono">
                                  {Number(line.credit) > 0 ? formatCurrency(Number(line.credit)) : ''}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ))}
                  </div>
                )}
                {entriesTotal > PAGE_SIZE && (
                  <div className="mt-4">
                    <Pagination
                      currentPage={entriesPage}
                      totalPages={Math.ceil(entriesTotal / PAGE_SIZE)}
                      totalItems={entriesTotal}
                      pageSize={PAGE_SIZE}
                      onPageChange={setEntriesPage}
                    />
                  </div>
                )}

                {/* Manual entry form */}
                {showManualEntry && (
                  <div className="mt-4 p-4 border rounded-lg dark:border-gray-700 space-y-3">
                    <h3 className="font-medium">Nuevo Asiento Manual</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <Input
                        type="date"
                        label="Fecha"
                        value={manualEntry.date}
                        onChange={e => setManualEntry({ ...manualEntry, date: e.target.value })}
                      />
                      <Input
                        label="Descripcion"
                        value={manualEntry.description}
                        onChange={e => setManualEntry({ ...manualEntry, description: e.target.value })}
                        placeholder="Descripcion del asiento"
                      />
                    </div>
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-gray-500 text-xs border-b dark:border-gray-700">
                          <th className="text-left py-1">Cuenta (codigo)</th>
                          <th className="text-right py-1 w-32">Debe</th>
                          <th className="text-right py-1 w-32">Haber</th>
                          <th className="text-left py-1">Detalle</th>
                          <th className="w-10"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {manualEntry.lines.map((line, i) => (
                          <tr key={i} className="border-b dark:border-gray-800">
                            <td className="py-1">
                              <select
                                className="w-full px-2 py-1 border rounded dark:bg-gray-800 dark:border-gray-700 text-sm"
                                value={line.accountCode}
                                onChange={e => updateManualLine(i, 'accountCode', e.target.value)}
                              >
                                <option value="">Seleccionar...</option>
                                {accounts.filter(a => !a.is_header).map(a => (
                                  <option key={a.id} value={a.code}>{a.code} - {a.name}</option>
                                ))}
                              </select>
                            </td>
                            <td className="py-1">
                              <input
                                type="number"
                                step="0.01"
                                className="w-full px-2 py-1 border rounded dark:bg-gray-800 dark:border-gray-700 text-right text-sm"
                                value={line.debit}
                                onChange={e => updateManualLine(i, 'debit', e.target.value)}
                                placeholder="0.00"
                              />
                            </td>
                            <td className="py-1">
                              <input
                                type="number"
                                step="0.01"
                                className="w-full px-2 py-1 border rounded dark:bg-gray-800 dark:border-gray-700 text-right text-sm"
                                value={line.credit}
                                onChange={e => updateManualLine(i, 'credit', e.target.value)}
                                placeholder="0.00"
                              />
                            </td>
                            <td className="py-1">
                              <input
                                className="w-full px-2 py-1 border rounded dark:bg-gray-800 dark:border-gray-700 text-sm"
                                value={line.description}
                                onChange={e => updateManualLine(i, 'description', e.target.value)}
                                placeholder="Detalle"
                              />
                            </td>
                            <td className="py-1 text-center">
                              {manualEntry.lines.length > 2 && (
                                <button
                                  className="text-red-500 hover:text-red-700 text-xs"
                                  onClick={() => removeManualLine(i)}
                                >
                                  X
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="font-medium border-t dark:border-gray-700">
                          <td className="py-2 text-right">Totales:</td>
                          <td className={`py-2 text-right font-mono ${!manualTotals.balanced ? 'text-red-500' : ''}`}>
                            {formatCurrency(manualTotals.debit)}
                          </td>
                          <td className={`py-2 text-right font-mono ${!manualTotals.balanced ? 'text-red-500' : ''}`}>
                            {formatCurrency(manualTotals.credit)}
                          </td>
                          <td colSpan={2}>
                            {!manualTotals.balanced && (
                              <span className="text-xs text-red-500">Desbalanceado</span>
                            )}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                    <div className="flex gap-2">
                      <Button variant="outline" onClick={addManualLine}>+ Linea</Button>
                      <Button onClick={handleCreateManualEntry} disabled={!manualTotals.balanced}>
                        Guardar Asiento
                      </Button>
                      <Button variant="outline" onClick={() => setShowManualEntry(false)}>Cancelar</Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Balance */}
          {activeTab === 'Balance' && (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <h2 className="text-lg font-semibold">Balance de Sumas y Saldos</h2>
                  <div className="flex gap-2 items-end flex-wrap">
                    <Input
                      type="date"
                      label="Desde"
                      value={balanceDateFrom}
                      onChange={e => setBalanceDateFrom(e.target.value)}
                    />
                    <Input
                      type="date"
                      label="Hasta"
                      value={balanceDateTo}
                      onChange={e => setBalanceDateTo(e.target.value)}
                    />
                    <Button variant="outline" onClick={loadData}>
                      Filtrar
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {balance.length === 0 ? (
                  <EmptyState
                    title="Sin datos"
                    description="No hay cuentas o movimientos en el periodo seleccionado."
                  />
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b dark:border-gray-700">
                          <th className="text-left py-2 px-3">Codigo</th>
                          <th className="text-left py-2 px-3">Cuenta</th>
                          <th className="text-right py-2 px-3">Debe</th>
                          <th className="text-right py-2 px-3">Haber</th>
                          <th className="text-right py-2 px-3">Saldo</th>
                        </tr>
                      </thead>
                      <tbody>
                        {balance.map(row => {
                          const hasMovements = Number(row.total_debit) > 0 || Number(row.total_credit) > 0
                          if (!row.is_header && !hasMovements) return null
                          return (
                            <tr
                              key={row.id}
                              className={`border-b dark:border-gray-800 ${row.is_header ? 'font-bold bg-gray-50 dark:bg-gray-900' : ''}`}
                            >
                              <td className="py-2 px-3" style={{ paddingLeft: `${(row.level - 1) * 24 + 12}px` }}>
                                {row.code}
                              </td>
                              <td className="py-2 px-3">{row.name}</td>
                              <td className="py-2 px-3 text-right font-mono">
                                {Number(row.total_debit) > 0 ? formatCurrency(Number(row.total_debit)) : '-'}
                              </td>
                              <td className="py-2 px-3 text-right font-mono">
                                {Number(row.total_credit) > 0 ? formatCurrency(Number(row.total_credit)) : '-'}
                              </td>
                              <td className={`py-2 px-3 text-right font-mono ${Number(row.balance) < 0 ? 'text-red-500' : ''}`}>
                                {formatCurrency(Math.abs(Number(row.balance)))}
                                {Number(row.balance) !== 0 && (
                                  <span className="text-xs ml-1 text-gray-500">
                                    {Number(row.balance) > 0 ? 'D' : 'H'}
                                  </span>
                                )}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                      <tfoot>
                        <tr className="font-bold border-t-2 dark:border-gray-600">
                          <td colSpan={2} className="py-2 px-3 text-right">TOTALES</td>
                          <td className="py-2 px-3 text-right font-mono">
                            {formatCurrency(balanceTotals.debit)}
                          </td>
                          <td className="py-2 px-3 text-right font-mono">
                            {formatCurrency(balanceTotals.credit)}
                          </td>
                          <td className="py-2 px-3 text-right font-mono">
                            {formatCurrency(Math.abs(balanceTotals.debit - balanceTotals.credit))}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* Delete confirmation */}
      <ConfirmDialog
        open={!!deleteTarget}
        title="Eliminar asiento"
        message={`Eliminar asiento #${deleteTarget?.entry_number}? Esta accion no se puede deshacer.`}
        confirmLabel="Eliminar"
        variant="danger"
        onConfirm={handleDeleteEntry}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}
