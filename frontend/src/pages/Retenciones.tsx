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
import { PermissionGate } from '@/components/shared/PermissionGate'

interface Retencion {
  id: string
  type: string
  regime: string | null
  enterprise_id: string | null
  enterprise_name: string | null
  pago_id: string | null
  base_amount: string
  rate: string
  amount: string
  certificate_number: string | null
  date: string
  period: string | null
  created_at: string
}

interface Summary {
  by_type: Array<{ type: string; count: number; total_base: number; total_amount: number }>
  total_count: number
  total_amount: number
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

export const Retenciones: React.FC = () => {
  const [retenciones, setRetenciones] = useState<Retencion[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [enterprises, setEnterprises] = useState<Enterprise[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Retencion | null>(null)
  const [deleting, setDeleting] = useState(false)

  // Filters
  const [filterType, setFilterType] = useState('')
  const [filterEnterprise, setFilterEnterprise] = useState('')
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
  })

  // Import state
  const [importSource, setImportSource] = useState('iibb')
  const [importCsv, setImportCsv] = useState('')
  const [importing, setImporting] = useState(false)

  const loadData = async () => {
    try {
      setLoading(true)
      const filters: any = {}
      if (filterType) filters.type = filterType
      if (filterEnterprise) filters.enterprise_id = filterEnterprise
      if (filterPeriod) filters.period = filterPeriod

      const [retRes, sumRes, entRes] = await Promise.all([
        api.getRetenciones(filters).catch(() => []),
        api.getRetencionesSummary(filterPeriod || undefined).catch(() => null),
        api.getEnterprises().catch(() => []),
      ])
      setRetenciones(retRes || [])
      setSummary(sumRes)
      setEnterprises(entRes || [])
    } catch (e: any) {
      toast.error('Error cargando retenciones')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadData() }, [filterType, filterEnterprise, filterPeriod])
  useEffect(() => { setCurrentPage(1) }, [filterType, filterEnterprise, filterPeriod, pageSize])

  // Auto-calculate amount when base_amount or rate change
  useEffect(() => {
    const base = parseFloat(form.base_amount)
    const rate = parseFloat(form.rate)
    if (!isNaN(base) && !isNaN(rate) && base > 0 && rate >= 0) {
      const calculated = Math.round(base * rate / 100 * 100) / 100
      setForm(prev => ({ ...prev, amount: calculated.toFixed(2) }))
    }
  }, [form.base_amount, form.rate])

  // Pagination
  const paginatedRetenciones = useMemo(() => {
    const start = (currentPage - 1) * pageSize
    return retenciones.slice(start, start + pageSize)
  }, [retenciones, currentPage, pageSize])

  const totalPages = Math.ceil(retenciones.length / pageSize)

  const handleCreate = async () => {
    if (!form.type || !form.base_amount || !form.rate) {
      toast.error('Tipo, monto base y alicuota son requeridos')
      return
    }
    try {
      setSaving(true)
      await api.createRetencion({
        type: form.type,
        enterprise_id: form.enterprise_id || undefined,
        base_amount: parseFloat(form.base_amount),
        rate: parseFloat(form.rate),
        amount: parseFloat(form.amount),
        certificate_number: form.certificate_number || undefined,
        date: form.date || undefined,
        period: form.period || undefined,
        regime: form.regime || undefined,
      })
      toast.success('Retencion creada')
      setShowForm(false)
      setForm({
        type: 'iibb', enterprise_id: '', base_amount: '', rate: '',
        amount: '', certificate_number: '', date: new Date().toISOString().split('T')[0],
        period: '', regime: '',
      })
      loadData()
    } catch (e: any) {
      toast.error(e?.response?.data?.error || 'Error al crear retencion')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    try {
      setDeleting(true)
      await api.deleteRetencion(deleteTarget.id)
      toast.success('Retencion eliminada')
      setDeleteTarget(null)
      loadData()
    } catch (e: any) {
      toast.error(e?.response?.data?.error || 'Error al eliminar retencion')
    } finally {
      setDeleting(false)
    }
  }

  const handleImport = async () => {
    if (!importCsv.trim()) {
      toast.error('Pegue el contenido del CSV')
      return
    }
    try {
      setImporting(true)
      const result = await api.importPadronRetenciones(importSource, importCsv)
      toast.success(`Importados ${result.imported} de ${result.total_rows} registros`)
      if (result.errors && result.errors.length > 0) {
        toast.error(`Errores: ${result.errors.slice(0, 3).join('; ')}`)
      }
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
    reader.onload = (ev) => {
      setImportCsv(ev.target?.result as string || '')
    }
    reader.readAsText(file, 'UTF-8')
  }

  // Generate current period options (last 12 months)
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

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Retenciones</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Retenciones impositivas (IIBB, Ganancias, IVA, SUSS)</p>
        </div>
        <div className="flex gap-2">
          <PermissionGate module="retenciones" action="create">
            <Button variant="secondary" onClick={() => setShowImport(true)}>
              Importar Padron
            </Button>
            <Button onClick={() => setShowForm(true)}>
              + Nueva Retencion
            </Button>
          </PermissionGate>
        </div>
      </div>

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 mb-6">
          {/* Total */}
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-gray-500 dark:text-gray-400 uppercase">Total</p>
              <p className="text-xl font-bold text-gray-900 dark:text-gray-100">{formatCurrency(summary.total_amount)}</p>
              <p className="text-xs text-gray-400">{summary.total_count} retenciones</p>
            </CardContent>
          </Card>
          {/* By type */}
          {summary.by_type.map(t => (
            <Card key={t.type}>
              <CardContent className="p-4">
                <p className="text-xs text-gray-500 dark:text-gray-400 uppercase">{TYPE_LABELS[t.type] || t.type}</p>
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
          <option value="iibb">IIBB</option>
          <option value="ganancias">Ganancias</option>
          <option value="iva">IVA</option>
          <option value="suss">SUSS</option>
        </select>

        <select
          value={filterEnterprise}
          onChange={e => setFilterEnterprise(e.target.value)}
          className="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm px-3 py-2"
        >
          <option value="">Todas las empresas</option>
          {enterprises.map(ent => (
            <option key={ent.id} value={ent.id}>{ent.name}</option>
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
        <SkeletonTable rows={5} cols={7} />
      ) : retenciones.length === 0 ? (
        <EmptyState
          title="Sin retenciones"
          description="No hay retenciones registradas. Cree una manualmente o importe el padron para que se calculen automaticamente al crear pagos."
        />
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
              <thead className="bg-gray-50 dark:bg-gray-800">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Fecha</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Tipo</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Empresa</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Regimen</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Base</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Alicuota</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Monto</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Certificado</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Acciones</th>
                </tr>
              </thead>
              <tbody className="bg-white dark:bg-gray-900 divide-y divide-gray-200 dark:divide-gray-700">
                {paginatedRetenciones.map(ret => (
                  <tr key={ret.id} className="hover:bg-gray-50 dark:hover:bg-gray-800">
                    <td className="px-4 py-3 text-sm text-gray-900 dark:text-gray-100 whitespace-nowrap">{formatDate(ret.date)}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${TYPE_COLORS[ret.type] || 'bg-gray-100 text-gray-800'}`}>
                        {TYPE_LABELS[ret.type] || ret.type}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-900 dark:text-gray-100">{ret.enterprise_name || '-'}</td>
                    <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">{ret.regime || '-'}</td>
                    <td className="px-4 py-3 text-sm text-right text-gray-900 dark:text-gray-100">{formatCurrency(parseFloat(ret.base_amount))}</td>
                    <td className="px-4 py-3 text-sm text-right text-gray-900 dark:text-gray-100">{parseFloat(ret.rate).toFixed(2)}%</td>
                    <td className="px-4 py-3 text-sm text-right font-medium text-gray-900 dark:text-gray-100">{formatCurrency(parseFloat(ret.amount))}</td>
                    <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">{ret.certificate_number || '-'}</td>
                    <td className="px-4 py-3 text-center">
                      <PermissionGate module="retenciones" action="delete">
                        <button
                          onClick={() => setDeleteTarget(ret)}
                          className="text-red-600 hover:text-red-800 dark:text-red-400 text-sm"
                        >
                          Eliminar
                        </button>
                      </PermissionGate>
                    </td>
                  </tr>
                ))}
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
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6">
            <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-4">Nueva Retencion</h2>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Tipo *</label>
                <select
                  value={form.type}
                  onChange={e => setForm(prev => ({ ...prev, type: e.target.value }))}
                  className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm px-3 py-2"
                >
                  <option value="iibb">IIBB (Ingresos Brutos)</option>
                  <option value="ganancias">Ganancias</option>
                  <option value="iva">IVA</option>
                  <option value="suss">SUSS</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Empresa</label>
                <select
                  value={form.enterprise_id}
                  onChange={e => setForm(prev => ({ ...prev, enterprise_id: e.target.value }))}
                  className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm px-3 py-2"
                >
                  <option value="">Sin empresa</option>
                  {enterprises.map(ent => (
                    <option key={ent.id} value={ent.id}>{ent.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Regimen</label>
                <Input
                  value={form.regime}
                  onChange={e => setForm(prev => ({ ...prev, regime: e.target.value }))}
                  placeholder="Ej: 208, General, etc."
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Monto Base *</label>
                  <Input
                    type="number"
                    step="0.01"
                    value={form.base_amount}
                    onChange={e => setForm(prev => ({ ...prev, base_amount: e.target.value }))}
                    placeholder="0.00"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Alicuota (%) *</label>
                  <Input
                    type="number"
                    step="0.01"
                    value={form.rate}
                    onChange={e => setForm(prev => ({ ...prev, rate: e.target.value }))}
                    placeholder="3.00"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Monto Retencion</label>
                <Input
                  type="number"
                  step="0.01"
                  value={form.amount}
                  onChange={e => setForm(prev => ({ ...prev, amount: e.target.value }))}
                  placeholder="Calculado automaticamente"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Fecha</label>
                  <Input
                    type="date"
                    value={form.date}
                    onChange={e => setForm(prev => ({ ...prev, date: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Nro Certificado</label>
                  <Input
                    value={form.certificate_number}
                    onChange={e => setForm(prev => ({ ...prev, certificate_number: e.target.value }))}
                    placeholder="Opcional"
                  />
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <Button variant="secondary" onClick={() => setShowForm(false)}>Cancelar</Button>
              <Button onClick={handleCreate} disabled={saving}>
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
            <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-4">Importar Padron de Retenciones</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              Importe el padron de ARCA (ex AFIP), ARBA u otro organismo. El CSV debe tener al menos una columna "cuit".
              Columnas opcionales: regimen, alicuota, vigencia_desde, vigencia_hasta.
            </p>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Fuente/Tipo</label>
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
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Archivo CSV</label>
                <input
                  type="file"
                  accept=".csv,.txt"
                  onChange={handleFileUpload}
                  className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 dark:file:bg-blue-900 dark:file:text-blue-200"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  O pegue el contenido CSV
                </label>
                <textarea
                  value={importCsv}
                  onChange={e => setImportCsv(e.target.value)}
                  rows={8}
                  placeholder="cuit;regimen;alicuota;vigencia_desde;vigencia_hasta&#10;20123456789;208;3.50;01/01/2026;31/12/2026"
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

      {/* Delete Confirmation */}
      <ConfirmDialog
        open={!!deleteTarget}
        title="Eliminar Retencion"
        message={`Eliminar la retencion de ${TYPE_LABELS[deleteTarget?.type || ''] || deleteTarget?.type} por ${deleteTarget ? formatCurrency(parseFloat(deleteTarget.amount)) : ''}?`}
        confirmLabel="Eliminar"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
        loading={deleting}
        variant="danger"
      />
    </div>
  )
}
