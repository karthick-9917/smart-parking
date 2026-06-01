import jwt from 'jsonwebtoken'
import type { AuthTokenPayload } from '@/types'

const secret = process.env.JWT_SECRET
const expiresIn = (process.env.JWT_EXPIRES_IN ?? '7d') as jwt.SignOptions['expiresIn']

export function signToken(payload: AuthTokenPayload): string {
  if (!secret) throw new Error('JWT_SECRET is not set')
  return jwt.sign(payload, secret, { expiresIn })
}

export function verifyToken(token: string): AuthTokenPayload {
  if (!secret) throw new Error('JWT_SECRET is not set')
  return jwt.verify(token, secret) as AuthTokenPayload
}

export function getAuthUser(request: Request): AuthTokenPayload | null {
  const auth = request.headers.get('authorization')
  if (!auth?.startsWith('Bearer ')) return null
  try {
    return verifyToken(auth.slice(7))
  } catch {
    return null
  }
}
