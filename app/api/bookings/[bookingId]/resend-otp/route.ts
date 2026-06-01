import { type NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { generateOtp, hashOtp, otpExpiresAt, OTP_MAX_ATTEMPTS } from '@/lib/otp'
import type { ApiError, ApiSuccess } from '@/types'

type ResendResponse = { otpExpiresAt: string; otpCode?: string }

// POST /api/bookings/[bookingId]/resend-otp
// Resets the OTP record for a PENDING_OTP booking (fresh 5-minute window, attempts zeroed).
// Only the booking owner may request a resend.
// Returns otpCode in non-production for testing.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ bookingId: string }> }
): Promise<NextResponse<ApiSuccess<ResendResponse> | ApiError>> {
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
      otpVerification: { select: { id: true } },
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
      { error: { code: 'INVALID_STATE', message: 'OTP can only be resent for a pending booking' } },
      { status: 409 }
    )
  }

  // Generate fresh OTP before hitting the DB
  const otpCode = generateOtp()
  const otpHash = await hashOtp(otpCode)
  const expiresAt = otpExpiresAt()

  if (booking.otpVerification) {
    // Reset the existing record — preserves the @unique bookingId constraint
    await prisma.otpVerification.update({
      where: { id: booking.otpVerification.id },
      data: {
        otpHash,
        expiresAt,
        attempts: 0,
        isLocked: false,
        verifiedAt: null,
        maxAttempts: OTP_MAX_ATTEMPTS,
        deliveredTo: user.email,
      },
    })
  } else {
    // No record yet (edge case: booking created without OTP); create one
    await prisma.otpVerification.create({
      data: {
        userId: user.sub,
        bookingId,
        purpose: 'BOOKING_CONFIRM',
        otpHash,
        expiresAt,
        deliveredTo: user.email,
        maxAttempts: OTP_MAX_ATTEMPTS,
      },
    })
  }

  return NextResponse.json({
    data: {
      otpExpiresAt: expiresAt.toISOString(),
      ...(process.env.NODE_ENV !== 'production' && { otpCode }),
    },
  })
}
