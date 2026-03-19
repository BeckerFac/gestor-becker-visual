import React, { useMemo } from 'react'
import { EmptyState } from '@/components/shared/EmptyState'
import { SummaryCard } from './SummaryCard'
import { ReportTable } from './ReportTable'
import { fmtCurrency } from './helpers'
import { formatDate } from '@/lib/utils'
import type { IVAComprasRow } from './types'

interface Props {
  rows: IVAComprasRow[]
  totals: Record<string, number>
}

export const LibroIVAComprasTab: React.FC<Props> = ({ rows, totals }) => {
  if (rows.length === 0) {
    return (
      <EmptyState
        title="Sin datos para el periodo"
        description="No hay compras registradas en el rango seleccionado. Proba con un rango de fechas mas amplio."
        variant="filtered"
      />
    )
  }

  const columns = useMemo(() => [
    {
      key: 'date',
      label: 'Fecha',
      align: 'left' as const,
      render: (row: IVAComprasRow) => (
        <span className="text-gray-600 dark:text-gray-300">{formatDate(row.date)}</span>
      ),
    },
    {
      key: 'comprobante',
      label: 'Comprobante',
      align: 'left' as const,
      render: (row: IVAComprasRow) => (
        <span className="font-mono text-xs font-semibold text-gray-800 dark:text-gray-200">{row.comprobante}</span>
      ),
    },
    {
      key: 'enterprise_name',
      label: 'Proveedor',
      align: 'left' as const,
      render: (row: IVAComprasRow) => (
        <span className="text-gray-900 dark:text-gray-100">{row.enterprise_name}</span>
      ),
    },
    {
      key: 'enterprise_cuit',
      label: 'CUIT',
      align: 'left' as const,
      className: 'whitespace-nowrap',
      render: (row: IVAComprasRow) => (
        <span className="font-mono text-xs text-gray-500 dark:text-gray-400">{row.enterprise_cuit || '-'}</span>
      ),
    },
    {
      key: 'neto_gravado',
      label: 'Neto Gravado',
      align: 'right' as const,
      render: (row: IVAComprasRow) => (
        <span className="text-gray-700 dark:text-gray-300 tabular-nums">{fmtCurrency(row.neto_gravado)}</span>
      ),
    },
    {
      key: 'iva',
      label: 'IVA',
      align: 'right' as const,
      render: (row: IVAComprasRow) => (
        <span className="font-medium text-purple-700 dark:text-purple-400 tabular-nums">{fmtCurrency(row.iva)}</span>
      ),
    },
    {
      key: 'total',
      label: 'Total',
      align: 'right' as const,
      render: (row: IVAComprasRow) => (
        <span className="font-bold text-gray-900 dark:text-gray-100 tabular-nums">{fmtCurrency(row.total)}</span>
      ),
    },
  ], [])

  const totalsRow = (
    <tr className="bg-gray-100 dark:bg-gray-800 font-bold text-sm border-t-2 border-gray-300 dark:border-gray-600">
      <td colSpan={4} className="px-3 py-3 text-gray-700 dark:text-gray-300">TOTALES</td>
      <td className="px-3 py-3 text-right text-gray-800 dark:text-gray-200 tabular-nums">{fmtCurrency(totals.neto_gravado ?? 0)}</td>
      <td className="px-3 py-3 text-right text-purple-700 dark:text-purple-400 tabular-nums">{fmtCurrency(totals.iva ?? 0)}</td>
      <td className="px-3 py-3 text-right text-gray-900 dark:text-gray-100 tabular-nums">{fmtCurrency(totals.total ?? 0)}</td>
    </tr>
  )

  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <SummaryCard label="Neto Gravado" value={fmtCurrency(totals.neto_gravado ?? 0)} colorScheme="blue" />
        <SummaryCard label="IVA Credito Fiscal" value={fmtCurrency(totals.iva ?? 0)} colorScheme="purple" />
        <SummaryCard label="Total Compras" value={fmtCurrency(totals.total ?? 0)} colorScheme="orange" />
      </div>

      <ReportTable columns={columns} rows={rows} totalsRow={totalsRow} highlightable />
    </>
  )
}
