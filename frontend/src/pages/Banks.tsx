import React, { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { EmptyState } from '@/components/shared/EmptyState'
import { ExportCSVButton } from '@/components/shared/ExportCSV'
import { formatCurrency, formatDate } from '@/lib/utils'
import { api } from '@/services/api'

interface Bank {
  id: string
  bank_name: string
  account_holder: string | null
  account_number: string | null
  account_type: string | null
  cbu: string | null
  alias: string | null
  branch: string | null
  notes: string | null
  status: string
}

interface MethodBreakdown {
  income: number
  income_count: number
  expense: number
  expense_count: number
  bank_details: Record<string, { bank_name: string; income: number; expense: number }>
}

interface Movement {
  type: string
  payment_method: string
  bank_id: string | null
  bank_name: string | null
  amount: number
  date: string
  detail: string
  enterprise_name: string | null
}

const METHOD_LABELS: Record<string, { label: string; icon: string; color: string }> = {
  efectivo: { label: 'Efectivo', icon: '💵', color: 'bg-green-50 border-green-200' },
  mercado_pago: { label: 'Mercado Pago', icon: '📱', color: 'bg-sky-50 border-sky-200' },
  transferencia: { label: 'Transferencia', icon: '🏦', color: 'bg-blue-50 border-blue-200' },
  cheque: { label: 'Cheque', icon: '📝', color: 'bg-purple-50 border-purple-200' },
  tarjeta: { label: 'Tarjeta', icon: '💳', color: 'bg-indigo-50 border-indigo-200' },
  sin_especificar: { label: 'Sin Especificar', icon: '❓', color: 'bg-gray-50 border-gray-200' },
}

const MOVEMENT_COLORS: Record<string, string> = {
  venta: 'text-green-700 bg-green-50',
  cobro: 'text-green-700 bg-green-50',
  compra: 'text-red-700 bg-red-50',
  pago: 'text-red-700 bg-red-50',
}

const emptyForm = {
  bank_name: '', account_holder: '', account_number: '', account_type: 'cuenta corriente',
  cbu: '', alias: '', branch: '', notes: '',
}

export const Banks: React.FC = () => {
  const [banks, setBanks] = useState<Bank[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [breakdown, setBreakdown] = useState<{ methods: Record<string, MethodBreakdown>; recent_movements: Movement[] } | null>(null)
  const [expandedMethod, setExpandedMethod] = useState<string | null>(null)

  const loadData = async () => {
    try {
      setLoading(true)
      const [banksRes, breakdownRes] = await Promise.all([
        api.getBanks(),
        api.getBankBreakdown(),
      ])
      setBanks(banksRes || [])
      setBreakdown(breakdownRes || null)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadData() }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      if (editingId) {
        await api.updateBank(editingId, form)
      } else {
        await api.createBank(form)
      }
      setShowForm(false)
      setEditingId(null)
      setForm(emptyForm)
      await loadData()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const handleEdit = (bank: Bank) => {
    setForm({
      bank_name: bank.bank_name, account_holder: bank.account_holder || '',
      account_number: bank.account_number || '', account_type: bank.account_type || 'cuenta corriente',
      cbu: bank.cbu || '', alias: bank.alias || '', branch: bank.branch || '', notes: bank.notes || '',
    })
    setEditingId(bank.id)
    setShowForm(true)
  }

  const handleDelete = async (bank: Bank) => {
    if (!confirm(`¿Eliminar banco "${bank.bank_name}"?`)) return
    try {
      await api.deleteBank(bank.id)
      await loadData()
    } catch (e: any) {
      setError(e.message)
    }
  }

  const totalIncome = breakdown ? Object.values(breakdown.methods).reduce((s, m) => s + m.income, 0) : 0
  const totalExpense = breakdown ? Object.values(breakdown.methods).reduce((s, m) => s + m.expense, 0) : 0

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Bancos y Métodos de Pago</h1>
          <p className="text-sm text-gray-500 mt-1">{banks.length} cuenta{banks.length !== 1 ? 's' : ''} bancaria{banks.length !== 1 ? 's' : ''}</p>
        </div>
        <div className="flex items-center gap-2">
          {breakdown && breakdown.recent_movements.length > 0 && (
            <ExportCSVButton
              data={breakdown.recent_movements.map(m => ({
                tipo: m.type === 'venta' ? 'Venta' : m.type === 'cobro' ? 'Cobro' : m.type === 'compra' ? 'Compra' : 'Pago',
                fecha: m.date,
                detalle: m.detail,
                empresa: m.enterprise_name,
                metodo: m.payment_method,
                banco: m.bank_name,
                monto: m.amount,
              }))}
              columns={[
                { key: 'tipo', label: 'Tipo' },
                { key: 'fecha', label: 'Fecha' },
                { key: 'detalle', label: 'Detalle' },
                { key: 'empresa', label: 'Empresa' },
                { key: 'metodo', label: 'Método' },
                { key: 'banco', label: 'Banco' },
                { key: 'monto', label: 'Monto' },
              ]}
              filename="movimientos_bancos"
            />
          )}
          <Button variant={showForm ? 'danger' : 'primary'} onClick={() => { setForm(emptyForm); setEditingId(null); setShowForm(!showForm) }}>
            {showForm ? 'Cancelar' : '+ Nuevo Banco'}
          </Button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
          {error}<button onClick={() => setError(null)} className="ml-2 font-bold">×</button>
        </div>
      )}

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <Card className="border border-green-200 bg-green-50">
          <CardContent className="pt-3 pb-2">
            <p className="text-xs text-green-700">Total Ingresos</p>
            <p className="text-xl font-bold text-green-800">{formatCurrency(totalIncome)}</p>
          </CardContent>
        </Card>
        <Card className="border border-red-200 bg-red-50">
          <CardContent className="pt-3 pb-2">
            <p className="text-xs text-red-700">Total Egresos</p>
            <p className="text-xl font-bold text-red-800">{formatCurrency(totalExpense)}</p>
          </CardContent>
        </Card>
        <Card className={`border ${totalIncome - totalExpense >= 0 ? 'border-emerald-200 bg-emerald-50' : 'border-orange-200 bg-orange-50'}`}>
          <CardContent className="pt-3 pb-2">
            <p className={`text-xs ${totalIncome - totalExpense >= 0 ? 'text-emerald-700' : 'text-orange-700'}`}>Balance Neto</p>
            <p className={`text-xl font-bold ${totalIncome - totalExpense >= 0 ? 'text-emerald-800' : 'text-orange-800'}`}>
              {formatCurrency(totalIncome - totalExpense)}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Bank form */}
      {showForm && (
        <Card className="animate-fadeIn">
          <CardHeader><h3 className="text-lg font-semibold">{editingId ? 'Editar Banco' : 'Nuevo Banco'}</h3></CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <Input label="Nombre del Banco *" placeholder="Banco Nación, Galicia, etc." value={form.bank_name} onChange={e => setForm({ ...form, bank_name: e.target.value })} required />
              <Input label="Titular de la Cuenta" placeholder="Nombre del titular" value={form.account_holder} onChange={e => setForm({ ...form, account_holder: e.target.value })} />
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-gray-700">Tipo de Cuenta</label>
                <select className="px-3 py-2 border border-gray-300 rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-blue-500" value={form.account_type} onChange={e => setForm({ ...form, account_type: e.target.value })}>
                  <option value="cuenta corriente">Cuenta Corriente</option>
                  <option value="caja de ahorro">Caja de Ahorro</option>
                </select>
              </div>
              <Input label="N° de Cuenta" placeholder="000-12345678/9" value={form.account_number} onChange={e => setForm({ ...form, account_number: e.target.value })} />
              <Input label="CBU" placeholder="0000000000000000000000" value={form.cbu} onChange={e => setForm({ ...form, cbu: e.target.value })} />
              <Input label="Alias" placeholder="mi.alias.banco" value={form.alias} onChange={e => setForm({ ...form, alias: e.target.value })} />
              <Input label="Sucursal" placeholder="Centro, Microcentro, etc." value={form.branch} onChange={e => setForm({ ...form, branch: e.target.value })} />
              <div className="col-span-full">
                <label className="text-sm font-medium text-gray-700 block mb-1">Notas</label>
                <textarea
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
                  rows={2}
                  placeholder="Observaciones, datos adicionales..."
                  value={form.notes}
                  onChange={e => setForm({ ...form, notes: e.target.value })}
                />
              </div>
              <div className="flex items-end">
                <Button type="submit" variant="success" loading={saving} className="w-full">{editingId ? 'Guardar Cambios' : 'Crear Banco'}</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Bank Accounts List */}
      {banks.length > 0 && (
        <Card>
          <CardHeader><h3 className="text-base font-semibold text-gray-700">Cuentas Bancarias</h3></CardHeader>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50 text-left text-sm font-medium text-gray-500">
                  <th className="px-4 py-3">Banco</th>
                  <th className="px-4 py-3">Titular</th>
                  <th className="px-4 py-3">Tipo</th>
                  <th className="px-4 py-3">CBU / Alias</th>
                  <th className="px-4 py-3">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {banks.map(bank => (
                  <tr key={bank.id} className="border-b hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900">{bank.bank_name}</p>
                      {bank.branch && <p className="text-xs text-gray-500">{bank.branch}</p>}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">{bank.account_holder || '-'}</td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
                        {bank.account_type === 'caja de ahorro' ? 'Caja de Ahorro' : 'Cuenta Corriente'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {bank.cbu && <p className="font-mono text-xs text-gray-600">{bank.cbu}</p>}
                      {bank.alias && <p className="font-mono text-sm text-blue-600">{bank.alias}</p>}
                      {!bank.cbu && !bank.alias && <span className="text-gray-400">-</span>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        <button onClick={() => handleEdit(bank)} className="text-blue-600 hover:underline text-sm">Editar</button>
                        <button onClick={() => handleDelete(bank)} className="text-red-600 hover:underline text-sm">Eliminar</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Breakdown by Payment Method */}
      {breakdown && Object.keys(breakdown.methods).length > 0 && (
        <Card>
          <CardHeader><h3 className="text-base font-semibold text-gray-700">Desglose por Método de Pago</h3></CardHeader>
          <CardContent>
            <div className="space-y-2">
              {Object.entries(breakdown.methods)
                .sort(([, a], [, b]) => (b.income + b.expense) - (a.income + a.expense))
                .map(([method, data]) => {
                  const meta = METHOD_LABELS[method] || METHOD_LABELS.sin_especificar
                  const balance = data.income - data.expense
                  const isExpanded = expandedMethod === method
                  return (
                    <div key={method} className={`border rounded-lg overflow-hidden ${meta.color}`}>
                      <div
                        className="px-4 py-3 flex items-center justify-between cursor-pointer hover:opacity-90 transition-opacity"
                        onClick={() => setExpandedMethod(isExpanded ? null : method)}
                      >
                        <div className="flex items-center gap-3">
                          <span className="text-xl">{meta.icon}</span>
                          <div>
                            <p className="font-semibold text-gray-900">{meta.label}</p>
                            <p className="text-xs text-gray-500">{data.income_count + data.expense_count} operaciones</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-6">
                          <div className="text-right">
                            <p className="text-xs text-gray-500">Ingresos</p>
                            <p className="font-bold text-green-700">{formatCurrency(data.income)}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-xs text-gray-500">Egresos</p>
                            <p className="font-bold text-red-700">{formatCurrency(data.expense)}</p>
                          </div>
                          <div className="text-right min-w-[100px]">
                            <p className="text-xs text-gray-500">Balance</p>
                            <p className={`font-bold ${balance >= 0 ? 'text-emerald-700' : 'text-orange-700'}`}>
                              {formatCurrency(balance)}
                            </p>
                          </div>
                          <span className="text-gray-400 text-xs">{isExpanded ? '▲' : '▼'}</span>
                        </div>
                      </div>
                      {isExpanded && Object.keys(data.bank_details).length > 0 && (
                        <div className="border-t px-4 py-3 bg-white/60 animate-slideDown">
                          <p className="text-xs font-medium text-gray-500 mb-2">Desglose por Banco</p>
                          <div className="space-y-1">
                            {Object.entries(data.bank_details).map(([bankId, bankData]) => (
                              <div key={bankId} className="flex items-center justify-between px-3 py-2 bg-white rounded border border-gray-100">
                                <span className="text-sm font-medium text-gray-800">{bankData.bank_name}</span>
                                <div className="flex gap-4">
                                  <span className="text-sm text-green-700">+{formatCurrency(bankData.income)}</span>
                                  <span className="text-sm text-red-700">-{formatCurrency(bankData.expense)}</span>
                                  <span className={`text-sm font-bold ${bankData.income - bankData.expense >= 0 ? 'text-emerald-700' : 'text-orange-700'}`}>
                                    = {formatCurrency(bankData.income - bankData.expense)}
                                  </span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })
              }
            </div>
          </CardContent>
        </Card>
      )}

      {/* Recent Movements */}
      {breakdown && breakdown.recent_movements.length > 0 && (
        <Card>
          <CardHeader><h3 className="text-base font-semibold text-gray-700">Últimos Movimientos</h3></CardHeader>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50 text-left text-sm font-medium text-gray-500">
                  <th className="px-4 py-2">Tipo</th>
                  <th className="px-4 py-2">Fecha</th>
                  <th className="px-4 py-2">Detalle</th>
                  <th className="px-4 py-2">Empresa</th>
                  <th className="px-4 py-2">Método</th>
                  <th className="px-4 py-2">Banco</th>
                  <th className="px-4 py-2 text-right">Monto</th>
                </tr>
              </thead>
              <tbody>
                {breakdown.recent_movements.map((mov, idx) => {
                  const isIncome = mov.type === 'venta' || mov.type === 'cobro'
                  return (
                    <tr key={idx} className="border-b hover:bg-gray-50 text-sm">
                      <td className="px-4 py-2">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${MOVEMENT_COLORS[mov.type] || 'bg-gray-100 text-gray-700'}`}>
                          {mov.type === 'venta' ? 'Venta' : mov.type === 'cobro' ? 'Cobro' : mov.type === 'compra' ? 'Compra' : 'Pago'}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-gray-600">{formatDate(mov.date)}</td>
                      <td className="px-4 py-2 text-gray-800 truncate max-w-[200px]">{mov.detail || '-'}</td>
                      <td className="px-4 py-2 text-gray-600">{mov.enterprise_name || '-'}</td>
                      <td className="px-4 py-2">
                        <span className="text-xs">{METHOD_LABELS[mov.payment_method]?.label || mov.payment_method || '-'}</span>
                      </td>
                      <td className="px-4 py-2 text-gray-600 text-xs">{mov.bank_name || '-'}</td>
                      <td className={`px-4 py-2 text-right font-bold ${isIncome ? 'text-green-700' : 'text-red-700'}`}>
                        {isIncome ? '+' : '-'}{formatCurrency(parseFloat(String(mov.amount || '0')))}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  )
}
