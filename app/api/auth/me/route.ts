import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'
import { verifyToken } from '@/lib/auth'
import type { ApiError, ApiSuccess, UserResponse } from '@/types'

export async function GET(): Promise<NextResponse<ApiSuccess<{ user: UserResponse }> | ApiError>> {
  const cookieStore = await cookies()
  const token = cookieStore.get('auth-token')?.value

  if (!token) {
    return NextResponse.json(
      { error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } },
      { status: 401 }
    )
  }

  let payload: ReturnType<typeof verifyToken>
  try {
    payload = verifyToken(token)
  } catch {
    return NextResponse.json(
      { error: { code: 'UNAUTHORIZED', message: 'Invalid or expired session' } },
      { status: 401 }
    )
  }

  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    select: {
      id: true,
      email: true,
      name: true,
      phone: true,
      role: true,
      employeeId: true,
      department: true,
      isActive: true,
      createdAt: true,
    },
  })

  if (!user || !user.isActive) {
    return NextResponse.json(
      { error: { code: 'UNAUTHORIZED', message: 'Account not found or inactive' } },
      { status: 401 }
    )
  }

  return NextResponse.json({
    data: { user: { ...user, createdAt: user.createdAt.toISOString() } },
  })
}
