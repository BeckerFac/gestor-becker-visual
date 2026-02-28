import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../services/api'

export default function Products() {
  const [products, setProducts] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    loadProducts()
  }, [])

  const loadProducts = async () => {
    try {
      const res = await api.getProducts()
      setProducts(res.data.items || [])
    } catch (err) {
      console.error(err)
      if ((err as any).response?.status === 401) navigate('/')
    } finally {
      setLoading(false)
    }
  }

  const handleCreate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    try {
      const sku = (e.currentTarget.elements.namedItem('sku') as HTMLInputElement).value
      const name = (e.currentTarget.elements.namedItem('name') as HTMLInputElement).value
      const cost = (e.currentTarget.elements.namedItem('cost') as HTMLInputElement).value
      const margin_percent = (e.currentTarget.elements.namedItem('margin_percent') as HTMLInputElement).value

      await api.createProduct({ sku, name, cost, margin_percent, vat_rate: 21 })
      setShowForm(false)
      loadProducts()
    } catch (err: any) {
      alert(err.response?.data?.error || 'Error al crear producto')
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('¿Eliminar este producto?')) return
    try {
      await api.deleteProduct(id)
      loadProducts()
    } catch (err: any) {
      alert(err.response?.data?.error || 'Error al eliminar')
    }
  }

  if (loading) return <div className="container">Cargando...</div>

  return (
    <div className="container">
      <div className="header">
        <h1>Productos</h1>
        <button onClick={() => setShowForm(!showForm)}>{showForm ? 'Cancelar' : 'Nuevo Producto'}</button>
      </div>

      {showForm && (
        <div className="form">
          <h3>Crear Producto</h3>
          <form onSubmit={handleCreate}>
            <div className="form-group">
              <label>SKU</label>
              <input type="text" name="sku" required />
            </div>
            <div className="form-group">
              <label>Nombre</label>
              <input type="text" name="name" required />
            </div>
            <div className="form-group">
              <label>Costo</label>
              <input type="number" name="cost" step="0.01" required />
            </div>
            <div className="form-group">
              <label>Margen (%)</label>
              <input type="number" name="margin_percent" defaultValue="30" step="0.01" />
            </div>
            <button type="submit">Crear</button>
          </form>
        </div>
      )}

      <table>
        <thead>
          <tr>
            <th>SKU</th>
            <th>Nombre</th>
            <th>Acciones</th>
          </tr>
        </thead>
        <tbody>
          {products.map((p: any) => (
            <tr key={p.id}>
              <td>{p.sku}</td>
              <td>{p.name}</td>
              <td>
                <button onClick={() => handleDelete(p.id)} style={{ background: '#d32f2f' }}>Eliminar</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
