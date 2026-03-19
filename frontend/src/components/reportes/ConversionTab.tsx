import React, { useMemo } from 'react'
import { Card, CardContent } from '@/components/ui/Card'
import { EmptyState } from '@/components/shared/EmptyState'
import { SummaryCard } from './SummaryCard'
import { ReportTable } from './ReportTable'
import { fmtCurrency, fmtDelta, fmtPercent } from './helpers'
import { formatDate } from '@/lib/utils'
import type { ConversionReportData, CotizacionAbierta } from './types'

interface Props {
  data: ConversionReportData | null
}

export const ConversionTab: React.FC<Props> = ({ data }) => {
  if (!data) {
    return (
      <EmptyState
        title="Sin datos de presupuestos"
        description="No hay presupuestos en el rango seleccionado."
        variant="filtered"
      />
    )
  }

  const { summary, funnel, cotizaciones_abiertas } = data

  if (summary.total_cotizaciones === 0) {
    return (
      <EmptyState
        title="Sin presupuestos en este periodo"
        description="No se emitieron cotizaciones en el rango de fechas seleccionado. Crea un presupuesto para empezar a medir la conversion."
        variant="filtered"
      />
    )
  }

  // Funnel visualization: bars getting smaller
  const maxFunnelCantidad = Math.max(...funnel.map(f => f.cantidad), 1)

  const funnelColors: Record<string, string> = {
    'Emitidas': 'bg-blue-500 dark:bg-blue-600',
    'Aceptadas': 'bg-green-500 dark:bg-green-600',
    'Rechazadas': 'bg-red-500 dark:bg-red-600',
    'Abiertas': 'bg-yellow-500 dark:bg-yellow-600',
  }

  const columns = useMemo(() => [
    {
      key: 'cliente',
      label: 'Cliente',
      align: 'left' as const,
      render: (row: CotizacionAbierta) => (
        <span className="font-medium text-gray-900 dark:text-gray-100">{row.cliente}</span>
      ),
    },
    {
      key: 'titulo',
      label: 'Titulo',
      align: 'left' as const,
      render: (row: CotizacionAbierta) => (
        <span className="text-gray-700 dark:text-gray-300 truncate max-w-[200px] block">{row.titulo}</span>
      ),
    },
    {
      key: 'fecha',
      label: 'Fecha',
      align: 'right' as const,
      render: (row: CotizacionAbierta) => (
        <span className="text-gray-500 dark:text-gray-400 text-xs">{formatDate(row.fecha)}</span>
      ),
    },
    {
      key: 'monto',
      label: 'Monto',
      align: 'right' as const,
      render: (row: CotizacionAbierta) => (
        <span className="font-semibold tabular-nums text-gray-900 dark:text-gray-100">{fmtCurrency(row.monto)}</span>
      ),
    },
    {
      key: 'dias_abierto',
      label: 'Dias abierto',
      align: 'right' as const,
      render: (row: CotizacionAbierta) => (
        <span className={`tabular-nums font-semibold ${row.dias_abierto > 30 ? 'text-red-600 dark:text-red-400' : row.dias_abierto > 14 ? 'text-orange-600 dark:text-orange-400' : 'text-gray-600 dark:text-gray-400'}`}>
          {row.dias_abierto}d
        </span>
      ),
    },
  ], [])

  return (
    <>
      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <SummaryCard
          label="Tasa de conversion"
          value={fmtPercent(summary.tasa_conversion)}
          colorScheme={summary.tasa_conversion >= 50 ? 'green' : summary.tasa_conversion >= 25 ? 'blue' : 'orange'}
          subtitle={summary.tasa_conversion_delta !== null ? `${summary.tasa_conversion_delta! >= 0 ? '↑' : '↓'} ${fmtDelta(summary.tasa_conversion_delta)} vs anterior` : undefined}
        />
        <SummaryCard
          label="Pipeline abierto"
          value={fmtCurrency(summary.valor_pipeline)}
          colorScheme="blue"
          subtitle={`${summary.total_cotizaciones} cotizaciones emitidas`}
        />
        <SummaryCard
          label="Valor prom. perdido"
          value={fmtCurrency(summary.valor_promedio_perdido)}
          colorScheme={summary.valor_promedio_perdido > 0 ? 'red' : 'gray'}
          subtitle={summary.tiempo_promedio_dias > 0 ? `${summary.tiempo_promedio_dias} dias prom. de cierre` : undefined}
        />
      </div>

      {/* Funnel chart */}
      <Card className="print:break-inside-avoid">
        <CardContent>
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4">Funnel de conversion</h3>
          <div className="space-y-3">
            {funnel.map((step, i) => {
              const rate = i > 0 && funnel[0].cantidad > 0
                ? Math.round((step.cantidad / funnel[0].cantidad) * 100)
                : 100
              return (
                <div key={i} className="space-y-1">
                  <div className="flex items-center justify-between text-xs text-gray-600 dark:text-gray-400">
                    <span className="font-medium">{step.etapa}</span>
                    <div className="flex items-center gap-3">
                      <span className="tabular-nums">{step.cantidad}</span>
                      {step.valor > 0 && <span className="tabular-nums">{fmtCurrency(step.valor)}</span>}
                      {i > 0 && <span className="text-gray-400">({rate}%)</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 bg-gray-100 dark:bg-gray-700 rounded-full h-6 overflow-hidden">
                      <div
                        className={`h-full ${funnelColors[step.etapa] || 'bg-gray-500'} rounded-full transition-all duration-500 flex items-center justify-end pr-2`}
                        style={{ width: `${Math.max((step.cantidad / maxFunnelCantidad) * 100, 3)}%`, minWidth: '8px' }}
                      >
                        {(step.cantidad / maxFunnelCantidad) > 0.15 && (
                          <span className="text-[10px] font-medium text-white whitespace-nowrap">{step.cantidad}</span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Conversion rate between steps */}
          {funnel[0].cantidad > 0 && (
            <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700 flex items-center justify-center gap-6 text-xs text-gray-500 dark:text-gray-400">
              <span>
                Conversion: <strong className="text-gray-900 dark:text-gray-100">{fmtPercent(summary.tasa_conversion)}</strong>
              </span>
              {summary.tiempo_promedio_dias > 0 && (
                <span>
                  Tiempo promedio: <strong className="text-gray-900 dark:text-gray-100">{summary.tiempo_promedio_dias} dias</strong>
                </span>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Open quotes table */}
      {cotizaciones_abiertas.length > 0 && (
        <>
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-2">
            Cotizaciones abiertas
            <span className="text-xs px-2 py-0.5 rounded bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-300">
              {cotizaciones_abiertas.length}
            </span>
          </h3>
          <ReportTable columns={columns} rows={cotizaciones_abiertas} highlightable />
        </>
      )}
    </>
  )
}
