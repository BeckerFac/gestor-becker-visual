import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { Card, CardContent } from '@/components/ui/Card'
import { SkeletonTable } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/shared/EmptyState'
import { ExportExcelButton } from '@/components/shared/ExportExcel'
import { api } from '@/services/api'
import { formatCurrency, formatDate } from '@/lib/utils'

// -- Types --

interface IVAVentasRow {
  invoice_date: string
  comprobante: string
  customer_name: string
  customer_cuit: string
  neto_gravado: number
  neto_no_gravado: number
  iva_27: number
  iva_21: number
  iva_10_5: number
  iva_5: number
  iva_2_5: number
  iva_0: number
  total_iva: number
  total: number
}

interface IVAComprasRow {
  date: string
  comprobante: string
  enterprise_name: string
  enterprise_cuit: string
  neto_gravado: number
  iva: number
  total: number
}

interface PosicionIVARow {
  periodo: string
  periodo_label: string
  debito_fiscal: number
  credito_fiscal: number
  saldo: number
}

interface FlujoCajaRow {
  periodo: string
  periodo_label: string
  ingresos: number
  egresos: number
  neto: number
  acumulado: number
}

type TabKey = 'ventas' | 'compras' | 'posicion' | 'flujo'

const TABS: { key: TabKey; label: string }[] = [
  { key: 'ventas', label: 'Libro IVA Ventas' },
  { key: 'compras', label: 'Libro IVA Compras' },
  { key: 'posicion', label: 'Posicion IVA' },
  { key: 'flujo', label: 'Flujo de Caja' },
]

// -- Date helpers --

function getMonthRange(offset: number = 0): { from: string; to: string } {
  const now = new Date()
  const y = now.getFullYear()
  const m = now.getMonth() + offset
  const start = new Date(y, m, 1)
  const end = new Date(y, m + 1, 0)
  return {
    from: fmt_iso(start),
    to: fmt_iso(end),
  }
}

function getQuarterRange(): { from: string; to: string } {
  const now = new Date()
  const q = Math.floor(now.getMonth() / 3)
  const start = new Date(now.getFullYear(), q * 3, 1)
  const end = new Date(now.getFullYear(), q * 3 + 3, 0)
  return { from: fmt_iso(start), to: fmt_iso(end) }
}

function getYearRange(): { from: string; to: string } {
  const y = new Date().getFullYear()
  return { from: `${y}-01-01`, to: `${y}-12-31` }
}

function getSixMonthsRange(): { from: string; to: string } {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth() - 5, 1)
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0)
  return { from: fmt_iso(start), to: fmt_iso(end) }
}

