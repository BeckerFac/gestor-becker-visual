import React from 'react'
import { Card, CardContent, CardHeader } from '@/components/ui/Card'

interface Column<T> {
  key: keyof T | string
  label: string
  render?: (value: any, row: T) => React.ReactNode
  headerRender?: () => React.ReactNode
}

interface DataTableProps<T> {
  columns: Column<T>[]
  data: T[]
  title?: string
  onRowClick?: (row: T) => void
}

export function DataTable<T extends { id?: string | number }>({
  columns,
  data,
  title,
  onRowClick,
}: DataTableProps<T>) {
  return (
    <Card>
      {title && <CardHeader>{title}</CardHeader>}
      <CardContent className="overflow-x-auto">
        <table className="min-w-full border-collapse">
          <thead>
            <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
              {columns.map((col) => (
                <th
                  key={String(col.key)}
                  className="px-6 py-3 text-left text-sm font-semibold text-gray-900 dark:text-gray-100"
                >
                  {col.headerRender ? col.headerRender() : col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-6 py-8 text-center text-gray-500 dark:text-gray-400"
                >
                  No hay datos
                </td>
              </tr>
            ) : (
              data.map((row, idx) => (
                <tr
                  key={row.id || idx}
                  className="border-b border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer"
                  onClick={() => onRowClick?.(row)}
                >
                  {columns.map((col) => (
                    <td key={String(col.key)} className="px-6 py-4 text-sm text-gray-600 dark:text-gray-300">
                      {col.render
                        ? col.render((row as any)[col.key], row)
                        : String((row as any)[col.key] || '')}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </CardContent>
    </Card>
  )
}
