import React, { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader } from '@/components/ui/Card'
import { SkeletonTable } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/shared/EmptyState'
import { ExportCSVButton } from '@/components/shared/ExportCSV'
import { ExportExcelButton } from '@/components/shared/ExportExcel'
import { DateInput } from '@/components/ui/DateInput'
import { toast } from '@/hooks/useToast'
import { api } from '@/services/api'
import { formatCurrency, formatDate } from '@/lib/utils'

interface EnterpriseSaldo {
  id: string
  name: string
  cuit: string | null
  total_ventas: number
  total_cobros: number
  total_compras: number
  total_pagos: number
  a_cobrar: number
  a_pagar: number
  saldo: number
  // Semantic fields (always >= 0)
  deuda_cliente?: number
  credito_cliente?: number
  deuda_proveedor?: number
  credito_proveedor?: number
  adelantos_recibidos?: number
  adelantos_entregados?: number
  adelantos_cobros?: number
  adelantos_pagos?: number
  saldo_neto?: number
  tipo?: string
}

interface Movimiento {
  id: string
  tipo: string
  fecha: string
  descripcion: string
  monto: number
  debe: number
  haber: number
  saldo: number
}

interface CuentaDetalle {
  movimientos: Movimiento[]
  total_ventas?: number
  total_cobros?: number
  total_compras?: number
  total_pagos?: number
  total_adelantos?: number
  saldo: number
}

interface Detalle {
  enterprise: { id: string; name: string; cuit: string | null }
  cuentas_a_cobrar: CuentaDetalle & { total_ventas: number; total_cobros: number }
  cuentas_a_pagar: CuentaDetalle & { total_compras: number; total_pagos: number }
  balance_neto: number
}

const tipoColors: Record<string, string> = {
  factura: 'bg-blue-100 text-blue-700',
  venta: 'bg-blue-100 text-blue-700',
  factura_compra: 'bg-purple-100 text-purple-700',
  cobro: 'bg-green-100 text-green-700',
  adelanto: 'bg-amber-100 text-amber-700',
  adelanto_pago: 'bg-amber-100 text-amber-700',
  compra: 'bg-orange-100 text-orange-700',
  pago: 'bg-red-100 text-red-700',
  ajuste: 'bg-violet-100 text-violet-700',
}

const tipoLabels: Record<string, string> = {
  factura: 'Factura',
  venta: 'Factura',
  factura_compra: 'Fact. Compra',
  cobro: 'Cobro',
  adelanto: 'Adelanto',
  adelanto_pago: 'Adelanto',
  compra: 'Compra',
  pago: 'Pago',
  ajuste: 'Ajuste',
}

interface MovimientosTableProps {
  movimientos: Movimiento[]
  saldo: number
  fmt: (n: number) => string
  formatDate: (d: string) => string
  saldoLabel: string
  saldoPositiveColor: string
  debitLabel: string
  creditLabel: string
}

