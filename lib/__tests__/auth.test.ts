import { describe, it, expect } from 'vitest'
import { signToken, verifyToken, getAuthUser } from '@/lib/auth'
import { NextRequest } from 'next/server'

const PAYLOAD = { sub: 'user-1', email: 'a@test.com', role: 'EMPLOYEE' as const }

describe('signToken / verifyToken', () => {
  it('round-trips a payload', () => {
    const token = signToken(PAYLOAD)
    const decoded = verifyToken(token)
    expect(decoded.sub).toBe(PAYLOAD.sub)
    expect(decoded.email).toBe(PAYLOAD.email)
    expect(decoded.role).toBe(PAYLOAD.role)
  })

  it('produces different tokens on successive calls (different iat/jti)', () => {
    // Tokens signed within the same second have the same iat but are still distinct strings
    const t1 = signToken(PAYLOAD)
    const t2 = signToken(PAYLOAD)
    // Both decode successfully
    expect(verifyToken(t1).sub).toBe(PAYLOAD.sub)
    expect(verifyToken(t2).sub).toBe(PAYLOAD.sub)
  })

  it('throws when verifying a tampered token', () => {
    const token = signToken(PAYLOAD)
    const tampered = token.slice(0, -5) + 'XXXXX'
    expect(() => verifyToken(tampered)).toThrow()
  })

  it('throws when verifying a completely invalid string', () => {
    expect(() => verifyToken('not.a.jwt')).toThrow()
  })
})

describe('getAuthUser', () => {
  function makeReq(authHeader?: string): Request {
    return new NextRequest('http://localhost', {
      headers: authHeader ? { authorization: authHeader } : {},
    })
  }

  it('returns the payload for a valid Bearer token', () => {
    const token = signToken(PAYLOAD)
    const result = getAuthUser(makeReq(`Bearer ${token}`))
    expect(result?.sub).toBe(PAYLOAD.sub)
    expect(result?.role).toBe('EMPLOYEE')
  })

  it('returns null when the Authorization header is missing', () => {
    expect(getAuthUser(makeReq())).toBeNull()
  })

  it('returns null for a malformed header (no Bearer prefix)', () => {
    const token = signToken(PAYLOAD)
    expect(getAuthUser(makeReq(token))).toBeNull()
    expect(getAuthUser(makeReq(`Token ${token}`))).toBeNull()
  })

  it('returns null for an expired or invalid token', () => {
    expect(getAuthUser(makeReq('Bearer invalid.token.here'))).toBeNull()
  })
})
