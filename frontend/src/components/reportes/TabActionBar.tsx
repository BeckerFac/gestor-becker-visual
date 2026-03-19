import React from 'react'
import { ExportExcelButton } from '@/components/shared/ExportExcel'
import { Button } from '@/components/ui/Button'

interface TabActionBarProps {
  excelData: Record<string, any>[]
  excelColumns: { key: string; label: string; type?: 'text' | 'date' | 'currency' | 'number' }[]
  excelFilename: string
  excelTotalsRow?: Record<string, any>
  headerText?: string
}

export const TabActionBar: React.FC<TabActionBarProps> = ({
  excelData,
  excelColumns,
  excelFilename,
  excelTotalsRow,
  headerText,
}) => {
  const handlePrint = () => {
    window.print()
  }

  return (
    <div className="flex items-center justify-end gap-2 print:hidden">
      <Button variant="outline" size="sm" onClick={handlePrint}>
        <svg className="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
        </svg>
        Imprimir
      </Button>
      <ExportExcelButton
        data={excelData}
        columns={excelColumns}
        filename={excelFilename}
        totalsRow={excelTotalsRow}
        headerText={headerText}
      />
    </div>
  )
}
