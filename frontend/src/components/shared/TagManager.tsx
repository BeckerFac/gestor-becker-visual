import React, { useState } from 'react'
import { api } from '@/services/api'
import { toast } from '@/hooks/useToast'

interface Tag {
  id: string
  name: string
  color: string
}

interface TagManagerProps {
  entityId: string
  entityType: 'enterprise' | 'customer'
  availableTags: Tag[]
  assignedTags: Tag[]
  onTagsChange: () => void
  onTagCreated?: () => void
}

const PRESET_COLORS = [
  '#EF4444', '#F97316', '#EAB308', '#22C55E', '#3B82F6', '#8B5CF6', '#EC4899', '#6B7280'
]

export const TagManager: React.FC<TagManagerProps> = ({
  entityId, entityType, availableTags, assignedTags, onTagsChange, onTagCreated,
}) => {
  const [showCreate, setShowCreate] = useState(false)
  const [newTagName, setNewTagName] = useState('')
  const [newTagColor, setNewTagColor] = useState('#3B82F6')
  const [creating, setCreating] = useState(false)

  const assignedIds = new Set((assignedTags || []).map(t => t.id))
  const unassigned = (availableTags || []).filter(t => !assignedIds.has(t.id))

  const handleAssign = async (tagId: string) => {
    try {
      await api.assignTag(entityId, entityType, tagId)
      onTagsChange()
    } catch (e: any) {
      toast.error(e.message)
    }
  }

  const handleRemove = async (tagId: string) => {
    try {
      await api.removeTag(entityId, entityType, tagId)
      onTagsChange()
    } catch (e: any) {
      toast.error(e.message)
    }
  }

  const handleCreate = async () => {
    if (!newTagName.trim()) return
    setCreating(true)
    try {
      const tag = await api.createTag({ name: newTagName.trim(), color: newTagColor })
      await api.assignTag(entityId, entityType, tag.id)
      setNewTagName('')
      setShowCreate(false)
      onTagCreated?.()
      onTagsChange()
      toast.success('Etiqueta creada y asignada')
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setCreating(false)
    }
  }

  const parsed = typeof assignedTags === 'string' ? JSON.parse(assignedTags) : assignedTags || []

  return (
    <div className="space-y-2">
      {/* Assigned tags with remove button */}
      {parsed.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {parsed.map((tag: Tag) => (
            <span
              key={tag.id}
              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium"
              style={{ backgroundColor: `${tag.color}20`, color: tag.color, border: `1px solid ${tag.color}40` }}
            >
              {tag.name}
              <button
                onClick={() => handleRemove(tag.id)}
                className="hover:opacity-70 font-bold text-xs leading-none"
                title="Quitar etiqueta"
              >
                x
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Assign existing tags */}
      {unassigned.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {unassigned.map(tag => (
            <button
              key={tag.id}
              onClick={() => handleAssign(tag.id)}
              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium opacity-50 hover:opacity-100 transition-opacity border border-dashed"
              style={{ borderColor: tag.color, color: tag.color }}
              title={`Asignar: ${tag.name}`}
            >
              + {tag.name}
            </button>
          ))}
        </div>
      )}

      {/* Create new tag inline */}
      {showCreate ? (
        <div className="flex items-center gap-2 mt-1">
          <input
            type="text"
            placeholder="Nombre..."
            value={newTagName}
            onChange={e => setNewTagName(e.target.value)}
            className="px-2 py-1 border border-gray-300 dark:border-gray-600 rounded text-xs w-24 bg-white dark:bg-gray-700 dark:text-gray-100"
            autoFocus
            onKeyDown={e => e.key === 'Enter' && handleCreate()}
          />
          <div className="flex gap-0.5">
            {PRESET_COLORS.map(c => (
              <button
                key={c}
                onClick={() => setNewTagColor(c)}
                className={`w-4 h-4 rounded-full border-2 ${newTagColor === c ? 'border-gray-800' : 'border-transparent'}`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
          <button onClick={handleCreate} disabled={creating || !newTagName.trim()} className="text-xs text-blue-600 hover:text-blue-800 font-medium disabled:opacity-50">
            {creating ? '...' : 'Crear'}
          </button>
          <button onClick={() => setShowCreate(false)} className="text-xs text-gray-400 hover:text-gray-600 dark:text-gray-400">
            Cancelar
          </button>
        </div>
      ) : (
        <button
          onClick={() => setShowCreate(true)}
          className="text-xs text-gray-400 hover:text-gray-600 dark:text-gray-400"
        >
          + Nueva etiqueta
        </button>
      )}
    </div>
  )
}
