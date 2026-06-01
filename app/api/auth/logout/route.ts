import { NextResponse } from 'next/server'
import type { ApiSuccess } from '@/types'

export async function POST(): Promise<NextResponse<ApiSuccess<{ success: boolean }>>> {
  const response = NextResponse.json({ data: { success: true } })
  response.cookies.set('auth-token', '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 0,
    path: '/',
  })
  return response
}
