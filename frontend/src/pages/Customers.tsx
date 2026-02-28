import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../services/api'

export default function Customers() {
  const [customers, setCustomers] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    loadCustomers()
  }, [])

  const loadCustomers = async () => {
    try {
      const res = await api.getCustomers()
      setCustomers(res.data.items || [])
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
      const cuit = (e.currentTarget.elements.namedItem('cuit') as HTMLInputElement).value
      const name = (e.currentTarget.elements.namedItem('name') as HTMLInputElement).value
      const email = (e.currentTarget.elements.namedItem('email') as HTMLInputElement).value

      await api.createCustomer({ cuit, name, email })
      setShowForm(false)
      loadCustomers()
    } catch (err: any) {
      alert(err.response?.data?.error || 'Error al crear cliente')
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('¿Eliminar este cliente?')) return
    try {
      await api.deleteCustomer(id)
      loadCustomers()
    } catch (err: any) {
      alert(err.response?.data?.error || 'Error al eliminar')
    }
  }

  if (loading) return <div className="container">Cargando...</div>

  return (
    <div className="container">
      <div className="header">
        <h1>Clientes</h1>
        <button onClick={() => setShowForm(!showForm)}>{showForm ? 'Cancelar' : 'Nuevo Cliente'}</button>
      </div>

      {showForm && (
        <div className="form">
          <h3>Crear Cliente</h3>
          <form onSubmit={handleCreate}>
            <div className="form-group">
              <label>CUIT</label>
              <input type="text" name="cuit" required />
            </div>
            <div className="form-group">
              <label>Nombre</label>
              <input type="text" name="name" required />
            </div>
            <div className="form-group">
              <label>Email</label>
              <input type="email" name="email" />
            </div>
            <button type="submit">Crear</button>
          </form>
        </div>
      )}

      <table>
        <thead>
          <tr>
            <th>CUIT</th>
            <th>Nombre</th>
            <th>Email</th>
            <th>Acciones</th>
          </tr>
        </thead>
        <tbody>
          {customers.map((c: any) => (
            <tr key={c.id}>
              <td>{c.cuit}</td>
              <td>{c.name}</td>
              <td>{c.email}</td>
              <td>
                <button onClick={() => handleDelete(c.id)} style={{ background: '#d32f2f' }}>Eliminar</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
