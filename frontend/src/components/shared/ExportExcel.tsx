import React from 'react'
import * as XLSX from 'xlsx'

interface ExcelColumn {
  header: string
  key: string
  width?: number
}

interface ExportExcelProps {
  data: Record<string, any>[]
  columns: { key: string; label: string }[]
  filename?: string
}

export function exportToExcel(
  data: Record<string, any>[],
  columns: ExcelColumn[],
  filename: string
) {
  if (data.length === 0) return

  const mapped = data.map(row => {
    const obj: Record<string, any> = {}
    columns.forEach(col => {
      obj[col.header] = row[col.key] ?? ''
    })
    return obj
  })

  const ws = XLSX.utils.json_to_sheet(mapped)
  ws['!cols'] = columns.map(col => ({ wch: col.width || 15 }))

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Datos')
  XLSX.writeFile(wb, `${filename}.xlsx`)
}

export function exportMultiSheetExcel(
  sheets: { name: string; data: Record<string, any>[]; columns: ExcelColumn[] }[],
  filename: string
) {
  const wb = XLSX.utils.book_new()

  sheets.forEach(sheet => {
    const mapped = sheet.data.map(row => {
      const obj: Record<string, any> = {}
      sheet.columns.forEach(col => {
        obj[col.header] = row[col.key] ?? ''
      })
      return obj
    })

    const ws = XLSX.utils.json_to_sheet(mapped)
    ws['!cols'] = sheet.columns.map(col => ({ wch: col.width || 15 }))
    // Excel sheet name max 31 chars
    XLSX.utils.book_append_sheet(wb, ws, sheet.name.substring(0, 31))
  })

  XLSX.writeFile(wb, `${filename}.xlsx`)
}

/**
 * Convenience wrapper: accepts the same { key, label } columns as ExportCSVButton
 * so pages can share the same column definition for both CSV and Excel exports.
 */
export const ExportExcelButton: React.FC<ExportExcelProps> = ({
  data,
  columns,
  filename = 'export',
}) => {
  const disabled = data.length === 0

  const handleClick = () => {
    const excelColumns: ExcelColumn[] = columns.map(c => ({
      header: c.label,
      key: c.key,
      width: 18,
    }))
    const dateStr = new Date().toISOString().split('T')[0]
    exportToExcel(data, excelColumns, `${filename}_${dateStr}`)
  }

  return (
    <button
      onClick={handleClick}
      disabled={disabled}
      className={`px-3 py-1.5 text-sm rounded-lg border transition-colors flex items-center gap-1.5 ${
        disabled
          ? 'border-gray-200 text-gray-400 cursor-not-allowed'
          : 'border-green-300 text-green-700 hover:bg-green-50'
      }`}
      title={disabled ? 'No hay datos para exportar' : 'Exportar a Excel'}
    >
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
        />
      </svg>
      Excel
    </button>
  )
}
