import { NextRequest } from 'next/server'
import bcrypt from 'bcrypt'
import { prisma } from '@/lib/prisma'
import { signToken } from '@/lib/auth'
import { hashOtp, otpExpiresAt, OTP_MAX_ATTEMPTS } from '@/lib/otp'
import type { Role, SlotStatus } from '@prisma/client'

// ─── Request factory ──────────────────────────────────────────────────────────

export function makeRequest(
  url: string,
  options?: {
    method?: string
    body?: unknown
    headers?: Record<string, string>
    searchParams?: Record<string, string>
  }
): NextRequest {
  const fullUrl = new URL(url, 'http://localhost:3000')
  if (options?.searchParams) {
    for (const [k, v] of Object.entries(options.searchParams)) {
      fullUrl.searchParams.set(k, v)
    }
  }
  return new NextRequest(fullUrl.toString(), {
    method: options?.method ?? 'GET',
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    body: options?.body !== undefined ? JSON.stringify(options.body) : undefined,
  })
}

// Wraps a dynamic segment so route handlers receive params as a Promise
export function routeParams<T extends Record<string, string>>(params: T): { params: Promise<T> } {
  return { params: Promise.resolve(params) }
}

// ─── Auth helpers ─────────────────────────────────────────────────────────────

export function makeToken(userId: string, email: string, role: Role = 'EMPLOYEE'): string {
  return signToken({ sub: userId, email, role })
}

export function bearer(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` }
}

// ─── Seed factories ───────────────────────────────────────────────────────────

// Low bcrypt cost for speed; the production value (12) is tested via the register route.
const TEST_BCRYPT_ROUNDS = 4

export async function createUser(overrides?: {
  email?: string
  employeeId?: string
  name?: string
  role?: Role
  password?: string
  isActive?: boolean
  phone?: string
}) {
  const uid = Math.random().toString(36).slice(2, 10)
  const passwordHash = await bcrypt.hash(overrides?.password ?? 'password123', TEST_BCRYPT_ROUNDS)
  return prisma.user.create({
    data: {
      email: overrides?.email ?? `user-${uid}@test.com`,
      name: overrides?.name ?? `Test User ${uid}`,
      employeeId: overrides?.employeeId ?? `EMP-${uid}`,
      role: overrides?.role ?? 'EMPLOYEE',
      phone: overrides?.phone,
      passwordHash,
      isActive: overrides?.isActive ?? true,
    },
  })
}

export async function createFloor(overrides?: { name?: string; level?: number; isActive?: boolean }) {
  const n = Math.floor(Math.random() * 9000) + 1000
  return prisma.parkingFloor.create({
    data: {
      name: overrides?.name ?? `Floor ${n}`,
      level: overrides?.level ?? n,
      isActive: overrides?.isActive ?? true,
      totalSlots: 0,
    },
  })
}

export async function createSlot(
  floorId: string,
  overrides?: { label?: string; zone?: string; status?: SlotStatus; row?: number; column?: number }
) {
  const n = Math.floor(Math.random() * 9000) + 1000
  return prisma.parkingSlot.create({
    data: {
      floorId,
      label: overrides?.label ?? `S-${n}`,
      zone: overrides?.zone ?? 'A',
      row: overrides?.row ?? n,
      column: overrides?.column ?? 1,
      status: overrides?.status ?? 'AVAILABLE',
    },
  })
}

export async function createBookingWithOtp(
  userId: string,
  slotId: string,
  {
    date,
    startTime,
    endTime,
    otp = '123456',
    expiresAt,
    isLocked = false,
    attempts = 0,
  }: {
    date?: string
    startTime?: string
    endTime?: string
    otp?: string
    expiresAt?: Date
    isLocked?: boolean
    attempts?: number
  } = {}
) {
  const d = date ?? futureDate()
  const st = new Date(`${d}T${startTime ?? '09:00'}:00.000Z`)
  const et = new Date(`${d}T${endTime ?? '17:00'}:00.000Z`)
  const dateObj = new Date(`${d}T00:00:00.000Z`)

  const booking = await prisma.booking.create({
    data: {
      userId,
      slotId,
      date: dateObj,
      startTime: st,
      endTime: et,
      status: 'PENDING_OTP',
    },
  })

  await prisma.otpVerification.create({
    data: {
      userId,
      bookingId: booking.id,
      purpose: 'BOOKING_CONFIRM',
      otpHash: await hashOtp(otp),
      expiresAt: expiresAt ?? otpExpiresAt(),
      deliveredTo: 'test@test.com',
      maxAttempts: OTP_MAX_ATTEMPTS,
      attempts,
      isLocked,
    },
  })

  await prisma.parkingSlot.update({ where: { id: slotId }, data: { status: 'RESERVED' } })

  return booking
}

// ─── Date utilities ───────────────────────────────────────────────────────────

export function futureDate(daysAhead = 1): string {
  const d = new Date()
  d.setDate(d.getDate() + daysAhead)
  return d.toISOString().slice(0, 10)
}

export function expiredDate(): Date {
  return new Date(Date.now() - 1000)
}
