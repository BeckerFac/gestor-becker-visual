import React from 'react'
import * as XLSX from 'xlsx'

interface ExcelColumn {
  header: string
  key: string
  width?: number
  type?: 'text' | 'date' | 'currency' | 'number'
}

interface ExportExcelProps {
  data: Record<string, any>[]
  columns: { key: string; label: string; type?: 'text' | 'date' | 'currency' | 'number' }[]
  filename?: string
  sheetName?: string
}

function formatCellValue(value: any, type?: string): any {
  if (value == null || value === '') return ''

  if (type === 'date') {
    const d = new Date(value)
    if (isNaN(d.getTime())) return String(value)
    const day = String(d.getDate()).padStart(2, '0')
    const month = String(d.getMonth() + 1).padStart(2, '0')
    const year = d.getFullYear()
    return `${day}/${month}/${year}`
  }

  if (type === 'currency' || type === 'number') {
    const num = typeof value === 'string' ? parseFloat(value) : value
    if (isNaN(num)) return value
    return num
  }

  return String(value)
}

function autoFitColumns(data: Record<string, any>[], columns: ExcelColumn[]): number[] {
  return columns.map(col => {
    const headerLen = col.header.length
    const maxDataLen = data.reduce((max, row) => {
      const val = String(row[col.key] ?? '')
      return Math.max(max, val.length)
    }, 0)
    const computed = Math.max(headerLen, maxDataLen) + 3
    return Math.min(Math.max(computed, 10), 40)
  })
}

export function exportToExcel(
  data: Record<string, any>[],
  columns: ExcelColumn[],
  filename: string,
  sheetName: string = 'Datos'
) {
  if (data.length === 0) return

  const mapped = data.map(row => {
    const obj: Record<string, any> = {}
    columns.forEach(col => {
      obj[col.header] = formatCellValue(row[col.key], col.type)
    })
    return obj
  })

  const ws = XLSX.utils.json_to_sheet(mapped)

  // Auto-fit column widths
  const widths = autoFitColumns(data, columns)
  ws['!cols'] = widths.map(w => ({ wch: w }))

  // Freeze header row
  ws['!freeze'] = { xSplit: 0, ySplit: 1 }

  // Number format for currency columns
  const range = XLSX.utils.decode_range(ws['!ref'] || 'A1')
  columns.forEach((col, colIdx) => {
    if (col.type === 'currency') {
      for (let row = range.s.r + 1; row <= range.e.r; row++) {
        const cellRef = XLSX.utils.encode_cell({ r: row, c: colIdx })
        const cell = ws[cellRef]
        if (cell && typeof cell.v === 'number') {
          cell.t = 'n'
          cell.z = '#,##0.00'
        }
      }
    }
  })

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, sheetName.substring(0, 31))

  // Set sheet view to show freeze panes
  if (!wb.Workbook) wb.Workbook = {}
  if (!wb.Workbook.Views) wb.Workbook.Views = [{}]
  if (!wb.Workbook.Sheets) wb.Workbook.Sheets = []
  wb.Workbook.Sheets.push({ freeze: { xSplit: 0, ySplit: 1 } } as any)

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
        obj[col.header] = formatCellValue(row[col.key], col.type)
      })
      return obj
    })

    const ws = XLSX.utils.json_to_sheet(mapped)
    const widths = autoFitColumns(sheet.data, sheet.columns)
    ws['!cols'] = widths.map(w => ({ wch: w }))
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
  sheetName = 'Datos',
}) => {
  const disabled = data.length === 0

  const handleClick = () => {
    const excelColumns: ExcelColumn[] = columns.map(c => ({
      header: c.label,
      key: c.key,
      width: 18,
      type: c.type,
    }))
    const dateStr = new Date().toISOString().split('T')[0]
    exportToExcel(data, excelColumns, `${filename}_${dateStr}`, sheetName)
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
