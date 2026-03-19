import React, { useState, useEffect } from 'react'
import { api } from '@/services/api'
import { formatCurrency } from '@/lib/utils'
import { SkeletonTable } from '@/components/ui/Skeleton'

interface HealthEntry {
  id: string
  name: string
  cuit: string | null
  last_order_date: string | null
  total_revenue: number
  active_deals: number
  pipeline_value: number
  days_since_last_order: number | null
  health: 'green' | 'yellow' | 'red'
}

const HEALTH_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  green: { label: 'Saludable', color: 'text-green-700 dark:text-green-400', bg: 'bg-green-100 dark:bg-green-900/30' },
  yellow: { label: 'Atencion', color: 'text-amber-700 dark:text-amber-400', bg: 'bg-amber-100 dark:bg-amber-900/30' },
  red: { label: 'En riesgo', color: 'text-red-700 dark:text-red-400', bg: 'bg-red-100 dark:bg-red-900/30' },
}

export const CustomerHealth: React.FC = () => {
  const [entries, setEntries] = useState<HealthEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<string>('all')
  const [search, setSearch] = useState('')

  useEffect(() => {
    const load = async () => {
      try {
        const data = await api.getCrmCustomerHealth()
        setEntries(data)
      } catch (err) {
        console.error('Failed to load customer health:', err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  if (loading) return <SkeletonTable rows={5} cols={5} />

  const filtered = entries
    .filter(e => filter === 'all' || e.health === filter)
    .filter(e =>
      !search.trim() ||
      e.name.toLowerCase().includes(search.toLowerCase()) ||
      (e.cuit || '').includes(search)
    )

  const healthCounts = {
    green: entries.filter(e => e.health === 'green').length,
    yellow: entries.filter(e => e.health === 'yellow').length,
    red: entries.filter(e => e.health === 'red').length,
  }

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          placeholder="Buscar empresa..."
          className="flex-1 min-w-[200px] px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <div className="flex gap-1">
          <button
            onClick={() => setFilter('all')}
            className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors ${filter === 'all' ? 'bg-gray-800 dark:bg-gray-200 text-white dark:text-gray-900' : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400'}`}
          >
            Todos ({entries.length})
          </button>
          {Object.entries(HEALTH_CONFIG).map(([key, config]) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors ${filter === key ? config.bg + ' ' + config.color + ' ring-1 ring-current' : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400'}`}
            >
              {config.label} ({healthCounts[key as keyof typeof healthCounts]})
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-8">Sin empresas encontradas</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                <th className="pb-2 font-medium">Salud</th>
                <th className="pb-2 font-medium">Empresa</th>
                <th className="pb-2 font-medium text-right">Ult. pedido</th>
                <th className="pb-2 font-medium text-right">Revenue total</th>
                <th className="pb-2 font-medium text-right">Deals activos</th>
                <th className="pb-2 font-medium text-right">Pipeline</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(entry => {
                const config = HEALTH_CONFIG[entry.health]
                return (
                  <tr key={entry.id} className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50">
                    <td className="py-2.5">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${config.bg} ${config.color}`}>
                        <span className={`w-2 h-2 rounded-full ${entry.health === 'green' ? 'bg-green-500' : entry.health === 'yellow' ? 'bg-amber-500' : 'bg-red-500'}`} />
                        {config.label}
                      </span>
                    </td>
                    <td className="py-2.5">
                      <div>
                        <span className="font-medium text-gray-900 dark:text-white">{entry.name}</span>
                        {entry.cuit && <span className="text-xs text-gray-400 dark:text-gray-500 ml-2 font-mono">{entry.cuit}</span>}
                      </div>
                    </td>
                    <td className="py-2.5 text-right">
                      {entry.days_since_last_order !== null ? (
                        <span className={entry.days_since_last_order > 30 ? 'text-red-600 dark:text-red-400 font-medium' : entry.days_since_last_order > 15 ? 'text-amber-600 dark:text-amber-400' : 'text-gray-700 dark:text-gray-300'}>
                          {entry.days_since_last_order}d
                        </span>
                      ) : (
                        <span className="text-gray-400 dark:text-gray-500">-</span>
                      )}
                    </td>
                    <td className="py-2.5 text-right font-medium text-gray-900 dark:text-white">
                      {formatCurrency(entry.total_revenue)}
                    </td>
                    <td className="py-2.5 text-right text-gray-700 dark:text-gray-300">
                      {entry.active_deals > 0 ? entry.active_deals : '-'}
                    </td>
                    <td className="py-2.5 text-right text-gray-700 dark:text-gray-300">
                      {entry.pipeline_value > 0 ? formatCurrency(entry.pipeline_value) : '-'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
