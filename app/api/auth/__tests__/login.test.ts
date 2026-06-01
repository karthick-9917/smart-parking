import { describe, it, expect } from 'vitest'
import { POST } from '@/app/api/auth/login/route'
import { makeRequest, createUser } from '@/tests/helpers'
import { prisma } from '@/lib/prisma'

describe('POST /api/auth/login', () => {
  // ── Happy path ──────────────────────────────────────────────────────────────

  it('returns 200 with token and user when credentials are correct', async () => {
    await createUser({ email: 'bob@test.com', password: 'secret123!' })

    const req = makeRequest('/api/auth/login', {
      method: 'POST',
      body: { email: 'bob@test.com', password: 'secret123!' },
    })
    const res = await POST(req)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.token).toMatch(/^eyJ/)
    expect(body.data.user.email).toBe('bob@test.com')
  })

  it('writes an audit log on successful login', async () => {
    const user = await createUser({ email: 'audit@test.com', password: 'pass1234' })
    await POST(makeRequest('/api/auth/login', {
      method: 'POST',
      body: { email: 'audit@test.com', password: 'pass1234' },
    }))
    const log = await prisma.auditLog.findFirst({ where: { userId: user.id, action: 'USER_LOGIN' } })
    expect(log).toBeTruthy()
  })

  it('never returns passwordHash in the response', async () => {
    await createUser({ email: 'nohash@test.com', password: 'pass1234' })
    const body = await (await POST(makeRequest('/api/auth/login', {
      method: 'POST',
      body: { email: 'nohash@test.com', password: 'pass1234' },
    }))).json()
    expect(body.data.user).not.toHaveProperty('passwordHash')
  })

  // ── Validation ──────────────────────────────────────────────────────────────

  it('rejects invalid email format → 400', async () => {
    const res = await POST(makeRequest('/api/auth/login', {
      method: 'POST',
      body: { email: 'not-email', password: 'pass1234' },
    }))
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('VALIDATION_ERROR')
  })

  it('rejects empty password → 400', async () => {
    const res = await POST(makeRequest('/api/auth/login', {
      method: 'POST',
      body: { email: 'user@test.com', password: '' },
    }))
    expect(res.status).toBe(400)
  })

  // ── Wrong credentials ───────────────────────────────────────────────────────

  it('rejects wrong password → 401 INVALID_CREDENTIALS', async () => {
    await createUser({ email: 'c@test.com', password: 'correct123' })
    const res = await POST(makeRequest('/api/auth/login', {
      method: 'POST',
      body: { email: 'c@test.com', password: 'WRONG' },
    }))
    expect(res.status).toBe(401)
    expect((await res.json()).error.code).toBe('INVALID_CREDENTIALS')
  })

  it('rejects non-existent email → 401 (same code, no user enumeration)', async () => {
    const res = await POST(makeRequest('/api/auth/login', {
      method: 'POST',
      body: { email: 'ghost@test.com', password: 'anypassword' },
    }))
    expect(res.status).toBe(401)
    expect((await res.json()).error.code).toBe('INVALID_CREDENTIALS')
  })

  it('rejects a user with no password (e.g. OTP-only seed user) → 401', async () => {
    // Create user without passwordHash
    await prisma.user.create({
      data: {
        email: 'nopw@test.com',
        name: 'No PW',
        employeeId: 'EMP-NOPW',
        role: 'EMPLOYEE',
        isActive: true,
      },
    })
    const res = await POST(makeRequest('/api/auth/login', {
      method: 'POST',
      body: { email: 'nopw@test.com', password: 'anypassword' },
    }))
    expect(res.status).toBe(401)
  })

  // ── Edge cases ──────────────────────────────────────────────────────────────

  it('returns 403 ACCOUNT_INACTIVE for a deactivated user', async () => {
    await createUser({ email: 'inactive@test.com', password: 'pass1234', isActive: false })
    const res = await POST(makeRequest('/api/auth/login', {
      method: 'POST',
      body: { email: 'inactive@test.com', password: 'pass1234' },
    }))
    expect(res.status).toBe(403)
    expect((await res.json()).error.code).toBe('ACCOUNT_INACTIVE')
  })
})
