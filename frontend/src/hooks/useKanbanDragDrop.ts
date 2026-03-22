import { useState, useCallback } from 'react'
import {
  useSensor,
  useSensors,
  PointerSensor,
  TouchSensor,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core'
import { api } from '@/services/api'
import { toast } from '@/hooks/useToast'
import type { Deal } from '@/components/crm/DealCard'

interface UseKanbanDragDropOptions {
  dealsByStage: Record<string, Deal[]>
  setDealsByStage: React.Dispatch<React.SetStateAction<Record<string, Deal[]>>>
  loadData: () => Promise<void>
}

export function useKanbanDragDrop({ dealsByStage, setDealsByStage, loadData }: UseKanbanDragDropOptions) {
  const [activeDeal, setActiveDeal] = useState<Deal | null>(null)
  const [sourceStageKey, setSourceStageKey] = useState<string | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 5 },
    })
  )

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const { deal, stageKey } = event.active.data.current as { deal: Deal; stageKey: string }
    setActiveDeal(deal)
    setSourceStageKey(stageKey)
  }, [])

  const handleDragEnd = useCallback(async (event: DragEndEvent) => {
    const { active, over } = event
    setActiveDeal(null)
    setSourceStageKey(null)

    if (!over || !active.data.current) return

    const { deal, stageKey: fromKey } = active.data.current as { deal: Deal; stageKey: string }
    const toStageId = over.id as string

    // Don't move to same stage
    if (toStageId === fromKey || toStageId === deal.stage_id) return

    // Optimistic update: snapshot + move
    const snapshot = Object.fromEntries(Object.entries(dealsByStage).map(([k, v]) => [k, [...v]]))
    setDealsByStage(prev => {
      const next = { ...prev }
      // Remove from source (check all keys that point to same array)
      for (const key of Object.keys(next)) {
        next[key] = (next[key] || []).filter(d => d.id !== deal.id)
      }
      // Add to target
      if (next[toStageId]) {
        next[toStageId] = [...next[toStageId], deal]
      }
      return next
    })

    try {
      await api.moveCrmDealStage(deal.id, toStageId)
      toast.success('Deal movido')
      await loadData()
    } catch (err: any) {
      // Rollback
      setDealsByStage(snapshot)
      toast.error(err?.response?.data?.error || err.message || 'Error al mover deal')
    }
  }, [dealsByStage, setDealsByStage, loadData])

  const handleDragCancel = useCallback(() => {
    setActiveDeal(null)
    setSourceStageKey(null)
  }, [])

  return {
    activeDeal,
    sourceStageKey,
    sensors,
    handleDragStart,
    handleDragEnd,
    handleDragCancel,
  }
}
