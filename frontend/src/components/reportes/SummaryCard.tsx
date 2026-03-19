import React from 'react'
import { Card, CardContent } from '@/components/ui/Card'

interface SummaryCardProps {
  label: string
  value: string
  colorScheme: 'blue' | 'purple' | 'green' | 'red' | 'orange' | 'gray'
  subtitle?: string
}

const COLOR_MAP = {
  blue: {
    border: 'border-blue-200 dark:border-blue-800',
    bg: 'bg-blue-50 dark:bg-blue-900/30',
    topBorder: 'border-t-blue-500',
    label: 'text-blue-700 dark:text-blue-300',
    value: 'text-blue-800 dark:text-blue-200',
  },
  purple: {
    border: 'border-purple-200 dark:border-purple-800',
    bg: 'bg-purple-50 dark:bg-purple-900/30',
    topBorder: 'border-t-purple-500',
    label: 'text-purple-700 dark:text-purple-300',
    value: 'text-purple-800 dark:text-purple-200',
  },
  green: {
    border: 'border-green-200 dark:border-green-800',
    bg: 'bg-green-50 dark:bg-green-900/30',
    topBorder: 'border-t-green-500',
    label: 'text-green-700 dark:text-green-300',
    value: 'text-green-800 dark:text-green-200',
  },
  red: {
    border: 'border-red-200 dark:border-red-800',
    bg: 'bg-red-50 dark:bg-red-900/30',
    topBorder: 'border-t-red-500',
    label: 'text-red-700 dark:text-red-300',
    value: 'text-red-800 dark:text-red-200',
  },
  orange: {
    border: 'border-orange-200 dark:border-orange-800',
    bg: 'bg-orange-50 dark:bg-orange-900/30',
    topBorder: 'border-t-orange-500',
    label: 'text-orange-700 dark:text-orange-300',
    value: 'text-orange-800 dark:text-orange-200',
  },
  gray: {
    border: 'border-gray-200 dark:border-gray-700',
    bg: 'bg-gray-50 dark:bg-gray-800',
    topBorder: 'border-t-gray-500',
    label: 'text-gray-600 dark:text-gray-400',
    value: 'text-gray-800 dark:text-gray-200',
  },
}

export const SummaryCard: React.FC<SummaryCardProps> = ({ label, value, colorScheme, subtitle }) => {
  const colors = COLOR_MAP[colorScheme]
  return (
    <Card className={`${colors.border} ${colors.bg} border-t-4 ${colors.topBorder}`}>
      <CardContent className="pt-3 pb-2">
        <p className={`text-xs ${colors.label}`}>{label}</p>
        <p className={`text-xl font-bold ${colors.value}`}>{value}</p>
        {subtitle && <p className={`text-xs mt-0.5 ${colors.label} opacity-75`}>{subtitle}</p>}
      </CardContent>
    </Card>
  )
}
