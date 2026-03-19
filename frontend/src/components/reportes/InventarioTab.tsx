import React, { useMemo } from 'react'
import { Card, CardContent } from '@/components/ui/Card'
import { EmptyState } from '@/components/shared/EmptyState'
import { SummaryCard } from './SummaryCard'
import { ReportTable } from './ReportTable'
import { TabActionBar } from './TabActionBar'
import { fmtCurrency, fmtNumber } from './helpers'
import type { InventarioReportData, StockItem, DeadStockItem } from './types'

interface Props {
  data: InventarioReportData | null
}

export const InventarioTab: React.FC<Props> = ({ data }) => {
  if (!data) {
    return (
      <EmptyState
        title="Sin datos de inventario"
        description="No hay productos con stock cargado."
        variant="empty"
      />
    )
  }

  const { summary, stock_items, dead_stock, low_stock } = data

  if (stock_items.length === 0) {
    return (
      <EmptyState
        title="Sin productos en inventario"
        description="Carga productos con stock para ver este reporte."
        variant="empty"
      />
    )
  }

  // Top products by stock value for chart
  const topByValue = [...stock_items]
    .filter(s => s.valor_stock > 0)
    .slice(0, 10)
  const maxStockValue = Math.max(...topByValue.map(s => s.valor_stock), 1)

  const stockColumns = useMemo(() => [
    {
      key: 'nombre',
      label: 'Producto',
      align: 'left' as const,
      render: (row: StockItem) => (
        <div className="flex items-center gap-2">
          <span className="font-medium text-gray-900 dark:text-gray-100">{row.nombre}</span>
          {row.controls_stock && row.stock_minimo > 0 && row.stock_actual <= row.stock_minimo && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 whitespace-nowrap">
              Bajo minimo
            </span>
          )}
        </div>
      ),
    },
    {
      key: 'sku',
      label: 'SKU',
      align: 'left' as const,
      render: (row: StockItem) => (
        <span className="text-gray-500 dark:text-gray-400 text-xs font-mono">{row.sku}</span>
      ),
    },
    {
      key: 'stock_actual',
      label: 'Stock',
      align: 'right' as const,
      render: (row: StockItem) => (
        <span className={`tabular-nums font-semibold ${
          row.controls_stock && row.stock_minimo > 0 && row.stock_actual <= row.stock_minimo
            ? 'text-red-700 dark:text-red-400'
            : 'text-gray-900 dark:text-gray-100'
        }`}>
          {fmtNumber(row.stock_actual)}
        </span>
      ),
    },
    {
      key: 'costo_unitario',
      label: 'Costo unit.',
      align: 'right' as const,
      render: (row: StockItem) => (
        <span className="tabular-nums text-gray-600 dark:text-gray-400">{fmtCurrency(row.costo_unitario)}</span>
      ),
    },
    {
      key: 'valor_stock',
      label: 'Valor stock',
      align: 'right' as const,
      render: (row: StockItem) => (
        <span className="tabular-nums font-semibold text-gray-900 dark:text-gray-100">{fmtCurrency(row.valor_stock)}</span>
      ),
    },
  ], [])

  const deadStockColumns = useMemo(() => [
    {
      key: 'nombre',
      label: 'Producto',
      align: 'left' as const,
      render: (row: DeadStockItem) => (
        <span className="font-medium text-gray-900 dark:text-gray-100">{row.nombre}</span>
      ),
    },
    {
      key: 'sku',
      label: 'SKU',
      align: 'left' as const,
      render: (row: DeadStockItem) => (
        <span className="text-gray-500 dark:text-gray-400 text-xs font-mono">{row.sku}</span>
      ),
    },
    {
      key: 'stock_actual',
      label: 'Stock',
      align: 'right' as const,
      render: (row: DeadStockItem) => (
        <span className="tabular-nums text-gray-700 dark:text-gray-300">{fmtNumber(row.stock_actual)}</span>
      ),
    },
    {
      key: 'dias_sin_venta',
      label: 'Dias sin venta',
      align: 'right' as const,
      render: (row: DeadStockItem) => (
        <span className="tabular-nums font-semibold text-orange-600 dark:text-orange-400">{row.dias_sin_venta}d</span>
      ),
    },
    {
      key: 'valor_inmovilizado',
      label: 'Valor inmovilizado',
      align: 'right' as const,
      render: (row: DeadStockItem) => (
        <span className="tabular-nums font-semibold text-red-700 dark:text-red-400">{fmtCurrency(row.valor_inmovilizado)}</span>
      ),
    },
  ], [])

  const excelData = useMemo(() =>
    stock_items.map(s => ({
      nombre: s.nombre,
      sku: s.sku,
      stock_actual: s.stock_actual,
      costo_unitario: s.costo_unitario,
      valor_stock: s.valor_stock,
    })),
  [stock_items])

  const excelColumns = [
    { key: 'nombre', label: 'Producto' },
    { key: 'sku', label: 'SKU' },
    { key: 'stock_actual', label: 'Stock', type: 'number' as const },
    { key: 'costo_unitario', label: 'Costo Unitario', type: 'currency' as const },
    { key: 'valor_stock', label: 'Valor Stock', type: 'currency' as const },
  ]

  return (
    <>
      <TabActionBar
        excelData={excelData}
        excelColumns={excelColumns}
        excelFilename="Inventario_Reporte"
        headerText="BeckerVisual - Reporte de Inventario"
      />

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <SummaryCard
          label="Valor total del stock"
          value={fmtCurrency(summary.valor_total)}
          colorScheme="blue"
        />
        <SummaryCard
          label="Productos bajo minimo"
          value={String(summary.productos_bajo_minimo)}
          colorScheme={summary.productos_bajo_minimo > 0 ? 'red' : 'green'}
          subtitle={summary.productos_bajo_minimo > 0 ? 'Requieren reposicion' : 'Todo en orden'}
        />
        <SummaryCard
          label="Sin movimiento (60+ dias)"
          value={String(summary.productos_sin_movimiento)}
          colorScheme={summary.productos_sin_movimiento > 0 ? 'orange' : 'gray'}
          subtitle={summary.productos_sin_movimiento > 0 ? 'Capital inmovilizado' : 'Sin stock parado'}
        />
      </div>

      {/* Stock value chart */}
      {topByValue.length > 0 && (
        <Card className="print:break-inside-avoid">
          <CardContent>
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4">Top productos por valor de stock</h3>
            <div className="space-y-3">
              {topByValue.map((row, i) => (
                <div key={i} className="space-y-1">
                  <div className="flex items-center justify-between text-xs text-gray-600 dark:text-gray-400">
                    <span className="font-medium truncate max-w-[200px]">{row.nombre}</span>
                    <span className="tabular-nums">{fmtCurrency(row.valor_stock)} ({fmtNumber(row.stock_actual)} uds)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 bg-gray-100 dark:bg-gray-700 rounded-full h-4 overflow-hidden">
                      <div
                        className="h-full bg-blue-500 dark:bg-blue-600 rounded-full transition-all duration-500"
                        style={{ width: `${Math.max((row.valor_stock / maxStockValue) * 100, 2)}%`, minWidth: '4px' }}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Low stock alert */}
      {low_stock.length > 0 && (
        <>
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-2">
            Productos bajo stock minimo
            <span className="text-xs px-2 py-0.5 rounded bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300">
              {low_stock.length}
            </span>
          </h3>
          <ReportTable columns={stockColumns} rows={low_stock} highlightable />
        </>
      )}

      {/* Dead stock */}
      {dead_stock.length > 0 && (
        <>
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-2">
            Stock sin movimiento (60+ dias)
            <span className="text-xs px-2 py-0.5 rounded bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300">
              {dead_stock.length}
            </span>
          </h3>
          <ReportTable columns={deadStockColumns} rows={dead_stock} highlightable />
        </>
      )}

      {/* Full stock table */}
      <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Inventario completo</h3>
      <ReportTable columns={stockColumns} rows={stock_items} highlightable />
    </>
  )
}
