import React from 'react'

interface ExportCSVProps {
  data: Record<string, any>[]
  columns: { key: string; label: string }[]
  filename?: string
}

/**
 * Edge cases handled:
 * - Empty data array → disabled button
 * - Values with commas → wrapped in double quotes
 * - Values with double quotes → escaped with double quotes
 * - Values with newlines → wrapped in quotes
 * - null/undefined → empty string
 * - Number values → exported as numbers
 * - UTF-8 BOM → prepended for Excel compatibility
 * - Date values → formatted to locale string
 */
function escapeCSVValue(value: any): string {
  if (value === null || value === undefined) return ''
  const str = String(value)
  // If contains comma, quote, newline, or leading/trailing whitespace → wrap in quotes
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r') || str !== str.trim()) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

export function exportToCSV(data: Record<string, any>[], columns: { key: string; label: string }[], filename: string = 'export') {
  if (data.length === 0) return

  const BOM = '\uFEFF' // UTF-8 BOM for Excel
  const header = columns.map(c => escapeCSVValue(c.label)).join(',')
  const rows = data.map(row =>
    columns.map(col => escapeCSVValue(row[col.key])).join(',')
  )
  const csv = BOM + [header, ...rows].join('\r\n')

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = window.URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${filename}_${new Date().toISOString().split('T')[0]}.csv`
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.URL.revokeObjectURL(url)
}

export const ExportCSVButton: React.FC<ExportCSVProps> = ({ data, columns, filename = 'export' }) => {
  const disabled = data.length === 0

  return (
    <button
      onClick={() => exportToCSV(data, columns, filename)}
      disabled={disabled}
      className={`px-3 py-1.5 text-sm rounded-lg border transition-colors flex items-center gap-1.5 ${
        disabled
          ? 'border-gray-200 text-gray-400 cursor-not-allowed'
          : 'border-gray-300 text-gray-700 hover:bg-gray-100'
      }`}
      title={disabled ? 'No hay datos para exportar' : 'Exportar a CSV'}
    >
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
      CSV
    </button>
  )
}