function fmt_iso(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

const fmt = (n: any) => formatCurrency(n)

// -- Component --

export const Reportes: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabKey>('ventas')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Date range
  const defaultRange = getMonthRange(0)
  const [dateFrom, setDateFrom] = useState(defaultRange.from)
  const [dateTo, setDateTo] = useState(defaultRange.to)

  // Data
  const [ventasRows, setVentasRows] = useState<IVAVentasRow[]>([])
  const [ventasTotals, setVentasTotals] = useState<Record<string, number>>({})
  const [comprasRows, setComprasRows] = useState<IVAComprasRow[]>([])
  const [comprasTotals, setComprasTotals] = useState<Record<string, number>>({})
  const [posicionRows, setPosicionRows] = useState<PosicionIVARow[]>([])
  const [flujoRows, setFlujoRows] = useState<FlujoCajaRow[]>([])

  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      switch (activeTab) {
        case 'ventas': {
          const res = await api.getLibroIVAVentas(dateFrom, dateTo)
          setVentasRows(res.rows || [])
          setVentasTotals(res.totals || {})
          break
        }
        case 'compras': {
          const res = await api.getLibroIVACompras(dateFrom, dateTo)
          setComprasRows(res.rows || [])
          setComprasTotals(res.totals || {})
          break
        }
        case 'posicion': {
          const res = await api.getPosicionIVA(dateFrom, dateTo)
          setPosicionRows(res.rows || [])
          break
        }
        case 'flujo': {
          const res = await api.getFlujoCaja(dateFrom, dateTo)
          setFlujoRows(res.rows || [])
          break
        }
      }
    } catch (e: any) {
      setError(e.message || 'Error cargando reporte')
    } finally {
      setLoading(false)
    }
  }, [activeTab, dateFrom, dateTo])

  useEffect(() => { loadData() }, [loadData])

  // When switching tabs, set sensible default date ranges
  const handleTabChange = (tab: TabKey) => {
    if (tab === activeTab) return
    if (tab === 'posicion' || tab === 'flujo') {
      const range = getSixMonthsRange()
      setDateFrom(range.from)
      setDateTo(range.to)
    } else {
      const range = getMonthRange(0)
      setDateFrom(range.from)
      setDateTo(range.to)
    }
    setActiveTab(tab)
  }

  const applyPreset = (preset: string) => {
    let range: { from: string; to: string }
    switch (preset) {
      case 'este_mes': range = getMonthRange(0); break
      case 'mes_anterior': range = getMonthRange(-1); break
      case 'trimestre': range = getQuarterRange(); break
      case 'anio': range = getYearRange(); break
      default: return
    }
    setDateFrom(range.from)
    setDateTo(range.to)
  }

  // Excel columns per tab
  const ventasExcelCols = [
    { key: 'invoice_date', label: 'Fecha', type: 'date' as const },
    { key: 'comprobante', label: 'Comprobante' },
    { key: 'customer_name', label: 'Cliente' },
    { key: 'customer_cuit', label: 'CUIT' },
    { key: 'neto_gravado', label: 'Neto Gravado', type: 'currency' as const },
    { key: 'neto_no_gravado', label: 'Neto No Gravado', type: 'currency' as const },
    { key: 'iva_27', label: 'IVA 27%', type: 'currency' as const },
    { key: 'iva_21', label: 'IVA 21%', type: 'currency' as const },
    { key: 'iva_10_5', label: 'IVA 10.5%', type: 'currency' as const },
    { key: 'iva_5', label: 'IVA 5%', type: 'currency' as const },
    { key: 'iva_2_5', label: 'IVA 2.5%', type: 'currency' as const },
    { key: 'iva_0', label: 'IVA 0%', type: 'currency' as const },
    { key: 'total_iva', label: 'Total IVA', type: 'currency' as const },
    { key: 'total', label: 'Total', type: 'currency' as const },
  ]

  const comprasExcelCols = [
    { key: 'date', label: 'Fecha', type: 'date' as const },
    { key: 'comprobante', label: 'Comprobante' },
    { key: 'enterprise_name', label: 'Proveedor' },
    { key: 'enterprise_cuit', label: 'CUIT' },
    { key: 'neto_gravado', label: 'Neto Gravado', type: 'currency' as const },
    { key: 'iva', label: 'IVA', type: 'currency' as const },
    { key: 'total', label: 'Total', type: 'currency' as const },
  ]

  const posicionExcelCols = [
    { key: 'periodo_label', label: 'Periodo' },
    { key: 'debito_fiscal', label: 'Debito Fiscal', type: 'currency' as const },
    { key: 'credito_fiscal', label: 'Credito Fiscal', type: 'currency' as const },
    { key: 'saldo', label: 'Saldo', type: 'currency' as const },
  ]

  const flujoExcelCols = [
    { key: 'periodo_label', label: 'Periodo' },
    { key: 'ingresos', label: 'Ingresos', type: 'currency' as const },
    { key: 'egresos', label: 'Egresos', type: 'currency' as const },
    { key: 'neto', label: 'Neto', type: 'currency' as const },
    { key: 'acumulado', label: 'Acumulado', type: 'currency' as const },
  ]

  const currentExcelData = useMemo(() => {
    switch (activeTab) {
      case 'ventas': return { data: ventasRows, columns: ventasExcelCols, filename: 'libro_iva_ventas' }
      case 'compras': return { data: comprasRows, columns: comprasExcelCols, filename: 'libro_iva_compras' }
      case 'posicion': return { data: posicionRows, columns: posicionExcelCols, filename: 'posicion_iva' }
      case 'flujo': return { data: flujoRows, columns: flujoExcelCols, filename: 'flujo_caja' }
    }
  }, [activeTab, ventasRows, comprasRows, posicionRows, flujoRows])

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Reportes</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Reportes contables e impositivos</p>
        </div>
        <ExportExcelButton
          data={currentExcelData.data}
          columns={currentExcelData.columns}
          filename={currentExcelData.filename}
        />
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 dark:border-gray-700">
        <nav className="flex gap-0 -mb-px overflow-x-auto">
          {TABS.map(tab => (
            <button
              key={tab.key}
              onClick={() => handleTabChange(tab.key)}
              className={`px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                activeTab === tab.key
                  ? 'border-blue-600 text-blue-600 dark:text-blue-400 dark:border-blue-400'
                  : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:border-gray-300'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-4 pb-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-500 dark:text-gray-400">Desde</label>
              <input
                type="date"
                value={dateFrom}
                onChange={e => setDateFrom(e.target.value)}
                className="px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-500 dark:text-gray-400">Hasta</label>
              <input
                type="date"
                value={dateTo}
                onChange={e => setDateTo(e.target.value)}
                className="px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
              />
            </div>
            <div className="flex gap-1.5 flex-wrap">
              {[
                { key: 'este_mes', label: 'Este mes' },
                { key: 'mes_anterior', label: 'Mes anterior' },
                { key: 'trimestre', label: 'Este trimestre' },
                { key: 'anio', label: 'Este anio' },
              ].map(p => (
                <button
                  key={p.key}
                  onClick={() => applyPreset(p.key)}
                  className="px-2.5 py-1.5 text-xs font-medium rounded-lg border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Error */}
      {error && (
        <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 px-4 py-3 rounded-lg animate-fadeIn">
          {error}
          <button onClick={() => setError(null)} className="ml-2 font-bold">x</button>
        </div>
      )}

      {/* Content */}
      {loading ? (
        <SkeletonTable rows={6} cols={6} />
      ) : (
        <>
          {activeTab === 'ventas' && <LibroIVAVentasTab rows={ventasRows} totals={ventasTotals} />}
          {activeTab === 'compras' && <LibroIVAComprasTab rows={comprasRows} totals={comprasTotals} />}
          {activeTab === 'posicion' && <PosicionIVATab rows={posicionRows} />}
          {activeTab === 'flujo' && <FlujoCajaTab rows={flujoRows} />}
        </>
      )}
    </div>
  )
}

// -- Libro IVA Ventas --

const LibroIVAVentasTab: React.FC<{ rows: IVAVentasRow[]; totals: Record<string, number> }> = ({ rows, totals }) => {
  if (rows.length === 0) {
    return <EmptyState title="Sin datos para el periodo" description="No hay facturas de venta en el rango seleccionado" variant="filtered" />
  }

  return (
    <>
      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/30">
          <CardContent className="pt-3 pb-2">
            <p className="text-xs text-blue-700 dark:text-blue-300">Neto Gravado</p>
            <p className="text-xl font-bold text-blue-800 dark:text-blue-200">{fmt(totals.neto_gravado || 0)}</p>
          </CardContent>
        </Card>
        <Card className="border border-purple-200 dark:border-purple-800 bg-purple-50 dark:bg-purple-900/30">
          <CardContent className="pt-3 pb-2">
            <p className="text-xs text-purple-700 dark:text-purple-300">Total IVA</p>
            <p className="text-xl font-bold text-purple-800 dark:text-purple-200">{fmt(totals.total_iva || 0)}</p>
          </CardContent>
        </Card>
        <Card className="border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/30">
          <CardContent className="pt-3 pb-2">
            <p className="text-xs text-green-700 dark:text-green-300">Total Ventas</p>
            <p className="text-xl font-bold text-green-800 dark:text-green-200">{fmt(totals.total || 0)}</p>
          </CardContent>
        </Card>
        <Card className="border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
          <CardContent className="pt-3 pb-2">
            <p className="text-xs text-gray-600 dark:text-gray-400">Comprobantes</p>
            <p className="text-xl font-bold text-gray-800 dark:text-gray-200">{rows.length}</p>
          </CardContent>
        </Card>
      </div>

      {/* Table */}
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-800 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                <th className="px-3 py-3">Fecha</th>
                <th className="px-3 py-3">Comprobante</th>
                <th className="px-3 py-3">Cliente</th>
                <th className="px-3 py-3">CUIT</th>
                <th className="px-3 py-3 text-right">Neto Grav.</th>
                <th className="px-3 py-3 text-right">No Grav.</th>
                <th className="px-3 py-3 text-right">IVA 21%</th>
                <th className="px-3 py-3 text-right">IVA 10.5%</th>
                <th className="px-3 py-3 text-right">IVA 27%</th>
                <th className="px-3 py-3 text-right">Total IVA</th>
                <th className="px-3 py-3 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i} className={`border-b border-gray-100 dark:border-gray-700 transition-colors ${i % 2 === 0 ? 'bg-white dark:bg-gray-900' : 'bg-gray-50/50 dark:bg-gray-800/50'}`}>
                  <td className="px-3 py-2.5 text-gray-600 dark:text-gray-300">{formatDate(row.invoice_date)}</td>
                  <td className="px-3 py-2.5 font-mono text-xs font-semibold text-gray-800 dark:text-gray-200">{row.comprobante}</td>
                  <td className="px-3 py-2.5 text-gray-900 dark:text-gray-100">{row.customer_name}</td>
                  <td className="px-3 py-2.5 font-mono text-xs text-gray-500 dark:text-gray-400">{row.customer_cuit || '-'}</td>
                  <td className="px-3 py-2.5 text-right text-gray-700 dark:text-gray-300">{fmt(row.neto_gravado)}</td>
                  <td className="px-3 py-2.5 text-right text-gray-500 dark:text-gray-400">{row.neto_no_gravado ? fmt(row.neto_no_gravado) : '-'}</td>
                  <td className="px-3 py-2.5 text-right text-gray-700 dark:text-gray-300">{row.iva_21 ? fmt(row.iva_21) : '-'}</td>
                  <td className="px-3 py-2.5 text-right text-gray-500 dark:text-gray-400">{row.iva_10_5 ? fmt(row.iva_10_5) : '-'}</td>
                  <td className="px-3 py-2.5 text-right text-gray-500 dark:text-gray-400">{row.iva_27 ? fmt(row.iva_27) : '-'}</td>
                  <td className="px-3 py-2.5 text-right font-medium text-purple-700 dark:text-purple-400">{fmt(row.total_iva)}</td>
                  <td className="px-3 py-2.5 text-right font-bold text-gray-900 dark:text-gray-100">{fmt(row.total)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-gray-100 dark:bg-gray-800 font-bold text-sm border-t-2 border-gray-300 dark:border-gray-600">
                <td colSpan={4} className="px-3 py-3 text-gray-700 dark:text-gray-300">TOTALES</td>
                <td className="px-3 py-3 text-right text-gray-800 dark:text-gray-200">{fmt(totals.neto_gravado || 0)}</td>
                <td className="px-3 py-3 text-right text-gray-600 dark:text-gray-400">{fmt(totals.neto_no_gravado || 0)}</td>
                <td className="px-3 py-3 text-right text-gray-800 dark:text-gray-200">{fmt(totals.iva_21 || 0)}</td>
                <td className="px-3 py-3 text-right text-gray-600 dark:text-gray-400">{fmt(totals.iva_10_5 || 0)}</td>
                <td className="px-3 py-3 text-right text-gray-600 dark:text-gray-400">{fmt(totals.iva_27 || 0)}</td>
                <td className="px-3 py-3 text-right text-purple-700 dark:text-purple-400">{fmt(totals.total_iva || 0)}</td>
                <td className="px-3 py-3 text-right text-gray-900 dark:text-gray-100">{fmt(totals.total || 0)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>
    </>
  )
}

// -- Libro IVA Compras --

const LibroIVAComprasTab: React.FC<{ rows: IVAComprasRow[]; totals: Record<string, number> }> = ({ rows, totals }) => {
  if (rows.length === 0) {
    return <EmptyState title="Sin datos para el periodo" description="No hay compras registradas en el rango seleccionado" variant="filtered" />
  }

  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <Card className="border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/30">
          <CardContent className="pt-3 pb-2">
            <p className="text-xs text-blue-700 dark:text-blue-300">Neto Gravado</p>
            <p className="text-xl font-bold text-blue-800 dark:text-blue-200">{fmt(totals.neto_gravado || 0)}</p>
          </CardContent>
        </Card>
        <Card className="border border-purple-200 dark:border-purple-800 bg-purple-50 dark:bg-purple-900/30">
          <CardContent className="pt-3 pb-2">
            <p className="text-xs text-purple-700 dark:text-purple-300">IVA Credito Fiscal</p>
            <p className="text-xl font-bold text-purple-800 dark:text-purple-200">{fmt(totals.iva || 0)}</p>
          </CardContent>
        </Card>
        <Card className="border border-orange-200 dark:border-orange-800 bg-orange-50 dark:bg-orange-900/30">
          <CardContent className="pt-3 pb-2">
            <p className="text-xs text-orange-700 dark:text-orange-300">Total Compras</p>
            <p className="text-xl font-bold text-orange-800 dark:text-orange-200">{fmt(totals.total || 0)}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-800 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                <th className="px-4 py-3">Fecha</th>
                <th className="px-4 py-3">Comprobante</th>
                <th className="px-4 py-3">Proveedor</th>
                <th className="px-4 py-3">CUIT</th>
                <th className="px-4 py-3 text-right">Neto Gravado</th>
                <th className="px-4 py-3 text-right">IVA</th>
                <th className="px-4 py-3 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i} className={`border-b border-gray-100 dark:border-gray-700 transition-colors ${i % 2 === 0 ? 'bg-white dark:bg-gray-900' : 'bg-gray-50/50 dark:bg-gray-800/50'}`}>
                  <td className="px-4 py-2.5 text-gray-600 dark:text-gray-300">{formatDate(row.date)}</td>
                  <td className="px-4 py-2.5 font-mono text-xs font-semibold text-gray-800 dark:text-gray-200">{row.comprobante}</td>
                  <td className="px-4 py-2.5 text-gray-900 dark:text-gray-100">{row.enterprise_name}</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-gray-500 dark:text-gray-400">{row.enterprise_cuit || '-'}</td>
                  <td className="px-4 py-2.5 text-right text-gray-700 dark:text-gray-300">{fmt(row.neto_gravado)}</td>
                  <td className="px-4 py-2.5 text-right font-medium text-purple-700 dark:text-purple-400">{fmt(row.iva)}</td>
                  <td className="px-4 py-2.5 text-right font-bold text-gray-900 dark:text-gray-100">{fmt(row.total)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-gray-100 dark:bg-gray-800 font-bold text-sm border-t-2 border-gray-300 dark:border-gray-600">
                <td colSpan={4} className="px-4 py-3 text-gray-700 dark:text-gray-300">TOTALES</td>
                <td className="px-4 py-3 text-right text-gray-800 dark:text-gray-200">{fmt(totals.neto_gravado || 0)}</td>
                <td className="px-4 py-3 text-right text-purple-700 dark:text-purple-400">{fmt(totals.iva || 0)}</td>
                <td className="px-4 py-3 text-right text-gray-900 dark:text-gray-100">{fmt(totals.total || 0)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>
    </>
  )
}

// -- Posicion IVA --

const PosicionIVATab: React.FC<{ rows: PosicionIVARow[] }> = ({ rows }) => {
  if (rows.length === 0) {
    return <EmptyState title="Sin datos para el periodo" description="No hay posiciones IVA calculadas para el rango seleccionado" variant="filtered" />
  }

  const totalDebito = rows.reduce((s, r) => s + r.debito_fiscal, 0)
  const totalCredito = rows.reduce((s, r) => s + r.credito_fiscal, 0)
  const totalSaldo = rows.reduce((s, r) => s + r.saldo, 0)

  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <Card className="border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/30">
          <CardContent className="pt-3 pb-2">
            <p className="text-xs text-red-700 dark:text-red-300">Total Debito Fiscal</p>
            <p className="text-xl font-bold text-red-800 dark:text-red-200">{fmt(totalDebito)}</p>
          </CardContent>
        </Card>
        <Card className="border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/30">
          <CardContent className="pt-3 pb-2">
            <p className="text-xs text-green-700 dark:text-green-300">Total Credito Fiscal</p>
            <p className="text-xl font-bold text-green-800 dark:text-green-200">{fmt(totalCredito)}</p>
          </CardContent>
        </Card>
        <Card className={`border ${totalSaldo >= 0 ? 'border-orange-200 dark:border-orange-800 bg-orange-50 dark:bg-orange-900/30' : 'border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/30'}`}>
          <CardContent className="pt-3 pb-2">
            <p className={`text-xs ${totalSaldo >= 0 ? 'text-orange-700 dark:text-orange-300' : 'text-green-700 dark:text-green-300'}`}>
              {totalSaldo >= 0 ? 'IVA a Pagar' : 'IVA a Favor'}
            </p>
            <p className={`text-xl font-bold ${totalSaldo >= 0 ? 'text-orange-800 dark:text-orange-200' : 'text-green-800 dark:text-green-200'}`}>
              {fmt(Math.abs(totalSaldo))}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-800 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                <th className="px-4 py-3">Periodo</th>
                <th className="px-4 py-3 text-right">Debito Fiscal (Ventas)</th>
                <th className="px-4 py-3 text-right">Credito Fiscal (Compras)</th>
                <th className="px-4 py-3 text-right">Saldo</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i} className={`border-b border-gray-100 dark:border-gray-700 transition-colors ${i % 2 === 0 ? 'bg-white dark:bg-gray-900' : 'bg-gray-50/50 dark:bg-gray-800/50'}`}>
                  <td className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100">{row.periodo_label}</td>
                  <td className="px-4 py-3 text-right text-red-600 dark:text-red-400">{fmt(row.debito_fiscal)}</td>
                  <td className="px-4 py-3 text-right text-green-600 dark:text-green-400">{fmt(row.credito_fiscal)}</td>
                  <td className={`px-4 py-3 text-right font-bold ${row.saldo >= 0 ? 'text-red-700 dark:text-red-400' : 'text-green-700 dark:text-green-400'}`}>
                    {row.saldo >= 0 ? '' : '-'}{fmt(Math.abs(row.saldo))}
                    <span className="ml-1.5 text-xs font-normal text-gray-400">
                      {row.saldo >= 0 ? 'a pagar' : 'a favor'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-gray-100 dark:bg-gray-800 font-bold text-sm border-t-2 border-gray-300 dark:border-gray-600">
                <td className="px-4 py-3 text-gray-700 dark:text-gray-300">TOTALES</td>
                <td className="px-4 py-3 text-right text-red-700 dark:text-red-400">{fmt(totalDebito)}</td>
                <td className="px-4 py-3 text-right text-green-700 dark:text-green-400">{fmt(totalCredito)}</td>
                <td className={`px-4 py-3 text-right ${totalSaldo >= 0 ? 'text-red-700 dark:text-red-400' : 'text-green-700 dark:text-green-400'}`}>
                  {totalSaldo >= 0 ? '' : '-'}{fmt(Math.abs(totalSaldo))}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>
    </>
  )
}

// -- Flujo de Caja --

const FlujoCajaTab: React.FC<{ rows: FlujoCajaRow[] }> = ({ rows }) => {
  if (rows.length === 0) {
    return <EmptyState title="Sin datos para el periodo" description="No hay movimientos de caja en el rango seleccionado" variant="filtered" />
  }

  const totalIngresos = rows.reduce((s, r) => s + r.ingresos, 0)
  const totalEgresos = rows.reduce((s, r) => s + r.egresos, 0)
  const totalNeto = rows.reduce((s, r) => s + r.neto, 0)
  const maxValue = Math.max(...rows.map(r => Math.max(r.ingresos, r.egresos)), 1)

  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <Card className="border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/30">
          <CardContent className="pt-3 pb-2">
            <p className="text-xs text-green-700 dark:text-green-300">Total Ingresos</p>
            <p className="text-xl font-bold text-green-800 dark:text-green-200">{fmt(totalIngresos)}</p>
          </CardContent>
        </Card>
        <Card className="border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/30">
          <CardContent className="pt-3 pb-2">
            <p className="text-xs text-red-700 dark:text-red-300">Total Egresos</p>
            <p className="text-xl font-bold text-red-800 dark:text-red-200">{fmt(totalEgresos)}</p>
          </CardContent>
        </Card>
        <Card className={`border ${totalNeto >= 0 ? 'border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/30' : 'border-orange-200 dark:border-orange-800 bg-orange-50 dark:bg-orange-900/30'}`}>
          <CardContent className="pt-3 pb-2">
            <p className={`text-xs ${totalNeto >= 0 ? 'text-blue-700 dark:text-blue-300' : 'text-orange-700 dark:text-orange-300'}`}>Flujo Neto</p>
            <p className={`text-xl font-bold ${totalNeto >= 0 ? 'text-blue-800 dark:text-blue-200' : 'text-orange-800 dark:text-orange-200'}`}>{fmt(totalNeto)}</p>
          </CardContent>
        </Card>
      </div>

      {/* Bar chart */}
      <Card>
        <CardContent>
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4">Ingresos vs Egresos por Periodo</h3>
          <div className="space-y-4">
            {rows.map((row, i) => (
              <div key={i} className="space-y-1.5">
                <div className="flex items-center justify-between text-xs text-gray-600 dark:text-gray-400">
                  <span className="font-medium">{row.periodo_label}</span>
                  <span className={`font-bold ${row.neto >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                    Neto: {fmt(row.neto)}
                  </span>
                </div>
                {/* Ingresos bar */}
                <div className="flex items-center gap-2">
                  <span className="text-[10px] w-14 text-right text-gray-400 shrink-0">Ingresos</span>
                  <div className="flex-1 bg-gray-100 dark:bg-gray-700 rounded-full h-4 overflow-hidden">
                    <div
                      className="h-full bg-green-500 dark:bg-green-600 rounded-full transition-all duration-500"
                      style={{ width: `${Math.max((row.ingresos / maxValue) * 100, 0.5)}%` }}
                    />
                  </div>
                  <span className="text-xs text-gray-600 dark:text-gray-300 w-28 text-right shrink-0 font-mono">{fmt(row.ingresos)}</span>
                </div>
                {/* Egresos bar */}
                <div className="flex items-center gap-2">
                  <span className="text-[10px] w-14 text-right text-gray-400 shrink-0">Egresos</span>
                  <div className="flex-1 bg-gray-100 dark:bg-gray-700 rounded-full h-4 overflow-hidden">
                    <div
                      className="h-full bg-red-500 dark:bg-red-600 rounded-full transition-all duration-500"
                      style={{ width: `${Math.max((row.egresos / maxValue) * 100, 0.5)}%` }}
                    />
                  </div>
                  <span className="text-xs text-gray-600 dark:text-gray-300 w-28 text-right shrink-0 font-mono">{fmt(row.egresos)}</span>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-800 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                <th className="px-4 py-3">Periodo</th>
                <th className="px-4 py-3 text-right">Ingresos</th>
                <th className="px-4 py-3 text-right">Egresos</th>
                <th className="px-4 py-3 text-right">Neto</th>
                <th className="px-4 py-3 text-right">Acumulado</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i} className={`border-b border-gray-100 dark:border-gray-700 transition-colors ${i % 2 === 0 ? 'bg-white dark:bg-gray-900' : 'bg-gray-50/50 dark:bg-gray-800/50'}`}>
                  <td className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100">{row.periodo_label}</td>
                  <td className="px-4 py-3 text-right text-green-600 dark:text-green-400">{fmt(row.ingresos)}</td>
                  <td className="px-4 py-3 text-right text-red-600 dark:text-red-400">{fmt(row.egresos)}</td>
                  <td className={`px-4 py-3 text-right font-bold ${row.neto >= 0 ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'}`}>
                    {fmt(row.neto)}
                  </td>
                  <td className={`px-4 py-3 text-right font-medium ${row.acumulado >= 0 ? 'text-blue-700 dark:text-blue-400' : 'text-orange-700 dark:text-orange-400'}`}>
                    {fmt(row.acumulado)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-gray-100 dark:bg-gray-800 font-bold text-sm border-t-2 border-gray-300 dark:border-gray-600">
                <td className="px-4 py-3 text-gray-700 dark:text-gray-300">TOTALES</td>
                <td className="px-4 py-3 text-right text-green-700 dark:text-green-400">{fmt(totalIngresos)}</td>
                <td className="px-4 py-3 text-right text-red-700 dark:text-red-400">{fmt(totalEgresos)}</td>
                <td className={`px-4 py-3 text-right ${totalNeto >= 0 ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'}`}>
                  {fmt(totalNeto)}
                </td>
                <td className="px-4 py-3 text-right text-gray-500 dark:text-gray-400">-</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>
    </>
  )
}
