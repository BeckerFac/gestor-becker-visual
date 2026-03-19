import React, { useState } from 'react'
import { Card } from '@/components/ui/Card'

interface Column<T> {
  key: keyof T | string
  label: string
  align?: 'left' | 'right' | 'center'
  render: (row: T, index: number) => React.ReactNode
  className?: string
}

interface ReportTableProps<T> {
  columns: Column<T>[]
  rows: T[]
  totalsRow?: React.ReactNode
  /** Enable row click highlighting */
  highlightable?: boolean
}

export function ReportTable<T>({ columns, rows, totalsRow, highlightable = false }: ReportTableProps<T>) {
  const [highlightedIdx, setHighlightedIdx] = useState<number | null>(null)

  return (
    <Card>
      <div className="overflow-x-auto max-h-[600px] relative">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10">
            <tr className="bg-gray-50 dark:bg-gray-800 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              {columns.map((col) => (
                <th
                  key={String(col.key)}
                  className={`px-3 py-3 ${
                    col.align === 'right' ? 'text-right' :
                    col.align === 'center' ? 'text-center' :
                    'text-left'
                  } ${col.className || ''}`}
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr
                key={i}
                onClick={highlightable ? () => setHighlightedIdx(i === highlightedIdx ? null : i) : undefined}
                className={`border-b border-gray-100 dark:border-gray-700 transition-colors
                  ${i % 2 === 0 ? 'bg-white dark:bg-gray-900' : 'bg-gray-50/50 dark:bg-gray-800/50'}
                  hover:bg-blue-50/50 dark:hover:bg-blue-900/20
                  ${highlightable ? 'cursor-pointer' : ''}
                  ${highlightedIdx === i ? 'bg-blue-100/70 dark:bg-blue-900/40 hover:bg-blue-100/70 dark:hover:bg-blue-900/40' : ''}
                `}
              >
                {columns.map((col) => (
                  <td
                    key={String(col.key)}
                    className={`px-3 py-2.5 ${
                      col.align === 'right' ? 'text-right' :
                      col.align === 'center' ? 'text-center' :
                      'text-left'
                    }`}
                  >
                    {col.render(row, i)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          {totalsRow && (
            <tfoot className="sticky bottom-0 z-10">
              {totalsRow}
            </tfoot>
          )}
        </table>
      </div>
    </Card>
  )
}
