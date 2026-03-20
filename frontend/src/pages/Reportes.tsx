import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { Card, CardContent } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { DateInput } from '@/components/ui/DateInput'
import { SkeletonTable, SkeletonCards } from '@/components/ui/Skeleton'
import { ExportExcelButton } from '@/components/shared/ExportExcel'
import { api } from '@/services/api'
import { formatDate } from '@/lib/utils'
import { useBilling } from '@/hooks/useBilling'
import { UpgradePrompt } from '@/components/shared/UpgradePrompt'
import { LibroIVAVentasTab } from '@/components/reportes/LibroIVAVentasTab'
import { LibroIVAComprasTab } from '@/components/reportes/LibroIVAComprasTab'
import { PosicionIVATab } from '@/components/reportes/PosicionIVATab'
import { FlujoCajaTab } from '@/components/reportes/FlujoCajaTab'
import { VentasTab } from '@/components/reportes/VentasTab'
import { RentabilidadTab } from '@/components/reportes/RentabilidadTab'
import { ClientesTab } from '@/components/reportes/ClientesTab'
import { CobranzasTab } from '@/components/reportes/CobranzasTab'
import { InventarioTab } from '@/components/reportes/InventarioTab'
import { ConversionTab } from '@/components/reportes/ConversionTab'
import {
  getMonthRange,
  getSixMonthsRange,
  resolvePreset,
  validateDateRange,
  isRangeOverOneYear,
  getActivePreset,
  buildExcelFilename,
} from '@/components/reportes/helpers'
import type {
  TabKey,
  DatePreset,
  IVAVentasRow,
  IVAComprasRow,
  PosicionIVARow,
  FlujoCajaRow,
  VentasReportData,
  RentabilidadReportData,
  ClientesReportData,
  CobranzasReportData,
  InventarioReportData,
  ConversionReportData,
} from '@/components/reportes/types'

// -- Tab groups --

const ACCOUNTING_TABS: { key: TabKey; label: string }[] = [
  { key: 'iva_ventas', label: 'Libro IVA Ventas' },
  { key: 'iva_compras', label: 'Libro IVA Compras' },
  { key: 'posicion', label: 'Posicion IVA' },
  { key: 'flujo', label: 'Flujo de Caja' },
]

const BUSINESS_TABS: { key: TabKey; label: string }[] = [
  { key: 'biz_ventas', label: 'Ventas' },
  { key: 'biz_rentabilidad', label: 'Rentabilidad' },
  { key: 'biz_clientes', label: 'Clientes' },
  { key: 'biz_cobranzas', label: 'Cobranzas' },
  { key: 'biz_inventario', label: 'Inventario' },
  { key: 'biz_conversion', label: 'Conversion' },
]

const ALL_TABS = [...ACCOUNTING_TABS, ...BUSINESS_TABS]

const DATE_PRESETS: { key: DatePreset; label: string }[] = [
  { key: 'este_mes', label: 'Este mes' },
  { key: 'mes_anterior', label: 'Mes anterior' },
  { key: 'trimestre', label: 'Este trimestre' },
  { key: 'anio', label: 'Este anio' },
]

// Tabs that use a 6-month default range
const LONG_RANGE_TABS: TabKey[] = ['posicion', 'flujo']
// Tabs that need date-range validation for >1 year
const IVA_TABS: TabKey[] = ['iva_ventas', 'iva_compras']
// Tabs that don't need date range (inventario)
const NO_DATE_TABS: TabKey[] = ['biz_inventario']

function isAccountingTab(tab: TabKey): boolean {
  return ACCOUNTING_TABS.some(t => t.key === tab)
}

// -- Excel column definitions --

