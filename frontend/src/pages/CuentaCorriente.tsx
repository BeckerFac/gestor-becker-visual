import React, { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
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
  retenciones_sufridas?: number
  retenciones_practicadas?: number
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
  total_retenciones?: number
  saldo: number
}

interface Detalle {
  enterprise: { id: string; name: string; cuit: string | null }
  cuentas_a_cobrar: CuentaDetalle & { total_ventas: number; total_cobros: number }
  cuentas_a_pagar: CuentaDetalle & { total_compras: number; total_pagos: number }
  balance_neto: number
}

const tipoBadgeConfig: Record<string, { label: string; bg: string; text: string }> = {
  fact_venta: { label: 'Factura Venta', bg: 'bg-blue-100 dark:bg-blue-900/40', text: 'text-blue-700 dark:text-blue-300' },
  factura: { label: 'Factura Venta', bg: 'bg-blue-100 dark:bg-blue-900/40', text: 'text-blue-700 dark:text-blue-300' },
  venta: { label: 'Factura Venta', bg: 'bg-blue-100 dark:bg-blue-900/40', text: 'text-blue-700 dark:text-blue-300' },
  recibo: { label: 'Recibo', bg: 'bg-green-100 dark:bg-green-900/40', text: 'text-green-700 dark:text-green-300' },
  cobro: { label: 'Recibo', bg: 'bg-green-100 dark:bg-green-900/40', text: 'text-green-700 dark:text-green-300' },
  adelanto: { label: 'Recibo (a favor)', bg: 'bg-green-100 dark:bg-green-900/40', text: 'text-green-700 dark:text-green-300' },
  fact_compra: { label: 'Fact. Compra', bg: 'bg-purple-100 dark:bg-purple-900/40', text: 'text-purple-700 dark:text-purple-300' },
  factura_compra: { label: 'Fact. Compra', bg: 'bg-purple-100 dark:bg-purple-900/40', text: 'text-purple-700 dark:text-purple-300' },
  compra: { label: 'Fact. Compra', bg: 'bg-purple-100 dark:bg-purple-900/40', text: 'text-purple-700 dark:text-purple-300' },
  orden_pago: { label: 'Orden de Pago', bg: 'bg-orange-100 dark:bg-orange-900/40', text: 'text-orange-700 dark:text-orange-300' },
  pago: { label: 'Orden de Pago', bg: 'bg-orange-100 dark:bg-orange-900/40', text: 'text-orange-700 dark:text-orange-300' },
  adelanto_pago: { label: 'OP (a favor)', bg: 'bg-orange-100 dark:bg-orange-900/40', text: 'text-orange-700 dark:text-orange-300' },
  ajuste: { label: 'Ajuste', bg: 'bg-gray-100 dark:bg-gray-800', text: 'text-gray-700 dark:text-gray-300' },
  retencion_sufrida: { label: 'Ret. Sufrida', bg: 'bg-teal-100 dark:bg-teal-900/40', text: 'text-teal-700 dark:text-teal-300' },
  retencion_practicada: { label: 'Ret. Practicada', bg: 'bg-teal-100 dark:bg-teal-900/40', text: 'text-teal-700 dark:text-teal-300' },
}

const defaultBadge = { label: 'Otro', bg: 'bg-gray-100 dark:bg-gray-800', text: 'text-gray-700 dark:text-gray-300' }

