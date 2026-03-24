import React from 'react'
import type { IVAVentasRow, IVAComprasRow } from './types'

// ARCA RG 4597 - Libro IVA Digital TXT export
// Format: fixed-width fields separated by semicolons, as per ARCA import specification

function pad(value: string | number, length: number, char: string = '0'): string {
  return String(value).padStart(length, char)
}

function fmtAmount(n: number): string {
  // ARCA expects amounts with 2 decimal places, no separator, right-aligned
  // Negative values: leading minus sign
  const sign = n < 0 ? '-' : ''
  const abs = Math.abs(Math.round(n * 100))
  return sign + pad(abs, 15)
}

function fmtDate(dateStr: string): string {
  // Convert YYYY-MM-DD to YYYYMMDD
  return dateStr.replace(/-/g, '')
}

/**
 * Generate ARCA-compatible TXT for Libro IVA Ventas (RG 4597)
 * Each line represents one comprobante with semicolons as separator
 */
export function generateVentasTxt(rows: IVAVentasRow[]): string {
  return rows.map(row => {
    const fields = [
      fmtDate(row.invoice_date),          // Fecha comprobante
      pad(row.tipo_cbte, 3),              // Tipo comprobante
      pad(row.punto_venta, 5),            // Punto de venta
      pad(row.numero_desde, 20),          // Numero desde
      pad(row.numero_hasta, 20),          // Numero hasta
      pad(row.cod_doc_receptor, 2),       // Codigo documento receptor
      pad(row.nro_doc_receptor || '0', 20), // Numero documento receptor
      (row.customer_name || '').substring(0, 30).padEnd(30, ' '), // Denominacion receptor
      fmtAmount(row.total),               // Importe total
      fmtAmount(row.neto_no_gravado),     // Importe total no gravado (ImpTotConc)
      fmtAmount(row.op_exentas),          // Importe operaciones exentas
      fmtAmount(row.neto_gravado),        // Importe neto gravado
      fmtAmount(row.total_iva),           // Importe IVA liquidado
      fmtAmount(row.otros_tributos),      // Importe otros tributos
    ]
    return fields.join(';')
  }).join('\r\n')
}

/**
 * Generate ARCA-compatible TXT for Libro IVA Compras (RG 4597)
 */
export function generateComprasTxt(rows: IVAComprasRow[]): string {
  return rows.map(row => {
    const fields = [
      fmtDate(row.date),                  // Fecha comprobante
      pad(row.tipo_cbte, 3),              // Tipo comprobante
      pad(row.punto_venta, 5),            // Punto de venta
      pad(row.numero_desde, 20),          // Numero desde
      pad(row.numero_hasta, 20),          // Numero hasta
      pad(row.cod_doc_emisor, 2),         // Codigo documento emisor
      pad(row.nro_doc_emisor || '0', 20), // Numero documento emisor
      (row.enterprise_name || '').substring(0, 30).padEnd(30, ' '), // Denominacion emisor
      fmtAmount(row.total),               // Importe total
      fmtAmount(row.neto_no_gravado),     // Importe total no gravado
      fmtAmount(row.op_exentas),          // Importe operaciones exentas
      fmtAmount(row.neto_gravado),        // Importe neto gravado
      fmtAmount(row.iva),                 // Importe IVA liquidado
      fmtAmount(row.otros_tributos),      // Importe otros tributos
    ]
    return fields.join(';')
  }).join('\r\n')
}

function downloadTxt(content: string, filename: string): void {
  const BOM = '\uFEFF'
  const blob = new Blob([BOM + content], { type: 'text/plain;charset=utf-8;' })
  const url = window.URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.URL.revokeObjectURL(url)
}

interface ExportARCATxtButtonProps {
  type: 'ventas' | 'compras'
  ventasRows?: IVAVentasRow[]
  comprasRows?: IVAComprasRow[]
  dateFrom: string
  dateTo: string
}

export const ExportARCATxtButton: React.FC<ExportARCATxtButtonProps> = ({
  type,
  ventasRows,
  comprasRows,
  dateFrom,
  dateTo,
}) => {
  const rows = type === 'ventas' ? ventasRows : comprasRows
  const disabled = !rows || rows.length === 0

  const handleExport = () => {
    if (disabled) return
    const from = dateFrom.replace(/-/g, '')
    const to = dateTo.replace(/-/g, '')
    if (type === 'ventas' && ventasRows) {
      const txt = generateVentasTxt(ventasRows)
      downloadTxt(txt, `LIBRO_IVA_VENTAS_${from}_${to}.txt`)
    } else if (type === 'compras' && comprasRows) {
      const txt = generateComprasTxt(comprasRows)
      downloadTxt(txt, `LIBRO_IVA_COMPRAS_${from}_${to}.txt`)
    }
  }

  return (
    <button
      onClick={handleExport}
      disabled={disabled}
      className={`px-3 py-1.5 text-sm rounded-lg border transition-colors flex items-center gap-1.5 ${
        disabled
          ? 'border-gray-200 text-gray-400 cursor-not-allowed'
          : 'border-blue-300 text-blue-700 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-900/30'
      }`}
      title={disabled ? 'No hay datos para exportar' : 'Exportar TXT para importar en ARCA (RG 4597)'}
    >
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
      ARCA TXT
    </button>
  )
}
