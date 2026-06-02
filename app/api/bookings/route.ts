import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { Prisma } from '.prisma/client'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { broadcastSlotUpdate } from '@/lib/realtime'
import { toUtcDate, toUtcDateTime } from '@/lib/slot'
import { generateOtp, hashOtp, otpExpiresAt, OTP_MAX_ATTEMPTS } from '@/lib/otp'
import type { ApiError, ApiSuccess, BookingItem, CreateBookingResponse } from '@/types'

// ─── GET /api/bookings ────────────────────────────────────────────────────────
// Returns the authenticated user's bookings, newest first.
// Query: status, date (YYYY-MM-DD), page, limit

const listQuerySchema = z.object({
  status: z.enum(['PENDING_OTP', 'CONFIRMED', 'CANCELLED', 'EXPIRED', 'NO_SHOW']).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})

export async function GET(
  request: NextRequest
): Promise<NextResponse<ApiSuccess<{ bookings: BookingItem[]; total: number }> | ApiError>> {
  const user = getAuthUser(request)
  if (!user) {
    return NextResponse.json(
      { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } },
      { status: 401 }
    )
  }

  const parsed = listQuerySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams))
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message ?? 'Invalid query' } },
      { status: 400 }
    )
  }

  const { status, date, page, limit } = parsed.data
  const skip = (page - 1) * limit

  const where = {
    userId: user.sub,
    ...(status && { status }),
    ...(date && { date: toUtcDate(date) }),
  }

  type BookingRow = {
    id: string
    date: Date
    startTime: Date
    endTime: Date
    status: string
    vehicleNumber: string | null
    confirmedAt: Date | null
    cancelledAt: Date | null
    createdAt: Date
    slot: {
      id: string
      label: string
      zone: string
      isEVCharging: boolean
      isHandicap: boolean
      floor: { id: string; name: string; level: number }
    }
  }

  const [bookings, total] = await prisma.$transaction([
    prisma.booking.findMany({
      where,
      orderBy: [{ date: 'desc' }, { startTime: 'desc' }],
      skip,
      take: limit,
      select: {
        id: true,
        date: true,
        startTime: true,
        endTime: true,
        status: true,
        vehicleNumber: true,
        confirmedAt: true,
        cancelledAt: true,
        createdAt: true,
        slot: {
          select: {
            id: true,
            label: true,
            zone: true,
            isEVCharging: true,
            isHandicap: true,
            floor: { select: { id: true, name: true, level: true } },
          },
        },
      },
    }),
    prisma.booking.count({ where }),
  ])

  return NextResponse.json({
    data: {
      bookings: (bookings as BookingRow[]).map(b => ({
        ...b,
        status: b.status as BookingItem['status'],
        date: b.date.toISOString().slice(0, 10),
        startTime: b.startTime.toISOString(),
        endTime: b.endTime.toISOString(),
        confirmedAt: b.confirmedAt?.toISOString() ?? null,
        cancelledAt: b.cancelledAt?.toISOString() ?? null,
        createdAt: b.createdAt.toISOString(),
      })),
      total,
    },
  })
}

// ─── POST /api/bookings ───────────────────────────────────────────────────────
// Creates a booking (PENDING_OTP) + OTP record atomically.
// Prevents double-booking via overlap check + DB unique constraint.
// Returns otpCode in non-production for testing.

const createSchema = z
  .object({
    slotId: z.string().min(1),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD'),
    startTime: z.string().regex(/^\d{2}:\d{2}$/, 'startTime must be HH:MM'),
    endTime: z.string().regex(/^\d{2}:\d{2}$/, 'endTime must be HH:MM'),
    vehicleId: z.string().optional(),
    vehicleNumber: z.string().max(20).optional(),
  })
  .refine(d => d.startTime < d.endTime, {
    message: 'startTime must be before endTime',
    path: ['endTime'],
  })

