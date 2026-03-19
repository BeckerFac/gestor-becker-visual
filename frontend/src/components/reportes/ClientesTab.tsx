import React, { useMemo } from 'react'
import { Card, CardContent } from '@/components/ui/Card'
import { EmptyState } from '@/components/shared/EmptyState'
import { SummaryCard } from './SummaryCard'
import { ReportTable } from './ReportTable'
import { fmtCurrency, fmtDelta, fmtPercent } from './helpers'
import { formatDate } from '@/lib/utils'
import type { ClientesReportData, ClienteRow } from './types'

interface Props {
  data: ClientesReportData | null
}

export const ClientesTab: React.FC<Props> = ({ data }) => {
  if (!data) {
    return (
      <EmptyState
        title="Sin datos para el periodo"
        description="No hay clientes con actividad en el rango seleccionado."
        variant="filtered"
      />
    )
  }

  const { summary, top_clientes, clientes_inactivos } = data

  if (summary.clientes_activos === 0 && top_clientes.length === 0) {
    return (
      <EmptyState
        title="No hay actividad en este periodo"
        description="No se registraron ventas a clientes en el rango de fechas seleccionado."
        variant="filtered"
      />
    )
  }

  const maxRevenue = Math.max(...top_clientes.map(c => c.revenue), 1)

  const columns = useMemo(() => [
    {
      key: 'nombre',
      label: 'Cliente',
      align: 'left' as const,
      render: (row: ClienteRow) => (
        <span className="font-medium text-gray-900 dark:text-gray-100">{row.nombre}</span>
      ),
    },
    {
      key: 'revenue',
      label: 'Facturado',
      align: 'right' as const,
      render: (row: ClienteRow) => (
        <span className="font-semibold tabular-nums text-gray-900 dark:text-gray-100">{fmtCurrency(row.revenue)}</span>
      ),
    },
    {
      key: 'cantidad_compras',
      label: 'Compras',
      align: 'right' as const,
      render: (row: ClienteRow) => (
        <span className="tabular-nums text-gray-700 dark:text-gray-300">{row.cantidad_compras}</span>
      ),
    },
    {
      key: 'ticket_promedio',
      label: 'Ticket prom.',
      align: 'right' as const,
      render: (row: ClienteRow) => (
        <span className="tabular-nums text-gray-600 dark:text-gray-400">{fmtCurrency(row.ticket_promedio)}</span>
      ),
    },
    {
      key: 'ultima_compra',
      label: 'Ultima compra',
      align: 'right' as const,
      render: (row: ClienteRow) => (
        <span className="text-gray-500 dark:text-gray-400 text-xs">{formatDate(row.ultima_compra)}</span>
      ),
    },
  ], [])

  return (
    <>
      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <SummaryCard
          label="Clientes activos"
          value={String(summary.clientes_activos)}
          colorScheme="blue"
          subtitle={`${summary.clientes_nuevos} nuevos, ${summary.clientes_recurrentes} recurrentes`}
        />
        <SummaryCard
          label="Clientes nuevos"
          value={String(summary.clientes_nuevos)}
          colorScheme="green"
          subtitle={summary.clientes_nuevos_delta !== null ? `${summary.clientes_nuevos_delta! >= 0 ? '↑' : '↓'} ${fmtDelta(summary.clientes_nuevos_delta)} vs anterior` : undefined}
        />
        <SummaryCard
          label="Concentracion top 5"
          value={fmtPercent(summary.concentracion_top5)}
          colorScheme={summary.concentracion_top5 > 60 ? 'orange' : 'gray'}
          subtitle={summary.concentracion_top5 > 60 ? 'Alta dependencia de pocos clientes' : 'Cartera diversificada'}
        />
      </div>

      {/* Top clients bar chart */}
      {top_clientes.length > 0 && (
        <Card className="print:break-inside-avoid">
          <CardContent>
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4">Top 10 clientes por facturacion</h3>
            <div className="space-y-3">
              {top_clientes.map((row, i) => (
                <div key={i} className="space-y-1">
                  <div className="flex items-center justify-between text-xs text-gray-600 dark:text-gray-400">
                    <span className="font-medium truncate max-w-[200px]">{row.nombre}</span>
                    <span className="tabular-nums font-semibold">{fmtCurrency(row.revenue)}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 bg-gray-100 dark:bg-gray-700 rounded-full h-4 overflow-hidden">
                      <div
                        className="h-full bg-blue-500 dark:bg-blue-600 rounded-full transition-all duration-500"
                        style={{ width: `${Math.max((row.revenue / maxRevenue) * 100, 2)}%`, minWidth: '4px' }}
                      />
                    </div>
                    <span className="text-[10px] text-gray-400 w-12 text-right shrink-0">{row.cantidad_compras} op.</span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Top clients table */}
      <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Ranking de clientes</h3>
      <ReportTable columns={columns} rows={top_clientes} highlightable />

      {/* Inactive clients */}
      {clientes_inactivos.length > 0 && (
        <>
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-2">
            Clientes inactivos (sin compras hace 30+ dias)
            <span className="text-xs px-2 py-0.5 rounded bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300">
              {clientes_inactivos.length}
            </span>
          </h3>
          <Card>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 dark:bg-gray-800 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    <th className="px-3 py-3 text-left">Cliente</th>
                    <th className="px-3 py-3 text-right">Facturado historico</th>
                    <th className="px-3 py-3 text-right">Ultima compra</th>
                  </tr>
                </thead>
                <tbody>
                  {clientes_inactivos.map((c, i) => (
                    <tr key={i} className={`border-b border-gray-100 dark:border-gray-700 ${i % 2 === 0 ? 'bg-white dark:bg-gray-900' : 'bg-gray-50/50 dark:bg-gray-800/50'}`}>
                      <td className="px-3 py-2.5 font-medium text-gray-900 dark:text-gray-100">{c.nombre}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-gray-700 dark:text-gray-300">{fmtCurrency(c.total_historico)}</td>
                      <td className="px-3 py-2.5 text-right text-gray-500 dark:text-gray-400 text-xs">{formatDate(c.ultima_compra)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </>
  )
}