const MovimientosTable: React.FC<MovimientosTableProps> = ({
  movimientos,
  saldo,
  fmt,
  formatDate,
  saldoLabel,
  saldoPositiveColor,
  debitLabel,
  creditLabel,
}) => (
  <table className="w-full text-sm">
    <thead>
      <tr className="text-left text-gray-500 border-b">
        <th className="pb-2">Fecha</th>
        <th className="pb-2">Tipo</th>
        <th className="pb-2">Descripcion</th>
        <th className="pb-2 text-right">{debitLabel}</th>
        <th className="pb-2 text-right">{creditLabel}</th>
        <th className="pb-2 text-right">Saldo</th>
      </tr>
    </thead>
    <tbody>
      {movimientos.map((m, idx) => (
        <tr key={`${m.id}-${idx}`} className={`border-b border-gray-100 ${m.tipo === 'adelanto' || m.tipo === 'adelanto_pago' ? 'bg-amber-50/60 dark:bg-amber-950/10' : 'even:bg-gray-50/50'}`}>
          <td className="py-2 text-gray-600 dark:text-gray-400">{formatDate(m.fecha)}</td>
          <td className="py-2">
            <span
              className={`px-2 py-0.5 rounded-full text-xs font-medium ${tipoColors[m.tipo] || 'bg-gray-100 text-gray-700 dark:text-gray-300'}`}
            >
              {tipoLabels[m.tipo] || m.tipo}
            </span>
          </td>
          <td className="py-2 text-gray-700 dark:text-gray-300">{m.descripcion}</td>
          <td className="py-2 text-right text-green-700">{m.debe > 0 ? fmt(m.debe) : ''}</td>
          <td className="py-2 text-right text-red-600">{m.haber > 0 ? fmt(m.haber) : ''}</td>
          <td className={`py-2 text-right font-medium ${m.saldo >= 0 ? saldoPositiveColor : 'text-red-600'}`}>
            {fmt(m.saldo)}
          </td>
        </tr>
      ))}
    </tbody>
    <tfoot>
      <tr className="border-t-2 border-gray-300">
        <td colSpan={5} className="py-3 font-bold text-right text-gray-700 dark:text-gray-300">
          {saldoLabel}:
        </td>
        <td
          className={`py-3 text-right font-bold text-base ${saldo >= 0 ? saldoPositiveColor : 'text-red-600'}`}
        >
          {fmt(saldo)}
        </td>
      </tr>
    </tfoot>
  </table>
)

interface AdjustmentFormProps {
  enterpriseId: string
  onCreated: () => void
}

const AdjustmentForm: React.FC<AdjustmentFormProps> = ({ enterpriseId, onCreated }) => {
  const [open, setOpen] = useState(false)
  const [tipo, setTipo] = useState<'credit' | 'debit'>('credit')
  const [monto, setMonto] = useState('')
  const [motivo, setMotivo] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const amount = parseFloat(monto)
    if (!amount || amount === 0) {
      toast.error('El monto debe ser mayor a 0')
      return
    }
    if (!motivo.trim()) {
      toast.error('El motivo es obligatorio')
      return
    }

    if (amount > 1000000) {
      const confirmed = window.confirm(
        `El monto es ${formatCurrency(amount)}. Confirma que desea crear este ajuste?`
      )
      if (!confirmed) return
    }

    try {
      setSubmitting(true)
      await api.createCuentaCorrienteAdjustment(enterpriseId, {
        amount,
        reason: motivo.trim(),
        adjustment_type: tipo,
      })
      toast.success('Ajuste creado correctamente')
      setMonto('')
      setMotivo('')
      setTipo('credit')
      setOpen(false)
      onCreated()
    } catch (err: any) {
      toast.error(err.message || 'Error al crear ajuste')
    } finally {
      setSubmitting(false)
    }
  }

  if (!open) {
    return (
      <button
        onClick={(e) => { e.stopPropagation(); setOpen(true) }}
        className="inline-flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-purple-700 bg-purple-50 border border-purple-200 rounded-lg hover:bg-purple-100 transition-colors"
      >
        + Ajuste
      </button>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="bg-purple-50 border border-purple-200 rounded-lg p-4 space-y-3" onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center justify-between">
        <h5 className="font-medium text-purple-800 text-sm">Nuevo ajuste manual</h5>
        <button type="button" onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600 dark:text-gray-400 text-lg leading-none">
          x
        </button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1">Tipo</label>
          <select
            value={tipo}
            onChange={(e) => setTipo(e.target.value as 'credit' | 'debit')}
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-purple-400 focus:border-transparent"
          >
            <option value="credit">A favor del cliente (credito)</option>
            <option value="debit">A cargo del cliente (debito)</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1">Monto ($)</label>
          <input
            type="number"
            step="0.01"
            min="0.01"
            value={monto}
            onChange={(e) => setMonto(e.target.value)}
            placeholder="0.00"
            required
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-purple-400 focus:border-transparent"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1">Motivo</label>
          <input
            type="text"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Ej: Bonificacion pronto pago"
            required
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-purple-400 focus:border-transparent"
          />
        </div>
      </div>
      <div className="flex items-center gap-2 justify-end">
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800 dark:text-gray-200"
        >
          Cancelar
        </button>
        <button
          type="submit"
          disabled={submitting}
          className="px-4 py-1.5 text-sm font-medium text-white bg-purple-600 rounded-md hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {submitting ? 'Guardando...' : 'Guardar ajuste'}
        </button>
      </div>
    </form>
  )
}

