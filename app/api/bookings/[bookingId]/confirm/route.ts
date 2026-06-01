import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { broadcastSlotUpdate } from '@/lib/realtime'
import { verifyOtpHash } from '@/lib/otp'
import type { ApiError, ApiSuccess, BookingDetail } from '@/types'

const confirmSchema = z.object({
  otp: z
    .string()
    .length(6, 'OTP must be exactly 6 digits')
    .regex(/^\d{6}$/, 'OTP must be numeric'),
})

// POST /api/bookings/[bookingId]/confirm
// Verifies the OTP, transitions booking → CONFIRMED, slot → OCCUPIED.
// Max 3 attempts; locks the OTP on the third failure.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ bookingId: string }> }
): Promise<NextResponse<ApiSuccess<{ booking: Pick<BookingDetail, 'id' | 'status' | 'confirmedAt'> }> | ApiError>> {
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

  const parsed = confirmSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message ?? 'Invalid input' } },
      { status: 400 }
    )
  }

  const { otp: inputOtp } = parsed.data
  const { bookingId } = await params

  // ── Pre-flight read outside the transaction ───────────────────────────────
  // bcrypt.compare is CPU-bound; running it outside keeps the DB round-trip short.
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: {
      id: true,
      userId: true,
      slotId: true,
      status: true,
      slot: { select: { floorId: true, label: true } },
      otpVerification: {
        select: {
          id: true,
          otpHash: true,
          expiresAt: true,
          attempts: true,
          maxAttempts: true,
          isLocked: true,
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
  if (booking.userId !== user.sub) {
    return NextResponse.json(
      { error: { code: 'FORBIDDEN', message: 'Access denied' } },
      { status: 403 }
    )
  }
  if (booking.status !== 'PENDING_OTP') {
    return NextResponse.json(
      { error: { code: 'INVALID_STATE', message: `Booking is ${booking.status.toLowerCase()}, not pending OTP` } },
      { status: 409 }
    )
  }

  const otpRecord = booking.otpVerification
  if (!otpRecord) {
    return NextResponse.json(
      { error: { code: 'OTP_NOT_FOUND', message: 'No OTP found for this booking — request a resend' } },
      { status: 400 }
    )
  }
  if (otpRecord.isLocked) {
    return NextResponse.json(
      { error: { code: 'OTP_LOCKED', message: 'Too many incorrect attempts — request a new OTP' } },
      { status: 429 }
    )
  }
  if (new Date() > otpRecord.expiresAt) {
    return NextResponse.json(
      { error: { code: 'OTP_EXPIRED', message: 'OTP has expired — request a new OTP' } },
      { status: 400 }
    )
  }
  if (otpRecord.verifiedAt) {
    return NextResponse.json(
      { error: { code: 'OTP_ALREADY_USED', message: 'OTP was already verified' } },
      { status: 409 }
    )
  }

  // Compare hash outside the transaction (CPU-intensive)
  const isValid = await verifyOtpHash(inputOtp, otpRecord.otpHash)

  const ip = request.headers.get('x-forwarded-for') ?? request.headers.get('x-real-ip') ?? undefined
  const ua = request.headers.get('user-agent') ?? undefined

  // ── Atomic update ──────────────────────────────────────────────────────────
  const now = new Date()
  const newAttempts = otpRecord.attempts + 1
  const willLock = !isValid && newAttempts >= otpRecord.maxAttempts

  if (!isValid) {
    // Increment attempts atomically; lock if max reached
    await prisma.otpVerification.update({
      where: { id: otpRecord.id },
      data: { attempts: { increment: 1 }, ...(willLock && { isLocked: true }) },
    })

    if (willLock) {
      return NextResponse.json(
        { error: { code: 'OTP_LOCKED', message: 'Too many incorrect attempts — request a new OTP' } },
        { status: 429 }
      )
    }

    return NextResponse.json(
      {
        error: {
          code: 'INVALID_OTP',
          message: `Incorrect OTP. ${otpRecord.maxAttempts - newAttempts} attempt(s) remaining`,
        },
      },
      { status: 400 }
    )
  }

  // OTP is correct — confirm booking atomically
  await prisma.$transaction([
    prisma.otpVerification.update({
      where: { id: otpRecord.id },
      data: { attempts: { increment: 1 }, verifiedAt: now },
    }),
    prisma.booking.update({
      where: { id: bookingId },
      data: { status: 'CONFIRMED', confirmedAt: now },
    }),
    prisma.parkingSlot.update({
      where: { id: booking.slotId },
      data: { status: 'OCCUPIED' },
    }),
    prisma.auditLog.create({
      data: {
        action: 'BOOKING_CONFIRMED',
        userId: user.sub,
        bookingId,
        slotId: booking.slotId,
        ipAddress: ip,
        userAgent: ua,
      },
    }),
  ])

  await broadcastSlotUpdate({
    slotId: booking.slotId,
    floorId: booking.slot.floorId,
    label: booking.slot.label,
    status: 'OCCUPIED',
    isAvailable: false,
  })

  return NextResponse.json({
    data: {
      booking: {
        id: bookingId,
        status: 'CONFIRMED',
        confirmedAt: now.toISOString(),
      },
    },
  })
}
