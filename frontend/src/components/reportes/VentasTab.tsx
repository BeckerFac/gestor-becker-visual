import React, { useMemo } from 'react'
import { Card, CardContent } from '@/components/ui/Card'
import { EmptyState } from '@/components/shared/EmptyState'
import { SummaryCard } from './SummaryCard'
import { ReportTable } from './ReportTable'
import { TabActionBar } from './TabActionBar'
import { fmtCurrency, fmtDelta, fmtNumber } from './helpers'
import type { VentasReportData, TopProductoRow } from './types'

interface Props {
  data: VentasReportData | null
}

export const VentasTab: React.FC<Props> = ({ data }) => {
  if (!data) {
    return (
      <EmptyState
        title="Sin datos para el periodo"
        description="No hay ventas registradas en el rango seleccionado. Proba con un rango de fechas mas amplio."
        variant="filtered"
      />
    )
  }

  const { summary, ventas_por_mes, top_productos, ventas_por_dia } = data
  const allZero = summary.total_facturado === 0 && summary.cantidad_pedidos === 0

  if (allZero) {
    return (
      <EmptyState
        title="No hay actividad en este periodo"
        description="No se registraron ventas en el rango de fechas seleccionado."
        variant="filtered"
      />
    )
  }

  const maxBarValue = Math.max(...ventas_por_mes.map(r => r.total), 1)

  const deltaColor = (d: number | null) => {
    if (d === null) return 'text-gray-400 dark:text-gray-500'
    return d >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
  }

  const deltaArrow = (d: number | null) => d !== null && d > 0 ? '↑' : d !== null && d < 0 ? '↓' : ''

  const topProductColumns = useMemo(() => [
    {
      key: 'nombre',
      label: 'Producto',
      align: 'left' as const,
      render: (row: TopProductoRow) => (
        <span className="font-medium text-gray-900 dark:text-gray-100">{row.nombre}</span>
      ),
    },
    {
      key: 'unidades',
      label: 'Unidades',
      align: 'right' as const,
      render: (row: TopProductoRow) => (
        <span className="tabular-nums text-gray-700 dark:text-gray-300">{fmtNumber(row.unidades)}</span>
      ),
    },
    {
      key: 'revenue',
      label: 'Facturado',
      align: 'right' as const,
      render: (row: TopProductoRow) => (
        <span className="font-semibold tabular-nums text-gray-900 dark:text-gray-100">{fmtCurrency(row.revenue)}</span>
      ),
    },
  ], [])

  const excelData = useMemo(() => {
    const rows: Record<string, any>[] = []
    ventas_por_mes.forEach(r => rows.push({ periodo: r.periodo, total: r.total, cantidad: r.cantidad }))
    return rows
  }, [ventas_por_mes])

  const excelColumns = [
    { key: 'periodo', label: 'Periodo' },
    { key: 'total', label: 'Total Facturado', type: 'currency' as const },
    { key: 'cantidad', label: 'Cantidad Pedidos', type: 'number' as const },
  ]

  return (
    <>
      <TabActionBar
        excelData={excelData}
        excelColumns={excelColumns}
        excelFilename="Ventas_Reporte"
        headerText="BeckerVisual - Reporte de Ventas"
      />

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <SummaryCard
          label="Total facturado"
          value={fmtCurrency(summary.total_facturado)}
          colorScheme="blue"
          subtitle={summary.total_facturado_delta !== null ? `${deltaArrow(summary.total_facturado_delta)} ${fmtDelta(summary.total_facturado_delta)} vs anterior` : undefined}
        />
        <SummaryCard
          label="Cantidad de pedidos"
          value={String(summary.cantidad_pedidos)}
          colorScheme="purple"
          subtitle={summary.cantidad_pedidos_delta !== null ? `${deltaArrow(summary.cantidad_pedidos_delta)} ${fmtDelta(summary.cantidad_pedidos_delta)} vs anterior` : undefined}
        />
        <SummaryCard
          label="Ticket promedio"
          value={fmtCurrency(summary.ticket_promedio)}
          colorScheme="green"
          subtitle={summary.ticket_promedio_delta !== null ? `${deltaArrow(summary.ticket_promedio_delta)} ${fmtDelta(summary.ticket_promedio_delta)} vs anterior` : undefined}
        />
      </div>

      {/* Sales by month chart */}
      {ventas_por_mes.length > 0 && (
        <Card className="print:break-inside-avoid">
          <CardContent>
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4">Ventas por periodo</h3>
            <div className="space-y-3">
              {ventas_por_mes.map((row, i) => (
                <div key={i} className="space-y-1">
                  <div className="flex items-center justify-between text-xs text-gray-600 dark:text-gray-400">
                    <span className="font-medium">{row.periodo}</span>
                    <span className="tabular-nums">{fmtCurrency(row.total)} ({row.cantidad} pedidos)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 bg-gray-100 dark:bg-gray-700 rounded-full h-5 overflow-hidden">
                      <div
                        className="h-full bg-blue-500 dark:bg-blue-600 rounded-full transition-all duration-500 flex items-center justify-end pr-1.5"
                        style={{ width: `${Math.max((row.total / maxBarValue) * 100, 2)}%`, minWidth: '4px' }}
                      >
                        {(row.total / maxBarValue) > 0.2 && (
                          <span className="text-[10px] font-medium text-white whitespace-nowrap">{fmtCurrency(row.total)}</span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Sales by day of week */}
      {ventas_por_dia.length > 0 && (
        <Card className="print:break-inside-avoid">
          <CardContent>
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4">Ventas por dia de la semana</h3>
            <div className="space-y-2">
              {ventas_por_dia.map((row, i) => {
                const maxDia = Math.max(...ventas_por_dia.map(d => d.total), 1)
                return (
                  <div key={i} className="flex items-center gap-3">
                    <span className="text-xs w-20 text-right text-gray-500 dark:text-gray-400 shrink-0">{row.dia}</span>
                    <div className="flex-1 bg-gray-100 dark:bg-gray-700 rounded-full h-4 overflow-hidden">
                      <div
                        className="h-full bg-purple-500 dark:bg-purple-600 rounded-full transition-all duration-500"
                        style={{ width: `${Math.max((row.total / maxDia) * 100, 2)}%`, minWidth: '4px' }}
                      />
                    </div>
                    <span className="text-xs tabular-nums text-gray-600 dark:text-gray-300 w-24 text-right shrink-0">{fmtCurrency(row.total)}</span>
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Top products table */}
      {top_productos.length > 0 && (
        <>
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Top 5 productos por facturacion</h3>
          <ReportTable columns={topProductColumns} rows={top_productos} />
        </>
      )}
    </>
  )
}
