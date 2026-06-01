import { describe, it, expect } from 'vitest'
import { POST } from '@/app/api/auth/register/route'
import { makeRequest, createUser } from '@/tests/helpers'
import { prisma } from '@/lib/prisma'

function registerBody(overrides?: Record<string, unknown>) {
  return {
    name: 'Alice Tester',
    email: 'alice@test.com',
    password: 'password123',
    employeeId: 'EMP-ALICE',
    ...overrides,
  }
}

describe('POST /api/auth/register', () => {
  // ── Happy path ──────────────────────────────────────────────────────────────

  it('creates a user and returns 201 with JWT + user object', async () => {
    const req = makeRequest('/api/auth/register', { method: 'POST', body: registerBody() })
    const res = await POST(req)
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(body.data.token).toMatch(/^eyJ/)
    expect(body.data.user.email).toBe('alice@test.com')
    expect(body.data.user.role).toBe('EMPLOYEE')
    expect(body.data.user.isActive).toBe(true)
  })

  it('never exposes passwordHash in the response', async () => {
    const req = makeRequest('/api/auth/register', { method: 'POST', body: registerBody() })
    const body = await (await POST(req)).json()
    expect(body.data.user).not.toHaveProperty('passwordHash')
  })

  it('persists the user with a bcrypt hash, not plaintext', async () => {
    const req = makeRequest('/api/auth/register', { method: 'POST', body: registerBody() })
    await POST(req)
    const user = await prisma.user.findUnique({ where: { email: 'alice@test.com' } })
    expect(user?.passwordHash).toBeTruthy()
    expect(user?.passwordHash).toMatch(/^\$2[ab]\$/)
    expect(user?.passwordHash).not.toBe('password123')
  })

  it('assigns EMPLOYEE role by default', async () => {
    const req = makeRequest('/api/auth/register', { method: 'POST', body: registerBody() })
    const body = await (await POST(req)).json()
    expect(body.data.user.role).toBe('EMPLOYEE')
  })

  // ── Validation ──────────────────────────────────────────────────────────────

  it('rejects missing name → 400', async () => {
    const req = makeRequest('/api/auth/register', {
      method: 'POST',
      body: registerBody({ name: undefined }),
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error.code).toBe('VALIDATION_ERROR')
  })

  it('rejects invalid email → 400', async () => {
    const req = makeRequest('/api/auth/register', {
      method: 'POST',
      body: registerBody({ email: 'not-an-email' }),
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('rejects password shorter than 8 chars → 400', async () => {
    const req = makeRequest('/api/auth/register', {
      method: 'POST',
      body: registerBody({ password: 'short' }),
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('rejects name shorter than 2 chars → 400', async () => {
    const req = makeRequest('/api/auth/register', {
      method: 'POST',
      body: registerBody({ name: 'X' }),
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('rejects malformed JSON body → 400', async () => {
    const req = new Request('http://localhost/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{invalid json}',
    })
    const { NextRequest } = await import('next/server')
    const res = await POST(new NextRequest(req))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error.code).toBe('INVALID_JSON')
  })

  // ── Conflicts ───────────────────────────────────────────────────────────────

  it('rejects duplicate email → 409 EMAIL_TAKEN', async () => {
    await createUser({ email: 'alice@test.com', employeeId: 'EMP-OTHER' })
    const req = makeRequest('/api/auth/register', { method: 'POST', body: registerBody() })
    const res = await POST(req)
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error.code).toBe('EMAIL_TAKEN')
  })

  it('rejects duplicate employeeId → 409 EMPLOYEE_ID_TAKEN', async () => {
    await createUser({ email: 'other@test.com', employeeId: 'EMP-ALICE' })
    const req = makeRequest('/api/auth/register', { method: 'POST', body: registerBody() })
    const res = await POST(req)
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error.code).toBe('EMPLOYEE_ID_TAKEN')
  })

  it('rejects duplicate phone → 409 PHONE_TAKEN', async () => {
    await createUser({ phone: '+919999999999' })
    const req = makeRequest('/api/auth/register', {
      method: 'POST',
      body: registerBody({ phone: '+919999999999' }),
    })
    const res = await POST(req)
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error.code).toBe('PHONE_TAKEN')
  })
})
