import React, { useMemo } from 'react'
import { Card, CardContent } from '@/components/ui/Card'
import { EmptyState } from '@/components/shared/EmptyState'
import { SummaryCard } from './SummaryCard'
import { ReportTable } from './ReportTable'
import { fmtCurrency } from './helpers'
import type { FlujoCajaRow } from './types'

interface Props {
  rows: FlujoCajaRow[]
}

export const FlujoCajaTab: React.FC<Props> = ({ rows }) => {
  if (rows.length === 0) {
    return (
      <EmptyState
        title="Sin datos para el periodo"
        description="No hay movimientos de caja en el rango seleccionado. Proba con un rango de fechas mas amplio."
        variant="filtered"
      />
    )
  }

  const totalIngresos = rows.reduce((s, r) => s + r.ingresos, 0)
  const totalEgresos = rows.reduce((s, r) => s + r.egresos, 0)
  const totalNeto = rows.reduce((s, r) => s + r.neto, 0)
  const maxValue = Math.max(...rows.map(r => Math.max(r.ingresos, r.egresos)), 1)
  const allZero = totalIngresos === 0 && totalEgresos === 0

  const columns = useMemo(() => [
    {
      key: 'periodo_label',
      label: 'Periodo',
      align: 'left' as const,
      render: (row: FlujoCajaRow) => (
        <span className="font-medium text-gray-900 dark:text-gray-100">{row.periodo_label}</span>
      ),
    },
    {
      key: 'ingresos',
      label: 'Ingresos',
      align: 'right' as const,
      render: (row: FlujoCajaRow) => (
        <span className="text-green-600 dark:text-green-400 tabular-nums">{fmtCurrency(row.ingresos)}</span>
      ),
    },
    {
      key: 'egresos',
      label: 'Egresos',
      align: 'right' as const,
      render: (row: FlujoCajaRow) => (
        <span className="text-red-600 dark:text-red-400 tabular-nums">{fmtCurrency(row.egresos)}</span>
      ),
    },
    {
      key: 'neto',
      label: 'Neto',
      align: 'right' as const,
      render: (row: FlujoCajaRow) => (
        <span className={`font-bold tabular-nums ${row.neto >= 0 ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'}`}>
          {fmtCurrency(row.neto)}
        </span>
      ),
    },
    {
      key: 'acumulado',
      label: 'Acumulado',
      align: 'right' as const,
      render: (row: FlujoCajaRow) => (
        <span className={`font-semibold tabular-nums ${row.acumulado >= 0 ? 'text-blue-700 dark:text-blue-400' : 'text-orange-700 dark:text-orange-400'}`}>
          {fmtCurrency(row.acumulado)}
        </span>
      ),
    },
  ], [])

  const totalsRow = (
    <tr className="bg-gray-100 dark:bg-gray-800 font-bold text-sm border-t-2 border-gray-300 dark:border-gray-600">
      <td className="px-3 py-3 text-gray-700 dark:text-gray-300">TOTALES</td>
      <td className="px-3 py-3 text-right text-green-700 dark:text-green-400 tabular-nums">{fmtCurrency(totalIngresos)}</td>
      <td className="px-3 py-3 text-right text-red-700 dark:text-red-400 tabular-nums">{fmtCurrency(totalEgresos)}</td>
      <td className={`px-3 py-3 text-right tabular-nums ${totalNeto >= 0 ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'}`}>
        {fmtCurrency(totalNeto)}
      </td>
      <td className="px-3 py-3 text-right text-gray-500 dark:text-gray-400">-</td>
    </tr>
  )

  const flujoNetColor = totalNeto >= 0 ? 'blue' as const : 'orange' as const

  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <SummaryCard label="Total Ingresos" value={fmtCurrency(totalIngresos)} colorScheme="green" />
        <SummaryCard label="Total Egresos" value={fmtCurrency(totalEgresos)} colorScheme="red" />
        <SummaryCard label="Flujo Neto" value={fmtCurrency(totalNeto)} colorScheme={flujoNetColor} />
      </div>

      {/* Bar chart */}
      <Card className="print:break-inside-avoid">
        <CardContent>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Ingresos vs Egresos por Periodo</h3>
            {/* Legend */}
            <div className="flex items-center gap-4 text-xs text-gray-500 dark:text-gray-400">
              <span className="flex items-center gap-1.5">
                <span className="inline-block w-3 h-3 rounded-sm bg-green-500 dark:bg-green-600" />
                Ingresos
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block w-3 h-3 rounded-sm bg-red-500 dark:bg-red-600" />
                Egresos
              </span>
            </div>
          </div>

          {allZero ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Todos los valores son cero para este periodo.
              </p>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                Proba con un rango de fechas mas amplio.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {rows.map((row, i) => (
                <div key={i} className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs text-gray-600 dark:text-gray-400">
                    <span className="font-medium">{row.periodo_label}</span>
                    <div className="flex items-center gap-3">
                      <span className={`font-bold ${row.neto >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                        Neto: {fmtCurrency(row.neto)}
                      </span>
                      <span className={`font-semibold ${row.acumulado >= 0 ? 'text-blue-600 dark:text-blue-400' : 'text-orange-600 dark:text-orange-400'}`}>
                        Acum: {fmtCurrency(row.acumulado)}
                      </span>
                    </div>
                  </div>
                  {/* Ingresos bar */}
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] w-14 text-right text-gray-400 shrink-0">Ingresos</span>
                    <div className="flex-1 bg-gray-100 dark:bg-gray-700 rounded-full h-5 overflow-hidden relative">
                      {row.ingresos === 0 ? (
                        <div className="h-full flex items-center pl-2">
                          <span className="text-[10px] text-gray-400 dark:text-gray-500 italic">sin movimiento</span>
                        </div>
                      ) : (
                        <div
                          className="h-full bg-green-500 dark:bg-green-600 rounded-full transition-all duration-500 flex items-center justify-end pr-1.5"
                          style={{ width: `${Math.max((row.ingresos / maxValue) * 100, 3)}%`, minWidth: '8px' }}
                        >
                          {(row.ingresos / maxValue) > 0.15 && (
                            <span className="text-[10px] font-medium text-white whitespace-nowrap">{fmtCurrency(row.ingresos)}</span>
                          )}
                        </div>
                      )}
                    </div>
                    <span className={`text-xs w-28 text-right shrink-0 font-mono tabular-nums ${row.ingresos === 0 ? 'text-gray-400 dark:text-gray-500' : 'text-gray-600 dark:text-gray-300'}`}>{fmtCurrency(row.ingresos)}</span>
                  </div>
                  {/* Egresos bar */}
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] w-14 text-right text-gray-400 shrink-0">Egresos</span>
                    <div className="flex-1 bg-gray-100 dark:bg-gray-700 rounded-full h-5 overflow-hidden relative">
                      {row.egresos === 0 ? (
                        <div className="h-full flex items-center pl-2">
                          <span className="text-[10px] text-gray-400 dark:text-gray-500 italic">sin movimiento</span>
                        </div>
                      ) : (
                        <div
                          className="h-full bg-red-500 dark:bg-red-600 rounded-full transition-all duration-500 flex items-center justify-end pr-1.5"
                          style={{ width: `${Math.max((row.egresos / maxValue) * 100, 3)}%`, minWidth: '8px' }}
                        >
                          {(row.egresos / maxValue) > 0.15 && (
                            <span className="text-[10px] font-medium text-white whitespace-nowrap">{fmtCurrency(row.egresos)}</span>
                          )}
                        </div>
                      )}
                    </div>
                    <span className={`text-xs w-28 text-right shrink-0 font-mono tabular-nums ${row.egresos === 0 ? 'text-gray-400 dark:text-gray-500' : 'text-gray-600 dark:text-gray-300'}`}>{fmtCurrency(row.egresos)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Table */}
      <ReportTable columns={columns} rows={rows} totalsRow={totalsRow} />
    </>
  )
}
