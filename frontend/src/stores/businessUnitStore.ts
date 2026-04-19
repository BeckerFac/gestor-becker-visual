import { create } from 'zustand'

export interface BusinessUnit {
  id: string
  company_id: string
  name: string
  is_fiscal: boolean
  cuit: string | null
  address: string | null
  iibb_number: string | null
  afip_start_date: string | null
  sort_order: number
  active: boolean
  created_at: string
  updated_at: string
}

interface BusinessUnitStore {
  units: BusinessUnit[]
  activeUnitId: string | null
  loaded: boolean

  setUnits: (units: BusinessUnit[]) => void
  setActiveUnitId: (id: string | null) => void
  getActiveUnit: () => BusinessUnit | null
  reset: () => void
}

const STORAGE_KEY = 'gestia_active_business_unit_id'

export const useBusinessUnitStore = create<BusinessUnitStore>((set, get) => ({
  units: [],
  activeUnitId: typeof window !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null,
  loaded: false,

  setUnits: (units) => {
    const state = get()
    const prevActiveId = state.activeUnitId
    let activeId = prevActiveId

    // If current active doesn't exist in units, pick first
    if (!activeId || !units.find(u => u.id === activeId)) {
      activeId = units.length > 0 ? units[0].id : null
    }

    if (activeId) {
      localStorage.setItem(STORAGE_KEY, activeId)
    } else {
      // Nor-fix (item 1): when the backend returns zero units and we used to
      // have a stale id saved, wipe localStorage so the axios interceptor
      // stops injecting a business_unit_id that excludes everything.
      localStorage.removeItem(STORAGE_KEY)
    }

    set({ units, activeUnitId: activeId, loaded: true })
  },

  setActiveUnitId: (id) => {
    if (id) {
      localStorage.setItem(STORAGE_KEY, id)
    } else {
      localStorage.removeItem(STORAGE_KEY)
    }
    set({ activeUnitId: id })
  },

  getActiveUnit: () => {
    const state = get()
    return state.units.find(u => u.id === state.activeUnitId) || null
  },

  reset: () => {
    localStorage.removeItem(STORAGE_KEY)
    set({ units: [], activeUnitId: null, loaded: false })
  },
}))
