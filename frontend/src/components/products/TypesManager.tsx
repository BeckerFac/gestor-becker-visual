import React, { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { toast } from '@/hooks/useToast'
import { api } from '@/services/api'
import type { ProductType } from './types'

interface TypesManagerProps {
  productTypes: ProductType[]
  onReload: () => void
}

export const TypesManager: React.FC<TypesManagerProps> = ({ productTypes, onReload }) => {
  const [newTypeName, setNewTypeName] = useState('')
  const [newTypeDesc, setNewTypeDesc] = useState('')
  const [editingTypeId, setEditingTypeId] = useState<string | null>(null)
  const [editingTypeName, setEditingTypeName] = useState('')

  const handleCreateType = async () => {
    if (!newTypeName.trim()) return
    try {
      await api.createProductType({ name: newTypeName.trim(), description: newTypeDesc.trim() || undefined })
      setNewTypeName('')
      setNewTypeDesc('')
      await onReload()
      toast.success('Tipo creado')
    } catch (e: any) { toast.error(e.message) }
  }

  const handleUpdateType = async (typeId: string) => {
    if (!editingTypeName.trim()) return
    try {
      await api.updateProductType(typeId, { name: editingTypeName.trim() })
      setEditingTypeId(null)
      setEditingTypeName('')
      await onReload()
      toast.success('Tipo actualizado')
    } catch (e: any) { toast.error(e.message) }
  }

  const handleDeleteType = async (typeId: string) => {
    try {
      await api.deleteProductType(typeId)
      await onReload()
      toast.success('Tipo eliminado')
    } catch (e: any) { toast.error(e.message) }
  }

  const handleMoveType = async (typeId: string, direction: 'up' | 'down') => {
    const structured = productTypes.filter(t => typeof t !== 'string') as ProductType[]
    const idx = structured.findIndex(t => t.id === typeId)
    if (idx < 0) return
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1
    if (swapIdx < 0 || swapIdx >= structured.length) return
    const ordered = [...structured]
    const temp = ordered[idx]
    ordered[idx] = ordered[swapIdx]
    ordered[swapIdx] = temp
    try {
      await api.reorderProductTypes(ordered.map(t => t.id))
      await onReload()
    } catch (e: any) { toast.error(e.message) }
  }

  return (
    <div className="space-y-3">
      <h3 className="text-base font-semibold text-gray-800 dark:text-gray-200">Gestionar tipos de producto ({productTypes.length})</h3>
      <div className="bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-lg p-3 space-y-2">
        <div className="flex items-center gap-2">
          <input placeholder="Nombre del tipo..." value={newTypeName} onChange={e => setNewTypeName(e.target.value)} className="px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm flex-1 bg-white dark:bg-gray-700 dark:text-gray-100" />
          <input placeholder="Descripcion (opcional)" value={newTypeDesc} onChange={e => setNewTypeDesc(e.target.value)} className="px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm flex-1 bg-white dark:bg-gray-700 dark:text-gray-100" />
          <Button variant="primary" onClick={handleCreateType} disabled={!newTypeName.trim()}>+ Crear</Button>
        </div>
        {productTypes.length > 0 && (
          <div className="space-y-1">
            {(productTypes.filter(t => typeof t !== 'string') as ProductType[]).map((t, idx, arr) => (
              <div key={t.id} className="flex items-center justify-between py-1 px-2 bg-white dark:bg-gray-700 rounded">
                {editingTypeId === t.id ? (
                  <div className="flex items-center gap-2 flex-1">
                    <input
                      className="px-2 py-1 border border-blue-300 dark:border-blue-600 rounded text-sm flex-1 bg-white dark:bg-gray-800 dark:text-gray-100"
                      value={editingTypeName}
                      onChange={e => setEditingTypeName(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleUpdateType(t.id)}
                      autoFocus
                    />
                    <button onClick={() => handleUpdateType(t.id)} className="text-blue-600 dark:text-blue-400 text-xs hover:underline">OK</button>
                    <button onClick={() => setEditingTypeId(null)} className="text-gray-400 text-xs hover:underline">x</button>
                  </div>
                ) : (
                  <>
                    <span className="font-medium text-gray-800 dark:text-gray-200">
                      {t.name}
                      {t.description && <span className="text-gray-400 text-xs ml-2">({t.description})</span>}
                    </span>
                    <div className="flex items-center gap-1">
                      <button onClick={() => handleMoveType(t.id, 'up')} disabled={idx === 0} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-xs disabled:opacity-30" title="Subir">^</button>
                      <button onClick={() => handleMoveType(t.id, 'down')} disabled={idx === arr.length - 1} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-xs disabled:opacity-30" title="Bajar">v</button>
                      <button onClick={() => { setEditingTypeId(t.id); setEditingTypeName(t.name) }} className="text-blue-500 dark:text-blue-400 text-xs hover:underline ml-1">Editar</button>
                      <button onClick={() => handleDeleteType(t.id)} className="text-red-500 dark:text-red-400 text-xs hover:underline">Eliminar</button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
