import React, { useMemo } from 'react'
import { EmptyState } from '@/components/shared/EmptyState'
import { SummaryCard } from './SummaryCard'
import { ReportTable } from './ReportTable'
import { fmtCurrency } from './helpers'
import { formatDate } from '@/lib/utils'
import type { IVAVentasRow } from './types'

interface Props {
  rows: IVAVentasRow[]
  totals: Record<string, number>
}

export const LibroIVAVentasTab: React.FC<Props> = ({ rows, totals }) => {
  if (rows.length === 0) {
    return (
      <EmptyState
        title="Sin datos para el periodo"
        description="No hay facturas de venta en el rango seleccionado. Proba con un rango de fechas mas amplio."
        variant="filtered"
      />
    )
  }

  const columns = useMemo(() => [
    {
      key: 'invoice_date',
      label: 'Fecha',
      align: 'left' as const,
      render: (row: IVAVentasRow) => (
        <span className="text-gray-600 dark:text-gray-300">{formatDate(row.invoice_date)}</span>
      ),
    },
    {
      key: 'comprobante',
      label: 'Comprobante',
      align: 'left' as const,
      render: (row: IVAVentasRow) => (
        <span className="font-mono text-xs font-semibold text-gray-800 dark:text-gray-200">{row.comprobante}</span>
      ),
    },
    {
      key: 'customer_name',
      label: 'Cliente',
      align: 'left' as const,
      render: (row: IVAVentasRow) => (
        <span className="text-gray-900 dark:text-gray-100">{row.customer_name}</span>
      ),
    },
    {
      key: 'customer_cuit',
      label: 'CUIT',
      align: 'left' as const,
      className: 'whitespace-nowrap',
      render: (row: IVAVentasRow) => (
        <span className="font-mono text-xs text-gray-500 dark:text-gray-400">{row.customer_cuit || '-'}</span>
      ),
    },
    {
      key: 'neto_gravado',
      label: 'Neto Grav.',
      align: 'right' as const,
      render: (row: IVAVentasRow) => (
        <span className="text-gray-700 dark:text-gray-300 tabular-nums">{fmtCurrency(row.neto_gravado)}</span>
      ),
    },
    {
      key: 'neto_no_gravado',
      label: 'No Grav.',
      align: 'right' as const,
      render: (row: IVAVentasRow) => (
        <span className="text-gray-500 dark:text-gray-400 tabular-nums">{fmtCurrency(row.neto_no_gravado)}</span>
      ),
    },
    {
      key: 'iva_21',
      label: 'IVA 21%',
      align: 'right' as const,
      render: (row: IVAVentasRow) => (
        <span className="text-gray-700 dark:text-gray-300 tabular-nums">{fmtCurrency(row.iva_21)}</span>
      ),
    },
    {
      key: 'iva_10_5',
      label: 'IVA 10,5%',
      align: 'right' as const,
      render: (row: IVAVentasRow) => (
        <span className="text-gray-500 dark:text-gray-400 tabular-nums">{fmtCurrency(row.iva_10_5)}</span>
      ),
    },
    {
      key: 'iva_27',
      label: 'IVA 27%',
      align: 'right' as const,
      render: (row: IVAVentasRow) => (
        <span className="text-gray-500 dark:text-gray-400 tabular-nums">{fmtCurrency(row.iva_27)}</span>
      ),
    },
    {
      key: 'total_iva',
      label: 'Total IVA',
      align: 'right' as const,
      render: (row: IVAVentasRow) => (
        <span className="font-medium text-purple-700 dark:text-purple-400 tabular-nums">{fmtCurrency(row.total_iva)}</span>
      ),
    },
    {
      key: 'total',
      label: 'Total',
      align: 'right' as const,
      render: (row: IVAVentasRow) => (
        <span className="font-bold text-gray-900 dark:text-gray-100 tabular-nums">{fmtCurrency(row.total)}</span>
      ),
    },
  ], [])

  const totalsRow = (
    <tr className="bg-gray-100 dark:bg-gray-800 font-bold text-sm border-t-2 border-gray-300 dark:border-gray-600">
      <td colSpan={4} className="px-3 py-3 text-gray-700 dark:text-gray-300">TOTALES</td>
      <td className="px-3 py-3 text-right text-gray-800 dark:text-gray-200 tabular-nums">{fmtCurrency(totals.neto_gravado ?? 0)}</td>
      <td className="px-3 py-3 text-right text-gray-600 dark:text-gray-400 tabular-nums">{fmtCurrency(totals.neto_no_gravado ?? 0)}</td>
      <td className="px-3 py-3 text-right text-gray-800 dark:text-gray-200 tabular-nums">{fmtCurrency(totals.iva_21 ?? 0)}</td>
      <td className="px-3 py-3 text-right text-gray-600 dark:text-gray-400 tabular-nums">{fmtCurrency(totals.iva_10_5 ?? 0)}</td>
      <td className="px-3 py-3 text-right text-gray-600 dark:text-gray-400 tabular-nums">{fmtCurrency(totals.iva_27 ?? 0)}</td>
      <td className="px-3 py-3 text-right text-purple-700 dark:text-purple-400 tabular-nums">{fmtCurrency(totals.total_iva ?? 0)}</td>
      <td className="px-3 py-3 text-right text-gray-900 dark:text-gray-100 tabular-nums">{fmtCurrency(totals.total ?? 0)}</td>
    </tr>
  )

  return (
    <>
      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <SummaryCard label="Neto Gravado" value={fmtCurrency(totals.neto_gravado ?? 0)} colorScheme="blue" />
        <SummaryCard label="Total IVA" value={fmtCurrency(totals.total_iva ?? 0)} colorScheme="purple" />
        <SummaryCard label="Total Ventas" value={fmtCurrency(totals.total ?? 0)} colorScheme="green" />
        <SummaryCard label="Comprobantes" value={String(rows.length)} colorScheme="gray" />
      </div>

      {/* Table */}
      <ReportTable columns={columns} rows={rows} totalsRow={totalsRow} highlightable />
    </>
  )
}
