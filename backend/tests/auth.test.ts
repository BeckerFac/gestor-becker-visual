import { describe, it, expect } from 'vitest'
import request from 'supertest'
import app from '../src/app'

describe('Auth Endpoints', () => {
  it('POST /auth/register - creates user', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({
        email: 'newuser@test.com',
        password: 'test123',
        name: 'New User',
        company_name: 'New Company',
        cuit: '20987654321'
      })
    expect(res.status).toBe(201)
    expect(res.body.accessToken).toBeDefined()
  })

  it('POST /auth/login - authenticates user', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'test@test.com',
        password: 'test123'
      })
    expect(res.status).toBe(200)
    expect(res.body.accessToken).toBeDefined()
  })

  it('GET /health - returns status', async () => {
    const res = await request(app).get('/health')
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('ok')
  })
})
