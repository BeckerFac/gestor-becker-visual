import React, { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader } from '@/components/ui/Card'
import { SkeletonTable } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/shared/EmptyState'
import { ExportCSVButton } from '@/components/shared/ExportCSV'
import { toast } from '@/hooks/useToast'
import { api } from '@/services/api'

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
  saldo: number
}

interface Detalle {
  enterprise: { id: string; name: string; cuit: string | null }
  cuentas_a_cobrar: CuentaDetalle & { total_ventas: number; total_cobros: number }
  cuentas_a_pagar: CuentaDetalle & { total_compras: number; total_pagos: number }
  balance_neto: number
}

const tipoColors: Record<string, string> = {
  venta: 'bg-blue-100 text-blue-700',
  cobro: 'bg-green-100 text-green-700',
  compra: 'bg-orange-100 text-orange-700',
  pago: 'bg-red-100 text-red-700',
}

const tipoLabels: Record<string, string> = {
  venta: 'Venta',
  cobro: 'Cobro',
  compra: 'Compra',
  pago: 'Pago',
}

interface MovimientosTableProps {
  movimientos: Movimiento[]
  saldo: number
  fmt: (n: number) => string
  formatDate: (d: string) => string
  saldoLabel: string
  saldoPositiveColor: string
}

const MovimientosTable: React.FC<MovimientosTableProps> = ({
  movimientos,
  saldo,
  fmt,
  formatDate,
  saldoLabel,
  saldoPositiveColor,
}) => (
  <table className="w-full text-sm">
    <thead>
      <tr className="text-left text-gray-500 border-b">
        <th className="pb-2">Fecha</th>
        <th className="pb-2">Tipo</th>
        <th className="pb-2">Descripcion</th>
        <th className="pb-2 text-right">Debe</th>
        <th className="pb-2 text-right">Haber</th>
        <th className="pb-2 text-right">Saldo</th>
      </tr>
    </thead>
    <tbody>
      {movimientos.map((m, idx) => (
        <tr key={`${m.id}-${idx}`} className="border-b border-gray-100">
          <td className="py-2 text-gray-600">{formatDate(m.fecha)}</td>
          <td className="py-2">
            <span
              className={`px-2 py-0.5 rounded-full text-xs font-medium ${tipoColors[m.tipo] || 'bg-gray-100 text-gray-700'}`}
            >
              {tipoLabels[m.tipo] || m.tipo}
            </span>
          </td>
          <td className="py-2 text-gray-700">{m.descripcion}</td>
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
        <td colSpan={5} className="py-3 font-bold text-right text-gray-700">
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

export const CuentaCorriente: React.FC = () => {
  const [resumen, setResumen] = useState<EnterpriseSaldo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedEnterprise, setSelectedEnterprise] = useState<string | null>(null)
  const [detalle, setDetalle] = useState<Detalle | null>(null)
  const [loadingDetalle, setLoadingDetalle] = useState(false)

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

  const fmt = (n: number) =>
    n.toLocaleString('es-AR', { style: 'currency', currency: 'ARS' })

  const formatDate = (d: string) => new Date(d).toLocaleDateString('es-AR')

  const totalNosDebem = resumen
    .filter((r) => r.a_cobrar > 0)
    .reduce((s, r) => s + r.a_cobrar, 0)

  const totalLesDebemos = resumen
    .filter((r) => r.a_pagar > 0)
    .reduce((s, r) => s + r.a_pagar, 0)

  const balanceNeto = totalNosDebem - totalLesDebemos

  const hasMovimientosCobrar =
    detalle && detalle.cuentas_a_cobrar.movimientos.length > 0
  const hasMovimientosPagar =
    detalle && detalle.cuentas_a_pagar.movimientos.length > 0

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Cuenta Corriente</h1>
          <p className="text-sm text-gray-500 mt-1">
            Balance por empresa — pedidos, compras, cobros y pagos
          </p>
        </div>
        <ExportCSVButton
          data={resumen.map((r) => ({
            empresa: r.name,
            cuit: r.cuit || '',
            ventas: r.total_ventas,
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
            { key: 'ventas', label: 'Ventas' },
            { key: 'cobros', label: 'Cobros' },
            { key: 'a_cobrar', label: 'A Cobrar' },
            { key: 'compras', label: 'Compras' },
            { key: 'pagos', label: 'Pagos' },
            { key: 'a_pagar', label: 'A Pagar' },
            { key: 'balance', label: 'Balance' },
          ]}
          filename="cuenta_corriente"
        />
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent>
            <p className="text-sm text-gray-500">Nos Deben</p>
            <p className="text-2xl font-bold text-green-700">{fmt(totalNosDebem)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <p className="text-sm text-gray-500">Les Debemos</p>
            <p className="text-2xl font-bold text-red-600">{fmt(totalLesDebemos)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <p className="text-sm text-gray-500">Balance Neto</p>
            <p
              className={`text-2xl font-bold ${balanceNeto >= 0 ? 'text-green-700' : 'text-red-600'}`}
            >
              {fmt(balanceNeto)}
            </p>
          </CardContent>
        </Card>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
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
                <tr className="bg-gray-50 text-left text-sm font-medium text-gray-500">
                  <th className="px-6 py-3">Empresa</th>
                  <th className="px-6 py-3">CUIT</th>
                  <th className="px-6 py-3 text-right">Ventas</th>
                  <th className="px-6 py-3 text-right">Cobros</th>
                  <th className="px-6 py-3 text-right">A Cobrar</th>
                  <th className="px-6 py-3 text-right">Compras</th>
                  <th className="px-6 py-3 text-right">Pagos</th>
                  <th className="px-6 py-3 text-right">A Pagar</th>
                  <th className="px-6 py-3 text-right">Balance</th>
                  <th className="px-6 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {resumen.map((r) => (
                  <React.Fragment key={r.id}>
                    <tr
                      className="border-b hover:bg-gray-50 cursor-pointer"
                      onClick={() => handleVerDetalle(r.id)}
                    >
                      <td className="px-6 py-4 font-medium text-gray-900">{r.name}</td>
                      <td className="px-6 py-4 font-mono text-sm text-gray-500">
                        {r.cuit || '-'}
                      </td>
                      <td className="px-6 py-4 text-right text-blue-700">
                        {fmt(r.total_ventas)}
                      </td>
                      <td className="px-6 py-4 text-right text-green-600">
                        {fmt(r.total_cobros)}
                      </td>
                      <td className="px-6 py-4 text-right">
                        {r.a_cobrar > 0 ? (
                          <>
                            <span className="font-bold text-green-700">{fmt(r.a_cobrar)}</span>
                            <span className="block text-xs text-green-600">Nos deben</span>
                          </>
                        ) : (
                          <span className="text-gray-400">{fmt(0)}</span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-right text-orange-600">
                        {fmt(r.total_compras)}
                      </td>
                      <td className="px-6 py-4 text-right text-red-600">
                        {fmt(r.total_pagos)}
                      </td>
                      <td className="px-6 py-4 text-right">
                        {r.a_pagar > 0 ? (
                          <>
                            <span className="font-bold text-red-600">{fmt(r.a_pagar)}</span>
                            <span className="block text-xs text-red-500">Les debemos</span>
                          </>
                        ) : (
                          <span className="text-gray-400">{fmt(0)}</span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <span
                          className={`font-bold text-lg ${r.saldo > 0 ? 'text-green-700' : r.saldo < 0 ? 'text-red-600' : 'text-gray-500'}`}
                        >
                          {fmt(r.saldo)}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm text-blue-600">
                        {selectedEnterprise === r.id ? '\u25b2' : '\u25bc'}
                      </td>
                    </tr>

                    {/* Expanded detail */}
                    {selectedEnterprise === r.id && (
                      <tr>
                        <td colSpan={10} className="px-6 py-4 bg-gray-50 animate-slideDown">
                          {loadingDetalle ? (
                            <SkeletonTable rows={4} cols={6} />
                          ) : detalle ? (
                            <div className="space-y-6">
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
                                  />
                                ) : (
                                  <p className="text-sm text-gray-400 py-2">
                                    Sin movimientos de compras o pagos.
                                  </p>
                                )}
                              </div>

                              {/* Balance Neto */}
                              <div className="border-t-2 border-gray-400 pt-4 flex items-center justify-end gap-4">
                                <span className="text-base font-bold text-gray-700">
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
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  )
}
