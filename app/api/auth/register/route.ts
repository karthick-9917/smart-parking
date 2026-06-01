import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import bcrypt from 'bcrypt'
import { prisma } from '@/lib/prisma'
import { signToken } from '@/lib/auth'
import type { ApiError, ApiSuccess, AuthResponse } from '@/types'

const registerSchema = z.object({
  name: z.string().min(2).max(100),
  email: z.string().email(),
  password: z.string().min(8).max(100),
  employeeId: z.string().min(1).max(50),
  phone: z.string().optional(),
  department: z.string().optional(),
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

  const parsed = registerSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message ?? 'Invalid input' } },
      { status: 400 }
    )
  }

  const { name, email, password, employeeId, phone, department } = parsed.data

  const conflict = await prisma.user.findFirst({
    where: {
      OR: [
        { email },
        { employeeId },
        ...(phone ? [{ phone }] : []),
      ],
    },
    select: { email: true, employeeId: true, phone: true },
  })

  if (conflict) {
    if (conflict.email === email) {
      return NextResponse.json(
        { error: { code: 'EMAIL_TAKEN', message: 'Email is already registered' } },
        { status: 409 }
      )
    }
    if (conflict.employeeId === employeeId) {
      return NextResponse.json(
        { error: { code: 'EMPLOYEE_ID_TAKEN', message: 'Employee ID is already registered' } },
        { status: 409 }
      )
    }
    return NextResponse.json(
      { error: { code: 'PHONE_TAKEN', message: 'Phone number is already registered' } },
      { status: 409 }
    )
  }

  const passwordHash = await bcrypt.hash(password, 12)

  const user = await prisma.user.create({
    data: { name, email, passwordHash, employeeId, phone, department },
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

  const token = signToken({ sub: user.id, email: user.email, role: user.role })

  const response = NextResponse.json(
    { data: { user: { ...user, createdAt: user.createdAt.toISOString() }, token } },
    { status: 201 }
  )

  response.cookies.set('auth-token', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 24 * 7,
    path: '/',
  })

  return response
}
