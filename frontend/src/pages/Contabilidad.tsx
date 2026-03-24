import React, { useState, useEffect, useMemo, useCallback } from 'react'
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

interface LedgerRow {
  date: string
  description: string
  debit: string | number
  credit: string | number
  balance: string | number
  entry_number: number
}

interface BalanceSheetSection {
  accounts: Array<{ code: string; name: string; balance: number }>
  total: number
}

interface BalanceSheetData {
  activo: BalanceSheetSection
  pasivo: BalanceSheetSection
  patrimonio: BalanceSheetSection
  date: string
}

interface IncomeStatementData {
  ingresos: Array<{ code: string; name: string; amount: number }>
  egresos: Array<{ code: string; name: string; amount: number }>
  total_ingresos: number
  total_egresos: number
  resultado_neto: number
  date_from: string
  date_to: string
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

const TABS = [
  'Plan de Cuentas',
  'Libro Diario',
  'Libro Mayor',
  'Balance',
  'Balance General',
  'Estado de Resultados',
] as const
type Tab = typeof TABS[number]

// --- Opening Entry Modal ---
const OpeningEntryModal: React.FC<{
  accounts: Account[]
  open: boolean
  onClose: () => void
  onSaved: () => void
}> = ({ accounts, open, onClose, onSaved }) => {
  const [date, setDate] = useState(new Date().toISOString().split('T')[0])
  const [lines, setLines] = useState<Array<{ accountCode: string; debit: string; credit: string }>>([
    { accountCode: '', debit: '', credit: '' },
    { accountCode: '', debit: '', credit: '' },
  ])
  const [saving, setSaving] = useState(false)

  const totals = useMemo(() => {
    const d = lines.reduce((s, l) => s + (Number(l.debit) || 0), 0)
    const c = lines.reduce((s, l) => s + (Number(l.credit) || 0), 0)
    return { debit: d, credit: c, balanced: Math.abs(d - c) < 0.01 }
  }, [lines])

  const addLine = () => setLines([...lines, { accountCode: '', debit: '', credit: '' }])

  const updateLine = (idx: number, field: string, value: string) => {
    setLines(lines.map((l, i) => (i === idx ? { ...l, [field]: value } : l)))
  }

  const removeLine = (idx: number) => {
    if (lines.length <= 2) return
    setLines(lines.filter((_, i) => i !== idx))
  }

  const handleSubmit = async () => {
    const balances = lines
      .filter(l => l.accountCode && (Number(l.debit) > 0 || Number(l.credit) > 0))
      .map(l => ({
        account_code: l.accountCode,
        debit: Number(l.debit) || 0,
        credit: Number(l.credit) || 0,
      }))
    if (balances.length < 1) {
      toast.error('Agregue al menos una linea con monto')
      return
    }
    setSaving(true)
    try {
      await api.createOpeningEntry(date, balances)
      toast.success('Asiento de apertura creado')
      onSaved()
      onClose()
    } catch (e: any) {
      toast.error(e?.response?.data?.error || e.message)
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null

  const leafAccounts = accounts.filter(a => !a.is_header)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white dark:bg-gray-900 rounded-lg shadow-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto p-6">
        <h2 className="text-lg font-bold mb-4">Asiento de Apertura</h2>
        <div className="mb-4">
          <Input
            type="date"
            label="Fecha"
            value={date}
            onChange={e => setDate(e.target.value)}
          />
        </div>
        <table className="w-full text-sm mb-4">
          <thead>
            <tr className="text-gray-500 text-xs border-b dark:border-gray-700">
              <th className="text-left py-1">Cuenta</th>
              <th className="text-right py-1 w-32">Debe</th>
              <th className="text-right py-1 w-32">Haber</th>
              <th className="w-10"></th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line, i) => (
              <tr key={i} className="border-b dark:border-gray-800">
                <td className="py-1">
                  <select
                    className="w-full px-2 py-1 border rounded dark:bg-gray-800 dark:border-gray-700 text-sm"
                    value={line.accountCode}
                    onChange={e => updateLine(i, 'accountCode', e.target.value)}
                  >
                    <option value="">Seleccionar...</option>
                    {leafAccounts.map(a => (
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
                    onChange={e => updateLine(i, 'debit', e.target.value)}
                    placeholder="0.00"
                  />
                </td>
                <td className="py-1">
                  <input
                    type="number"
                    step="0.01"
                    className="w-full px-2 py-1 border rounded dark:bg-gray-800 dark:border-gray-700 text-right text-sm"
                    value={line.credit}
                    onChange={e => updateLine(i, 'credit', e.target.value)}
                    placeholder="0.00"
                  />
                </td>
                <td className="py-1 text-center">
                  {lines.length > 2 && (
                    <button
                      className="text-red-500 hover:text-red-700 text-xs"
                      onClick={() => removeLine(i)}
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
              <td className={`py-2 text-right font-mono ${!totals.balanced ? 'text-red-500' : ''}`}>
                {formatCurrency(totals.debit)}
              </td>
              <td className={`py-2 text-right font-mono ${!totals.balanced ? 'text-red-500' : ''}`}>
                {formatCurrency(totals.credit)}
              </td>
              <td>
                {!totals.balanced && (
                  <span className="text-xs text-red-500">Desbalanceado</span>
                )}
              </td>
            </tr>
          </tfoot>
        </table>
        <div className="flex gap-2">
          <Button variant="outline" onClick={addLine}>+ Linea</Button>
          <Button onClick={handleSubmit} disabled={!totals.balanced || saving}>
            {saving ? 'Guardando...' : 'Guardar Asiento de Apertura'}
          </Button>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
        </div>
      </div>
    </div>
  )
}

// --- Activation Card ---
const ActivationCard: React.FC<{ onActivated: () => void }> = ({ onActivated }) => {
  const [activating, setActivating] = useState(false)

  const handleActivate = async () => {
    setActivating(true)
    try {
      await api.enableAccounting()
      toast.success('Contabilidad activada. Se cargo el plan de cuentas base.')
      onActivated()
    } catch (e: any) {
      toast.error(e?.response?.data?.error || e.message)
    } finally {
      setActivating(false)
    }
  }

  return (
    <div className="flex items-center justify-center min-h-[400px]">
      <Card className="max-w-lg w-full">
        <CardContent className="text-center py-12 space-y-4">
          <h2 className="text-xl font-bold">Modulo de Contabilidad</h2>
          <p className="text-gray-600 dark:text-gray-400">
            El modulo de contabilidad permite llevar el libro diario, libro mayor,
            balance general y estado de resultados de forma integrada con facturacion,
            cobros y pagos.
          </p>
          <p className="text-sm text-gray-500 dark:text-gray-500">
            Al activar se cargara el plan de cuentas base argentino. Podra personalizarlo luego.
          </p>
          <Button onClick={handleActivate} disabled={activating} className="mt-4">
            {activating ? 'Activando...' : 'Activar Contabilidad'}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}

export const Contabilidad: React.FC = () => {
  const [activeTab, setActiveTab] = useState<Tab>('Plan de Cuentas')
  const [loading, setLoading] = useState(true)
  const [accountingEnabled, setAccountingEnabled] = useState<boolean | null>(null)

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

  // Ledger state
  const [ledgerAccount, setLedgerAccount] = useState('')
  const [ledgerDateFrom, setLedgerDateFrom] = useState('')
  const [ledgerDateTo, setLedgerDateTo] = useState('')
  const [ledgerRows, setLedgerRows] = useState<LedgerRow[]>([])

  // Balance Sheet state
  const [balanceSheetDate, setBalanceSheetDate] = useState('')
  const [balanceSheetData, setBalanceSheetData] = useState<BalanceSheetData | null>(null)

  // Income Statement state
  const [incomeDateFrom, setIncomeDateFrom] = useState('')
  const [incomeDateTo, setIncomeDateTo] = useState('')
  const [incomeData, setIncomeData] = useState<IncomeStatementData | null>(null)

  // Opening entry modal
  const [showOpeningEntry, setShowOpeningEntry] = useState(false)

  const PAGE_SIZE = 20

  // Check accounting_enabled on mount
  useEffect(() => {
    checkAccountingEnabled()
  }, [])

  const checkAccountingEnabled = async () => {
    try {
      const data = await api.getChartOfAccounts()
      // If we get accounts back, accounting is enabled
      setAccountingEnabled(data.length > 0)
      setAccounts(data)
      setLoading(false)
    } catch {
      // If it fails, assume not enabled yet
      setAccountingEnabled(false)
      setLoading(false)
    }
  }

  // Load data based on active tab
  useEffect(() => {
    if (accountingEnabled) {
      loadData()
    }
  }, [activeTab, entriesPage, accountingEnabled])

  const loadData = async () => {
    setLoading(true)
    try {
      if (activeTab === 'Plan de Cuentas') {
        const data = await api.getChartOfAccounts()
        setAccounts(data)
      } else if (activeTab === 'Libro Diario') {
        // Also load accounts for manual entry form
        if (accounts.length === 0) {
          const accs = await api.getChartOfAccounts()
          setAccounts(accs)
        }
        const data = await api.getAccountingEntries({
          date_from: dateFrom,
          date_to: dateTo,
          limit: PAGE_SIZE,
          offset: (entriesPage - 1) * PAGE_SIZE,
        })
        setEntries(data.entries)
        setEntriesTotal(data.total)
      } else if (activeTab === 'Libro Mayor') {
        if (accounts.length === 0) {
          const accs = await api.getChartOfAccounts()
          setAccounts(accs)
        }
        if (ledgerAccount) {
          const data = await api.getAccountingLedger(ledgerAccount, ledgerDateFrom || undefined, ledgerDateTo || undefined)
          setLedgerRows(data)
        }
      } else if (activeTab === 'Balance') {
        const data = await api.getAccountingBalance({
          date_from: balanceDateFrom,
          date_to: balanceDateTo,
        })
        setBalance(data)
      } else if (activeTab === 'Balance General') {
        const data = await api.getBalanceSheet(balanceSheetDate || undefined)
        setBalanceSheetData(data)
      } else if (activeTab === 'Estado de Resultados') {
        const data = await api.getIncomeStatement(incomeDateFrom || undefined, incomeDateTo || undefined)
        setIncomeData(data)
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

  // Ledger totals
  const ledgerTotals = useMemo(() => {
    const debit = ledgerRows.reduce((s, r) => s + Number(r.debit), 0)
    const credit = ledgerRows.reduce((s, r) => s + Number(r.credit), 0)
    return { debit, credit }
  }, [ledgerRows])

  const handleLoadLedger = useCallback(() => {
    if (!ledgerAccount) {
      toast.error('Seleccione una cuenta')
      return
    }
    loadData()
  }, [ledgerAccount, ledgerDateFrom, ledgerDateTo])

  const handleActivated = () => {
    setAccountingEnabled(true)
    loadData()
  }

  // Show activation card if not enabled
  if (accountingEnabled === false) {
    return <ActivationCard onActivated={handleActivated} />
  }

  // Initial loading
  if (accountingEnabled === null) {
    return <SkeletonTable rows={8} cols={5} />
  }

  const leafAccounts = accounts.filter(a => !a.is_header)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Contabilidad</h1>
        <Button variant="outline" onClick={() => setShowOpeningEntry(true)}>
          Asiento de Apertura
        </Button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200 dark:border-gray-700 overflow-x-auto">
        {TABS.map(tab => (
          <button
            key={tab}
            onClick={() => { setActiveTab(tab); setLoading(true) }}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
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
                                {leafAccounts.map(a => (
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

          {/* Libro Mayor */}
          {activeTab === 'Libro Mayor' && (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <h2 className="text-lg font-semibold">Libro Mayor</h2>
                  <div className="flex gap-2 items-end flex-wrap">
                    <div>
                      <label className="block text-sm font-medium mb-1">Cuenta</label>
                      <select
                        className="px-3 py-2 border rounded-lg dark:bg-gray-800 dark:border-gray-700 text-sm min-w-[250px]"
                        value={ledgerAccount}
                        onChange={e => setLedgerAccount(e.target.value)}
                      >
                        <option value="">Seleccionar cuenta...</option>
                        {leafAccounts.map(a => (
                          <option key={a.id} value={a.code}>{a.code} - {a.name}</option>
                        ))}
                      </select>
                    </div>
                    <Input
                      type="date"
                      label="Desde"
                      value={ledgerDateFrom}
                      onChange={e => setLedgerDateFrom(e.target.value)}
                    />
                    <Input
                      type="date"
                      label="Hasta"
                      value={ledgerDateTo}
                      onChange={e => setLedgerDateTo(e.target.value)}
                    />
                    <Button variant="outline" onClick={handleLoadLedger}>
                      Consultar
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {!ledgerAccount ? (
                  <EmptyState
                    title="Seleccione una cuenta"
                    description="Elija una cuenta del selector para ver su libro mayor."
                  />
                ) : ledgerRows.length === 0 ? (
                  <EmptyState
                    title="Sin movimientos"
                    description="La cuenta seleccionada no tiene movimientos en el periodo."
                  />
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b dark:border-gray-700">
                          <th className="text-left py-2 px-3">Fecha</th>
                          <th className="text-left py-2 px-3">Descripcion</th>
                          <th className="text-right py-2 px-3">Debe</th>
                          <th className="text-right py-2 px-3">Haber</th>
                          <th className="text-right py-2 px-3">Saldo</th>
                        </tr>
                      </thead>
                      <tbody>
                        {ledgerRows.map((row, i) => {
                          const bal = Number(row.balance)
                          return (
                            <tr key={i} className="border-b dark:border-gray-800">
                              <td className="py-2 px-3">{formatDate(row.date)}</td>
                              <td className="py-2 px-3">
                                <span className="text-gray-500 mr-2">#{row.entry_number}</span>
                                {row.description}
                              </td>
                              <td className="py-2 px-3 text-right font-mono">
                                {Number(row.debit) > 0 ? formatCurrency(Number(row.debit)) : '-'}
                              </td>
                              <td className="py-2 px-3 text-right font-mono">
                                {Number(row.credit) > 0 ? formatCurrency(Number(row.credit)) : '-'}
                              </td>
                              <td className={`py-2 px-3 text-right font-mono font-medium ${
                                bal > 0 ? 'text-green-600 dark:text-green-400' : bal < 0 ? 'text-red-500 dark:text-red-400' : ''
                              }`}>
                                {formatCurrency(Math.abs(bal))}
                                {bal !== 0 && (
                                  <span className="text-xs ml-1 text-gray-500">
                                    {bal > 0 ? 'D' : 'H'}
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
                            {formatCurrency(ledgerTotals.debit)}
                          </td>
                          <td className="py-2 px-3 text-right font-mono">
                            {formatCurrency(ledgerTotals.credit)}
                          </td>
                          <td className={`py-2 px-3 text-right font-mono font-medium ${
                            ledgerTotals.debit - ledgerTotals.credit > 0
                              ? 'text-green-600 dark:text-green-400'
                              : ledgerTotals.debit - ledgerTotals.credit < 0
                                ? 'text-red-500 dark:text-red-400'
                                : ''
                          }`}>
                            {formatCurrency(Math.abs(ledgerTotals.debit - ledgerTotals.credit))}
                            {ledgerTotals.debit !== ledgerTotals.credit && (
                              <span className="text-xs ml-1 text-gray-500">
                                {ledgerTotals.debit > ledgerTotals.credit ? 'D' : 'H'}
                              </span>
                            )}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Balance de Sumas y Saldos */}
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

          {/* Balance General */}
          {activeTab === 'Balance General' && (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <h2 className="text-lg font-semibold">Balance General</h2>
                  <div className="flex gap-2 items-end flex-wrap">
                    <Input
                      type="date"
                      label="Al dia"
                      value={balanceSheetDate}
                      onChange={e => setBalanceSheetDate(e.target.value)}
                    />
                    <Button variant="outline" onClick={loadData}>
                      Consultar
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {!balanceSheetData ? (
                  <EmptyState
                    title="Sin datos"
                    description="No hay movimientos contables registrados."
                  />
                ) : (
                  <>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      {/* ACTIVO */}
                      <div className="border rounded-lg dark:border-gray-700 p-4">
                        <h3 className="text-base font-bold text-green-700 dark:text-green-400 mb-3 border-b pb-2 dark:border-gray-700">
                          ACTIVO
                        </h3>
                        <div className="space-y-1">
                          {balanceSheetData.activo.accounts.map((acc, i) => (
                            <div key={i} className="flex justify-between text-sm">
                              <span className="text-gray-600 dark:text-gray-400">{acc.code} {acc.name}</span>
                              <span className="font-mono">{formatCurrency(acc.balance)}</span>
                            </div>
                          ))}
                        </div>
                        <div className="mt-3 pt-2 border-t dark:border-gray-700 flex justify-between font-bold">
                          <span>Total Activo</span>
                          <span className="font-mono text-green-700 dark:text-green-400">
                            {formatCurrency(balanceSheetData.activo.total)}
                          </span>
                        </div>
                      </div>

                      {/* PASIVO */}
                      <div className="border rounded-lg dark:border-gray-700 p-4">
                        <h3 className="text-base font-bold text-red-700 dark:text-red-400 mb-3 border-b pb-2 dark:border-gray-700">
                          PASIVO
                        </h3>
                        <div className="space-y-1">
                          {balanceSheetData.pasivo.accounts.map((acc, i) => (
                            <div key={i} className="flex justify-between text-sm">
                              <span className="text-gray-600 dark:text-gray-400">{acc.code} {acc.name}</span>
                              <span className="font-mono">{formatCurrency(acc.balance)}</span>
                            </div>
                          ))}
                        </div>
                        <div className="mt-3 pt-2 border-t dark:border-gray-700 flex justify-between font-bold">
                          <span>Total Pasivo</span>
                          <span className="font-mono text-red-700 dark:text-red-400">
                            {formatCurrency(balanceSheetData.pasivo.total)}
                          </span>
                        </div>
                      </div>

                      {/* PATRIMONIO NETO */}
                      <div className="border rounded-lg dark:border-gray-700 p-4">
                        <h3 className="text-base font-bold text-blue-700 dark:text-blue-400 mb-3 border-b pb-2 dark:border-gray-700">
                          PATRIMONIO NETO
                        </h3>
                        <div className="space-y-1">
                          {balanceSheetData.patrimonio.accounts.map((acc, i) => (
                            <div key={i} className="flex justify-between text-sm">
                              <span className="text-gray-600 dark:text-gray-400">{acc.code} {acc.name}</span>
                              <span className="font-mono">{formatCurrency(acc.balance)}</span>
                            </div>
                          ))}
                        </div>
                        <div className="mt-3 pt-2 border-t dark:border-gray-700 flex justify-between font-bold">
                          <span>Total PN</span>
                          <span className="font-mono text-blue-700 dark:text-blue-400">
                            {formatCurrency(balanceSheetData.patrimonio.total)}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Validation */}
                    {(() => {
                      const totalActivo = balanceSheetData.activo.total
                      const totalPasivoPN = balanceSheetData.pasivo.total + balanceSheetData.patrimonio.total
                      const balanced = Math.abs(totalActivo - totalPasivoPN) < 0.01
                      return (
                        <div className={`mt-4 p-3 rounded-lg text-center font-bold ${
                          balanced
                            ? 'bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-800'
                            : 'bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800'
                        }`}>
                          <div className="flex justify-center gap-8">
                            <span>Activo: {formatCurrency(totalActivo)}</span>
                            <span>=</span>
                            <span>Pasivo + PN: {formatCurrency(totalPasivoPN)}</span>
                          </div>
                          {!balanced && (
                            <div className="text-sm mt-1">
                              Diferencia: {formatCurrency(Math.abs(totalActivo - totalPasivoPN))}
                            </div>
                          )}
                        </div>
                      )
                    })()}
                  </>
                )}
              </CardContent>
            </Card>
          )}

          {/* Estado de Resultados */}
          {activeTab === 'Estado de Resultados' && (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <h2 className="text-lg font-semibold">Estado de Resultados</h2>
                  <div className="flex gap-2 items-end flex-wrap">
                    <Input
                      type="date"
                      label="Desde"
                      value={incomeDateFrom}
                      onChange={e => setIncomeDateFrom(e.target.value)}
                    />
                    <Input
                      type="date"
                      label="Hasta"
                      value={incomeDateTo}
                      onChange={e => setIncomeDateTo(e.target.value)}
                    />
                    <Button variant="outline" onClick={loadData}>
                      Consultar
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {!incomeData ? (
                  <EmptyState
                    title="Sin datos"
                    description="No hay movimientos de resultados en el periodo."
                  />
                ) : (
                  <div className="space-y-6">
                    {/* INGRESOS */}
                    <div>
                      <h3 className="text-base font-bold text-green-700 dark:text-green-400 mb-2 border-b pb-2 dark:border-gray-700">
                        INGRESOS
                      </h3>
                      <div className="space-y-1">
                        {incomeData.ingresos.map((acc, i) => (
                          <div key={i} className="flex justify-between text-sm py-1">
                            <span className="text-gray-600 dark:text-gray-400">{acc.code} {acc.name}</span>
                            <span className="font-mono text-green-600 dark:text-green-400">
                              {formatCurrency(acc.amount)}
                            </span>
                          </div>
                        ))}
                      </div>
                      <div className="mt-2 pt-2 border-t dark:border-gray-700 flex justify-between font-bold">
                        <span>Total Ingresos</span>
                        <span className="font-mono text-green-700 dark:text-green-400">
                          {formatCurrency(incomeData.total_ingresos)}
                        </span>
                      </div>
                    </div>

                    {/* EGRESOS */}
                    <div>
                      <h3 className="text-base font-bold text-red-700 dark:text-red-400 mb-2 border-b pb-2 dark:border-gray-700">
                        EGRESOS
                      </h3>
                      <div className="space-y-1">
                        {incomeData.egresos.map((acc, i) => (
                          <div key={i} className="flex justify-between text-sm py-1">
                            <span className="text-gray-600 dark:text-gray-400">{acc.code} {acc.name}</span>
                            <span className="font-mono text-red-600 dark:text-red-400">
                              {formatCurrency(acc.amount)}
                            </span>
                          </div>
                        ))}
                      </div>
                      <div className="mt-2 pt-2 border-t dark:border-gray-700 flex justify-between font-bold">
                        <span>Total Egresos</span>
                        <span className="font-mono text-red-700 dark:text-red-400">
                          {formatCurrency(incomeData.total_egresos)}
                        </span>
                      </div>
                    </div>

                    {/* RESULTADO NETO */}
                    {(() => {
                      const neto = incomeData.resultado_neto
                      const positive = neto >= 0
                      return (
                        <div className={`p-4 rounded-lg text-center ${
                          positive
                            ? 'bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-800'
                            : 'bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800'
                        }`}>
                          <div className="text-sm text-gray-500 dark:text-gray-400 mb-1">Resultado Neto</div>
                          <div className={`text-2xl font-bold font-mono ${
                            positive
                              ? 'text-green-700 dark:text-green-400'
                              : 'text-red-700 dark:text-red-400'
                          }`}>
                            {neto < 0 && '-'}{formatCurrency(Math.abs(neto))}
                          </div>
                          <div className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                            {positive ? 'Ganancia' : 'Perdida'}
                          </div>
                        </div>
                      )
                    })()}
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

      {/* Opening Entry Modal */}
      <OpeningEntryModal
        accounts={accounts}
        open={showOpeningEntry}
        onClose={() => setShowOpeningEntry(false)}
        onSaved={loadData}
      />
    </div>
  )
}