export const CuentaCorriente: React.FC = () => {
  const [resumen, setResumen] = useState<EnterpriseSaldo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedEnterprise, setSelectedEnterprise] = useState<string | null>(null)
  const [detalle, setDetalle] = useState<Detalle | null>(null)
  const [loadingDetalle, setLoadingDetalle] = useState(false)
  const [pdfDateFrom, setPdfDateFrom] = useState<string>(() => {
    const d = new Date()
    d.setMonth(d.getMonth() - 1)
    return d.toISOString().split('T')[0]
  })
  const [pdfDateTo, setPdfDateTo] = useState<string>(() => new Date().toISOString().split('T')[0])
  const [downloadingPdf, setDownloadingPdf] = useState(false)

  const loadResumen = async () => {
    try {
      setLoading(true)
      const data = await api.getCuentaCorrienteResumen()
      setResumen(data || [])
    } catch (e: any) {
      toast.error(e.message)
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadResumen()
  }, [])

  const handleVerDetalle = async (enterpriseId: string) => {
    if (selectedEnterprise === enterpriseId) {
      setSelectedEnterprise(null)
      setDetalle(null)
      return
    }
    try {
      setLoadingDetalle(true)
      setSelectedEnterprise(enterpriseId)
      const data = await api.getCuentaCorrienteDetalle(enterpriseId)
      setDetalle(data)
    } catch (e: any) {
      toast.error(e.message)
      setError(e.message)
    } finally {
      setLoadingDetalle(false)
    }
  }

  const handleDownloadPdf = async (enterpriseId: string, enterpriseName: string) => {
    if (!pdfDateFrom || !pdfDateTo) {
      toast.error('Selecciona un rango de fechas')
      return
    }
    try {
      setDownloadingPdf(true)
      const blob = await api.downloadCuentaCorrientePdf(enterpriseId, pdfDateFrom, pdfDateTo)
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `cuenta_corriente_${enterpriseName.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`
      document.body.appendChild(a)
      a.click()
      a.remove()
      window.URL.revokeObjectURL(url)
    } catch (e: any) {
      toast.error(e.message || 'Error al generar PDF')
    } finally {
      setDownloadingPdf(false)
    }
  }

  const handleAdjustmentCreated = async () => {
    loadResumen()
    if (selectedEnterprise) {
      try {
        const data = await api.getCuentaCorrienteDetalle(selectedEnterprise)
        setDetalle(data)
      } catch (e: any) {
        toast.error(e.message)
      }
    }
  }

  const fmt = (n: number) => formatCurrency(n)

  // Totals from semantic fields
  const totalACobrar = resumen.reduce((s, r) => s + (r.deuda_cliente || Math.max(r.a_cobrar, 0)), 0)
  const totalAPagar = resumen.reduce((s, r) => s + (r.deuda_proveedor || Math.max(r.a_pagar, 0)), 0)
  const totalAdelantosRecibidos = resumen.reduce((s, r) => s + ((r as any).adelantos_recibidos || r.adelantos_cobros || 0), 0)
  const totalAdelantosEntregados = resumen.reduce((s, r) => s + ((r as any).adelantos_entregados || r.adelantos_pagos || 0), 0)
  const balanceNeto = totalACobrar - totalAPagar

  // Legacy compat
  const totalNosDebem = totalACobrar
  const totalLesDebemos = totalAPagar

  const hasMovimientosCobrar =
    detalle && detalle.cuentas_a_cobrar.movimientos.length > 0
  const hasMovimientosPagar =
    detalle && detalle.cuentas_a_pagar.movimientos.length > 0

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Cuenta Corriente</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Balance por empresa — facturas AFIP, compras, cobros y pagos
          </p>
        </div>
        <ExportCSVButton
          data={resumen.map((r) => ({
            empresa: r.name,
            cuit: r.cuit || '',
            facturado: r.total_ventas,
            cobros: r.total_cobros,
            a_cobrar: r.a_cobrar,
            compras: r.total_compras,
            pagos: r.total_pagos,
            a_pagar: r.a_pagar,
            balance: r.saldo,
          }))}
          columns={[
            { key: 'empresa', label: 'Empresa' },
            { key: 'cuit', label: 'CUIT' },
            { key: 'facturado', label: 'Facturado AFIP' },
            { key: 'cobros', label: 'Cobros' },
            { key: 'a_cobrar', label: 'A Cobrar' },
            { key: 'compras', label: 'Compras' },
            { key: 'pagos', label: 'Pagos' },
            { key: 'a_pagar', label: 'A Pagar' },
            { key: 'balance', label: 'Balance' },
          ]}
          filename="cuenta_corriente"
        />
        <ExportExcelButton
          data={resumen.map((r) => ({
            empresa: r.name,
            cuit: r.cuit || '',
            facturado: r.total_ventas,
            cobros: r.total_cobros,
            a_cobrar: r.a_cobrar,
            compras: r.total_compras,
            pagos: r.total_pagos,
            a_pagar: r.a_pagar,
            balance: r.saldo,
          }))}
          columns={[
            { key: 'empresa', label: 'Empresa' },
            { key: 'cuit', label: 'CUIT' },
            { key: 'facturado', label: 'Facturado AFIP', type: 'currency' as const },
            { key: 'cobros', label: 'Cobros', type: 'currency' as const },
            { key: 'a_cobrar', label: 'A Cobrar', type: 'currency' as const },
            { key: 'compras', label: 'Compras', type: 'currency' as const },
            { key: 'pagos', label: 'Pagos', type: 'currency' as const },
            { key: 'a_pagar', label: 'A Pagar', type: 'currency' as const },
            { key: 'balance', label: 'Balance', type: 'currency' as const },
          ]}
          filename="cuenta_corriente"
        />
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card className="border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950/30">
          <CardContent className="pt-4 pb-3">
            <p className="text-xs font-medium text-green-600 dark:text-green-400">A Cobrar</p>
            <p className="text-xl font-bold text-green-700 dark:text-green-300">{fmt(totalACobrar)}</p>
            <p className="text-[10px] text-green-500 mt-0.5">{resumen.filter(r => (r.deuda_cliente || Math.max(r.a_cobrar, 0)) > 0).length} empresas</p>
          </CardContent>
        </Card>
        <Card className="border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950/30">
          <CardContent className="pt-4 pb-3">
            <p className="text-xs font-medium text-red-600 dark:text-red-400">A Pagar</p>
            <p className="text-xl font-bold text-red-700 dark:text-red-300">{fmt(totalAPagar)}</p>
            <p className="text-[10px] text-red-500 mt-0.5">{resumen.filter(r => (r.deuda_proveedor || Math.max(r.a_pagar, 0)) > 0).length} proveedores</p>
          </CardContent>
        </Card>
        {totalAdelantosRecibidos > 0 && (
          <Card className="border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/30">
            <CardContent className="pt-4 pb-3">
              <p className="text-xs font-medium text-blue-600 dark:text-blue-400">Cobros Sin Asociar</p>
              <p className="text-xl font-bold text-blue-700 dark:text-blue-300">{fmt(totalAdelantosRecibidos)}</p>
              <p className="text-[10px] text-blue-500 mt-0.5">Cobros no vinculados a facturas — chequear en Cobros</p>
            </CardContent>
          </Card>
        )}
        {totalAdelantosEntregados > 0 && (
          <Card className="border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30">
            <CardContent className="pt-4 pb-3">
              <p className="text-xs font-medium text-amber-600 dark:text-amber-400">Pagos Sin Asociar</p>
              <p className="text-xl font-bold text-amber-700 dark:text-amber-300">{fmt(totalAdelantosEntregados)}</p>
              <p className="text-[10px] text-amber-500 mt-0.5">Pagos no vinculados a facturas — chequear en Pagos</p>
            </CardContent>
          </Card>
        )}
        <Card className={balanceNeto >= 0 ? 'border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950/30' : 'border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950/30'}>
          <CardContent className="pt-4 pb-3">
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400">Balance Neto</p>
            <p className={`text-xl font-bold ${balanceNeto >= 0 ? 'text-green-700 dark:text-green-300' : 'text-red-700 dark:text-red-300'}`}>
              {fmt(Math.abs(balanceNeto))}
            </p>
            <p className="text-[10px] text-gray-400 mt-0.5">{balanceNeto >= 0 ? 'A nuestro favor' : 'En contra'}</p>
          </CardContent>
        </Card>
      </div>

      {error && (
        <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 px-4 py-3 rounded-lg">
          {error}
          <button onClick={() => setError(null)} className="ml-2 font-bold">
            x
          </button>
        </div>
      )}

      {loading ? (
        <SkeletonTable rows={6} cols={5} />
      ) : resumen.length === 0 ? (
        <EmptyState
          title="Sin movimientos"
          description="Registra pedidos, compras, cobros o pagos para ver la cuenta corriente"
        />
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-700 text-left text-sm font-medium text-gray-500 dark:text-gray-300">
                  <th className="px-4 py-3">Empresa</th>
                  <th className="px-4 py-3 text-center">Tipo</th>
                  <th className="px-4 py-3 text-right">Pend. Cobro</th>
                  <th className="px-4 py-3 text-right">Pend. Pago</th>
                  <th className="px-4 py-3 text-right" title="Cobros/pagos no vinculados a facturas. La plata ya se movio, cuenta en el balance.">Sin Asociar</th>
                  <th className="px-4 py-3 text-center">Balance</th>
                  <th className="px-4 py-3 w-10"></th>
                </tr>
              </thead>
              <tbody>
                {resumen.map((r) => {
                  const deudaCli = r.deuda_cliente || Math.max(r.a_cobrar, 0)
                  const creditoCli = r.credito_cliente || Math.max(-r.a_cobrar, 0)
                  const deudaProv = r.deuda_proveedor || Math.max(r.a_pagar, 0)
                  const creditoProv = r.credito_proveedor || Math.max(-r.a_pagar, 0)
                  const tipo = r.tipo || 'cliente'
                  const saldoNeto = r.saldo_neto ?? r.saldo

                  return (
                  <React.Fragment key={r.id}>
                    <tr
                      className="border-b dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800/50 cursor-pointer"
                      onClick={() => handleVerDetalle(r.id)}
                    >
                      <td className="px-4 py-3">
                        <span className="font-medium text-gray-900 dark:text-gray-100">{r.name}</span>
                        {r.cuit && <span className="block text-xs text-gray-400 font-mono mt-0.5">{r.cuit}</span>}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`text-xs font-medium rounded-full px-2 py-0.5 ${
                          tipo === 'mixto' ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300' :
                          tipo === 'proveedor' ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300' :
                          'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
                        }`}>{tipo === 'mixto' ? 'Cli+Prov' : tipo === 'proveedor' ? 'Proveedor' : 'Cliente'}</span>
                      </td>
                      {/* Pendiente de cobro (facturas - cobros aplicados) */}
                      <td className="px-4 py-3 text-right">
                        {deudaCli > 0 ? (
                          <span className="font-bold text-green-700 dark:text-green-400">{fmt(deudaCli)}</span>
                        ) : <span className="text-gray-300 dark:text-gray-600">-</span>}
                      </td>
                      {/* Pendiente de pago (fact compra - pagos aplicados) */}
                      <td className="px-4 py-3 text-right">
                        {deudaProv > 0 ? (
                          <span className="font-bold text-red-600 dark:text-red-400">{fmt(deudaProv)}</span>
                        ) : <span className="text-gray-300 dark:text-gray-600">-</span>}
                      </td>
                      {/* Sin Asociar (cobros/pagos sin factura — la plata ya se movio, cuenta en balance) */}
                      <td className="px-4 py-3 text-right" title="Cobros/pagos sin factura vinculada. Ir a Cobros o Pagos para asociar.">
                        {(() => {
                          const advRec = (r as any).cobros_no_asociados || (r as any).adelantos_recibidos || r.adelantos_cobros || 0
                          const advEnt = (r as any).pagos_no_asociados || (r as any).adelantos_entregados || r.adelantos_pagos || 0
                          if (advRec > 0 && advEnt > 0) return (
                            <div className="text-xs">
                              <span className="text-blue-600" title="Cobros sin factura — chequear en Cobros">Cob: {fmt(advRec)}</span>
                              <span className="block text-amber-600" title="Pagos sin factura — chequear en Pagos">Pag: {fmt(advEnt)}</span>
                            </div>
                          )
                          if (advRec > 0) return <span className="text-xs font-medium text-blue-600 dark:text-blue-400" title="Cobros sin factura — chequear en Cobros">{fmt(advRec)}</span>
                          if (advEnt > 0) return <span className="text-xs font-medium text-amber-600 dark:text-amber-400" title="Pagos sin factura — chequear en Pagos">{fmt(advEnt)}</span>
                          return <span className="text-gray-300 dark:text-gray-600">-</span>
                        })()}
                      </td>
                      {/* Neto */}
                      <td className="px-4 py-3 text-center">
                        {saldoNeto > 0.01 ? (
                          <span className="text-xs font-semibold rounded-full px-2 py-0.5 bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300">+{fmt(saldoNeto)}</span>
                        ) : saldoNeto < -0.01 ? (
                          <span className="text-xs font-semibold rounded-full px-2 py-0.5 bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300">-{fmt(Math.abs(saldoNeto))}</span>
                        ) : (
                          <span className="text-xs text-gray-400">Saldado</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-blue-600">
                        {selectedEnterprise === r.id ? '\u25b2' : '\u25bc'}
                      </td>
                    </tr>

                    {/* Expanded detail */}
                    {selectedEnterprise === r.id && (
                      <tr>
                        <td colSpan={5} className="px-6 py-4 bg-gray-50 animate-slideDown">
                          {loadingDetalle ? (
                            <SkeletonTable rows={4} cols={6} />
                          ) : detalle ? (
                            <div className="space-y-6">
                              {/* Adjustment form */}
                              <AdjustmentForm
                                enterpriseId={r.id}
                                onCreated={handleAdjustmentCreated}
                              />

                              {/* Mini summary cards */}
                              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                                <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg px-3 py-2">
                                  <span className="text-xs text-blue-600 dark:text-blue-400 block">Facturado</span>
                                  <span className="text-sm font-bold text-blue-700 dark:text-blue-300">{fmt(detalle.cuentas_a_cobrar.total_ventas)}</span>
                                </div>
                                <div className="bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded-lg px-3 py-2">
                                  <span className="text-xs text-green-600 dark:text-green-400 block">Cobrado</span>
                                  <span className="text-sm font-bold text-green-700 dark:text-green-300">{fmt(detalle.cuentas_a_cobrar.total_cobros)}</span>
                                </div>
                                {(detalle.cuentas_a_cobrar.total_adelantos || 0) > 0 && (
                                  <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2">
                                    <span className="text-xs text-amber-600 dark:text-amber-400 block">Adelantos sin asignar</span>
                                    <span className="text-sm font-bold text-amber-700 dark:text-amber-300">{fmt(detalle.cuentas_a_cobrar.total_adelantos || 0)}</span>
                                  </div>
                                )}
                                <div className="bg-purple-50 dark:bg-purple-950/30 border border-purple-200 dark:border-purple-800 rounded-lg px-3 py-2">
                                  <span className="text-xs text-purple-600 dark:text-purple-400 block">Compras</span>
                                  <span className="text-sm font-bold text-purple-700 dark:text-purple-300">{fmt(detalle.cuentas_a_pagar.total_compras)}</span>
                                </div>
                                <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg px-3 py-2">
                                  <span className="text-xs text-red-600 dark:text-red-400 block">Pagado</span>
                                  <span className="text-sm font-bold text-red-700 dark:text-red-300">{fmt(detalle.cuentas_a_pagar.total_pagos)}</span>
                                </div>
                                {(detalle.cuentas_a_pagar.total_adelantos || 0) > 0 && (
                                  <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2">
                                    <span className="text-xs text-amber-600 dark:text-amber-400 block">Adelantos a proveedor</span>
                                    <span className="text-sm font-bold text-amber-700 dark:text-amber-300">{fmt(detalle.cuentas_a_pagar.total_adelantos || 0)}</span>
                                  </div>
                                )}
                              </div>

                              {/* Date range filter & PDF download */}
                              <div className="flex flex-wrap items-end gap-3 p-4 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg">
                                <DateInput
                                  label="Desde"
                                  value={pdfDateFrom}
                                  onChange={setPdfDateFrom}
                                  className="w-36"
                                />
                                <DateInput
                                  label="Hasta"
                                  value={pdfDateTo}
                                  onChange={setPdfDateTo}
                                  className="w-36"
                                />
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    handleDownloadPdf(r.id, r.name)
                                  }}
                                  disabled={downloadingPdf || !pdfDateFrom || !pdfDateTo}
                                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium flex items-center gap-2"
                                >
                                  {downloadingPdf ? (
                                    <>
                                      <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                      </svg>
                                      Generando...
                                    </>
                                  ) : (
                                    <>
                                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                      </svg>
                                      Descargar PDF
                                    </>
                                  )}
                                </button>
                              </div>

                              {/* Cuentas a Cobrar */}
                              <div>
                                <h4 className="font-semibold text-green-700 mb-3 text-base border-b border-green-200 pb-2">
                                  Cuentas a Cobrar — {detalle.enterprise.name}
                                </h4>
                                {hasMovimientosCobrar ? (
                                  <MovimientosTable
                                    movimientos={detalle.cuentas_a_cobrar.movimientos}
                                    saldo={detalle.cuentas_a_cobrar.saldo}
                                    fmt={fmt}
                                    formatDate={formatDate}
                                    saldoLabel="Saldo a cobrar"
                                    saldoPositiveColor="text-green-700"
                                    debitLabel="Facturado"
                                    creditLabel="Cobrado"
                                  />
                                ) : (
                                  <p className="text-sm text-gray-400 py-2">
                                    Sin movimientos de ventas o cobros.
                                  </p>
                                )}
                              </div>

                              {/* Divider */}
                              <div className="border-t border-dashed border-gray-300" />

                              {/* Cuentas a Pagar */}
                              <div>
                                <h4 className="font-semibold text-red-700 mb-3 text-base border-b border-red-200 pb-2">
                                  Cuentas a Pagar — {detalle.enterprise.name}
                                </h4>
                                {hasMovimientosPagar ? (
                                  <MovimientosTable
                                    movimientos={detalle.cuentas_a_pagar.movimientos}
                                    saldo={detalle.cuentas_a_pagar.saldo}
                                    fmt={fmt}
                                    formatDate={formatDate}
                                    saldoLabel="Saldo a pagar"
                                    saldoPositiveColor="text-red-600"
                                    debitLabel="Comprado"
                                    creditLabel="Pagado"
                                  />
                                ) : (
                                  <p className="text-sm text-gray-400 py-2">
                                    Sin movimientos de compras o pagos.
                                  </p>
                                )}
                              </div>

                              {/* Balance Neto */}
                              <div className="border-t-2 border-gray-400 pt-4 flex items-center justify-end gap-4">
                                <span className="text-base font-bold text-gray-700 dark:text-gray-300">
                                  Balance Neto:
                                </span>
                                <span
                                  className={`text-xl font-bold ${detalle.balance_neto >= 0 ? 'text-green-700' : 'text-red-600'}`}
                                >
                                  {fmt(detalle.balance_neto)}
                                </span>
                                {detalle.balance_neto > 0 && (
                                  <span className="text-sm text-green-600 font-medium">
                                    (a nuestro favor)
                                  </span>
                                )}
                                {detalle.balance_neto < 0 && (
                                  <span className="text-sm text-red-500 font-medium">
                                    (en contra)
                                  </span>
                                )}
                              </div>
                            </div>
                          ) : (
                            <p className="text-center text-gray-500 py-4">
                              Sin movimientos registrados
                            </p>
                          )}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  )
}
