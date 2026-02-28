import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../services/api'

export default function Dashboard() {
  const [user, setUser] = useState<any>(null)
  const navigate = useNavigate()

  useEffect(() => {
    api.getMe()
      .then(res => setUser(res.data.user))
      .catch(() => navigate('/'))
  }, [])

  const logout = () => {
    localStorage.removeItem('accessToken')
    navigate('/')
  }

  if (!user) return <div>Cargando...</div>

  return (
    <div className="container">
      <div className="header">
        <h1>Gestor BeckerVisual</h1>
        <p>Bienvenido, {user.name}</p>
        <div className="nav">
          <a href="/products">Productos</a>
          <a href="/customers">Clientes</a>
          <a href="/invoices">Facturas</a>
          <button onClick={logout} style={{ marginLeft: 'auto' }}>Logout</button>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '20px' }}>
        <div className="form">
          <h3>📊 KPIs</h3>
          <p>Ventas hoy: $0</p>
          <p>Facturas pendientes: 0</p>
          <p>Clientes: 0</p>
        </div>
      </div>
    </div>
  )
}
