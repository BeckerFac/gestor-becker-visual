import React, { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { SkeletonTable } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/shared/EmptyState'
import { toast } from '@/hooks/useToast'
import { api } from '@/services/api'
import { formatCurrency, formatDate } from '@/lib/utils'
import { StatusBadge } from '@/components/ui/StatusBadge'

// Types
interface BankStatement {
  id: string
  bank_name: string | null
  bank_id: string | null
  period: string | null
  file_name: string
  total_lines: number
  matched_lines: number
  uploaded_at: string
}

interface MatchedRecord {
  id: string
  amount: string
  payment_method: string
  payment_date: string
  reference: string | null
  enterprise_name: string | null
}

interface StatementLine {
  id: string
  line_date: string
  description: string
  amount: string
  reference: string | null
  matched_type: 'cobro' | 'pago' | null
  matched_id: string | null
  match_confidence: string | null
  status: string
  matched_record: MatchedRecord | null
}

interface StatementDetail extends BankStatement {
  lines: StatementLine[]
}

interface Cobro {
  id: string
  amount: string
  payment_method: string
  payment_date: string
  reference: string | null
  enterprise_name: string | null
}

interface Pago {
  id: string
  amount: string
  payment_method: string
  payment_date: string
  reference: string | null
  enterprise_name: string | null
}

interface Bank {
  id: string
  bank_name: string
}

// Status config for StatusBadge
const LINE_STATUS_LABELS: Record<string, string> = {
  pending: 'Pendiente',
  matched: 'Conciliado',
}

const LINE_STATUS_COLORS: Record<string, string> = {
  pending: 'warning',
  matched: 'success',
}

export function Conciliacion() {
  const [statements, setStatements] = useState<BankStatement[]>([])
  const [selectedStatement, setSelectedStatement] = useState<StatementDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [matchingLineId, setMatchingLineId] = useState<string | null>(null)
  const [cobros, setCobros] = useState<Cobro[]>([])
  const [pagos, setPagos] = useState<Pago[]>([])
  const [banks, setBanks] = useState<Bank[]>([])
  const [autoMatching, setAutoMatching] = useState(false)

  // Upload form state
  const [showUpload, setShowUpload] = useState(false)
  const [uploadBankId, setUploadBankId] = useState('')
  const [uploadBankType, setUploadBankType] = useState('')
  const [uploadPeriod, setUploadPeriod] = useState('')

  const loadStatements = useCallback(async () => {
    try {
      setLoading(true)
      const data = await api.getBankStatements()
      setStatements(data)
    } catch {
      toast.error('Error al cargar extractos')
    } finally {
      setLoading(false)
    }
  }, [])

  const loadBanks = useCallback(async () => {
    try {
      const data = await api.getBanks()
      setBanks(Array.isArray(data) ? data : data.banks || [])
    } catch {
      // Banks not critical
    }
  }, [])

  useEffect(() => {
    loadStatements()
    loadBanks()
  }, [loadStatements, loadBanks])

  const loadStatement = useCallback(async (id: string) => {
    try {
      const data = await api.getBankStatement(id)
      setSelectedStatement(data)
    } catch {
      toast.error('Error al cargar detalle')
    }
  }, [])

  const loadMatchCandidates = useCallback(async () => {
    try {
      const [cobrosData, pagosData] = await Promise.all([
        api.getCobros(),
        api.getPagos(),
      ])
      setCobros(Array.isArray(cobrosData) ? cobrosData : [])
      setPagos(Array.isArray(pagosData) ? pagosData : [])
    } catch {
      // Non-critical
    }
  }, [])

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    try {
      setUploading(true)
      const csvContent = await file.text()
      const result = await api.uploadBankStatement({
        csvContent,
        bankId: uploadBankId || undefined,
        bankType: uploadBankType || undefined,
        fileName: file.name,
        period: uploadPeriod || undefined,
      })
      toast.success(`Extracto cargado: ${result.autoMatchResult?.matched || 0} de ${result.total_lines} lineas conciliadas`)
      setShowUpload(false)
      setUploadBankId('')
      setUploadBankType('')
      setUploadPeriod('')
      await loadStatements()
      setSelectedStatement(result)
    } catch (err: any) {
      toast.error(err?.message || 'Error al subir archivo')
    } finally {
      setUploading(false)
      // Reset file input
      e.target.value = ''
    }
  }

  const handleAutoMatch = async () => {
    if (!selectedStatement) return
    try {
      setAutoMatching(true)
      const result = await api.autoMatchStatement(selectedStatement.id)
      toast.success(`Auto-match: ${result.matched} nuevas conciliaciones`)
      await loadStatement(selectedStatement.id)
    } catch {
      toast.error('Error en auto-match')
    } finally {
      setAutoMatching(false)
    }
  }

  const handleManualMatch = async (lineId: string, type: 'cobro' | 'pago', matchId: string) => {
    try {
      await api.manualMatch(lineId, type, matchId)
      toast.success('Conciliacion manual realizada')
      if (selectedStatement) await loadStatement(selectedStatement.id)
      setMatchingLineId(null)
    } catch {
      toast.error('Error al conciliar')
    }
  }

  const handleUnmatch = async (lineId: string) => {
    try {
      await api.unmatchLine(lineId)
      toast.success('Conciliacion deshecha')
      if (selectedStatement) await loadStatement(selectedStatement.id)
    } catch {
      toast.error('Error al deshacer conciliacion')
    }
  }

  const startManualMatch = (lineId: string) => {
    setMatchingLineId(lineId)
    loadMatchCandidates()
  }

  // Summary calculations
  const summary = selectedStatement ? {
    total: selectedStatement.lines.length,
    matched: selectedStatement.lines.filter(l => l.status === 'matched').length,
    pending: selectedStatement.lines.filter(l => l.status === 'pending').length,
    percentage: selectedStatement.lines.length > 0
      ? Math.round((selectedStatement.lines.filter(l => l.status === 'matched').length / selectedStatement.lines.length) * 100)
      : 0,
  } : null

  if (loading) return <div className="mx-auto max-w-7xl px-4 py-8"><SkeletonTable /></div>

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Conciliacion Bancaria</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Subi extractos bancarios y concilia automaticamente con cobros y pagos
          </p>
        </div>
        <Button onClick={() => setShowUpload(!showUpload)}>
          Subir Extracto
        </Button>
      </div>

      {/* Upload form */}
      {showUpload && (
        <Card>
          <CardHeader>
            <h3 className="text-lg font-semibold">Subir Extracto CSV</h3>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Banco</label>
                <select
                  className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm"
                  value={uploadBankId}
                  onChange={e => setUploadBankId(e.target.value)}
                >
                  <option value="">Seleccionar banco...</option>
                  {banks.map(b => (
                    <option key={b.id} value={b.id}>{b.bank_name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Formato</label>
                <select
                  className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm"
                  value={uploadBankType}
                  onChange={e => setUploadBankType(e.target.value)}
                >
                  <option value="">Auto-detectar</option>
                  <option value="galicia">Galicia</option>
                  <option value="macro">Macro</option>
                  <option value="santander">Santander</option>
                  <option value="bbva">BBVA</option>
                  <option value="generic">Generico</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Periodo</label>
                <input
                  type="month"
                  className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm"
                  value={uploadPeriod}
                  onChange={e => setUploadPeriod(e.target.value)}
                />
              </div>
              <div className="flex items-end">
                <label className="w-full">
                  <span className="sr-only">Seleccionar archivo CSV</span>
                  <input
                    type="file"
                    accept=".csv,.txt"
                    onChange={handleFileUpload}
                    disabled={uploading}
                    className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 dark:file:bg-blue-900 dark:file:text-blue-300"
                  />
                </label>
              </div>
            </div>
            {uploading && <p className="text-sm text-blue-600">Procesando archivo...</p>}
          </CardContent>
        </Card>
      )}

      {/* Statement detail view */}
      {selectedStatement ? (
        <>
          {/* Back + summary */}
          <div className="flex items-center justify-between">
            <Button variant="outline" size="sm" onClick={() => setSelectedStatement(null)}>
              Volver a listado
            </Button>
            <div className="flex items-center gap-4">
              <Button
                variant="secondary"
                size="sm"
                loading={autoMatching}
                onClick={handleAutoMatch}
              >
                Auto-match
              </Button>
            </div>
          </div>

          {/* Summary cards */}
          {summary && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Card>
                <CardContent className="p-4 text-center">
                  <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{summary.total}</p>
                  <p className="text-sm text-gray-500">Total lineas</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4 text-center">
                  <p className="text-2xl font-bold text-green-600">{summary.matched}</p>
                  <p className="text-sm text-gray-500">Conciliadas</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4 text-center">
                  <p className="text-2xl font-bold text-yellow-600">{summary.pending}</p>
                  <p className="text-sm text-gray-500">Pendientes</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4 text-center">
                  <p className="text-2xl font-bold text-blue-600">{summary.percentage}%</p>
                  <p className="text-sm text-gray-500">Conciliado</p>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Statement info */}
          <Card>
            <CardHeader>
              <h3 className="text-lg font-semibold">
                {selectedStatement.file_name}
                {selectedStatement.bank_name && <span className="text-gray-500 font-normal ml-2">- {selectedStatement.bank_name}</span>}
                {selectedStatement.period && <span className="text-gray-500 font-normal ml-2">({selectedStatement.period})</span>}
              </h3>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 dark:border-gray-700 text-left">
                      <th className="pb-2 font-medium text-gray-500">Fecha</th>
                      <th className="pb-2 font-medium text-gray-500">Descripcion</th>
                      <th className="pb-2 font-medium text-gray-500 text-right">Monto</th>
                      <th className="pb-2 font-medium text-gray-500">Referencia</th>
                      <th className="pb-2 font-medium text-gray-500">Estado</th>
                      <th className="pb-2 font-medium text-gray-500">Match</th>
                      <th className="pb-2 font-medium text-gray-500">Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                    {selectedStatement.lines.map(line => (
                      <tr key={line.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                        <td className="py-2 whitespace-nowrap">{formatDate(line.line_date)}</td>
                        <td className="py-2 max-w-xs truncate">{line.description}</td>
                        <td className={`py-2 text-right whitespace-nowrap font-medium ${parseFloat(line.amount) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          {formatCurrency(line.amount)}
                        </td>
                        <td className="py-2 text-gray-500">{line.reference || '-'}</td>
                        <td className="py-2">
                          <StatusBadge
                            status={LINE_STATUS_COLORS[line.status] || 'default'}
                            label={LINE_STATUS_LABELS[line.status] || line.status}
                          />
                        </td>
                        <td className="py-2 text-xs">
                          {line.matched_record ? (
                            <div>
                              <span className="font-medium capitalize">{line.matched_type}</span>
                              {line.matched_record.enterprise_name && (
                                <span className="text-gray-500 ml-1">- {line.matched_record.enterprise_name}</span>
                              )}
                              <br />
                              <span className="text-gray-400">
                                {formatCurrency(line.matched_record.amount)} ({line.matched_record.payment_method})
                              </span>
                              {line.match_confidence && (
                                <span className="ml-1 text-gray-400">
                                  [{Math.round(parseFloat(line.match_confidence) * 100)}%]
                                </span>
                              )}
                            </div>
                          ) : '-'}
                        </td>
                        <td className="py-2">
                          {line.status === 'matched' ? (
                            <Button variant="ghost" size="xs" onClick={() => handleUnmatch(line.id)}>
                              Deshacer
                            </Button>
                          ) : matchingLineId === line.id ? (
                            <ManualMatchSelector
                              line={line}
                              cobros={cobros}
                              pagos={pagos}
                              onMatch={handleManualMatch}
                              onCancel={() => setMatchingLineId(null)}
                            />
                          ) : (
                            <Button variant="outline" size="xs" onClick={() => startManualMatch(line.id)}>
                              Vincular
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      ) : (
        /* Statements list */
        statements.length === 0 ? (
          <EmptyState
            title="Sin extractos bancarios"
            description="Subi un archivo CSV de tu banco para comenzar la conciliacion"
          />
        ) : (
          <Card>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 dark:border-gray-700 text-left">
                      <th className="pb-2 font-medium text-gray-500">Archivo</th>
                      <th className="pb-2 font-medium text-gray-500">Banco</th>
                      <th className="pb-2 font-medium text-gray-500">Periodo</th>
                      <th className="pb-2 font-medium text-gray-500 text-right">Lineas</th>
                      <th className="pb-2 font-medium text-gray-500 text-right">Conciliadas</th>
                      <th className="pb-2 font-medium text-gray-500 text-right">%</th>
                      <th className="pb-2 font-medium text-gray-500">Fecha carga</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                    {statements.map(stmt => (
                      <tr
                        key={stmt.id}
                        className="hover:bg-gray-50 dark:hover:bg-gray-800/50 cursor-pointer"
                        onClick={() => loadStatement(stmt.id)}
                      >
                        <td className="py-3 font-medium text-blue-600 hover:underline">{stmt.file_name}</td>
                        <td className="py-3">{stmt.bank_name || '-'}</td>
                        <td className="py-3">{stmt.period || '-'}</td>
                        <td className="py-3 text-right">{stmt.total_lines}</td>
                        <td className="py-3 text-right text-green-600">{stmt.matched_lines}</td>
                        <td className="py-3 text-right font-medium">
                          {stmt.total_lines > 0 ? Math.round((stmt.matched_lines / stmt.total_lines) * 100) : 0}%
                        </td>
                        <td className="py-3 text-gray-500">{formatDate(stmt.uploaded_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )
      )}
    </div>
  )
}

// Manual match dropdown component
function ManualMatchSelector({
  line,
  cobros,
  pagos,
  onMatch,
  onCancel,
}: {
  line: StatementLine
  cobros: Cobro[]
  pagos: Pago[]
  onMatch: (lineId: string, type: 'cobro' | 'pago', matchId: string) => void
  onCancel: () => void
}) {
  const lineAmount = parseFloat(line.amount)
  // Positive amounts = cobros, negative = pagos
  const candidates = lineAmount >= 0
    ? cobros.map(c => ({ ...c, type: 'cobro' as const }))
    : pagos.map(p => ({ ...p, type: 'pago' as const }))

  // Sort by amount similarity
  const sorted = [...candidates].sort((a, b) => {
    const diffA = Math.abs(Math.abs(lineAmount) - parseFloat(a.amount))
    const diffB = Math.abs(Math.abs(lineAmount) - parseFloat(b.amount))
    return diffA - diffB
  })

  return (
    <div className="flex flex-col gap-1">
      <select
        className="text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-1 py-1"
        defaultValue=""
        onChange={e => {
          if (e.target.value) {
            const [type, id] = e.target.value.split('::')
            onMatch(line.id, type as 'cobro' | 'pago', id)
          }
        }}
      >
        <option value="">Seleccionar...</option>
        {sorted.slice(0, 20).map(c => (
          <option key={c.id} value={`${c.type}::${c.id}`}>
            {c.type === 'cobro' ? 'Recibo' : 'Orden de Pago'} - {formatCurrency(c.amount)} - {c.enterprise_name || 'Sin empresa'} ({formatDate(c.payment_date)})
          </option>
        ))}
      </select>
      <Button variant="ghost" size="xs" onClick={onCancel}>Cancelar</Button>
    </div>
  )
}
