import React, { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { toast } from '@/hooks/useToast'
import { api } from '@/services/api'
import type { Category } from './types'

interface CategoriesManagerProps {
  categories: Category[]
  onReload: () => void
}

export const CategoriesManager: React.FC<CategoriesManagerProps> = ({ categories, onReload }) => {
  const [newCategoryName, setNewCategoryName] = useState('')
  const [newCategoryParent, setNewCategoryParent] = useState('')

  const handleCreateCategory = async () => {
    if (!newCategoryName.trim()) return
    try {
      await api.createCategory({ name: newCategoryName.trim(), parent_id: newCategoryParent || undefined })
      setNewCategoryName('')
      setNewCategoryParent('')
      await onReload()
      toast.success('Categoria creada')
    } catch (e: any) { toast.error(e.message) }
  }

  const handleDeleteCategory = async (catId: string) => {
    try {
      await api.deleteCategory(catId)
      await onReload()
      toast.success('Categoria eliminada')
    } catch (e: any) { toast.error(e.message) }
  }

  return (
    <div className="space-y-3">
      <h3 className="text-base font-semibold text-gray-800 dark:text-gray-200">Gestionar categorias ({categories.length})</h3>
      <div className="bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-lg p-3 space-y-2">
        <div className="flex items-center gap-2">
          <input placeholder="Nombre categoria..." value={newCategoryName} onChange={e => setNewCategoryName(e.target.value)} className="px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm flex-1 bg-white dark:bg-gray-700 dark:text-gray-100" />
          <select value={newCategoryParent} onChange={e => setNewCategoryParent(e.target.value)} className="px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 dark:text-gray-100">
            <option value="">Sin padre</option>
            {categories.filter(c => !c.parent_id).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <Button variant="primary" onClick={handleCreateCategory} disabled={!newCategoryName.trim()}>+ Crear</Button>
        </div>
        {categories.length > 0 && (
          <div className="space-y-1">
            {categories.filter(c => !c.parent_id).map(c => (
              <div key={c.id}>
                <div className="flex items-center justify-between py-1 px-2 bg-white dark:bg-gray-700 rounded">
                  <span className="font-medium text-gray-800 dark:text-gray-200">{c.name} <span className="text-gray-400 text-xs">({c.product_count})</span></span>
                  <button onClick={() => handleDeleteCategory(c.id)} className="text-red-500 dark:text-red-400 text-xs hover:underline">Eliminar</button>
                </div>
                {categories.filter(sub => sub.parent_id === c.id).map(sub => (
                  <div key={sub.id} className="flex items-center justify-between py-1 px-2 ml-6 bg-white dark:bg-gray-700 rounded">
                    <span className="text-gray-600 dark:text-gray-300">{sub.name} <span className="text-gray-400 text-xs">({sub.product_count})</span></span>
                    <button onClick={() => handleDeleteCategory(sub.id)} className="text-red-500 dark:text-red-400 text-xs hover:underline">Eliminar</button>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