const ventasExcelCols = [
  { key: 'invoice_date', label: 'Fecha', type: 'date' as const },
  { key: 'comprobante', label: 'Comprobante' },
  { key: 'customer_name', label: 'Cliente' },
  { key: 'customer_cuit', label: 'CUIT' },
  { key: 'neto_gravado', label: 'Neto Gravado', type: 'currency' as const },
  { key: 'neto_no_gravado', label: 'Neto No Gravado', type: 'currency' as const },
  { key: 'iva_27', label: 'IVA 27%', type: 'currency' as const },
  { key: 'iva_21', label: 'IVA 21%', type: 'currency' as const },
  { key: 'iva_10_5', label: 'IVA 10,5%', type: 'currency' as const },
  { key: 'iva_5', label: 'IVA 5%', type: 'currency' as const },
  { key: 'iva_2_5', label: 'IVA 2,5%', type: 'currency' as const },
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

// Business tabs don't use the top-level Excel button (they have their own via the tab component)
// but we still need a fallback for the print header

// -- Component --

// Tabs that require Premium plan (advanced_reports feature)
const PREMIUM_TABS: TabKey[] = ['biz_rentabilidad', 'biz_clientes', 'biz_cobranzas', 'biz_inventario', 'biz_conversion']

export const Reportes: React.FC = () => {
  const { hasFeature } = useBilling()
  const canAccessAdvanced = hasFeature('advanced_reports')

  const [activeTab, setActiveTab] = useState<TabKey>('biz_ventas')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Date range
  const defaultRange = getMonthRange(0)
  const [dateFrom, setDateFrom] = useState(defaultRange.from)
  const [dateTo, setDateTo] = useState(defaultRange.to)
  const [dateError, setDateError] = useState<string | null>(null)

  // Accounting data
  const [ivaVentasRows, setIvaVentasRows] = useState<IVAVentasRow[]>([])
  const [ivaVentasTotals, setIvaVentasTotals] = useState<Record<string, number>>({})
  const [ivaComprasRows, setIvaComprasRows] = useState<IVAComprasRow[]>([])
  const [ivaComprasTotals, setIvaComprasTotals] = useState<Record<string, number>>({})
  const [posicionRows, setPosicionRows] = useState<PosicionIVARow[]>([])
  const [flujoRows, setFlujoRows] = useState<FlujoCajaRow[]>([])

  // Business data
  const [bizVentasData, setBizVentasData] = useState<VentasReportData | null>(null)
  const [bizRentabilidadData, setBizRentabilidadData] = useState<RentabilidadReportData | null>(null)
  const [bizClientesData, setBizClientesData] = useState<ClientesReportData | null>(null)
  const [bizCobranzasData, setBizCobranzasData] = useState<CobranzasReportData | null>(null)
  const [bizInventarioData, setBizInventarioData] = useState<InventarioReportData | null>(null)
  const [bizConversionData, setBizConversionData] = useState<ConversionReportData | null>(null)

  // Date validation
  useEffect(() => {
    const rangeErr = validateDateRange(dateFrom, dateTo)
    if (rangeErr) {
      setDateError(rangeErr)
      return
    }
    if (IVA_TABS.includes(activeTab) && isRangeOverOneYear(dateFrom, dateTo)) {
      setDateError('El rango de fechas no puede superar 1 anio para el Libro IVA. Reducilo para evitar problemas de rendimiento.')
      return
    }
    setDateError(null)
  }, [dateFrom, dateTo, activeTab])

  const loadData = useCallback(async () => {
    // Don't load data for premium tabs the user can't access
    if (PREMIUM_TABS.includes(activeTab) && !canAccessAdvanced) return

    // Skip date validation for inventory tab
    if (!NO_DATE_TABS.includes(activeTab)) {
      if (validateDateRange(dateFrom, dateTo)) return
      if (IVA_TABS.includes(activeTab) && isRangeOverOneYear(dateFrom, dateTo)) return
    }

    setLoading(true)
    setError(null)
    try {
      switch (activeTab) {
        case 'iva_ventas': {
          const res = await api.getLibroIVAVentas(dateFrom, dateTo)
          setIvaVentasRows(res.rows || [])
          setIvaVentasTotals(res.totals || {})
          break
        }
        case 'iva_compras': {
          const res = await api.getLibroIVACompras(dateFrom, dateTo)
          setIvaComprasRows(res.rows || [])
          setIvaComprasTotals(res.totals || {})
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
        case 'biz_ventas': {
          const res = await api.getBusinessVentas(dateFrom, dateTo)
          setBizVentasData(res)
          break
        }
        case 'biz_rentabilidad': {
          const res = await api.getBusinessRentabilidad(dateFrom, dateTo)
          setBizRentabilidadData(res)
          break
        }
        case 'biz_clientes': {
          const res = await api.getBusinessClientes(dateFrom, dateTo)
          setBizClientesData(res)
          break
        }
        case 'biz_cobranzas': {
          const res = await api.getBusinessCobranzas(dateFrom, dateTo)
          setBizCobranzasData(res)
          break
        }
        case 'biz_inventario': {
          const res = await api.getBusinessInventario()
          setBizInventarioData(res)
          break
        }
        case 'biz_conversion': {
          const res = await api.getBusinessConversion(dateFrom, dateTo)
          setBizConversionData(res)
          break
        }
      }
    } catch (e: any) {
      setError(e.message || 'Error cargando reporte')
    } finally {
      setLoading(false)
    }
  }, [activeTab, dateFrom, dateTo, canAccessAdvanced])

  useEffect(() => { loadData() }, [loadData])

  // When switching tabs, set sensible default date ranges
  const handleTabChange = (tab: TabKey) => {
    if (tab === activeTab) return
    if (LONG_RANGE_TABS.includes(tab)) {
      const range = getSixMonthsRange()
      setDateFrom(range.from)
      setDateTo(range.to)
    } else if (!NO_DATE_TABS.includes(tab)) {
      const range = getMonthRange(0)
      setDateFrom(range.from)
      setDateTo(range.to)
    }
    setActiveTab(tab)
  }

  const applyPreset = (preset: DatePreset) => {
    const range = resolvePreset(preset)
    setDateFrom(range.from)
    setDateTo(range.to)
  }

  const resetFilters = () => {
    const range = LONG_RANGE_TABS.includes(activeTab)
      ? getSixMonthsRange()
      : getMonthRange(0)
    setDateFrom(range.from)
    setDateTo(range.to)
  }

  const handlePrint = () => {
    window.print()
  }

  // Active preset detection
  const activePreset = getActivePreset(dateFrom, dateTo)

  // Whether to show date filters (all tabs except inventory)
  const showDateFilters = !NO_DATE_TABS.includes(activeTab)

  // Excel data (only for accounting tabs that have row-level export)
  const currentExcelData = useMemo(() => {
    const filename = buildExcelFilename(activeTab, dateFrom, dateTo)
    const dateRangeStr = `${formatDate(dateFrom)} - ${formatDate(dateTo)}`
    const tabLabel = ALL_TABS.find(t => t.key === activeTab)?.label || 'Reporte'
    const headerText = `BeckerVisual - ${tabLabel} - ${dateRangeStr}`

    // Business tabs: provide empty data (business tabs export differently via their own components)
    if (!isAccountingTab(activeTab)) {
      return {
        data: [] as any[],
        columns: [] as any[],
        filename,
        totalsRow: undefined as any,
        headerText,
      }
    }

    switch (activeTab) {
      case 'iva_ventas':
        return {
          data: ivaVentasRows,
          columns: ventasExcelCols,
          filename,
          totalsRow: {
            invoice_date: '',
            comprobante: 'TOTALES',
            customer_name: '',
            customer_cuit: '',
            ...ivaVentasTotals,
          },
          headerText,
        }
      case 'iva_compras':
        return {
          data: ivaComprasRows,
          columns: comprasExcelCols,
          filename,
          totalsRow: {
            date: '',
            comprobante: 'TOTALES',
            enterprise_name: '',
            enterprise_cuit: '',
            ...ivaComprasTotals,
          },
          headerText,
        }
      case 'posicion': {
        const totalDebito = posicionRows.reduce((s, r) => s + r.debito_fiscal, 0)
        const totalCredito = posicionRows.reduce((s, r) => s + r.credito_fiscal, 0)
        const totalSaldo = posicionRows.reduce((s, r) => s + r.saldo, 0)
        return {
          data: posicionRows,
          columns: posicionExcelCols,
          filename,
          totalsRow: {
            periodo_label: 'TOTALES',
            debito_fiscal: totalDebito,
            credito_fiscal: totalCredito,
            saldo: totalSaldo,
          },
          headerText,
        }
      }
      case 'flujo': {
        const totalIngresos = flujoRows.reduce((s, r) => s + r.ingresos, 0)
        const totalEgresos = flujoRows.reduce((s, r) => s + r.egresos, 0)
        const totalNeto = flujoRows.reduce((s, r) => s + r.neto, 0)
        return {
          data: flujoRows,
          columns: flujoExcelCols,
          filename,
          totalsRow: {
            periodo_label: 'TOTALES',
            ingresos: totalIngresos,
            egresos: totalEgresos,
            neto: totalNeto,
            acumulado: '',
          },
          headerText,
        }
      }
      default:
        return { data: [], columns: [], filename, totalsRow: undefined, headerText }
    }
  }, [activeTab, ivaVentasRows, ivaComprasRows, posicionRows, flujoRows, ivaVentasTotals, ivaComprasTotals, dateFrom, dateTo])

  const skeletonConfig = useMemo(() => {
    if (isAccountingTab(activeTab)) {
      return {
        cards: activeTab === 'iva_ventas' ? 4 : 3,
        cols: activeTab === 'iva_ventas' ? 11 : activeTab === 'iva_compras' ? 7 : activeTab === 'posicion' ? 4 : 5,
      }
    }
    return { cards: 3, cols: 5 }
  }, [activeTab])

  const renderTabButton = (tab: { key: TabKey; label: string }) => {
    const isLocked = PREMIUM_TABS.includes(tab.key) && !canAccessAdvanced
    return (
      <button
        key={tab.key}
        role="tab"
        aria-selected={activeTab === tab.key}
        onClick={() => handleTabChange(tab.key)}
        className={`px-3 py-2 text-sm font-medium whitespace-nowrap border-b-2 transition-colors flex items-center gap-1.5 ${
          activeTab === tab.key
            ? 'border-blue-600 text-blue-600 dark:text-blue-400 dark:border-blue-400 bg-blue-50/50 dark:bg-blue-900/20'
            : isLocked
              ? 'border-transparent text-gray-400 dark:text-gray-500 hover:text-gray-500 hover:border-gray-200'
              : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:border-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'
        }`}
      >
        {tab.label}
        {isLocked && (
          <svg className="w-3 h-3 text-gray-400 shrink-0" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
          </svg>
        )}
      </button>
    )
  }

  return (
    <div className="space-y-6 print:space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between print:hidden">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Reportes</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Reportes contables y de negocio
          </p>
        </div>
        {isAccountingTab(activeTab) && (
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handlePrint}>
              <svg className="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
              </svg>
              Imprimir
            </Button>
            {currentExcelData.data.length > 0 && (
              <ExportExcelButton
                data={currentExcelData.data}
                columns={currentExcelData.columns}
                filename={currentExcelData.filename}
                totalsRow={currentExcelData.totalsRow}
                headerText={currentExcelData.headerText}
              />
            )}
          </div>
        )}
      </div>

      {/* Print header (only visible in print) */}
      <div className="hidden print:block print:mb-4">
        <h1 className="text-xl font-bold">{ALL_TABS.find(t => t.key === activeTab)?.label}</h1>
        <p className="text-sm text-gray-600">{formatDate(dateFrom)} - {formatDate(dateTo)}</p>
      </div>

      {/* Tabs - two groups with visual separator */}
      <div className="border-b border-gray-200 dark:border-gray-700 print:hidden">
        <nav className="flex gap-0 -mb-px overflow-x-auto" role="tablist">
          {/* Business group */}
          <div className="flex items-center">
            <span className="text-[10px] uppercase tracking-widest text-gray-400 dark:text-gray-500 px-2 py-2 self-end select-none">
              Negocio
            </span>
            {BUSINESS_TABS.map(renderTabButton)}
          </div>

          {/* Separator */}
          <div className="mx-1.5 self-stretch flex items-end pb-2">
            <div className="w-px h-5 bg-gray-300 dark:bg-gray-600" />
          </div>

          {/* Accounting group */}
          <div className="flex items-center">
            <span className="text-[10px] uppercase tracking-widest text-gray-400 dark:text-gray-500 px-2 py-2 self-end select-none">
              Contable
            </span>
            {ACCOUNTING_TABS.map(renderTabButton)}
          </div>
        </nav>
      </div>

      {/* Filters */}
      {showDateFilters && (
        <Card className="print:hidden">
          <CardContent className="pt-4 pb-3">
            <div className="flex flex-wrap items-end gap-3">
              <DateInput
                label="Desde"
                value={dateFrom}
                onChange={setDateFrom}
                className={`text-sm py-1.5 ${
                  dateError ? 'border-red-400 dark:border-red-600' : ''
                }`}
              />
              <DateInput
                label="Hasta"
                value={dateTo}
                onChange={setDateTo}
                className={`text-sm py-1.5 ${
                  dateError ? 'border-red-400 dark:border-red-600' : ''
                }`}
              />
              <div className="flex gap-1.5 flex-wrap">
                {DATE_PRESETS.map(p => (
                  <button
                    key={p.key}
                    onClick={() => applyPreset(p.key)}
                    className={`px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                      activePreset === p.key
                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 ring-1 ring-blue-500/30'
                        : 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <button
                onClick={resetFilters}
                className="px-2.5 py-1.5 text-xs font-medium rounded-lg text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                title="Limpiar filtros"
              >
                Limpiar filtros
              </button>
            </div>
            {dateError && (
              <p className="mt-2 text-xs text-red-600 dark:text-red-400 flex items-center gap-1">
                <svg className="w-3.5 h-3.5 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
                {dateError}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Error */}
      {error && (
        <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 px-4 py-3 rounded-lg animate-fadeIn flex items-center justify-between">
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5 shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
            </svg>
            <span className="text-sm">{error}</span>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="xs" onClick={loadData}>
              Reintentar
            </Button>
            <button
              onClick={() => setError(null)}
              className="text-red-500 hover:text-red-700 dark:hover:text-red-200 transition-colors p-1"
              aria-label="Cerrar error"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="space-y-6">
          <SkeletonCards count={skeletonConfig.cards} />
          <SkeletonTable rows={8} cols={skeletonConfig.cols} />
        </div>
      ) : (
        <>
          {/* Accounting tabs */}
          {activeTab === 'iva_ventas' && <LibroIVAVentasTab rows={ivaVentasRows} totals={ivaVentasTotals} />}
          {activeTab === 'iva_compras' && <LibroIVAComprasTab rows={ivaComprasRows} totals={ivaComprasTotals} />}
          {activeTab === 'posicion' && <PosicionIVATab rows={posicionRows} />}
          {activeTab === 'flujo' && <FlujoCajaTab rows={flujoRows} />}

          {/* Business tabs */}
          {activeTab === 'biz_ventas' && <VentasTab data={bizVentasData} />}
          {activeTab === 'biz_rentabilidad' && (canAccessAdvanced ? <RentabilidadTab data={bizRentabilidadData} /> : <UpgradePrompt feature="advanced_reports" />)}
          {activeTab === 'biz_clientes' && (canAccessAdvanced ? <ClientesTab data={bizClientesData} /> : <UpgradePrompt feature="advanced_reports" />)}
          {activeTab === 'biz_cobranzas' && (canAccessAdvanced ? <CobranzasTab data={bizCobranzasData} /> : <UpgradePrompt feature="advanced_reports" />)}
          {activeTab === 'biz_inventario' && (canAccessAdvanced ? <InventarioTab data={bizInventarioData} /> : <UpgradePrompt feature="advanced_reports" />)}
          {activeTab === 'biz_conversion' && (canAccessAdvanced ? <ConversionTab data={bizConversionData} /> : <UpgradePrompt feature="advanced_reports" />)}
        </>
      )}
    </div>
  )
}
