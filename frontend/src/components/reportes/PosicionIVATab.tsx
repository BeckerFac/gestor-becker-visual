import React, { useMemo } from 'react'
import { EmptyState } from '@/components/shared/EmptyState'
import { SummaryCard } from './SummaryCard'
import { ReportTable } from './ReportTable'
import { fmtCurrency } from './helpers'
import type { PosicionIVARow } from './types'

interface Props {
  rows: PosicionIVARow[]
}

export const PosicionIVATab: React.FC<Props> = ({ rows }) => {
  if (rows.length === 0) {
    return (
      <EmptyState
        title="Sin datos para el periodo"
        description="No hay posiciones IVA calculadas para el rango seleccionado. Proba con un rango de fechas mas amplio."
        variant="filtered"
      />
    )
  }

  const totalDebito = rows.reduce((s, r) => s + r.debito_fiscal, 0)
  const totalCredito = rows.reduce((s, r) => s + r.credito_fiscal, 0)
  const totalSaldo = rows.reduce((s, r) => s + r.saldo, 0)

  const saldoCardColor = totalSaldo >= 0 ? 'orange' as const : 'green' as const
  const saldoCardLabel = totalSaldo >= 0 ? 'IVA a Pagar' : 'IVA a Favor'

  const columns = useMemo(() => [
    {
      key: 'periodo_label',
      label: 'Periodo',
      align: 'left' as const,
      render: (row: PosicionIVARow) => (
        <span className="font-medium text-gray-900 dark:text-gray-100">{row.periodo_label}</span>
      ),
    },
    {
      key: 'debito_fiscal',
      label: 'Debito Fiscal (Ventas)',
      align: 'right' as const,
      render: (row: PosicionIVARow) => (
        <span className="text-red-600 dark:text-red-400 tabular-nums">{fmtCurrency(row.debito_fiscal)}</span>
      ),
    },
    {
      key: 'credito_fiscal',
      label: 'Credito Fiscal (Compras)',
      align: 'right' as const,
      render: (row: PosicionIVARow) => (
        <span className="text-green-600 dark:text-green-400 tabular-nums">{fmtCurrency(row.credito_fiscal)}</span>
      ),
    },
    {
      key: 'saldo',
      label: 'Saldo',
      align: 'right' as const,
      render: (row: PosicionIVARow) => (
        <span className={`font-bold tabular-nums ${row.saldo >= 0 ? 'text-red-700 dark:text-red-400' : 'text-green-700 dark:text-green-400'}`}>
          {row.saldo < 0 ? `-${fmtCurrency(Math.abs(row.saldo))}` : fmtCurrency(row.saldo)}
          <span className="ml-1.5 text-xs font-normal text-gray-400">
            {row.saldo >= 0 ? 'a pagar' : 'a favor'}
          </span>
        </span>
      ),
    },
  ], [])

  const totalsRow = (
    <tr className="bg-gray-100 dark:bg-gray-800 font-bold text-sm border-t-2 border-gray-300 dark:border-gray-600">
      <td className="px-3 py-3 text-gray-700 dark:text-gray-300">TOTALES</td>
      <td className="px-3 py-3 text-right text-red-700 dark:text-red-400 tabular-nums">{fmtCurrency(totalDebito)}</td>
      <td className="px-3 py-3 text-right text-green-700 dark:text-green-400 tabular-nums">{fmtCurrency(totalCredito)}</td>
      <td className={`px-3 py-3 text-right tabular-nums ${totalSaldo >= 0 ? 'text-red-700 dark:text-red-400' : 'text-green-700 dark:text-green-400'}`}>
        {totalSaldo < 0 ? `-${fmtCurrency(Math.abs(totalSaldo))}` : fmtCurrency(totalSaldo)}
      </td>
    </tr>
  )

  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <SummaryCard label="Total Debito Fiscal" value={fmtCurrency(totalDebito)} colorScheme="red" />
        <SummaryCard label="Total Credito Fiscal" value={fmtCurrency(totalCredito)} colorScheme="green" />
        <SummaryCard
          label={saldoCardLabel}
          value={fmtCurrency(Math.abs(totalSaldo))}
          colorScheme={saldoCardColor}
        />
      </div>

      <ReportTable columns={columns} rows={rows} totalsRow={totalsRow} />
    </>
  )
}
