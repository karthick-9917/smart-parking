import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { Prisma } from '.prisma/client'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { broadcastSlotUpdate } from '@/lib/realtime'
import { toUtcDate, toUtcDateTime } from '@/lib/slot'
import type { ApiError, ApiSuccess, LockResponse } from '@/types'

const lockSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD'),
  startTime: z.string().regex(/^\d{2}:\d{2}$/, 'startTime must be HH:MM'),
  endTime: z.string().regex(/^\d{2}:\d{2}$/, 'endTime must be HH:MM'),
  vehicleId: z.string().optional(),
  vehicleNumber: z.string().optional(),
}).refine(d => d.startTime < d.endTime, {
  message: 'startTime must be before endTime',
  path: ['endTime'],
})

const unlockSchema = z.object({
  bookingId: z.string().min(1),
})

// POST /api/slots/[slotId]/lock
// Creates a PENDING_OTP booking and marks the slot RESERVED atomically.
// Returns the bookingId so the client can proceed to OTP confirmation.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slotId: string }> }
): Promise<NextResponse<ApiSuccess<LockResponse> | ApiError>> {
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

  const parsed = lockSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message ?? 'Invalid input' } },
      { status: 400 }
    )
  }

  const { date, startTime, endTime, vehicleId, vehicleNumber } = parsed.data
  const { slotId } = await params

  const dateObj = toUtcDate(date)
  const startTimeObj = toUtcDateTime(date, startTime)
  const endTimeObj = toUtcDateTime(date, endTime)

  try {
    const { booking, slot } = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // 1. Verify slot exists and is physically AVAILABLE
      const slot = await tx.parkingSlot.findUnique({
        where: { id: slotId },
        select: { id: true, status: true, floorId: true, label: true, zone: true },
      })

      if (!slot) {
        throw Object.assign(new Error('Slot not found'), { code: 'NOT_FOUND' })
      }
      if (slot.status === 'MAINTENANCE') {
        throw Object.assign(new Error('Slot is under maintenance'), { code: 'SLOT_UNAVAILABLE' })
      }
      if (slot.status === 'OCCUPIED') {
        throw Object.assign(new Error('Slot is already occupied'), { code: 'SLOT_CONFLICT' })
      }

      // 2. Check for any overlapping active bookings in this time window
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
        throw Object.assign(new Error('Slot is already booked for this time window'), { code: 'SLOT_CONFLICT' })
      }

      // 3. Create the provisional booking
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

      // 4. Mark the slot as RESERVED
      await tx.parkingSlot.update({
        where: { id: slotId },
        data: { status: 'RESERVED' },
      })

      return { booking, slot }
    })

    // Broadcast outside the transaction — non-critical
    await broadcastSlotUpdate({
      slotId,
      floorId: slot.floorId,
      label: slot.label,
      status: 'RESERVED',
      isAvailable: false,
    })

    return NextResponse.json(
      { data: { bookingId: booking.id, slotId, date, startTime, endTime } },
      { status: 201 }
    )
  } catch (err) {
    // Custom domain errors thrown inside the transaction
    if (err instanceof Error && 'code' in err) {
      const domainCode = (err as Error & { code: string }).code
      if (domainCode === 'NOT_FOUND') {
        return NextResponse.json({ error: { code: 'NOT_FOUND', message: err.message } }, { status: 404 })
      }
      if (domainCode === 'SLOT_CONFLICT' || domainCode === 'SLOT_UNAVAILABLE') {
        return NextResponse.json({ error: { code: domainCode, message: err.message } }, { status: 409 })
      }
    }
    // Unique constraint race: another request won the same exact time window
    if (err instanceof Error && (err as unknown as { code?: string }).code === 'P2002') {
      return NextResponse.json(
        { error: { code: 'SLOT_CONFLICT', message: 'Slot was just taken — please choose another' } },
        { status: 409 }
      )
    }
    throw err
  }
}

// DELETE /api/slots/[slotId]/lock
// Cancels a PENDING_OTP booking and releases the slot back to AVAILABLE.
// Only the booking owner can release their own lock.
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ slotId: string }> }
): Promise<NextResponse<ApiSuccess<{ released: true }> | ApiError>> {
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

  const parsed = unlockSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message ?? 'bookingId is required' } },
      { status: 400 }
    )
  }

  const { bookingId } = parsed.data
  const { slotId } = await params

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: {
      id: true,
      userId: true,
      slotId: true,
      status: true,
      slot: { select: { floorId: true, label: true } },
    },
  })

  if (!booking || booking.slotId !== slotId) {
    return NextResponse.json(
      { error: { code: 'NOT_FOUND', message: 'Booking not found for this slot' } },
      { status: 404 }
    )
  }
  if (booking.userId !== user.sub) {
    return NextResponse.json(
      { error: { code: 'FORBIDDEN', message: 'You do not own this booking' } },
      { status: 403 }
    )
  }
  if (booking.status !== 'PENDING_OTP') {
    return NextResponse.json(
      { error: { code: 'INVALID_STATE', message: `Cannot release a booking in ${booking.status} state` } },
      { status: 409 }
    )
  }

  await prisma.$transaction([
    prisma.booking.update({
      where: { id: bookingId },
      data: { status: 'CANCELLED', cancelledAt: new Date(), cancelledBy: user.sub },
    }),
    prisma.parkingSlot.update({
      where: { id: slotId },
      data: { status: 'AVAILABLE' },
    }),
  ])

  await broadcastSlotUpdate({
    slotId,
    floorId: booking.slot.floorId,
    label: booking.slot.label,
    status: 'AVAILABLE',
    isAvailable: true,
  })

  return NextResponse.json({ data: { released: true } })
}
