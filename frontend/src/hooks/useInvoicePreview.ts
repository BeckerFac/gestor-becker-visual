import { useState, useCallback } from 'react'
import { api } from '@/services/api'

export interface PreviewItem {
  id?: string
  product_id?: string | null
  product_name: string
  quantity: number
  unit_price: number
  vat_rate: number
  order_item_id?: string | null
}

interface UseInvoicePreviewOptions {
  onError: (msg: string) => void
  onDataRefresh: () => Promise<void>
  loadInvoicingStatus: (orderId: string) => Promise<void>
}

export function useInvoicePreview({ onError, onDataRefresh, loadInvoicingStatus }: UseInvoicePreviewOptions) {
  const [previewInvoice, setPreviewInvoice] = useState<any>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewOrderId, setPreviewOrderId] = useState('')
  const [authorizingInvoice, setAuthorizingInvoice] = useState(false)
  const [authorizeProgress, setAuthorizeProgress] = useState('')
  const [previewPuntoVenta, setPreviewPuntoVenta] = useState(3)
  const [previewInvoiceType, setPreviewInvoiceType] = useState('B')
  const [previewItems, setPreviewItems] = useState<PreviewItem[]>([])
  const [invoiceAuthorized, setInvoiceAuthorized] = useState(false)

  const openPreview = useCallback(async (invoiceId: string, orderId: string) => {
    setPreviewLoading(true)
    setPreviewOrderId(orderId)
    setInvoiceAuthorized(false)
    setAuthorizeProgress('')
    try {
      const invoice = await api.getInvoice(invoiceId)
      setPreviewInvoice(invoice)
      setPreviewInvoiceType(invoice.invoice_type || 'B')
      setPreviewPuntoVenta(invoice.punto_venta || 3)
      setPreviewItems((invoice.items || []).map((i: any) => ({
        ...i,
        quantity: Number(i.quantity),
        unit_price: parseFloat(i.unit_price?.toString() || '0'),
        vat_rate: parseFloat(i.vat_rate?.toString() || '21'),
      })))
      setInvoiceAuthorized(invoice.status === 'authorized')
    } catch (e: any) {
      onError(e.response?.data?.message || e.message)
    } finally {
      setPreviewLoading(false)
    }
  }, [onError])

  const closePreview = useCallback(() => {
    setPreviewInvoice(null)
    setPreviewOrderId('')
    setPreviewItems([])
    setAuthorizeProgress('')
    setInvoiceAuthorized(false)
  }, [])

  const saveAndAuthorize = useCallback(async () => {
    if (!previewInvoice || authorizingInvoice) return
    setAuthorizingInvoice(true)
    setAuthorizeProgress('Guardando cambios...')
    try {
      await api.updateDraftInvoice(previewInvoice.id, {
        invoice_type: previewInvoiceType,
        items: previewItems.map(i => ({
          product_id: i.product_id || null,
          product_name: i.product_name || '',
          quantity: i.quantity,
          unit_price: i.unit_price,
          vat_rate: i.vat_rate,
          order_item_id: i.order_item_id || null,
        })),
      })

      setAuthorizeProgress('Autorizando con AFIP...')
      const authorized = await api.authorizeInvoice(previewInvoice.id, previewPuntoVenta)
      setPreviewInvoice(authorized)
      setInvoiceAuthorized(true)
      setAuthorizeProgress('Factura autorizada exitosamente')

      if (previewOrderId) {
        await loadInvoicingStatus(previewOrderId)
      }
      await onDataRefresh()
    } catch (e: any) {
      onError(e.response?.data?.message || e.message)
      setAuthorizeProgress('')
    } finally {
      setAuthorizingInvoice(false)
    }
  }, [previewInvoice, authorizingInvoice, previewInvoiceType, previewItems, previewPuntoVenta, previewOrderId, onError, onDataRefresh, loadInvoicingStatus])

  const deleteDraft = useCallback(async (invoiceId: string, orderId: string) => {
    if (!confirm('Eliminar este borrador de factura?')) return
    try {
      await api.deleteDraftInvoice(invoiceId)
      closePreview()
      if (orderId) await loadInvoicingStatus(orderId)
      await onDataRefresh()
    } catch (e: any) {
      onError(e.response?.data?.message || e.message)
    }
  }, [closePreview, loadInvoicingStatus, onDataRefresh, onError])

  const downloadPdf = useCallback(async (invoiceId: string, invoice: any) => {
    try {
      const blob = await api.downloadInvoicePdf(invoiceId)
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      const pv = invoice.punto_venta ? String(invoice.punto_venta).padStart(5, '0') : '00000'
      const nro = String(invoice.invoice_number).padStart(8, '0')
      a.href = url
      a.download = `Factura_${invoice.invoice_type}_${pv}-${nro}.pdf`
      document.body.appendChild(a)
      a.click()
      a.remove()
      window.URL.revokeObjectURL(url)
    } catch (e: any) {
      onError(e.message)
    }
  }, [onError])

  return {
    previewInvoice,
    previewLoading,
    previewOrderId,
    authorizingInvoice,
    authorizeProgress,
    previewPuntoVenta,
    setPreviewPuntoVenta,
    previewInvoiceType,
    setPreviewInvoiceType,
    previewItems,
    setPreviewItems,
    invoiceAuthorized,
    openPreview,
    closePreview,
    saveAndAuthorize,
    deleteDraft,
    downloadPdf,
  }
}
