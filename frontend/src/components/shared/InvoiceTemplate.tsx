import React from 'react'
import { formatCurrency } from '@/lib/utils'

const INVOICE_TYPE_CODE: Record<string, string> = {
  A: '01',
  B: '06',
  C: '11',
}

const TAX_CONDITION_EMISOR: Record<string, string> = {
  A: 'IVA Responsable Inscripto',
  B: 'IVA Responsable Inscripto',
  C: 'Responsable Monotributo',
}

export interface InvoiceTemplateProps {
  companyName: string
  companyCuit: string
  companyAddress?: string
  customerName: string
  customerCuit?: string
  taxCondition?: string
  invoiceType: string
  invoiceNumber: string
  puntoVenta: number
  invoiceDate: string
  items: { name: string; quantity: number; unitPrice: number; vatRate: number }[]
  subtotal: number
  vatAmount: number
  total: number
  cae?: string
  caeExpiry?: string
  authorized?: boolean
  missingCuit?: boolean
}

function formatCuit(cuit: string): string {
  const clean = cuit.replace(/-/g, '')
  if (clean.length === 11) {
    return `${clean.slice(0, 2)}-${clean.slice(2, 10)}-${clean.slice(10)}`
  }
  return cuit
}

export function InvoiceTemplate({
  companyName,
  companyCuit,
  companyAddress,
  customerName,
  customerCuit,
  taxCondition,
  invoiceType,
  invoiceNumber,
  puntoVenta,
  invoiceDate,
  items,
  subtotal,
  vatAmount,
  total,
  cae,
  caeExpiry,
  authorized,
  missingCuit,
}: InvoiceTemplateProps) {
  const ptoVtaStr = String(puntoVenta).padStart(5, '0')
  const nroStr = String(invoiceNumber).padStart(8, '0')
  const isFacturaC = invoiceType === 'C'
  const typeCode = INVOICE_TYPE_CODE[invoiceType] || '11'

  return (
    <div
      className="relative bg-white border border-gray-200 shadow-sm mx-auto overflow-hidden"
      style={{ aspectRatio: '210 / 297', maxWidth: '100%', fontFamily: 'Arial, Helvetica, sans-serif' }}
    >
      <div className="p-4 text-[10px] leading-relaxed h-full flex flex-col">

        {/* Watermark */}
        {!authorized && (
          <div
            className="absolute inset-0 flex items-center justify-center pointer-events-none select-none z-10"
            aria-hidden="true"
          >
            <span
              className="text-gray-200 font-bold tracking-widest"
              style={{
                fontSize: '3rem',
                transform: 'rotate(-45deg)',
                opacity: 0.4,
              }}
            >
              BORRADOR
            </span>
          </div>
        )}

        {/* Header */}
        <div className="relative border border-gray-400 flex min-h-[72px]">
          {/* Vertical divider */}
          <div className="absolute top-0 bottom-0 left-1/2 w-px bg-gray-400" />

          {/* Letter badge */}
          <div className="absolute -top-px left-1/2 -translate-x-1/2 bg-white border border-gray-400 w-10 text-center z-20">
            <div className="text-xl font-bold leading-tight">{invoiceType}</div>
            <div className="text-[7px] text-gray-500 pb-0.5">COD. {typeCode}</div>
          </div>

          {/* Left: company */}
          <div className="flex-1 p-2 pr-6">
            <div className="font-bold text-xs mb-0.5">{companyName}</div>
            {companyAddress && (
              <div className="text-gray-500">{companyAddress}</div>
            )}
            <div className="text-gray-500">
              Cond. IVA: <span className="text-gray-700 dark:text-gray-300 font-medium">{TAX_CONDITION_EMISOR[invoiceType] || 'Monotributo'}</span>
            </div>
          </div>

          {/* Right: invoice info */}
          <div className="flex-1 p-2 pl-7">
            <div className="font-bold text-[11px] mb-0.5">FACTURA</div>
            <div className="font-bold font-mono text-[9px] mb-1">
              PV: {ptoVtaStr} &mdash; Nro: {nroStr}
            </div>
            <div className="text-gray-500">
              Fecha: <span className="text-gray-700 dark:text-gray-300">{invoiceDate}</span>
            </div>
            <div className="text-gray-500">
              CUIT: <span className="text-gray-700 dark:text-gray-300 font-medium">{formatCuit(companyCuit)}</span>
            </div>
          </div>
        </div>

        {/* Customer */}
        <div className="border border-t-0 border-gray-400 p-2 flex gap-4">
          <div className="flex-1">
            <div className="text-gray-500 text-[8px] uppercase tracking-wide mb-0.5">Receptor</div>
            <div className="font-semibold text-[11px]">{customerName || 'Consumidor Final'}</div>
            <div className="text-gray-500">
              {taxCondition || 'Consumidor Final'}
            </div>
          </div>
          <div className="flex-1">
            <div
              className={`mt-3 ${missingCuit ? 'border border-dashed border-red-400 rounded px-1 py-0.5 bg-red-50/50' : ''}`}
            >
              <span className="text-gray-500">CUIT: </span>
              <span className={missingCuit ? 'text-red-500 font-medium' : 'text-gray-700 dark:text-gray-300 font-medium'}>
                {customerCuit ? formatCuit(customerCuit) : (missingCuit ? 'Requerido' : '-')}
              </span>
            </div>
          </div>
        </div>

        {/* Items table */}
        <div className="flex-1 mt-2 min-h-0">
          <table className="w-full border-collapse text-[9px]">
            <thead>
              <tr className="bg-gray-100">
                <th className="border border-gray-300 px-1 py-0.5 text-left font-semibold w-[45%]">
                  Descripcion
                </th>
                <th className="border border-gray-300 px-1 py-0.5 text-center font-semibold w-[10%]">
                  Cant.
                </th>
                <th className="border border-gray-300 px-1 py-0.5 text-right font-semibold w-[15%]">
                  P. Unit.
                </th>
                {!isFacturaC && (
                  <th className="border border-gray-300 px-1 py-0.5 text-right font-semibold w-[10%]">
                    IVA %
                  </th>
                )}
                <th className="border border-gray-300 px-1 py-0.5 text-right font-semibold w-[20%]">
                  Importe
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, idx) => {
                const lineSubtotal = item.quantity * item.unitPrice
                const lineIva = isFacturaC ? 0 : lineSubtotal * (item.vatRate / 100)
                const lineTotal = lineSubtotal + lineIva
                const isZeroPrice = item.unitPrice === 0

                return (
                  <tr key={idx} className={isZeroPrice ? 'bg-red-50' : ''}>
                    <td className="border border-gray-200 px-1 py-0.5">{item.name || '-'}</td>
                    <td className="border border-gray-200 px-1 py-0.5 text-center">{item.quantity}</td>
                    <td className={`border border-gray-200 px-1 py-0.5 text-right font-mono ${isZeroPrice ? 'text-red-500' : ''}`}>
                      {item.unitPrice.toFixed(2)}
                    </td>
                    {!isFacturaC && (
                      <td className="border border-gray-200 px-1 py-0.5 text-right font-mono">
                        {item.vatRate.toFixed(1)}
                      </td>
                    )}
                    <td className="border border-gray-200 px-1 py-0.5 text-right font-mono">
                      {lineTotal.toFixed(2)}
                    </td>
                  </tr>
                )
              })}
              {/* Empty rows to fill space */}
              {items.length < 4 && Array.from({ length: 4 - items.length }).map((_, idx) => (
                <tr key={`empty-${idx}`}>
                  <td className="border border-gray-200 px-1 py-0.5">&nbsp;</td>
                  <td className="border border-gray-200 px-1 py-0.5">&nbsp;</td>
                  <td className="border border-gray-200 px-1 py-0.5">&nbsp;</td>
                  {!isFacturaC && <td className="border border-gray-200 px-1 py-0.5">&nbsp;</td>}
                  <td className="border border-gray-200 px-1 py-0.5">&nbsp;</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Totals */}
        <div className="border border-gray-400 mt-1">
          {!isFacturaC && (
            <>
              <div className="flex justify-end px-2 py-0.5 border-b border-gray-200">
                <span className="text-gray-500 mr-4">Neto Gravado:</span>
                <span className="font-mono font-medium w-20 text-right">$ {subtotal.toFixed(2)}</span>
              </div>
              <div className="flex justify-end px-2 py-0.5 border-b border-gray-200">
                <span className="text-gray-500 mr-4">IVA:</span>
                <span className="font-mono font-medium w-20 text-right">$ {vatAmount.toFixed(2)}</span>
              </div>
            </>
          )}
          <div className="flex justify-end px-2 py-1 bg-gray-50">
            <span className="font-bold mr-4">TOTAL:</span>
            <span className={`font-mono font-bold w-20 text-right text-xs ${total === 0 ? 'text-red-500' : ''}`}>
              $ {total.toFixed(2)}
            </span>
          </div>
        </div>

        {/* CAE or draft notice */}
        {authorized && cae ? (
          <div className="border border-green-300 bg-green-50 mt-1 px-2 py-1 flex items-center justify-between">
            <div>
              <div className="text-[8px] text-green-700 font-bold uppercase tracking-wide">CAE</div>
              <div className="font-mono font-bold text-green-800 text-[11px]">{cae}</div>
              {caeExpiry && (
                <div className="text-[8px] text-green-600">Vto: {caeExpiry}</div>
              )}
            </div>
            <div className="px-2 py-0.5 bg-green-600 text-white rounded text-[8px] font-bold uppercase tracking-wider">
              Autorizada
            </div>
          </div>
        ) : (
          <div className="mt-1 text-center text-[8px] text-gray-400 py-1 border border-dashed border-gray-300">
            Comprobante no valido como factura &mdash; Borrador
          </div>
        )}
      </div>
    </div>
  )
}
