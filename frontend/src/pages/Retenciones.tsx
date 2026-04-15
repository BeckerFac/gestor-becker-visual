import React, { useState, useEffect, useMemo, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Card, CardContent } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { SkeletonTable } from '@/components/ui/Skeleton'
import { Pagination } from '@/components/shared/Pagination'
import { EmptyState } from '@/components/shared/EmptyState'
import { toast } from '@/hooks/useToast'
import { api } from '@/services/api'
import { formatCurrency, formatDate } from '@/lib/utils'
import { PermissionGate } from '@/components/shared/PermissionGate'

type Direction = 'sufrida' | 'practicada'

interface Retencion {
  id: string
  type: string
  regime: string | null
  enterprise_id: string | null
  enterprise_name: string | null
  pago_id: string | null
  cobro_id: string | null
  purchase_invoice_id: string | null
  invoice_id: string | null
  base_amount: string
  rate: string
  amount: string
  certificate_number: string | null
  date: string
  period: string | null
  direction: Direction | null
  jurisdiction: string | null
  status: string | null
  created_at: string
}

interface Summary {
  by_type: Array<{ type: string; count: number; total_base: number; total_amount: number }>
  total_count: number
  total_amount: number
  by_jurisdiction?: Array<{ jurisdiction: string | null; count: number; total_amount: number }>
}

interface Enterprise { id: string; name: string; cuit?: string }

const TYPE_LABELS: Record<string, string> = {
  iibb: 'IIBB',
  ganancias: 'Ganancias',
  iva: 'IVA',
  suss: 'SUSS',
}

const TYPE_COLORS: Record<string, string> = {
  iibb: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  ganancias: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  iva: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
  suss: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200',
}

// Backend constraint: jurisdiction must be one of caba/pba/otra (mapped to 'nacional/provincia/municipal' in UI)
const JURISDICTIONS: { value: string; label: string; group: 'nacional' | 'provincia' | 'municipal' }[] = [
  { value: 'caba', label: 'CABA (Provincial)', group: 'provincia' },
  { value: 'pba', label: 'Provincia BsAs', group: 'provincia' },
  { value: 'otra', label: 'Otra (Nacional / Municipal)', group: 'nacional' },
]
const JURISDICTION_LABELS: Record<string, string> = Object.fromEntries(JURISDICTIONS.map(j => [j.value, j.label]))

interface PreviewState {
  rate: number
  amount: number
  source: 'padron' | 'default'
  regime: string | null
  below_minimum: boolean
  minimum_base: number
}

