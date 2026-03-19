import React, { useState } from 'react'
import { Button } from '@/components/ui/Button'
import {
  MODULE_LABELS,
  MODULE_ACTIONS,
  ACTION_LABELS,
  ROLE_TEMPLATES,
} from '@/shared/permissions.constants'

interface PermissionMatrixProps {
  permissions: Record<string, string[]>
  onChange: (permissions: Record<string, string[]>) => void
  onSave: () => void
  onApplyTemplate: (template: string) => void
  saving: boolean
}

const TEMPLATE_LABELS: Record<string, string> = {
  vendedor: 'Vendedor',
  contable: 'Contable',
  stock_manager: 'Gestor de Stock',
  gerente: 'Gerente',
  viewer: 'Solo Lectura',
}

const ALL_ACTIONS = ['view', 'create', 'edit', 'delete'] as const

// Group modules by section, preserving order from MODULE_LABELS
function getGroupedModules(): { section: string; modules: { key: string; label: string }[] }[] {
  const sectionOrder: string[] = []
  const sectionMap: Record<string, { key: string; label: string }[]> = {}

  for (const [key, meta] of Object.entries(MODULE_LABELS)) {
    // Skip dashboard — it only has 'view' and is not relevant for the matrix
    if (key === 'dashboard') continue

    if (!sectionMap[meta.section]) {
      sectionOrder.push(meta.section)
      sectionMap[meta.section] = []
    }
    sectionMap[meta.section].push({ key, label: meta.label })
  }

  return sectionOrder.map(section => ({
    section,
    modules: sectionMap[section],
  }))
}

export const PermissionMatrix: React.FC<PermissionMatrixProps> = ({
  permissions,
  onChange,
  onSave,
  onApplyTemplate,
  saving,
}) => {
  const [selectedTemplate, setSelectedTemplate] = useState('')
  const grouped = getGroupedModules()

  const isChecked = (moduleKey: string, action: string): boolean => {
    return permissions[moduleKey]?.includes(action) ?? false
  }

  const isActionSupported = (moduleKey: string, action: string): boolean => {
    return MODULE_ACTIONS[moduleKey]?.includes(action) ?? false
  }

  const handleToggle = (moduleKey: string, action: string) => {
    const current = permissions[moduleKey] ?? []
    let updated: string[]

    if (current.includes(action)) {
      // Unchecking
      if (action === 'view') {
        // Unchecking 'view' removes all actions for this module
        updated = []
      } else {
        updated = current.filter(a => a !== action)
      }
    } else {
      // Checking
      if (action === 'view') {
        updated = [...current, 'view']
      } else {
        // Auto-check 'view' when checking create/edit/delete
        const withView = current.includes('view') ? current : [...current, 'view']
        updated = [...withView, action]
      }
    }

    // Deduplicate
    const unique = [...new Set(updated)]

    const next = { ...permissions }
    if (unique.length === 0) {
      delete next[moduleKey]
    } else {
      next[moduleKey] = unique
    }
    onChange(next)
  }

  const handleApplyTemplate = () => {
    if (!selectedTemplate) return
    onApplyTemplate(selectedTemplate)
    setSelectedTemplate('')
  }

  return (
    <div className="space-y-4">
      {/* Template selector */}
      <div className="flex items-center gap-3">
        <label className="text-sm font-medium text-gray-700">Template:</label>
        <select
          value={selectedTemplate}
          onChange={e => setSelectedTemplate(e.target.value)}
          className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">Seleccionar template...</option>
          {Object.keys(ROLE_TEMPLATES).map(key => (
            <option key={key} value={key}>
              {TEMPLATE_LABELS[key] || key}
            </option>
          ))}
        </select>
        <Button
          variant="outline"
          size="sm"
          onClick={handleApplyTemplate}
          disabled={!selectedTemplate}
        >
          Aplicar Template
        </Button>
      </div>

      {/* Permission table */}
      <div className="overflow-x-auto border border-gray-200 rounded-lg">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-100 border-b border-gray-200">
              <th className="text-left px-4 py-3 font-semibold text-gray-700 min-w-[200px]">
                Modulo
              </th>
              {ALL_ACTIONS.map(action => (
                <th
                  key={action}
                  className="text-center px-4 py-3 font-semibold text-gray-700 w-24"
                >
                  {ACTION_LABELS[action]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grouped.map(group => (
              <React.Fragment key={group.section}>
                {/* Section header */}
                <tr>
                  <td
                    colSpan={5}
                    className="px-4 py-2 bg-gray-50 font-bold text-gray-800 text-xs uppercase tracking-wide border-b border-gray-200"
                  >
                    {group.section}
                  </td>
                </tr>
                {/* Module rows */}
                {group.modules.map(mod => (
                  <tr
                    key={mod.key}
                    className="border-b border-gray-100 hover:bg-blue-50/30 transition-colors"
                  >
                    <td className="px-4 py-2.5 pl-8 text-gray-700">{mod.label}</td>
                    {ALL_ACTIONS.map(action => {
                      const supported = isActionSupported(mod.key, action)
                      const checked = isChecked(mod.key, action)
                      return (
                        <td key={action} className="text-center px-4 py-2.5">
                          {supported ? (
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => handleToggle(mod.key, action)}
                              className="w-4 h-4 accent-indigo-600 cursor-pointer"
                            />
                          ) : (
                            <span className="text-gray-300">-</span>
                          )}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {/* Save button */}
      <div className="flex justify-end">
        <Button variant="primary" onClick={onSave} loading={saving}>
          Guardar Permisos
        </Button>
      </div>
    </div>
  )
}