export async function POST(
  request: NextRequest
): Promise<NextResponse<ApiSuccess<CreateBookingResponse> | ApiError>> {
  const user = getAuthUser(request)
  if (!user) {
    return NextResponse.json(
      { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } },
      { status: 401 }
    )
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { error: { code: 'INVALID_JSON', message: 'Request body must be valid JSON' } },
      { status: 400 }
    )
  }

  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message ?? 'Invalid input' } },
      { status: 400 }
    )
  }

  const { slotId, date, startTime, endTime, vehicleId, vehicleNumber } = parsed.data
  const dateObj = toUtcDate(date)
  const startTimeObj = toUtcDateTime(date, startTime)
  const endTimeObj = toUtcDateTime(date, endTime)

  // Generate OTP before the transaction — bcrypt is CPU-bound; keep the DB round-trip fast
  const otpCode = generateOtp()
  const otpHash = await hashOtp(otpCode)
  const expiresAt = otpExpiresAt()

  const ip = request.headers.get('x-forwarded-for') ?? request.headers.get('x-real-ip') ?? undefined
  const ua = request.headers.get('user-agent') ?? undefined

  try {
    const { bookingId, slot } = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // ── 1. Slot guard ───────────────────────────────────────────────────────
      const slot = await tx.parkingSlot.findUnique({
        where: { id: slotId },
        select: { id: true, status: true, floorId: true, label: true },
      })
      if (!slot) {
        throw Object.assign(new Error('Slot not found'), { code: 'NOT_FOUND' })
      }
      if (slot.status === 'MAINTENANCE') {
        throw Object.assign(new Error('Slot is under maintenance'), { code: 'SLOT_UNAVAILABLE' })
      }
      if (slot.status === 'OCCUPIED') {
        throw Object.assign(new Error('Slot is currently occupied'), { code: 'SLOT_CONFLICT' })
      }

      // ── 2. Vehicle ownership guard (if vehicleId supplied) ──────────────────
      if (vehicleId) {
        const vehicle = await tx.vehicle.findFirst({
          where: { id: vehicleId, userId: user.sub },
          select: { id: true },
        })
        if (!vehicle) {
          throw Object.assign(new Error('Vehicle not found'), { code: 'VEHICLE_NOT_FOUND' })
        }
      }

      // ── 3. Double-booking check ─────────────────────────────────────────────
      // Any PENDING_OTP or CONFIRMED booking whose time window overlaps ours is a conflict.
      const conflict = await tx.booking.findFirst({
        where: {
          slotId,
          date: dateObj,
          status: { in: ['PENDING_OTP', 'CONFIRMED'] },
          startTime: { lt: endTimeObj },
          endTime: { gt: startTimeObj },
        },
        select: { id: true },
      })
      if (conflict) {
        throw Object.assign(
          new Error('Slot is already booked for this time window'),
          { code: 'SLOT_CONFLICT' }
        )
      }

      // ── 4. Create booking ───────────────────────────────────────────────────
      const booking = await tx.booking.create({
        data: {
          userId: user.sub,
          slotId,
          vehicleId: vehicleId ?? null,
          vehicleNumber: vehicleNumber ?? null,
          date: dateObj,
          startTime: startTimeObj,
          endTime: endTimeObj,
          status: 'PENDING_OTP',
        },
        select: { id: true },
      })

      // ── 5. Store OTP (hash only — plaintext never persisted) ────────────────
      await tx.otpVerification.create({
        data: {
          userId: user.sub,
          bookingId: booking.id,
          purpose: 'BOOKING_CONFIRM',
          otpHash,
          expiresAt,
          deliveredTo: user.email,
          maxAttempts: OTP_MAX_ATTEMPTS,
        },
      })

      // ── 6. Reserve slot ─────────────────────────────────────────────────────
      await tx.parkingSlot.update({
        where: { id: slotId },
        data: { status: 'RESERVED' },
      })

      // ── 7. Audit ────────────────────────────────────────────────────────────
      await tx.auditLog.create({
        data: {
          action: 'BOOKING_CREATED',
          userId: user.sub,
          bookingId: booking.id,
          slotId,
          metadata: { date, startTime, endTime },
          ipAddress: ip,
          userAgent: ua,
        },
      })

      return { bookingId: booking.id, slot }
    })

    // Broadcast outside the transaction — failure here is non-fatal
    await broadcastSlotUpdate({
      slotId,
      floorId: slot.floorId,
      label: slot.label,
      status: 'RESERVED',
      isAvailable: false,
    })

    return NextResponse.json(
      {
        data: {
          bookingId,
          status: 'PENDING_OTP',
          otpExpiresAt: expiresAt.toISOString(),
          ...(process.env.NODE_ENV !== 'production' && { otpCode }),
        },
      },
      { status: 201 }
    )
  } catch (err) {
    if (err instanceof Error && 'code' in err) {
      const c = (err as Error & { code: string }).code
      if (c === 'NOT_FOUND' || c === 'VEHICLE_NOT_FOUND') {
        return NextResponse.json({ error: { code: c, message: err.message } }, { status: 404 })
      }
      if (c === 'SLOT_CONFLICT' || c === 'SLOT_UNAVAILABLE') {
        return NextResponse.json({ error: { code: c, message: err.message } }, { status: 409 })
      }
    }
    // DB unique constraint race — last-microsecond concurrent booking for the exact same window
    if (err instanceof Error && (err as unknown as { code?: string }).code === 'P2002') {
      return NextResponse.json(
        { error: { code: 'SLOT_CONFLICT', message: 'Slot was just taken — please choose another' } },
        { status: 409 }
      )
    }
    throw err
  }
}
