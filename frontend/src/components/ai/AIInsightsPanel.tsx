import React, { useState, useEffect } from 'react'
import { api } from '@/services/api'
import { useNavigate } from 'react-router-dom'

interface SmartInsight {
  id: string
  type: string
  severity: 'critical' | 'warning' | 'info' | 'success'
  title: string
  description: string
  metric?: string
  action_label?: string
  action_link?: string
}

const SEVERITY_STYLES = {
  critical: {
    dot: 'bg-red-500 ring-red-100 dark:ring-red-950',
    metric: 'text-red-600 dark:text-red-400',
    icon: 'from-red-500 to-red-600',
  },
  warning: {
    dot: 'bg-amber-500 ring-amber-100 dark:ring-amber-950',
    metric: 'text-amber-600 dark:text-amber-400',
    icon: 'from-amber-500 to-orange-500',
  },
  info: {
    dot: 'bg-blue-500 ring-blue-100 dark:ring-blue-950',
    metric: 'text-blue-600 dark:text-blue-400',
    icon: 'from-blue-500 to-indigo-500',
  },
  success: {
    dot: 'bg-green-500 ring-green-100 dark:ring-green-950',
    metric: 'text-green-600 dark:text-green-400',
    icon: 'from-green-500 to-emerald-500',
  },
}

export const AIInsightsPanel: React.FC = () => {
  const [insights, setInsights] = useState<SmartInsight[]>([])
  const [loading, setLoading] = useState(true)
  const [hasAccess, setHasAccess] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    const loadInsights = async () => {
      try {
        // Check AI status first
        const status = await api.getAiStatus()
        if (!status.configured || !status.has_plan_access) {
          setHasAccess(false)
          setLoading(false)
          return
        }
        setHasAccess(true)

        const data = await api.getAiInsights()
        setInsights(data.insights || [])
      } catch {
        setInsights([])
      } finally {
        setLoading(false)
      }
    }
    loadInsights()
  }, [])

  if (loading || !hasAccess || insights.length === 0) return null

  return (
    <div className="rounded-xl bg-gradient-to-r from-purple-50 via-white to-indigo-50 dark:from-purple-950/20 dark:via-gray-900 dark:to-indigo-950/20 border border-purple-100 dark:border-purple-900/50 shadow-sm overflow-hidden">
      <div className="px-5 py-3 flex items-center gap-3 border-b border-purple-100/60 dark:border-purple-900/30">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center shadow-sm">
          <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
          </svg>
        </div>
        <div>
          <span className="text-sm font-semibold text-gray-800 dark:text-gray-200">Insights IA</span>
          <p className="text-xs text-gray-500 dark:text-gray-400">Analisis inteligente de tu negocio</p>
        </div>
        <span className="ml-auto text-xs font-bold bg-purple-600 text-white w-5 h-5 rounded-full flex items-center justify-center">
          {insights.length}
        </span>
      </div>

      <div className="divide-y divide-purple-50 dark:divide-purple-900/20">
        {insights.map((insight) => {
          const styles = SEVERITY_STYLES[insight.severity] || SEVERITY_STYLES.info
          return (
            <div
              key={insight.id}
              onClick={() => insight.action_link && navigate(insight.action_link)}
              className={`group flex items-start gap-4 px-5 py-3.5 ${
                insight.action_link
                  ? 'hover:bg-purple-50/50 dark:hover:bg-purple-950/20 cursor-pointer'
                  : ''
              } transition-all`}
            >
              <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ring-4 mt-1.5 ${styles.dot}`} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-800 dark:text-gray-200">{insight.title}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{insight.description}</p>
                {insight.action_label && insight.action_link && (
                  <button
                    onClick={(e) => { e.stopPropagation(); navigate(insight.action_link!) }}
                    className="mt-1.5 text-xs font-medium text-purple-600 dark:text-purple-400 hover:text-purple-800 dark:hover:text-purple-300 transition-colors"
                  >
                    {insight.action_label} &rarr;
                  </button>
                )}
              </div>
              {insight.metric && (
                <span className={`text-sm font-bold tabular-nums flex-shrink-0 ${styles.metric}`}>
                  {insight.metric}
                </span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
