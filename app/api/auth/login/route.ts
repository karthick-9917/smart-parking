import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import bcrypt from 'bcrypt'
import { prisma } from '@/lib/prisma'
import { signToken } from '@/lib/auth'
import type { ApiError, ApiSuccess, AuthResponse } from '@/types'

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

export async function POST(
  request: NextRequest
): Promise<NextResponse<ApiSuccess<AuthResponse> | ApiError>> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { error: { code: 'INVALID_JSON', message: 'Request body must be valid JSON' } },
      { status: 400 }
    )
  }

  const parsed = loginSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message ?? 'Invalid input' } },
      { status: 400 }
    )
  }

  const { email, password } = parsed.data

  const user = await prisma.user.findUnique({
    where: { email },
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
      passwordHash: true,
    },
  })

  // Constant-time guard: always compare even when user is missing
  const dummyHash = '$2b$12$invalidhashfortimingprotection000000000000000000000000'
  const hashToCompare = user?.passwordHash ?? dummyHash

  const passwordValid = await bcrypt.compare(password, hashToCompare)

  if (!user || !user.passwordHash || !passwordValid) {
    return NextResponse.json(
      { error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' } },
      { status: 401 }
    )
  }

  if (!user.isActive) {
    return NextResponse.json(
      { error: { code: 'ACCOUNT_INACTIVE', message: 'Account has been deactivated' } },
      { status: 403 }
    )
  }

  const { passwordHash: _omit, ...userWithoutHash } = user

  const token = signToken({ sub: user.id, email: user.email, role: user.role })

  await prisma.auditLog.create({
    data: {
      action: 'USER_LOGIN',
      userId: user.id,
      metadata: { email: user.email },
    },
  })

  return NextResponse.json({
    data: {
      user: { ...userWithoutHash, createdAt: userWithoutHash.createdAt.toISOString() },
      token,
    },
  })
}