const TipoBadge = ({ tipo }: { tipo: string }) => {
  const c = tipoBadgeConfig[tipo] || defaultBadge
  return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${c.bg} ${c.text}`}>{c.label}</span>
}


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
  const [tiposVisibles, setTiposVisibles] = useState<Record<string, boolean>>({
    fact_venta: true, recibo: true, fact_compra: true, orden_pago: true, ajuste: true,
    factura: true, venta: true, cobro: true, adelanto: true, factura_compra: true,
    compra: true, pago: true, adelanto_pago: true,
    retencion_sufrida: true, retencion_practicada: true,
  })

  const toggleTipo = (tipo: string) => setTiposVisibles(prev => ({ ...prev, [tipo]: !prev[tipo] }))

  const allMovimientos = useMemo(() => {
    if (!detalle) return []
    const cobrar = (detalle.cuentas_a_cobrar?.movimientos || [])
    const pagar = (detalle.cuentas_a_pagar?.movimientos || [])
    return [...cobrar, ...pagar].sort((a, b) =>
      new Date(a.fecha).getTime() - new Date(b.fecha).getTime()
    )
  }, [detalle])

  const movimientosFiltrados = useMemo(() => {
    const filtered = allMovimientos.filter((m: Movimiento) => tiposVisibles[m.tipo] !== false)
    let saldo = 0
    return filtered.map((m: Movimiento) => {
      saldo += (m.debe || 0) - (m.haber || 0)
      return { ...m, saldo: Math.round(saldo * 100) / 100 }
    })
  }, [allMovimientos, tiposVisibles])

  const filteredTotals = useMemo(() => {
    const debe = movimientosFiltrados.reduce((s: number, m: Movimiento) => s + (m.debe || 0), 0)
    const haber = movimientosFiltrados.reduce((s: number, m: Movimiento) => s + (m.haber || 0), 0)
    const saldo = movimientosFiltrados.length > 0 ? movimientosFiltrados[movimientosFiltrados.length - 1].saldo : 0
    return { debe, haber, saldo }
  }, [movimientosFiltrados])

  // Unique tipos present in current movimientos for filter buttons
  const tiposPresentes = useMemo(() => {
    const set = new Set(allMovimientos.map((m: Movimiento) => m.tipo))
    return Array.from(set)
  }, [allMovimientos])

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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Cuenta Corriente</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Balance por empresa — facturas AFIP, compras, recibos y ordenes de pago
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
            { key: 'cobros', label: 'Recibos' },
            { key: 'a_cobrar', label: 'A Cobrar' },
            { key: 'compras', label: 'Compras' },
            { key: 'pagos', label: 'Ordenes de Pago' },
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
            { key: 'cobros', label: 'Recibos', type: 'currency' as const },
            { key: 'a_cobrar', label: 'A Cobrar', type: 'currency' as const },
            { key: 'compras', label: 'Compras', type: 'currency' as const },
            { key: 'pagos', label: 'Ordenes de Pago', type: 'currency' as const },
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
              <p className="text-xs font-medium text-blue-600 dark:text-blue-400">Recibos Sin Asociar</p>
              <p className="text-xl font-bold text-blue-700 dark:text-blue-300">{fmt(totalAdelantosRecibidos)}</p>
              <div className="flex items-center justify-between mt-0.5">
                <p className="text-[10px] text-blue-500">Recibos no vinculados a facturas</p>
                <Link to="/cobros" className="text-[10px] font-semibold text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-200 underline">
                  Ver en Recibos
                </Link>
              </div>
            </CardContent>
          </Card>
        )}
        {totalAdelantosEntregados > 0 && (
          <Card className="border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30">
            <CardContent className="pt-4 pb-3">
              <p className="text-xs font-medium text-amber-600 dark:text-amber-400">OP Sin Asociar</p>
              <p className="text-xl font-bold text-amber-700 dark:text-amber-300">{fmt(totalAdelantosEntregados)}</p>
              <div className="flex items-center justify-between mt-0.5">
                <p className="text-[10px] text-amber-500">Ordenes de pago no vinculadas a facturas</p>
                <Link to="/pagos" className="text-[10px] font-semibold text-amber-600 hover:text-amber-800 dark:text-amber-400 dark:hover:text-amber-200 underline">
                  Ver en Ordenes de Pago
                </Link>
              </div>
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

      {/* Alert banners for unlinked payments */}
      {totalAdelantosRecibidos > 0 && (
        <div className="flex items-start gap-3 px-4 py-3 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg">
          <svg className="h-5 w-5 text-blue-500 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-sm text-blue-700 dark:text-blue-300">
            Hay recibos por <span className="font-semibold">{fmt(totalAdelantosRecibidos)}</span> sin factura asociada.
            Estos recibos ya figuran en el balance pero no estan vinculados a ninguna factura de venta.{' '}
            <Link to="/cobros" className="font-semibold underline hover:text-blue-900 dark:hover:text-blue-100">
              Ir a Recibos para vincularlos
            </Link>
          </p>
        </div>
      )}
      {totalAdelantosEntregados > 0 && (
        <div className="flex items-start gap-3 px-4 py-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg">
          <svg className="h-5 w-5 text-amber-500 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-sm text-amber-700 dark:text-amber-300">
            Hay ordenes de pago por <span className="font-semibold">{fmt(totalAdelantosEntregados)}</span> sin factura asociada.
            Estas ordenes de pago ya figuran en el balance pero no estan vinculadas a ninguna factura de compra.{' '}
            <Link to="/pagos" className="font-semibold underline hover:text-amber-900 dark:hover:text-amber-100">
              Ir a Ordenes de Pago para vincularlas
            </Link>
          </p>
        </div>
      )}

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
          description="Registra pedidos, compras, recibos u ordenes de pago para ver la cuenta corriente"
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
                  <th className="px-4 py-3 text-right" title="Recibos/OP no vinculados a facturas. La plata ya se movio, cuenta en el balance.">Sin Asociar</th>
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
                      <td className="px-4 py-3 text-right" title="Recibos/OP sin factura vinculada. Ir a Recibos u Ordenes de Pago para asociar.">
                        {(() => {
                          const advRec = (r as any).cobros_no_asociados || (r as any).adelantos_recibidos || r.adelantos_cobros || 0
                          const advEnt = (r as any).pagos_no_asociados || (r as any).adelantos_entregados || r.adelantos_pagos || 0
                          if (advRec > 0 && advEnt > 0) return (
                            <div className="text-xs" onClick={(e) => e.stopPropagation()}>
                              <Link to="/cobros" className="text-blue-600 hover:text-blue-800 dark:hover:text-blue-300 underline" title="Recibos sin factura — ir a Recibos para vincular">Rec: {fmt(advRec)}</Link>
                              <Link to="/pagos" className="block text-amber-600 hover:text-amber-800 dark:hover:text-amber-300 underline" title="OP sin factura — ir a Ordenes de Pago para vincular">OP: {fmt(advEnt)}</Link>
                            </div>
                          )
                          if (advRec > 0) return <Link to="/cobros" className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 underline" title="Recibos sin factura — ir a Recibos para vincular" onClick={(e) => e.stopPropagation()}>{fmt(advRec)}</Link>
                          if (advEnt > 0) return <Link to="/pagos" className="text-xs font-medium text-amber-600 dark:text-amber-400 hover:text-amber-800 dark:hover:text-amber-300 underline" title="OP sin factura — ir a Ordenes de Pago para vincular" onClick={(e) => e.stopPropagation()}>{fmt(advEnt)}</Link>
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
                        <td colSpan={7} className="px-6 py-4 bg-gray-50 animate-slideDown">
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

                              {/* Filtro por tipo */}
                              <div className="flex gap-2 flex-wrap mb-3">
                                {tiposPresentes.map((tipo) => {
                                  const visible = tiposVisibles[tipo] !== false
                                  const cfg = tipoBadgeConfig[tipo] || defaultBadge
                                  return (
                                    <button key={tipo} onClick={() => toggleTipo(tipo)}
                                      className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${visible ? cfg.bg + ' ' + cfg.text + ' border-transparent' : 'bg-white dark:bg-gray-900 text-gray-400 border-gray-200 dark:border-gray-700 line-through'}`}>
                                      {cfg.label}
                                    </button>
                                  )
                                })}
                              </div>

                              {/* Tabla cronologica unificada */}
                              <div className="overflow-x-auto">
                                {movimientosFiltrados.length > 0 ? (
                                  <table className="w-full text-sm">
                                    <thead>
                                      <tr className="text-left text-xs text-gray-500 dark:text-gray-400 border-b">
                                        <th className="pb-2 px-3">Fecha</th>
                                        <th className="pb-2 px-3">Tipo</th>
                                        <th className="pb-2 px-3">Comprobante</th>
                                        <th className="pb-2 px-3">Descripcion</th>
                                        <th className="pb-2 px-3 text-right">Debe</th>
                                        <th className="pb-2 px-3 text-right">Haber</th>
                                        <th className="pb-2 px-3 text-right">Saldo</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {movimientosFiltrados.map((m: any, i: number) => (
                                        <tr key={i} className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/30">
                                          <td className="py-2 px-3 text-gray-600 dark:text-gray-400">
                                            {m.fecha ? new Date(m.fecha).toLocaleDateString('es-AR') : '-'}
                                          </td>
                                          <td className="py-2 px-3">
                                            <TipoBadge tipo={m.tipo} />
                                          </td>
                                          <td className="py-2 px-3 font-mono text-xs">{m.nro_comprobante || '-'}</td>
                                          <td className="py-2 px-3">{m.descripcion}</td>
                                          <td className="py-2 px-3 text-right font-medium">
                                            {m.debe > 0 ? `$${m.debe.toLocaleString('es-AR', {minimumFractionDigits: 2})}` : ''}
                                          </td>
                                          <td className="py-2 px-3 text-right font-medium">
                                            {m.haber > 0 ? `$${m.haber.toLocaleString('es-AR', {minimumFractionDigits: 2})}` : ''}
                                          </td>
                                          <td className={`py-2 px-3 text-right font-bold ${m.saldo >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                                            ${Math.abs(m.saldo).toLocaleString('es-AR', {minimumFractionDigits: 2})}
                                            <span className="text-[10px] ml-0.5">{m.saldo >= 0 ? 'D' : 'H'}</span>
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                    <tfoot>
                                      <tr className="border-t-2 font-bold">
                                        <td colSpan={4} className="py-2 px-3">TOTALES</td>
                                        <td className="py-2 px-3 text-right">${filteredTotals.debe.toLocaleString('es-AR', {minimumFractionDigits: 2})}</td>
                                        <td className="py-2 px-3 text-right">${filteredTotals.haber.toLocaleString('es-AR', {minimumFractionDigits: 2})}</td>
                                        <td className={`py-2 px-3 text-right ${filteredTotals.saldo >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                          ${Math.abs(filteredTotals.saldo).toLocaleString('es-AR', {minimumFractionDigits: 2})}
                                          <span className="text-[10px] ml-0.5">{filteredTotals.saldo >= 0 ? 'D' : 'H'}</span>
                                        </td>
                                      </tr>
                                    </tfoot>
                                  </table>
                                ) : (
                                  <p className="text-sm text-gray-400 py-4 text-center">
                                    Sin movimientos registrados
                                  </p>
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
