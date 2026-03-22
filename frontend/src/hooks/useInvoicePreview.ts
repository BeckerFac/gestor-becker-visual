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
  const [authFailed, setAuthFailed] = useState(false)
  const [authErrorMsg, setAuthErrorMsg] = useState('')
  const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null)
  const [downloadingPdf, setDownloadingPdf] = useState(false)
  const [previewCondicionIva, setPreviewCondicionIva] = useState<number>(5)
  const [previewConcepto, setPreviewConcepto] = useState<number>(1)
  const [previewFchServDesde, setPreviewFchServDesde] = useState('')
  const [previewFchServHasta, setPreviewFchServHasta] = useState('')
  const [previewFchVtoPago, setPreviewFchVtoPago] = useState('')

  const openPreview = useCallback(async (invoiceId: string, orderId: string) => {
    setPreviewLoading(true)
    setPreviewOrderId(orderId)
    setInvoiceAuthorized(false)
    setAuthFailed(false)
    setAuthErrorMsg('')
    setAuthorizeProgress('')
    try {
      // Load invoice data and PDF blob in parallel
      const [invoice] = await Promise.all([
        api.getInvoice(invoiceId),
        api.downloadInvoicePdf(invoiceId)
          .then(blob => {
            setPdfBlobUrl(prev => {
              if (prev) URL.revokeObjectURL(prev)
              return URL.createObjectURL(blob)
            })
          })
          .catch(() => {
            // PDF generation may fail silently; tab will show loading state
          }),
      ])
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
    setPdfBlobUrl(prev => {
      if (prev) URL.revokeObjectURL(prev)
      return null
    })
  }, [])

  const saveAndAuthorize = useCallback(async () => {
    if (!previewInvoice || authorizingInvoice) return
    setAuthorizingInvoice(true)
    setAuthorizeProgress('Guardando cambios...')
    try {
      await api.updateDraftInvoice(previewInvoice.id, {
        invoice_type: previewInvoiceType,
        concepto: previewConcepto,
        fch_serv_desde: previewConcepto !== 1 ? previewFchServDesde : undefined,
        fch_serv_hasta: previewConcepto !== 1 ? previewFchServHasta : undefined,
        fch_vto_pago: previewConcepto !== 1 ? previewFchVtoPago : undefined,
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
      const authorized = await api.authorizeInvoice(previewInvoice.id, previewPuntoVenta, previewCondicionIva)
      setPreviewInvoice(authorized)
      setInvoiceAuthorized(true)
      setAuthorizeProgress('Factura autorizada exitosamente')

      if (previewOrderId) {
        await loadInvoicingStatus(previewOrderId)
      }
      await onDataRefresh()
    } catch (e: any) {
      const msg = e.response?.data?.message || e.message
      onError(msg)
      setAuthFailed(true)
      setAuthErrorMsg(msg)
      setAuthorizeProgress('Error al autorizar - puede descargar el PDF borrador')
    } finally {
      setAuthorizingInvoice(false)
    }
  }, [previewInvoice, authorizingInvoice, previewInvoiceType, previewItems, previewPuntoVenta, previewCondicionIva, previewConcepto, previewFchServDesde, previewFchServHasta, previewFchVtoPago, previewOrderId, onError, onDataRefresh, loadInvoicingStatus])

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
      setDownloadingPdf(true)
      const blob = await api.downloadInvoicePdf(invoiceId)
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      const pv = invoice.punto_venta ? String(invoice.punto_venta).padStart(5, '0') : '00000'
      const nro = String(invoice.invoice_number).padStart(8, '0')
      a.href = url
      a.download = `Factura_${invoice.invoice_type || 'NF'}_${pv}-${nro}.pdf`
      document.body.appendChild(a)
      a.click()
      a.remove()
      window.URL.revokeObjectURL(url)
    } catch (e: any) {
      onError(e.message)
    } finally {
      setDownloadingPdf(false)
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
    authFailed,
    authErrorMsg,
    openPreview,
    closePreview,
    saveAndAuthorize,
    deleteDraft,
    downloadPdf,
    downloadingPdf,
    pdfBlobUrl,
    previewCondicionIva,
    setPreviewCondicionIva,
    previewConcepto,
    setPreviewConcepto,
    previewFchServDesde,
    setPreviewFchServDesde,
    previewFchServHasta,
    setPreviewFchServHasta,
    previewFchVtoPago,
    setPreviewFchVtoPago,
  }
}