export const Retenciones: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams()
  const direction: Direction = (searchParams.get('direction') as Direction) === 'practicada' ? 'practicada' : 'sufrida'

  const [retenciones, setRetenciones] = useState<Retencion[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [enterprises, setEnterprises] = useState<Enterprise[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [saving, setSaving] = useState(false)

  // Anular (soft-delete)
  const [anularTarget, setAnularTarget] = useState<Retencion | null>(null)
  const [anularReason, setAnularReason] = useState('')
  const [anulando, setAnulando] = useState(false)

  // Filters
  const [filterType, setFilterType] = useState('')
  const [filterJurisdiction, setFilterJurisdiction] = useState('')
  const [filterPeriod, setFilterPeriod] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)

  // Form state
  const [form, setForm] = useState({
    type: 'iibb',
    enterprise_id: '',
    base_amount: '',
    rate: '',
    amount: '',
    certificate_number: '',
    date: new Date().toISOString().split('T')[0],
    period: '',
    regime: '',
    jurisdiction: '',
    pago_id: '',
    cobro_id: '',
    purchase_invoice_id: '',
    invoice_id: '',
  })
  const [preview, setPreview] = useState<PreviewState | null>(null)
  const previewTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Import state
  const [importSource, setImportSource] = useState('iibb')
  const [importCsv, setImportCsv] = useState('')
  const [importing, setImporting] = useState(false)

  const setDirection = (d: Direction) => {
    setSearchParams(prev => { const np = new URLSearchParams(prev); np.set('direction', d); return np })
  }

  const loadData = async () => {
    try {
      setLoading(true)
      const filters: any = { direction }
      if (filterType) filters.type = filterType
      if (filterJurisdiction) filters.jurisdiction = filterJurisdiction
      if (filterPeriod) filters.period = filterPeriod

      const [retRes, sumRes, entRes] = await Promise.all([
        api.getRetenciones(filters).catch(() => []),
        api.getRetencionesSummary(filterPeriod || undefined).catch(() => null),
        api.getEnterprises().catch(() => []),
      ])
      setRetenciones(Array.isArray(retRes) ? retRes : retRes?.items || [])
      setSummary(sumRes)
      setEnterprises(Array.isArray(entRes) ? entRes : entRes?.items || [])
    } catch {
      toast.error('Error cargando retenciones')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadData() }, [filterType, filterJurisdiction, filterPeriod, direction])
  useEffect(() => { setCurrentPage(1) }, [filterType, filterJurisdiction, filterPeriod, pageSize, direction])

  // Auto-calculate amount when base_amount or rate change (local fallback)
  useEffect(() => {
    const base = parseFloat(form.base_amount)
    const rate = parseFloat(form.rate)
    if (Number.isFinite(base) && Number.isFinite(rate) && base > 0 && rate >= 0 && rate <= 100) {
      const calculated = Math.round(base * rate / 100 * 100) / 100
      setForm(prev => ({ ...prev, amount: calculated.toFixed(2) }))
    }
  }, [form.base_amount, form.rate])

  // Preview from backend (debounced) — populates rate from padron + threshold flag
  useEffect(() => {
    if (!showForm) return
    const base = parseFloat(form.base_amount)
    if (!Number.isFinite(base) || base <= 0 || !form.type) {
      setPreview(null)
      return
    }
    if (form.type === 'iibb' && !form.jurisdiction) {
      setPreview(null)
      return
    }
    if (previewTimeout.current) clearTimeout(previewTimeout.current)
    previewTimeout.current = setTimeout(async () => {
      try {
        const ent = enterprises.find(e => e.id === form.enterprise_id)
        const result = await api.previewRetencion({
          type: form.type,
          base_amount: base,
          jurisdiction: form.jurisdiction || undefined,
          cuit: ent?.cuit || undefined,
          date: form.date || undefined,
        })
        setPreview(result)
        // Only auto-fill rate if user hasn't typed one
        if (result?.rate != null && (!form.rate || preview?.rate === parseFloat(form.rate))) {
          setForm(prev => ({ ...prev, rate: String(result.rate) }))
        }
      } catch {
        setPreview(null)
      }
    }, 350)
    return () => { if (previewTimeout.current) clearTimeout(previewTimeout.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.type, form.base_amount, form.jurisdiction, form.enterprise_id, form.date, showForm])

  // Pagination
  const paginatedRetenciones = useMemo(() => {
    const start = (currentPage - 1) * pageSize
    return retenciones.slice(start, start + pageSize)
  }, [retenciones, currentPage, pageSize])

  const totalPages = Math.ceil(retenciones.length / pageSize)

  const resetForm = () => {
    setForm({
      type: 'iibb', enterprise_id: '', base_amount: '', rate: '', amount: '',
      certificate_number: '', date: new Date().toISOString().split('T')[0],
      period: '', regime: '', jurisdiction: '',
      pago_id: '', cobro_id: '', purchase_invoice_id: '', invoice_id: '',
    })
    setPreview(null)
  }

  const handleCreate = async () => {
    if (!form.type || !form.base_amount || !form.rate) {
      toast.error('Tipo, monto base y alicuota son requeridos')
      return
    }
    const base = parseFloat(form.base_amount)
    const rate = parseFloat(form.rate)
    const amount = parseFloat(form.amount)
    if (!Number.isFinite(base) || base <= 0) { toast.error('Monto base invalido'); return }
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) { toast.error('Alicuota invalida (0-100)'); return }
    if (!Number.isFinite(amount) || amount < 0) { toast.error('Monto retencion invalido'); return }
    if (form.type === 'iibb' && !form.jurisdiction) { toast.error('IIBB requiere jurisdiccion'); return }

    try {
      setSaving(true)
      await api.createRetencion({
        type: form.type,
        direction,
        jurisdiction: form.jurisdiction || undefined,
        enterprise_id: form.enterprise_id || undefined,
        base_amount: base,
        rate,
        amount,
        certificate_number: form.certificate_number || undefined,
        date: form.date || undefined,
        period: form.period || undefined,
        regime: form.regime || undefined,
        pago_id: direction === 'practicada' && form.pago_id ? form.pago_id : undefined,
        cobro_id: direction === 'sufrida' && form.cobro_id ? form.cobro_id : undefined,
        purchase_invoice_id: direction === 'practicada' && form.purchase_invoice_id ? form.purchase_invoice_id : undefined,
        invoice_id: direction === 'sufrida' && form.invoice_id ? form.invoice_id : undefined,
      })
      toast.success('Retencion creada')
      setShowForm(false)
      resetForm()
      loadData()
    } catch (e: any) {
      toast.error(e?.response?.data?.error || 'Error al crear retencion')
    } finally {
      setSaving(false)
    }
  }

  const handleAnular = async () => {
    if (!anularTarget) return
    if (!anularReason.trim()) { toast.error('Debe indicar el motivo'); return }
    try {
      setAnulando(true)
      await api.deleteRetencion(anularTarget.id, anularReason)
      toast.success('Retencion anulada')
      setAnularTarget(null)
      setAnularReason('')
      loadData()
    } catch (e: any) {
      toast.error(e?.response?.data?.error || 'Error al anular retencion')
    } finally {
      setAnulando(false)
    }
  }

  const handleImport = async () => {
    if (!importCsv.trim()) { toast.error('Pegue el contenido del CSV'); return }
    try {
      setImporting(true)
      const result = await api.importPadronRetenciones(importSource, importCsv)
      toast.success(`Importados ${result.imported} de ${result.total_rows}`)
      if (result.errors?.length) toast.error(`Errores: ${result.errors.slice(0, 3).join('; ')}`)
      setShowImport(false)
      setImportCsv('')
    } catch (e: any) {
      toast.error(e?.response?.data?.error || 'Error al importar padron')
    } finally {
      setImporting(false)
    }
  }

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => setImportCsv(ev.target?.result as string || '')
    reader.readAsText(file, 'UTF-8')
  }

  const periodOptions = useMemo(() => {
    const options = []
    const now = new Date()
    for (let i = 0; i < 12; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const period = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      const label = d.toLocaleDateString('es-AR', { year: 'numeric', month: 'long' })
      options.push({ value: period, label })
    }
    return options
  }, [])

  const isAnulada = (r: Retencion) => r.status === 'anulada'

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Retenciones</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {direction === 'sufrida'
              ? 'Retenciones sufridas (clientes nos retienen en cobros)'
              : 'Retenciones practicadas (nosotros retenemos a proveedores en pagos)'}
          </p>
        </div>
        <div className="flex gap-2">
          <PermissionGate module="retenciones" action="create">
            <Button variant="secondary" onClick={() => setShowImport(true)}>Importar Padron</Button>
            <Button onClick={() => { resetForm(); setShowForm(true) }}>+ Nueva Retencion</Button>
          </PermissionGate>
        </div>
      </div>

      {/* Direction tabs */}
      <div className="flex gap-1 border-b border-gray-200 dark:border-gray-700 mb-6">
        {([
          { value: 'sufrida', label: 'Sufridas (en cobros)' },
          { value: 'practicada', label: 'Practicadas (en pagos)' },
        ] as { value: Direction; label: string }[]).map(t => (
          <button
            key={t.value}
            onClick={() => setDirection(t.value)}
            className={`px-4 py-2 -mb-px border-b-2 text-sm font-medium ${
              direction === t.value ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 mb-6">
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-gray-500 uppercase">Total mes</p>
              <p className="text-xl font-bold text-gray-900 dark:text-gray-100">{formatCurrency(summary.total_amount)}</p>
              <p className="text-xs text-gray-400">{summary.total_count} retenciones</p>
            </CardContent>
          </Card>
          {summary.by_type.map(t => (
            <Card key={t.type}>
              <CardContent className="p-4">
                <p className="text-xs text-gray-500 uppercase">{TYPE_LABELS[t.type] || t.type}</p>
                <p className="text-xl font-bold text-gray-900 dark:text-gray-100">{formatCurrency(t.total_amount)}</p>
                <p className="text-xs text-gray-400">{t.count} retenciones</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4">
        <select
          value={filterType}
          onChange={e => setFilterType(e.target.value)}
          className="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm px-3 py-2"
        >
          <option value="">Todos los tipos</option>
          <option value="ganancias">Ganancias</option>
          <option value="iva">IVA</option>
          <option value="iibb">IIBB</option>
          <option value="suss">SUSS</option>
        </select>

        <select
          value={filterJurisdiction}
          onChange={e => setFilterJurisdiction(e.target.value)}
          className="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm px-3 py-2"
        >
          <option value="">Todas las jurisdicciones</option>
          {JURISDICTIONS.map(j => (
            <option key={j.value} value={j.value}>{j.label}</option>
          ))}
        </select>

        <select
          value={filterPeriod}
          onChange={e => setFilterPeriod(e.target.value)}
          className="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm px-3 py-2"
        >
          <option value="">Todos los periodos</option>
          {periodOptions.map(p => (
            <option key={p.value} value={p.value}>{p.label}</option>
          ))}
        </select>
      </div>

      {/* Table */}
      {loading ? (
        <SkeletonTable rows={5} cols={8} />
      ) : retenciones.length === 0 ? (
        <EmptyState
          title="Sin retenciones"
          description={direction === 'sufrida'
            ? 'No hay retenciones sufridas en el periodo. Se generan automaticamente en cobros con metodo retencion.'
            : 'No hay retenciones practicadas en el periodo. Se generan automaticamente en pagos a proveedores.'}
        />
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
              <thead className="bg-gray-50 dark:bg-gray-800">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Fecha</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Tipo</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Jurisd.</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Empresa</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Base</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Alicuota</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Monto</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Certificado</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Acciones</th>
                </tr>
              </thead>
              <tbody className="bg-white dark:bg-gray-900 divide-y divide-gray-200 dark:divide-gray-700">
                {paginatedRetenciones.map(ret => {
                  const anulada = isAnulada(ret)
                  const rowClass = anulada
                    ? 'bg-red-50/40 dark:bg-red-900/10 line-through opacity-70'
                    : 'hover:bg-gray-50 dark:hover:bg-gray-800'
                  return (
                    <tr key={ret.id} className={rowClass}>
                      <td className="px-4 py-3 text-sm whitespace-nowrap">{formatDate(ret.date)}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${TYPE_COLORS[ret.type] || 'bg-gray-100'}`}>
                          {TYPE_LABELS[ret.type] || ret.type}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500">{ret.jurisdiction ? JURISDICTION_LABELS[ret.jurisdiction] || ret.jurisdiction : '-'}</td>
                      <td className="px-4 py-3 text-sm">{ret.enterprise_name || '-'}</td>
                      <td className="px-4 py-3 text-sm text-right">{formatCurrency(parseFloat(ret.base_amount))}</td>
                      <td className="px-4 py-3 text-sm text-right">{parseFloat(ret.rate).toFixed(2)}%</td>
                      <td className="px-4 py-3 text-sm text-right font-medium">{formatCurrency(parseFloat(ret.amount))}</td>
                      <td className="px-4 py-3 text-sm text-gray-500">{ret.certificate_number || '-'}</td>
                      <td className="px-4 py-3 text-center">
                        {!anulada && (
                          <PermissionGate module="retenciones" action="delete">
                            <button
                              onClick={() => setAnularTarget(ret)}
                              className="text-red-600 hover:text-red-800 text-sm"
                            >
                              Anular
                            </button>
                          </PermissionGate>
                        )}
                        {anulada && <span className="text-xs text-red-700 font-semibold">ANULADA</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {totalPages > 1 && (
            <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-700">
              <Pagination
                currentPage={currentPage}
                totalPages={totalPages}
                onPageChange={setCurrentPage}
                pageSize={pageSize}
                onPageSizeChange={setPageSize}
                totalItems={retenciones.length}
              />
            </div>
          )}
        </Card>
      )}

      {/* Create Form Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6">
            <h2 className="text-lg font-bold mb-4">
              Nueva Retencion {direction === 'sufrida' ? 'Sufrida' : 'Practicada'}
            </h2>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium mb-1">Tipo *</label>
                  <select
                    value={form.type}
                    onChange={e => setForm(p => ({ ...p, type: e.target.value }))}
                    className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm px-3 py-2"
                  >
                    <option value="ganancias">Ganancias (min $60.000)</option>
                    <option value="iva">IVA</option>
                    <option value="iibb">IIBB</option>
                    <option value="suss">SUSS (min $108.000)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">
                    Jurisdiccion {form.type === 'iibb' && '*'}
                  </label>
                  <select
                    value={form.jurisdiction}
                    onChange={e => setForm(p => ({ ...p, jurisdiction: e.target.value }))}
                    className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm px-3 py-2"
                  >
                    <option value="">{form.type === 'iibb' ? 'Seleccionar...' : 'Sin jurisdiccion'}</option>
                    {JURISDICTIONS.map(j => (
                      <option key={j.value} value={j.value}>{j.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Empresa</label>
                <select
                  value={form.enterprise_id}
                  onChange={e => setForm(p => ({ ...p, enterprise_id: e.target.value }))}
                  className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm px-3 py-2"
                >
                  <option value="">Sin empresa</option>
                  {enterprises.map(ent => (
                    <option key={ent.id} value={ent.id}>{ent.name}{ent.cuit ? ` (${ent.cuit})` : ''}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Regimen</label>
                <Input
                  value={form.regime}
                  onChange={e => setForm(p => ({ ...p, regime: e.target.value }))}
                  placeholder="Ej: 208, General, etc."
                />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-sm font-medium mb-1">Monto Base *</label>
                  <Input
                    type="number" step="0.01"
                    value={form.base_amount}
                    onChange={e => setForm(p => ({ ...p, base_amount: e.target.value }))}
                    placeholder="0.00"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Alicuota (%) *</label>
                  <Input
                    type="number" step="0.01"
                    value={form.rate}
                    onChange={e => setForm(p => ({ ...p, rate: e.target.value }))}
                    placeholder="3.00"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Monto Retencion</label>
                  <Input
                    type="number" step="0.01"
                    value={form.amount}
                    onChange={e => setForm(p => ({ ...p, amount: e.target.value }))}
                    placeholder="Calculado"
                  />
                </div>
              </div>

              {/* Live preview */}
              {preview && (
                <div className={`rounded-lg border p-3 text-sm ${
                  preview.below_minimum
                    ? 'bg-yellow-50 border-yellow-300 text-yellow-900'
                    : 'bg-blue-50 border-blue-200 text-blue-900'
                }`}>
                  <p>
                    Con alicuota <span className="font-bold">{preview.rate}%</span> ({preview.source === 'padron' ? 'padron' : 'default'})
                    {' -> '}retencion <span className="font-bold">{formatCurrency(preview.amount)}</span>
                  </p>
                  {preview.regime && <p className="text-xs">Regimen: {preview.regime}</p>}
                  {preview.below_minimum && (
                    <p className="text-xs font-semibold mt-1">
                      Atencion: base por debajo del minimo no imponible ({formatCurrency(preview.minimum_base)}). El backend rechazara la creacion.
                    </p>
                  )}
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium mb-1">Fecha</label>
                  <Input type="date" value={form.date} onChange={e => setForm(p => ({ ...p, date: e.target.value }))} />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Nro Certificado</label>
                  <Input
                    value={form.certificate_number}
                    onChange={e => setForm(p => ({ ...p, certificate_number: e.target.value }))}
                    placeholder="Opcional"
                  />
                </div>
              </div>

              {/* Linked entity (manual creation outside cobro/pago) */}
              <div className="grid grid-cols-2 gap-3 pt-2 border-t border-gray-200 dark:border-gray-700">
                {direction === 'practicada' ? (
                  <>
                    <div>
                      <label className="block text-sm font-medium mb-1">Pago ID (opcional)</label>
                      <Input value={form.pago_id} onChange={e => setForm(p => ({ ...p, pago_id: e.target.value }))} placeholder="UUID del pago" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">Factura compra ID (opcional)</label>
                      <Input value={form.purchase_invoice_id} onChange={e => setForm(p => ({ ...p, purchase_invoice_id: e.target.value }))} placeholder="UUID factura compra" />
                    </div>
                  </>
                ) : (
                  <>
                    <div>
                      <label className="block text-sm font-medium mb-1">Cobro ID (opcional)</label>
                      <Input value={form.cobro_id} onChange={e => setForm(p => ({ ...p, cobro_id: e.target.value }))} placeholder="UUID del cobro" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">Factura venta ID (opcional)</label>
                      <Input value={form.invoice_id} onChange={e => setForm(p => ({ ...p, invoice_id: e.target.value }))} placeholder="UUID factura venta" />
                    </div>
                  </>
                )}
              </div>
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <Button variant="secondary" onClick={() => setShowForm(false)}>Cancelar</Button>
              <Button onClick={handleCreate} disabled={saving || (preview?.below_minimum ?? false)}>
                {saving ? 'Guardando...' : 'Crear Retencion'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Import Padron Modal */}
      {showImport && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6">
            <h2 className="text-lg font-bold mb-4">Importar Padron de Retenciones</h2>
            <p className="text-sm text-gray-500 mb-4">
              Importe el padron de ARCA (ex AFIP), ARBA u otro organismo. Columnas: cuit, regimen, alicuota, vigencia_desde, vigencia_hasta.
            </p>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Fuente/Tipo</label>
                <select
                  value={importSource}
                  onChange={e => setImportSource(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm px-3 py-2"
                >
                  <option value="iibb">IIBB</option>
                  <option value="ganancias">Ganancias</option>
                  <option value="iva">IVA</option>
                  <option value="suss">SUSS</option>
                  <option value="arba">ARBA</option>
                  <option value="arca">ARCA (ex AFIP)</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Archivo CSV</label>
                <input
                  type="file" accept=".csv,.txt" onChange={handleFileUpload}
                  className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">O pegue el contenido CSV</label>
                <textarea
                  value={importCsv}
                  onChange={e => setImportCsv(e.target.value)}
                  rows={8}
                  placeholder="cuit;regimen;alicuota;vigencia_desde;vigencia_hasta"
                  className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm px-3 py-2 font-mono"
                />
              </div>
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <Button variant="secondary" onClick={() => { setShowImport(false); setImportCsv('') }}>Cancelar</Button>
              <Button onClick={handleImport} disabled={importing}>
                {importing ? 'Importando...' : 'Importar'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Anular Modal */}
      {anularTarget && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-md p-6">
            <h2 className="text-lg font-bold mb-2">Anular Retencion</h2>
            <p className="text-sm text-gray-600 mb-4">
              Anular {TYPE_LABELS[anularTarget.type] || anularTarget.type} por {formatCurrency(parseFloat(anularTarget.amount))}.
              Esta accion es soft-delete y queda registrada en el audit trail.
            </p>
            <label className="block text-sm font-medium mb-1">Motivo *</label>
            <textarea
              value={anularReason}
              onChange={e => setAnularReason(e.target.value)}
              rows={3}
              placeholder="Ej: error de carga, retencion duplicada..."
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm px-3 py-2"
            />
            <div className="flex justify-end gap-3 mt-4">
              <Button variant="secondary" onClick={() => { setAnularTarget(null); setAnularReason('') }}>Cancelar</Button>
              <Button onClick={handleAnular} disabled={anulando}>
                {anulando ? 'Anulando...' : 'Anular'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
