import { type NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { broadcastSlotUpdate } from '@/lib/realtime'
import type { ApiError, ApiSuccess, BookingDetail } from '@/types'

type RouteContext = { params: Promise<{ bookingId: string }> }

// ─── GET /api/bookings/[bookingId] ────────────────────────────────────────────
// Returns full booking detail including OTP status (no hash).

export async function GET(
  request: NextRequest,
  { params }: RouteContext
): Promise<NextResponse<ApiSuccess<BookingDetail> | ApiError>> {
  const user = getAuthUser(request)
  if (!user) {
    return NextResponse.json(
      { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } },
      { status: 401 }
    )
  }

  const { bookingId } = await params

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: {
      id: true,
      userId: true,
      vehicleId: true,
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
      otpVerification: {
        select: {
          expiresAt: true,
          isLocked: true,
          attempts: true,
          maxAttempts: true,
          verifiedAt: true,
        },
      },
    },
  })

  if (!booking) {
    return NextResponse.json(
      { error: { code: 'NOT_FOUND', message: 'Booking not found' } },
      { status: 404 }
    )
  }

  // Employees can only see their own bookings; admins can see any
  if (booking.userId !== user.sub && user.role !== 'ADMIN') {
    return NextResponse.json(
      { error: { code: 'FORBIDDEN', message: 'Access denied' } },
      { status: 403 }
    )
  }

  const otp = booking.otpVerification
  return NextResponse.json({
    data: {
      id: booking.id,
      userId: booking.userId,
      vehicleId: booking.vehicleId,
      date: booking.date.toISOString().slice(0, 10),
      startTime: booking.startTime.toISOString(),
      endTime: booking.endTime.toISOString(),
      status: booking.status as BookingDetail['status'],
      vehicleNumber: booking.vehicleNumber,
      confirmedAt: booking.confirmedAt?.toISOString() ?? null,
      cancelledAt: booking.cancelledAt?.toISOString() ?? null,
      createdAt: booking.createdAt.toISOString(),
      slot: booking.slot,
      otp: otp
        ? {
            expiresAt: otp.expiresAt.toISOString(),
            isLocked: otp.isLocked,
            attemptsRemaining: otp.maxAttempts - otp.attempts,
            verifiedAt: otp.verifiedAt?.toISOString() ?? null,
          }
        : null,
    },
  })
}

// ─── DELETE /api/bookings/[bookingId] ─────────────────────────────────────────
// Cancels a PENDING_OTP or CONFIRMED booking and releases the slot.
// Employees can cancel their own bookings; admins can cancel any booking.

export async function DELETE(
  request: NextRequest,
  { params }: RouteContext
): Promise<NextResponse<ApiSuccess<{ cancelled: true }> | ApiError>> {
  const user = getAuthUser(request)
  if (!user) {
    return NextResponse.json(
      { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } },
      { status: 401 }
    )
  }

  const { bookingId } = await params

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: {
      id: true,
      userId: true,
      status: true,
      slotId: true,
      slot: { select: { floorId: true, label: true } },
    },
  })

  if (!booking) {
    return NextResponse.json(
      { error: { code: 'NOT_FOUND', message: 'Booking not found' } },
      { status: 404 }
    )
  }

  if (booking.userId !== user.sub && user.role !== 'ADMIN') {
    return NextResponse.json(
      { error: { code: 'FORBIDDEN', message: 'Access denied' } },
      { status: 403 }
    )
  }

  if (booking.status === 'CANCELLED' || booking.status === 'EXPIRED') {
    return NextResponse.json(
      { error: { code: 'INVALID_STATE', message: `Booking is already ${booking.status.toLowerCase()}` } },
      { status: 409 }
    )
  }

  const ip = request.headers.get('x-forwarded-for') ?? request.headers.get('x-real-ip') ?? undefined
  const ua = request.headers.get('user-agent') ?? undefined

  await prisma.$transaction([
    prisma.booking.update({
      where: { id: bookingId },
      data: {
        status: 'CANCELLED',
        cancelledAt: new Date(),
        cancelledBy: user.sub,
      },
    }),
    prisma.parkingSlot.update({
      where: { id: booking.slotId },
      data: { status: 'AVAILABLE' },
    }),
    prisma.auditLog.create({
      data: {
        action: 'BOOKING_CANCELLED',
        userId: user.sub,
        bookingId,
        slotId: booking.slotId,
        metadata: { reason: 'user_request', cancelledBy: user.sub },
        ipAddress: ip,
        userAgent: ua,
      },
    }),
  ])

  await broadcastSlotUpdate({
    slotId: booking.slotId,
    floorId: booking.slot.floorId,
    label: booking.slot.label,
    status: 'AVAILABLE',
    isAvailable: true,
  })

  return NextResponse.json({ data: { cancelled: true } })
}
