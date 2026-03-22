import React, { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { api } from '@/services/api'
import { toast } from '@/hooks/useToast'
import { PermissionGate } from '@/components/shared/PermissionGate'

interface PortalConfigData {
  show_orders: boolean
  show_invoices: boolean
  show_quotes: boolean
  show_balance: boolean
  show_remitos: boolean
  orders_show_price: boolean
  orders_show_total: boolean
  orders_show_status: boolean
  orders_show_delivery_date: boolean
  orders_show_payment_status: boolean
  orders_show_payment_method: boolean
  orders_show_notes: boolean
  orders_show_timeline: boolean
  invoices_show_subtotal: boolean
  invoices_show_iva: boolean
  invoices_show_total: boolean
  invoices_show_cae: boolean
  invoices_show_download_pdf: boolean
  quotes_show_price: boolean
  quotes_show_validity: boolean
  quotes_show_download_pdf: boolean
  quotes_show_accept_reject: boolean
  balance_show_total_orders: boolean
  balance_show_total_invoiced: boolean
  balance_show_pending: boolean
  balance_show_payment_detail: boolean
  portal_welcome_message: string
  portal_logo_url: string | null
}

const DEFAULT_CONFIG: PortalConfigData = {
  show_orders: true,
  show_invoices: true,
  show_quotes: true,
  show_balance: true,
  show_remitos: false,
  orders_show_price: true,
  orders_show_total: true,
  orders_show_status: true,
  orders_show_delivery_date: true,
  orders_show_payment_status: true,
  orders_show_payment_method: false,
  orders_show_notes: false,
  orders_show_timeline: true,
  invoices_show_subtotal: true,
  invoices_show_iva: true,
  invoices_show_total: true,
  invoices_show_cae: false,
  invoices_show_download_pdf: true,
  quotes_show_price: true,
  quotes_show_validity: true,
  quotes_show_download_pdf: true,
  quotes_show_accept_reject: false,
  balance_show_total_orders: true,
  balance_show_total_invoiced: true,
  balance_show_pending: true,
  balance_show_payment_detail: false,
  portal_welcome_message: 'Bienvenido a tu portal de cliente',
  portal_logo_url: null,
}

interface CheckboxFieldProps {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
}

const CheckboxField: React.FC<CheckboxFieldProps> = ({ label, checked, onChange, disabled }) => (
  <label className={`flex items-center gap-2 cursor-pointer select-none ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}>
    <input
      type="checkbox"
      checked={checked}
      onChange={e => onChange(e.target.checked)}
      disabled={disabled}
      className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
    />
    <span className="text-sm text-gray-700 dark:text-gray-300">{label}</span>
  </label>
)

interface SectionGroupProps {
  title: string
  children: React.ReactNode
  enabled?: boolean
}

const SectionGroup: React.FC<SectionGroupProps> = ({ title, children, enabled = true }) => (
  <div className={`p-4 rounded-lg border ${enabled ? 'border-gray-200 bg-white dark:bg-gray-800' : 'border-gray-100 bg-gray-50 dark:bg-gray-900 opacity-60'}`}>
    <h4 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-3">{title}</h4>
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
      {children}
    </div>
  </div>
)

export const PortalConfigSection: React.FC = () => {
  const [config, setConfig] = useState<PortalConfigData>(DEFAULT_CONFIG)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    loadConfig()
  }, [])

  const loadConfig = async () => {
    try {
      setLoading(true)
      const data = await api.getPortalConfig()
      setConfig({
        ...DEFAULT_CONFIG,
        ...data,
      })
    } catch (e: any) {
      toast.error('Error cargando configuracion del portal: ' + e.message)
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async () => {
    try {
      setSaving(true)
      await api.updatePortalConfig(config)
      toast.success('Configuracion del portal guardada')
    } catch (e: any) {
      toast.error('Error guardando configuracion: ' + e.message)
    } finally {
      setSaving(false)
    }
  }

  const handlePreview = async () => {
    try {
      const token = await api.getPortalPreviewToken()
      window.open(`/portal?preview_token=${token}`, '_blank')
    } catch (e: any) {
      toast.error('Error al generar vista previa')
    }
  }

  const updateField = <K extends keyof PortalConfigData>(field: K, value: PortalConfigData[K]) => {
    setConfig(prev => ({ ...prev, [field]: value }))
  }

  if (loading) {
    return (
      <Card>
        <CardHeader><h3 className="text-lg font-semibold">Portal de Clientes</h3></CardHeader>
        <CardContent>
          <div className="animate-pulse space-y-3">
            <div className="h-4 bg-gray-200 rounded w-1/3"></div>
            <div className="h-4 bg-gray-200 rounded w-1/2"></div>
            <div className="h-4 bg-gray-200 rounded w-1/4"></div>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">Portal de Clientes</h3>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={handlePreview}>
              Vista previa
            </Button>
            <PermissionGate module="settings" action="edit">
              <Button variant="primary" onClick={handleSave} loading={saving}>
                Guardar
              </Button>
            </PermissionGate>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-6">
          {/* Welcome message */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Mensaje de bienvenida
            </label>
            <Input
              value={config.portal_welcome_message}
              onChange={e => updateField('portal_welcome_message', e.target.value)}
              placeholder="Bienvenido a tu portal de cliente"
            />
          </div>

          {/* Sections */}
          <div>
            <h4 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-3">Secciones visibles</h4>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
              <CheckboxField label="Pedidos" checked={config.show_orders} onChange={v => updateField('show_orders', v)} />
              <CheckboxField label="Facturas" checked={config.show_invoices} onChange={v => updateField('show_invoices', v)} />
              <CheckboxField label="Cotizaciones" checked={config.show_quotes} onChange={v => updateField('show_quotes', v)} />
              <CheckboxField label="Remitos" checked={config.show_remitos} onChange={v => updateField('show_remitos', v)} />
              <CheckboxField label="Balance / Mi Cuenta" checked={config.show_balance} onChange={v => updateField('show_balance', v)} />
            </div>
          </div>

          {/* Orders fields */}
          <SectionGroup title="Pedidos - campos visibles para el cliente" enabled={config.show_orders}>
            <CheckboxField label="Precio unitario" checked={config.orders_show_price} onChange={v => updateField('orders_show_price', v)} disabled={!config.show_orders} />
            <CheckboxField label="Total" checked={config.orders_show_total} onChange={v => updateField('orders_show_total', v)} disabled={!config.show_orders} />
            <CheckboxField label="Estado del pedido" checked={config.orders_show_status} onChange={v => updateField('orders_show_status', v)} disabled={!config.show_orders} />
            <CheckboxField label="Fecha de entrega estimada" checked={config.orders_show_delivery_date} onChange={v => updateField('orders_show_delivery_date', v)} disabled={!config.show_orders} />
            <CheckboxField label="Estado de pago" checked={config.orders_show_payment_status} onChange={v => updateField('orders_show_payment_status', v)} disabled={!config.show_orders} />
            <CheckboxField label="Metodo de pago" checked={config.orders_show_payment_method} onChange={v => updateField('orders_show_payment_method', v)} disabled={!config.show_orders} />
            <CheckboxField label="Notas / observaciones" checked={config.orders_show_notes} onChange={v => updateField('orders_show_notes', v)} disabled={!config.show_orders} />
            <CheckboxField label="Timeline de progreso" checked={config.orders_show_timeline} onChange={v => updateField('orders_show_timeline', v)} disabled={!config.show_orders} />
          </SectionGroup>

          {/* Invoices fields */}
          <SectionGroup title="Facturas - campos visibles" enabled={config.show_invoices}>
            <CheckboxField label="Subtotal" checked={config.invoices_show_subtotal} onChange={v => updateField('invoices_show_subtotal', v)} disabled={!config.show_invoices} />
            <CheckboxField label="IVA" checked={config.invoices_show_iva} onChange={v => updateField('invoices_show_iva', v)} disabled={!config.show_invoices} />
            <CheckboxField label="Total" checked={config.invoices_show_total} onChange={v => updateField('invoices_show_total', v)} disabled={!config.show_invoices} />
            <CheckboxField label="CAE" checked={config.invoices_show_cae} onChange={v => updateField('invoices_show_cae', v)} disabled={!config.show_invoices} />
            <CheckboxField label="Descargar PDF" checked={config.invoices_show_download_pdf} onChange={v => updateField('invoices_show_download_pdf', v)} disabled={!config.show_invoices} />
          </SectionGroup>

          {/* Quotes fields */}
          <SectionGroup title="Cotizaciones - campos visibles" enabled={config.show_quotes}>
            <CheckboxField label="Precios" checked={config.quotes_show_price} onChange={v => updateField('quotes_show_price', v)} disabled={!config.show_quotes} />
            <CheckboxField label="Validez" checked={config.quotes_show_validity} onChange={v => updateField('quotes_show_validity', v)} disabled={!config.show_quotes} />
            <CheckboxField label="Descargar PDF" checked={config.quotes_show_download_pdf} onChange={v => updateField('quotes_show_download_pdf', v)} disabled={!config.show_quotes} />
            <CheckboxField label="Aceptar / Rechazar cotizacion" checked={config.quotes_show_accept_reject} onChange={v => updateField('quotes_show_accept_reject', v)} disabled={!config.show_quotes} />
          </SectionGroup>

          {/* Balance fields */}
          <SectionGroup title="Balance / Mi Cuenta - campos visibles" enabled={config.show_balance}>
            <CheckboxField label="Total en pedidos" checked={config.balance_show_total_orders} onChange={v => updateField('balance_show_total_orders', v)} disabled={!config.show_balance} />
            <CheckboxField label="Total facturado" checked={config.balance_show_total_invoiced} onChange={v => updateField('balance_show_total_invoiced', v)} disabled={!config.show_balance} />
            <CheckboxField label="Pendiente de pago" checked={config.balance_show_pending} onChange={v => updateField('balance_show_pending', v)} disabled={!config.show_balance} />
            <CheckboxField label="Detalle de pagos" checked={config.balance_show_payment_detail} onChange={v => updateField('balance_show_payment_detail', v)} disabled={!config.show_balance} />
          </SectionGroup>
        </div>
      </CardContent>
    </Card>
  )
}
