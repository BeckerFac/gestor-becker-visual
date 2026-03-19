import React, { useState, useEffect, useRef, useCallback } from 'react'
import { Card, CardContent } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { toast } from '@/hooks/useToast'
import { formatCurrency } from '@/lib/utils'
import { api } from '@/services/api'
import type { BulkPreviewItem } from './types'
import * as XLSX from 'xlsx'

interface BulkPriceModalProps {
  selectedIds: Set<string>
  onClose: () => void
  onUpdated: () => void
}

type ActiveTab = 'percent' | 'import' | 'undo'

interface ImportPreviewItem {
  sku: string
  status: string
  product_name?: string
  old_cost?: number
  new_cost?: number
  new_final_price?: number
}

interface BulkOperation {
  id: string
  operation_type: string
  parameters: any
  affected_products: number
  rolled_back: boolean
  rolled_back_at: string | null
  performed_at: string
  performed_by_name?: string
}

export const BulkPriceModal: React.FC<BulkPriceModalProps> = ({
  selectedIds,
  onClose,
  onUpdated,
}) => {
  const [activeTab, setActiveTab] = useState<ActiveTab>('percent')

  // --- Percent tab state ---
  const [bulkPercent, setBulkPercent] = useState('')
  const [bulkUpdating, setBulkUpdating] = useState(false)
  const [preview, setPreview] = useState<BulkPreviewItem[]>([])
  const [previewLoading, setPreviewLoading] = useState(false)
  const [showPreview, setShowPreview] = useState(false)
  const [lastOperationId, setLastOperationId] = useState<string | null>(null)

  // --- Import tab state ---
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importParsed, setImportParsed] = useState<{ sku: string; new_cost: number }[]>([])
  const [importPreview, setImportPreview] = useState<ImportPreviewItem[]>([])
  const [importNotFound, setImportNotFound] = useState<string[]>([])
  const [importPreviewLoading, setImportPreviewLoading] = useState(false)
  const [importApplying, setImportApplying] = useState(false)
  const [importDone, setImportDone] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // --- Undo tab state ---
  const [recentOps, setRecentOps] = useState<BulkOperation[]>([])
  const [opsLoading, setOpsLoading] = useState(false)
  const [undoingId, setUndoingId] = useState<string | null>(null)

  const pct = parseFloat(bulkPercent)

  // Load recent operations when undo tab opens
  const loadRecentOps = useCallback(async () => {
    setOpsLoading(true)
    try {
      const ops = await api.getRecentBulkOperations()
      setRecentOps(Array.isArray(ops) ? ops : [])
    } catch { setRecentOps([]) }
    finally { setOpsLoading(false) }
  }, [])

  useEffect(() => {
    if (activeTab === 'undo') loadRecentOps()
  }, [activeTab, loadRecentOps])

  // --- Percent handlers ---

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
      const result = await api.bulkUpdatePriceWithHistory(Array.from(selectedIds), pct)
      toast.success(`${selectedIds.size} productos actualizados (${pct > 0 ? '+' : ''}${pct}%)`)
      if (result?.operation_id) {
        setLastOperationId(result.operation_id)
      }
      onUpdated()
    } catch (e: any) { toast.error(e.message) }
    finally { setBulkUpdating(false) }
  }

  const handleUndoLast = async () => {
    if (!lastOperationId) return
    setBulkUpdating(true)
    try {
      await api.undoBulkOperation(lastOperationId)
      toast.success('Operacion deshecha correctamente')
      setLastOperationId(null)
      setShowPreview(false)
      setBulkPercent('')
      onUpdated()
    } catch (e: any) { toast.error(e.message) }
    finally { setBulkUpdating(false) }
  }

  // --- Import handlers ---

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setImportFile(file)
    setImportPreview([])
    setImportNotFound([])
    setImportDone(false)

    try {
      const data = await file.arrayBuffer()
      const workbook = XLSX.read(data, { type: 'array' })
      const sheet = workbook.Sheets[workbook.SheetNames[0]]
      const rows = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { defval: '' })

      if (rows.length === 0) {
        toast.error('El archivo esta vacio')
        return
      }

      // Auto-detect column names (case insensitive)
      const firstRow = rows[0]
      const keys = Object.keys(firstRow)

      const skuKey = keys.find(k =>
        /^sku$/i.test(k.trim()) || /^codigo$/i.test(k.trim()) || /^code$/i.test(k.trim()) || /^articulo$/i.test(k.trim())
      )
      const costKey = keys.find(k =>
        /^(new_)?cost[oe]?$/i.test(k.trim()) || /^precio$/i.test(k.trim()) || /^price$/i.test(k.trim()) || /^new_cost$/i.test(k.trim()) || /^costo_nuevo$/i.test(k.trim())
      )

      if (!skuKey || !costKey) {
        toast.error(`No se encontraron columnas SKU y Costo. Columnas detectadas: ${keys.join(', ')}. Se esperan columnas como "SKU" y "Costo" o "Precio".`)
        return
      }

      const parsed = rows
        .map(row => ({
          sku: String(row[skuKey] || '').trim(),
          new_cost: parseFloat(String(row[costKey] || '0').replace(/[^0-9.,]/g, '').replace(',', '.')) || 0,
        }))
        .filter(item => item.sku && item.new_cost > 0)

      if (parsed.length === 0) {
        toast.error('No se encontraron items validos en el archivo')
        return
      }

      setImportParsed(parsed)
      toast.success(`${parsed.length} items parseados del archivo`)
    } catch (err: any) {
      toast.error(`Error al leer archivo: ${err.message}`)
    }
  }

  const handleImportPreview = async () => {
    if (importParsed.length === 0) return
    setImportPreviewLoading(true)
    try {
      const result = await api.importSupplierPrices(importParsed)
      const matched = (result.results || []).filter((r: any) => r.status === 'updated')
      const notFound = (result.results || []).filter((r: any) => r.status === 'not_found').map((r: any) => r.sku)
      setImportPreview(matched)
      setImportNotFound(notFound)
      if (result.operation_id) {
        setLastOperationId(result.operation_id)
      }
      setImportDone(true)
      toast.success(`${result.summary?.updated || 0} productos actualizados, ${result.summary?.not_found || 0} no encontrados`)
      onUpdated()
    } catch (e: any) { toast.error(e.message) }
    finally { setImportPreviewLoading(false) }
  }

  // --- Undo handlers ---

  const handleUndoOperation = async (operationId: string) => {
    setUndoingId(operationId)
    try {
      const result = await api.undoBulkOperation(operationId)
      toast.success(`${result.restored || 0} productos revertidos`)
      await loadRecentOps()
      onUpdated()
    } catch (e: any) { toast.error(e.message) }
    finally { setUndoingId(null) }
  }

  const tabs = [
    { key: 'percent' as const, label: `% Masivo (${selectedIds.size})` },
    { key: 'import' as const, label: 'Importar Excel' },
    { key: 'undo' as const, label: 'Deshacer' },
  ]

  return (
    <Card className="border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20">
      <CardContent className="pt-4 space-y-4">
        {/* Tab selector */}
        <div className="flex items-center gap-1 border-b border-blue-200 dark:border-blue-800">
          {tabs.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.key
                  ? 'border-blue-500 text-blue-700 dark:text-blue-300'
                  : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
              }`}
            >
              {tab.label}
            </button>
          ))}
          <div className="flex-1" />
          <Button variant="secondary" onClick={onClose} className="text-xs">Cerrar</Button>
        </div>

        {/* PERCENT TAB */}
        {activeTab === 'percent' && (
          <div className="space-y-3">
            <h4 className="text-sm font-semibold text-blue-800 dark:text-blue-300">
              Aumento masivo de precios -- {selectedIds.size} producto{selectedIds.size > 1 ? 's' : ''}
            </h4>

            <div className="flex items-center gap-3">
              <input
                type="number"
                step="0.1"
                placeholder="Ej: 15 para +15%"
                value={bulkPercent}
                onChange={e => { setBulkPercent(e.target.value); setShowPreview(false); setLastOperationId(null) }}
                className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm w-40 bg-white dark:bg-gray-700 dark:text-gray-100"
              />
              <span className="text-sm text-gray-600 dark:text-gray-400">%</span>
              <Button variant="secondary" onClick={handlePreview} loading={previewLoading} disabled={!bulkPercent}>
                Vista previa
              </Button>
              {showPreview && !lastOperationId && (
                <Button variant="success" onClick={handleApply} loading={bulkUpdating} disabled={!bulkPercent}>
                  Aplicar
                </Button>
              )}
            </div>

            <p className="text-xs text-gray-500 dark:text-gray-400">
              Formula: nuevo_costo = costo * (1 + %/100), nuevo_precio = nuevo_costo * (1 + margen/100) * (1 + IVA/100).
              Usa valores negativos para disminuir (ej: -10 para -10%).
            </p>

            {/* Undo last operation button */}
            {lastOperationId && (
              <div className="flex items-center gap-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg px-3 py-2">
                <span className="text-sm text-yellow-800 dark:text-yellow-300">Operacion aplicada correctamente.</span>
                <Button
                  variant="danger"
                  onClick={handleUndoLast}
                  loading={bulkUpdating}
                  className="text-xs"
                >
                  Deshacer
                </Button>
                <span className="text-xs text-yellow-600 dark:text-yellow-400">Disponible por 5 minutos</span>
              </div>
            )}

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
          </div>
        )}

        {/* IMPORT TAB */}
        {activeTab === 'import' && (
          <div className="space-y-3">
            <h4 className="text-sm font-semibold text-blue-800 dark:text-blue-300">
              Importar precios desde Excel / CSV
            </h4>

            <p className="text-xs text-gray-500 dark:text-gray-400">
              El archivo debe tener una columna "SKU" (o "Codigo") y una columna "Costo" (o "Precio").
              Se matchea por SKU, se actualiza el costo y se recalcula el precio final manteniendo margenes.
            </p>

            <div className="flex items-center gap-3">
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={handleFileChange}
                className="text-sm text-gray-600 dark:text-gray-300 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-blue-100 file:text-blue-700 dark:file:bg-blue-900/40 dark:file:text-blue-300 hover:file:bg-blue-200 dark:hover:file:bg-blue-900/60"
              />
              {importFile && (
                <span className="text-xs text-gray-500">{importFile.name}</span>
              )}
            </div>

            {importParsed.length > 0 && !importDone && (
              <div className="space-y-2">
                <p className="text-sm text-gray-700 dark:text-gray-300">
                  {importParsed.length} items listos para importar.
                </p>
                <div className="overflow-x-auto max-h-[200px]">
                  <table className="w-full text-sm border-collapse">
                    <thead className="sticky top-0">
                      <tr className="bg-blue-100 dark:bg-blue-900/40 text-xs text-blue-800 dark:text-blue-300">
                        <th className="px-3 py-1.5 text-left">SKU</th>
                        <th className="px-3 py-1.5 text-right">Nuevo Costo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {importParsed.slice(0, 50).map((item, idx) => (
                        <tr key={idx} className="border-t border-blue-200/50 dark:border-blue-800/50">
                          <td className="px-3 py-1 font-mono text-xs text-gray-600 dark:text-gray-400">{item.sku}</td>
                          <td className="px-3 py-1 text-right text-gray-800 dark:text-gray-200">{formatCurrency(item.new_cost)}</td>
                        </tr>
                      ))}
                      {importParsed.length > 50 && (
                        <tr><td colSpan={2} className="px-3 py-1 text-xs text-gray-400">...y {importParsed.length - 50} mas</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <Button
                  variant="success"
                  onClick={handleImportPreview}
                  loading={importPreviewLoading}
                >
                  Importar y aplicar cambios
                </Button>
              </div>
            )}

            {/* Import results */}
            {importDone && (
              <div className="space-y-2">
                {importPreview.length > 0 && (
                  <>
                    <p className="text-sm font-medium text-green-700 dark:text-green-400">
                      {importPreview.length} productos actualizados:
                    </p>
                    <div className="overflow-x-auto max-h-[200px]">
                      <table className="w-full text-sm border-collapse">
                        <thead className="sticky top-0">
                          <tr className="bg-green-100 dark:bg-green-900/40 text-xs text-green-800 dark:text-green-300">
                            <th className="px-3 py-1.5 text-left">SKU</th>
                            <th className="px-3 py-1.5 text-left">Producto</th>
                            <th className="px-3 py-1.5 text-right">Costo Anterior</th>
                            <th className="px-3 py-1.5 text-right">Costo Nuevo</th>
                            <th className="px-3 py-1.5 text-right">Precio Final</th>
                          </tr>
                        </thead>
                        <tbody>
                          {importPreview.map((item, idx) => (
                            <tr key={idx} className="border-t border-green-200/50 dark:border-green-800/50">
                              <td className="px-3 py-1 font-mono text-xs text-gray-500 dark:text-gray-400">{item.sku}</td>
                              <td className="px-3 py-1 text-gray-800 dark:text-gray-200">{item.product_name}</td>
                              <td className="px-3 py-1 text-right text-gray-500 dark:text-gray-400">{formatCurrency(item.old_cost || 0)}</td>
                              <td className="px-3 py-1 text-right font-bold text-blue-700 dark:text-blue-400">{formatCurrency(item.new_cost || 0)}</td>
                              <td className="px-3 py-1 text-right font-bold text-green-700 dark:text-green-400">{formatCurrency(item.new_final_price || 0)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}

                {importNotFound.length > 0 && (
                  <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg px-3 py-2">
                    <p className="text-sm font-medium text-yellow-800 dark:text-yellow-300">
                      {importNotFound.length} SKUs no encontrados:
                    </p>
                    <p className="text-xs text-yellow-600 dark:text-yellow-400 mt-1">
                      {importNotFound.slice(0, 20).join(', ')}
                      {importNotFound.length > 20 && ` ...y ${importNotFound.length - 20} mas`}
                    </p>
                  </div>
                )}

                {lastOperationId && (
                  <div className="flex items-center gap-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg px-3 py-2">
                    <span className="text-sm text-yellow-800 dark:text-yellow-300">Importacion completada.</span>
                    <Button
                      variant="danger"
                      onClick={handleUndoLast}
                      loading={bulkUpdating}
                      className="text-xs"
                    >
                      Deshacer importacion
                    </Button>
                    <span className="text-xs text-yellow-600 dark:text-yellow-400">Disponible por 5 minutos</span>
                  </div>
                )}

                <Button
                  variant="secondary"
                  onClick={() => {
                    setImportDone(false)
                    setImportParsed([])
                    setImportPreview([])
                    setImportNotFound([])
                    setImportFile(null)
                    if (fileInputRef.current) fileInputRef.current.value = ''
                  }}
                >
                  Importar otro archivo
                </Button>
              </div>
            )}
          </div>
        )}

        {/* UNDO TAB */}
        {activeTab === 'undo' && (
          <div className="space-y-3">
            <h4 className="text-sm font-semibold text-blue-800 dark:text-blue-300">
              Deshacer operaciones masivas
            </h4>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Solo se pueden deshacer operaciones de los ultimos 5 minutos.
            </p>

            {opsLoading ? (
              <p className="text-xs text-gray-400">Cargando operaciones...</p>
            ) : recentOps.length === 0 ? (
              <p className="text-xs text-gray-400">No hay operaciones recientes</p>
            ) : (
              <div className="space-y-2">
                {recentOps.map(op => {
                  const performedAt = new Date(op.performed_at)
                  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000)
                  const canUndo = !op.rolled_back && performedAt > fiveMinutesAgo
                  const typeLabels: Record<string, string> = {
                    percentage_increase: 'Aumento porcentual',
                    supplier_import: 'Import. proveedor',
                  }
                  const params = typeof op.parameters === 'string' ? JSON.parse(op.parameters) : op.parameters
                  return (
                    <div key={op.id} className={`flex items-center justify-between py-2 px-3 rounded-lg border text-sm ${
                      op.rolled_back
                        ? 'bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700 opacity-60'
                        : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-600'
                    }`}>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-gray-800 dark:text-gray-200">
                            {typeLabels[op.operation_type] || op.operation_type}
                          </span>
                          {params?.percent && (
                            <span className="text-xs text-gray-500">({params.percent > 0 ? '+' : ''}{params.percent}%)</span>
                          )}
                          <span className="text-xs text-gray-400">
                            {op.affected_products} producto{op.affected_products > 1 ? 's' : ''}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-xs text-gray-400">
                            {performedAt.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                          </span>
                          {op.performed_by_name && (
                            <span className="text-xs text-gray-400">{op.performed_by_name}</span>
                          )}
                          {op.rolled_back && (
                            <span className="text-xs px-1.5 py-0.5 rounded-full bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400">Revertido</span>
                          )}
                        </div>
                      </div>
                      {canUndo && (
                        <Button
                          variant="danger"
                          onClick={() => handleUndoOperation(op.id)}
                          loading={undoingId === op.id}
                          className="text-xs ml-3"
                        >
                          Deshacer
                        </Button>
                      )}
                    </div>
                  )
                })}
              </div>
            )}

            <Button variant="secondary" onClick={loadRecentOps} loading={opsLoading} className="text-xs">
              Actualizar
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
