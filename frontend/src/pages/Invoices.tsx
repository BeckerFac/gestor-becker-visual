import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../services/api'

export default function Invoices() {
  const [invoices, setInvoices] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [selectedInvoice, setSelectedInvoice] = useState<any>(null)
  const navigate = useNavigate()

  useEffect(() => {
    loadInvoices()
  }, [])

  const loadInvoices = async () => {
    try {
      const res = await api.getInvoices()
      setInvoices(res.data.items || [])
    } catch (err) {
      console.error(err)
      if ((err as any).response?.status === 401) navigate('/')
    } finally {
      setLoading(false)
    }
  }

  const handleAuthorize = async (invoiceId: string) => {
    try {
      const res = await api.authorizeInvoice(invoiceId)
      alert(`✅ Factura autorizada\nCAE: ${res.data.authorization.cae}`)
      loadInvoices()
    } catch (err: any) {
      alert(`Error: ${err.response?.data?.error || 'No se pudo autorizar'}`)
    }
  }

  const getStatusBadge = (status: string): Record<string, string> => {
    const styles: Record<string, Record<string, string>> = {
      draft: { background: '#FFC107', color: 'black' },
      pending: { background: '#2196F3', color: 'white' },
      authorized: { background: '#4CAF50', color: 'white' },
      cancelled: { background: '#F44336', color: 'white' },
    }
    return styles[status] || { background: '#9E9E9E', color: 'white' }
  }

  if (loading) return <div className="container">Cargando...</div>

  return (
    <div className="container">
      <div className="header">
        <h1>Facturas</h1>
        <button onClick={() => setShowForm(!showForm)}>{showForm ? 'Cancelar' : 'Nueva Factura'}</button>
      </div>

      {showForm && (
        <div className="form">
          <h3>Crear Factura</h3>
          <p>Funcionalidad de creación de facturas próximamente</p>
          <p style={{ fontSize: '12px', color: '#999' }}>
            Por ahora usa los endpoints de API para crear facturas
          </p>
        </div>
      )}

      {selectedInvoice && (
        <div className="form">
          <h3>Detalles de Factura</h3>
          <div style={{ marginBottom: '15px' }}>
            <p><strong>Factura:</strong> {selectedInvoice.invoice_number}</p>
            <p><strong>Tipo:</strong> {selectedInvoice.invoice_type}</p>
            <p><strong>Total:</strong> ${parseFloat(selectedInvoice.total_amount).toFixed(2)}</p>
            <p>
              <strong>Estado:</strong>
              <span style={{ marginLeft: '10px', padding: '5px 10px', borderRadius: '4px', ...getStatusBadge(selectedInvoice.status) }}>
                {selectedInvoice.status}
              </span>
            </p>
            {selectedInvoice.cae && <p><strong>CAE:</strong> {selectedInvoice.cae}</p>}
          </div>

          {selectedInvoice.status !== 'authorized' && (
            <button
              onClick={() => handleAuthorize(selectedInvoice.id)}
              style={{ background: '#4CAF50', marginRight: '10px' }}
            >
              Autorizar en AFIP
            </button>
          )}
          <button
            onClick={() => setSelectedInvoice(null)}
            style={{ background: '#999' }}
          >
            Cerrar
          </button>
        </div>
      )}

      <table>
        <thead>
          <tr>
            <th>Factura #</th>
            <th>Tipo</th>
            <th>Total</th>
            <th>Estado</th>
            <th>CAE</th>
            <th>Acciones</th>
          </tr>
        </thead>
        <tbody>
          {invoices.length > 0 ? (
            invoices.map((inv: any) => (
              <tr key={inv.id}>
                <td>{inv.invoice_number}</td>
                <td>{inv.invoice_type}</td>
                <td>${parseFloat(inv.total_amount).toFixed(2)}</td>
                <td>
                  <span style={{ padding: '5px 10px', borderRadius: '4px', ...getStatusBadge(inv.status) }}>
                    {inv.status}
                  </span>
                </td>
                <td>{inv.cae || '-'}</td>
                <td>
                  <button
                    onClick={() => setSelectedInvoice(inv)}
                    style={{ background: '#0066cc', marginRight: '5px' }}
                  >
                    Ver
                  </button>
                  {inv.status !== 'authorized' && (
                    <button
                      onClick={() => handleAuthorize(inv.id)}
                      style={{ background: '#4CAF50' }}
                    >
                      Autorizar
                    </button>
                  )}
                </td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={6} style={{ textAlign: 'center', padding: '20px' }}>
                No hay facturas. <a href="#" onClick={() => setShowForm(true)}>Crear una nueva</a>
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
