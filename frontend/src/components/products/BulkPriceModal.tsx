import React, { useState, useEffect } from 'react'
import { Card, CardContent } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { toast } from '@/hooks/useToast'
import { formatCurrency } from '@/lib/utils'
import { api } from '@/services/api'
import type { BulkPreviewItem } from './types'

interface BulkPriceModalProps {
  selectedIds: Set<string>
  onClose: () => void
  onUpdated: () => void
}

export const BulkPriceModal: React.FC<BulkPriceModalProps> = ({
  selectedIds,
  onClose,
  onUpdated,
}) => {
  const [bulkPercent, setBulkPercent] = useState('')
  const [bulkUpdating, setBulkUpdating] = useState(false)
  const [preview, setPreview] = useState<BulkPreviewItem[]>([])
  const [previewLoading, setPreviewLoading] = useState(false)
  const [showPreview, setShowPreview] = useState(false)

  const pct = parseFloat(bulkPercent)

  const handlePreview = async () => {
    if (!pct || selectedIds.size === 0) return
    setPreviewLoading(true)
    try {
      const result = await api.bulkPricePreview(Array.from(selectedIds), pct)
      setPreview(result.items || [])
      setShowPreview(true)
    } catch (e: any) { toast.error(e.message) }
    finally { setPreviewLoading(false) }
  }

  const handleApply = async () => {
    if (!pct || selectedIds.size === 0) return
    setBulkUpdating(true)
    try {
      await api.bulkUpdatePrice(Array.from(selectedIds), pct)
      toast.success(`${selectedIds.size} productos actualizados (${pct > 0 ? '+' : ''}${pct}%)`)
      onUpdated()
    } catch (e: any) { toast.error(e.message) }
    finally { setBulkUpdating(false) }
  }

  return (
    <Card className="border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20">
      <CardContent className="pt-4 space-y-4">
        <h4 className="text-sm font-semibold text-blue-800 dark:text-blue-300">
          Aumento masivo de precios -- {selectedIds.size} producto{selectedIds.size > 1 ? 's' : ''}
        </h4>

        <div className="flex items-center gap-3">
          <input
            type="number"
            step="0.1"
            placeholder="Ej: 15 para +15%"
            value={bulkPercent}
            onChange={e => { setBulkPercent(e.target.value); setShowPreview(false) }}
            className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm w-40 bg-white dark:bg-gray-700 dark:text-gray-100"
          />
          <span className="text-sm text-gray-600 dark:text-gray-400">%</span>
          <Button variant="secondary" onClick={handlePreview} loading={previewLoading} disabled={!bulkPercent}>
            Vista previa
          </Button>
          {showPreview && (
            <Button variant="success" onClick={handleApply} loading={bulkUpdating} disabled={!bulkPercent}>
              Aplicar
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
        </div>

        <p className="text-xs text-gray-500 dark:text-gray-400">
          Formula: nuevo_costo = costo * (1 + %/100), nuevo_precio = nuevo_costo * (1 + margen/100) * (1 + IVA/100).
          Usa valores negativos para disminuir (ej: -10 para -10%).
        </p>

        {/* Preview table */}
        {showPreview && preview.length > 0 && (
          <div className="overflow-x-auto max-h-[300px]">
            <table className="w-full text-sm border-collapse">
              <thead className="sticky top-0">
                <tr className="bg-blue-100 dark:bg-blue-900/40 text-xs text-blue-800 dark:text-blue-300">
                  <th className="px-3 py-2 text-left">SKU</th>
                  <th className="px-3 py-2 text-left">Producto</th>
                  <th className="px-3 py-2 text-right">Costo Antes</th>
                  <th className="px-3 py-2 text-right">Costo Despues</th>
                  <th className="px-3 py-2 text-right">Margen%</th>
                  <th className="px-3 py-2 text-right">Precio Antes</th>
                  <th className="px-3 py-2 text-right">Precio Despues</th>
                </tr>
              </thead>
              <tbody>
                {preview.map(item => (
                  <tr key={item.product_id} className="border-t border-blue-200/50 dark:border-blue-800/50">
                    <td className="px-3 py-1.5 font-mono text-xs text-gray-500 dark:text-gray-400">{item.sku}</td>
                    <td className="px-3 py-1.5 text-gray-800 dark:text-gray-200">{item.name}</td>
                    <td className="px-3 py-1.5 text-right text-gray-500 dark:text-gray-400">{formatCurrency(parseFloat(item.old_cost))}</td>
                    <td className="px-3 py-1.5 text-right font-bold text-blue-700 dark:text-blue-400">{formatCurrency(parseFloat(item.new_cost))}</td>
                    <td className="px-3 py-1.5 text-right text-gray-500 dark:text-gray-400">{item.margin_percent}%</td>
                    <td className="px-3 py-1.5 text-right text-gray-500 dark:text-gray-400">{formatCurrency(parseFloat(item.old_final_price))}</td>
                    <td className="px-3 py-1.5 text-right font-bold text-green-700 dark:text-green-400">{formatCurrency(parseFloat(item.new_final_price))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
