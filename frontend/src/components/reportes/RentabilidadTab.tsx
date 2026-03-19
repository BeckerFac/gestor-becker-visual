import React, { useMemo } from 'react'
import { Card, CardContent } from '@/components/ui/Card'
import { EmptyState } from '@/components/shared/EmptyState'
import { SummaryCard } from './SummaryCard'
import { ReportTable } from './ReportTable'
import { TabActionBar } from './TabActionBar'
import { fmtCurrency, fmtDelta, fmtPercent } from './helpers'
import type { RentabilidadReportData, RentabilidadProducto } from './types'

interface Props {
  data: RentabilidadReportData | null
}

export const RentabilidadTab: React.FC<Props> = ({ data }) => {
  if (!data) {
    return (
      <EmptyState
        title="Sin datos para el periodo"
        description="No hay ventas con productos en el rango seleccionado. Proba con un rango de fechas mas amplio."
        variant="filtered"
      />
    )
  }

  const { summary, top_por_margen, productos } = data

  if (productos.length === 0) {
    return (
      <EmptyState
        title="No hay actividad en este periodo"
        description="No se registraron ventas de productos en el rango de fechas seleccionado."
        variant="filtered"
      />
    )
  }

  const maxMargen = Math.max(...top_por_margen.map(p => Math.abs(p.margen)), 1)

  const margenColor = (pct: number, sinCosto: boolean): string => {
    if (sinCosto) return 'text-gray-400 dark:text-gray-500'
    if (pct >= 30) return 'text-green-600 dark:text-green-400'
    if (pct >= 15) return 'text-yellow-600 dark:text-yellow-400'
    return 'text-red-600 dark:text-red-400'
  }

  const barColor = (pct: number): string => {
    if (pct >= 30) return 'bg-green-500 dark:bg-green-600'
    if (pct >= 15) return 'bg-yellow-500 dark:bg-yellow-600'
    if (pct >= 0) return 'bg-orange-500 dark:bg-orange-600'
    return 'bg-red-500 dark:bg-red-600'
  }

  const columns = useMemo(() => [
    {
      key: 'nombre',
      label: 'Producto',
      align: 'left' as const,
      render: (row: RentabilidadProducto) => (
        <div className="flex items-center gap-2">
          <span className="font-medium text-gray-900 dark:text-gray-100">{row.nombre}</span>
          {row.sin_costo && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-300 whitespace-nowrap">
              Sin costo
            </span>
          )}
          {!row.sin_costo && row.margen < 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 whitespace-nowrap">
              Margen negativo
            </span>
          )}
        </div>
      ),
    },
    {
      key: 'revenue',
      label: 'Revenue',
      align: 'right' as const,
      render: (row: RentabilidadProducto) => (
        <span className="tabular-nums text-gray-700 dark:text-gray-300">{fmtCurrency(row.revenue)}</span>
      ),
    },
    {
      key: 'costo_total',
      label: 'Costo',
      align: 'right' as const,
      render: (row: RentabilidadProducto) => (
        <span className="tabular-nums text-gray-500 dark:text-gray-400">{fmtCurrency(row.costo_total)}</span>
      ),
    },
    {
      key: 'margen',
      label: 'Margen $',
      align: 'right' as const,
      render: (row: RentabilidadProducto) => (
        <span className={`font-semibold tabular-nums ${row.margen >= 0 ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'}`}>
          {fmtCurrency(row.margen)}
        </span>
      ),
    },
    {
      key: 'margen_pct',
      label: 'Margen %',
      align: 'right' as const,
      render: (row: RentabilidadProducto) => (
        <span className={`font-semibold tabular-nums ${margenColor(row.margen_pct, row.sin_costo)}`}>
          {row.sin_costo ? '-' : fmtPercent(row.margen_pct)}
        </span>
      ),
    },
    {
      key: 'unidades',
      label: 'Unidades',
      align: 'right' as const,
      render: (row: RentabilidadProducto) => (
        <span className="tabular-nums text-gray-600 dark:text-gray-400">{row.unidades.toLocaleString('es-AR')}</span>
      ),
    },
  ], [])

  const excelData = useMemo(() =>
    productos.map(p => ({
      nombre: p.nombre,
      revenue: p.revenue,
      costo_total: p.costo_total,
      margen: p.margen,
      margen_pct: p.margen_pct,
      unidades: p.unidades,
    })),
  [productos])

  const excelColumns = [
    { key: 'nombre', label: 'Producto' },
    { key: 'revenue', label: 'Revenue', type: 'currency' as const },
    { key: 'costo_total', label: 'Costo', type: 'currency' as const },
    { key: 'margen', label: 'Margen $', type: 'currency' as const },
    { key: 'margen_pct', label: 'Margen %', type: 'number' as const },
    { key: 'unidades', label: 'Unidades', type: 'number' as const },
  ]

  return (
    <>
      <TabActionBar
        excelData={excelData}
        excelColumns={excelColumns}
        excelFilename="Rentabilidad_Reporte"
        headerText="BeckerVisual - Reporte de Rentabilidad"
      />

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <SummaryCard
          label="Margen bruto total"
          value={fmtCurrency(summary.margen_total)}
          colorScheme={summary.margen_total >= 0 ? 'green' : 'red'}
          subtitle={summary.margen_total_delta !== null ? `${summary.margen_total_delta! >= 0 ? '↑' : '↓'} ${fmtDelta(summary.margen_total_delta)} vs anterior` : undefined}
        />
        <SummaryCard
          label="Margen promedio"
          value={fmtPercent(summary.margen_promedio_pct)}
          colorScheme="blue"
          subtitle={summary.margen_promedio_pct_delta !== null ? `${summary.margen_promedio_pct_delta! >= 0 ? '↑' : '↓'} ${fmtDelta(summary.margen_promedio_pct_delta)} vs anterior` : undefined}
        />
        <SummaryCard
          label="Productos margen bajo (<15%)"
          value={String(summary.productos_margen_bajo)}
          colorScheme={summary.productos_margen_bajo > 0 ? 'orange' : 'gray'}
          subtitle={summary.productos_margen_negativo > 0 ? `${summary.productos_margen_negativo} con margen negativo` : undefined}
        />
      </div>

      {/* Top products by margin - horizontal bars */}
      {top_por_margen.length > 0 && (
        <Card className="print:break-inside-avoid">
          <CardContent>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Top productos por margen bruto</h3>
              <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400">
                <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-green-500 inline-block" /> {'>'}30%</span>
                <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-yellow-500 inline-block" /> 15-30%</span>
                <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-red-500 inline-block" /> {'<'}15%</span>
              </div>
            </div>
            <div className="space-y-3">
              {top_por_margen.map((row, i) => (
                <div key={i} className="space-y-1">
                  <div className="flex items-center justify-between text-xs text-gray-600 dark:text-gray-400">
                    <span className="font-medium truncate max-w-[200px]">{row.nombre}</span>
                    <div className="flex items-center gap-3">
                      <span className={`font-semibold ${margenColor(row.margen_pct, row.sin_costo)}`}>{fmtPercent(row.margen_pct)}</span>
                      <span className="tabular-nums">{fmtCurrency(row.margen)}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 bg-gray-100 dark:bg-gray-700 rounded-full h-4 overflow-hidden">
                      <div
                        className={`h-full ${barColor(row.margen_pct)} rounded-full transition-all duration-500`}
                        style={{ width: `${Math.max((Math.abs(row.margen) / maxMargen) * 100, 2)}%`, minWidth: '4px' }}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Full products table */}
      <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Detalle por producto</h3>
      <ReportTable columns={columns} rows={productos} highlightable />
    </>
  )
}
