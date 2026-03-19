import React, { useMemo } from 'react'
import { Card, CardContent } from '@/components/ui/Card'
import { EmptyState } from '@/components/shared/EmptyState'
import { SummaryCard } from './SummaryCard'
import { ReportTable } from './ReportTable'
import { TabActionBar } from './TabActionBar'
import { fmtCurrency, fmtDelta } from './helpers'
import type { CobranzasReportData, MorosoRow } from './types'
import { AIReportNarrative } from '@/components/ai/AIReportNarrative'

interface Props {
  data: CobranzasReportData | null
}

const BUCKET_BAR_COLORS: Record<string, string> = {
  al_dia: 'bg-green-500 dark:bg-green-600',
  '1_30': 'bg-blue-500 dark:bg-blue-600',
  '31_60': 'bg-yellow-500 dark:bg-yellow-600',
  '61_90': 'bg-orange-500 dark:bg-orange-600',
  '90_plus': 'bg-red-500 dark:bg-red-600',
}

export const CobranzasTab: React.FC<Props> = ({ data }) => {
  if (!data) {
    return (
      <EmptyState
        title="Sin datos de cobranzas"
        description="No hay informacion de cobranzas disponible."
        variant="filtered"
      />
    )
  }

  const { summary, aging, morosos } = data

  const dsoColor = (): 'green' | 'orange' | 'red' => {
    if (summary.dso_promedio <= 30) return 'green'
    if (summary.dso_promedio <= 60) return 'orange'
    return 'red'
  }

  const maxAgingMonto = Math.max(...aging.map(a => a.monto), 1)

  const morososColumns = useMemo(() => [
    {
      key: 'nombre',
      label: 'Cliente',
      align: 'left' as const,
      render: (row: MorosoRow) => (
        <span className="font-medium text-gray-900 dark:text-gray-100">{row.nombre}</span>
      ),
    },
    {
      key: 'monto_pendiente',
      label: 'Monto pendiente',
      align: 'right' as const,
      render: (row: MorosoRow) => (
        <span className="font-semibold tabular-nums text-red-700 dark:text-red-400">{fmtCurrency(row.monto_pendiente)}</span>
      ),
    },
    {
      key: 'pedidos_pendientes',
      label: 'Pedidos',
      align: 'right' as const,
      render: (row: MorosoRow) => (
        <span className="tabular-nums text-gray-700 dark:text-gray-300">{row.pedidos_pendientes}</span>
      ),
    },
    {
      key: 'dias_max_atraso',
      label: 'Max atraso',
      align: 'right' as const,
      render: (row: MorosoRow) => (
        <span className={`tabular-nums font-semibold ${row.dias_max_atraso > 60 ? 'text-red-600 dark:text-red-400' : row.dias_max_atraso > 30 ? 'text-orange-600 dark:text-orange-400' : 'text-gray-600 dark:text-gray-400'}`}>
          {row.dias_max_atraso}d
        </span>
      ),
    },
  ], [])

  const excelData = useMemo(() => {
    const rows: Record<string, any>[] = []
    aging.forEach(a => rows.push({ bucket: a.label, cantidad: a.cantidad, monto: a.monto }))
    if (morosos.length > 0) {
      rows.push({ bucket: '', cantidad: '', monto: '' })
      rows.push({ bucket: 'MOROSOS', cantidad: 'Pedidos', monto: 'Monto' })
      morosos.forEach(m => rows.push({ bucket: m.nombre, cantidad: m.pedidos_pendientes, monto: m.monto_pendiente }))
    }
    return rows
  }, [aging, morosos])

  const excelColumns = [
    { key: 'bucket', label: 'Concepto' },
    { key: 'cantidad', label: 'Cantidad', type: 'number' as const },
    { key: 'monto', label: 'Monto', type: 'currency' as const },
  ]

  return (
    <>
      <AIReportNarrative reportType="cobranzas" reportData={data} />

      <TabActionBar
        excelData={excelData}
        excelColumns={excelColumns}
        excelFilename="Cobranzas_Reporte"
        headerText="BeckerVisual - Reporte de Cobranzas"
      />

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <SummaryCard
          label="Total a cobrar"
          value={fmtCurrency(summary.total_pendiente)}
          colorScheme="blue"
        />
        <SummaryCard
          label="DSO promedio"
          value={`${summary.dso_promedio} dias`}
          colorScheme={dsoColor()}
          subtitle={summary.dso_promedio_delta !== null ? `${summary.dso_promedio_delta! >= 0 ? '↑' : '↓'} ${fmtDelta(summary.dso_promedio_delta)} vs anterior` : undefined}
        />
        <SummaryCard
          label="Facturas vencidas"
          value={`${summary.facturas_vencidas}`}
          colorScheme={summary.facturas_vencidas > 0 ? 'red' : 'green'}
          subtitle={summary.monto_vencido > 0 ? `${fmtCurrency(summary.monto_vencido)} vencido` : 'Sin vencimientos'}
        />
        <SummaryCard
          label="Cobranzas del periodo"
          value={fmtCurrency(summary.cobranzas_periodo)}
          colorScheme="green"
          subtitle={summary.cobranzas_periodo_delta !== null ? `${summary.cobranzas_periodo_delta! >= 0 ? '↑' : '↓'} ${fmtDelta(summary.cobranzas_periodo_delta)} vs anterior` : undefined}
        />
      </div>

      {/* Aging chart */}
      <Card className="print:break-inside-avoid">
        <CardContent>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Antiguedad de saldos</h3>
            <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400">
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-green-500 inline-block" /> Al dia</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-blue-500 inline-block" /> 1-30d</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-yellow-500 inline-block" /> 31-60d</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-orange-500 inline-block" /> 61-90d</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-red-500 inline-block" /> 90+d</span>
            </div>
          </div>

          {aging.every(a => a.monto === 0) ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <p className="text-sm text-gray-500 dark:text-gray-400">No hay saldos pendientes.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {aging.map((row, i) => (
                <div key={i} className="space-y-1">
                  <div className="flex items-center justify-between text-xs text-gray-600 dark:text-gray-400">
                    <span className="font-medium">{row.label}</span>
                    <span className="tabular-nums">{fmtCurrency(row.monto)} ({row.cantidad} pedidos)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 bg-gray-100 dark:bg-gray-700 rounded-full h-5 overflow-hidden">
                      <div
                        className={`h-full ${BUCKET_BAR_COLORS[row.bucket] || 'bg-gray-500'} rounded-full transition-all duration-500 flex items-center justify-end pr-1.5`}
                        style={{ width: `${Math.max((row.monto / maxAgingMonto) * 100, 2)}%`, minWidth: '4px' }}
                      >
                        {(row.monto / maxAgingMonto) > 0.15 && (
                          <span className="text-[10px] font-medium text-white whitespace-nowrap">{fmtCurrency(row.monto)}</span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Top morosos table */}
      {morosos.length > 0 && (
        <>
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-2">
            Clientes con mayor deuda
            <span className="text-xs px-2 py-0.5 rounded bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300">
              Top 5
            </span>
          </h3>
          <ReportTable columns={morososColumns} rows={morosos} highlightable />
        </>
      )}
    </>
  )
}
