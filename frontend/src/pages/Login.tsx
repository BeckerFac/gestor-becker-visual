import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../services/api'

export default function Login() {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const navigate = useNavigate()

  const handleLogin = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const email = (e.currentTarget.elements.namedItem('email') as HTMLInputElement).value
      const password = (e.currentTarget.elements.namedItem('password') as HTMLInputElement).value
      const res = await api.login(email, password)
      localStorage.setItem('accessToken', res.data.accessToken)
      navigate('/dashboard')
    } catch (err: any) {
      setError(err.response?.data?.error || 'Error en login')
    } finally {
      setLoading(false)
    }
  }

  const handleRegister = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const email = (e.currentTarget.elements.namedItem('email') as HTMLInputElement).value
      const password = (e.currentTarget.elements.namedItem('password') as HTMLInputElement).value
      const name = (e.currentTarget.elements.namedItem('name') as HTMLInputElement).value
      const company_name = (e.currentTarget.elements.namedItem('company_name') as HTMLInputElement).value
      const cuit = (e.currentTarget.elements.namedItem('cuit') as HTMLInputElement).value
      const res = await api.register(email, password, name, company_name, cuit)
      localStorage.setItem('accessToken', res.data.accessToken)
      navigate('/dashboard')
    } catch (err: any) {
      setError(err.response?.data?.error || 'Error en registro')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="container" style={{ maxWidth: '400px', marginTop: '50px' }}>
      <div className="form">
        <h2>{mode === 'login' ? 'Iniciar Sesión' : 'Registrarse'}</h2>
        {error && <p className="error">{error}</p>}
        <form onSubmit={mode === 'login' ? handleLogin : handleRegister}>
          <div className="form-group">
            <label>Email</label>
            <input type="email" name="email" required />
          </div>
          <div className="form-group">
            <label>Contraseña</label>
            <input type="password" name="password" required />
          </div>
          {mode === 'register' && (
            <>
              <div className="form-group">
                <label>Nombre</label>
                <input type="text" name="name" required />
              </div>
              <div className="form-group">
                <label>Empresa</label>
                <input type="text" name="company_name" required />
              </div>
              <div className="form-group">
                <label>CUIT</label>
                <input type="text" name="cuit" required />
              </div>
            </>
          )}
          <button type="submit" disabled={loading}>{loading ? 'Cargando...' : (mode === 'login' ? 'Entrar' : 'Registrarse')}</button>
        </form>
        <p style={{ marginTop: '15px' }}>
          {mode === 'login' ? '¿No tienes cuenta?' : '¿Ya tienes cuenta?'}
          {' '}
          <a href="#" onClick={() => setMode(mode === 'login' ? 'register' : 'login')} style={{ color: '#0066cc' }}>
            {mode === 'login' ? 'Registrate' : 'Inicia sesión'}
          </a>
        </p>
      </div>
    </div>
  )
}
