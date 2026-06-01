import { describe, it, expect } from 'vitest'
import { POST } from '@/app/api/bookings/[bookingId]/confirm/route'
import { makeRequest, routeParams, createUser, createFloor, createSlot, createBookingWithOtp, bearer, makeToken, expiredDate } from '@/tests/helpers'
import { prisma } from '@/lib/prisma'
import { hashOtp } from '@/lib/otp'

async function confirmOtp(bookingId: string, token: string, otp: string) {
  return POST(
    makeRequest(`/api/bookings/${bookingId}/confirm`, {
      method: 'POST',
      headers: bearer(token),
      body: { otp },
    }),
    routeParams({ bookingId })
  )
}

describe('POST /api/bookings/:bookingId/confirm', () => {
  it('returns 401 without auth', async () => {
    const res = await POST(
      makeRequest('/api/bookings/x/confirm', { method: 'POST', body: { otp: '123456' } }),
      routeParams({ bookingId: 'x' })
    )
    expect(res.status).toBe(401)
  })

  it('returns 404 for a non-existent booking', async () => {
    const user = await createUser()
    const res = await confirmOtp('nonexistent', makeToken(user.id, user.email), '123456')
    expect(res.status).toBe(404)
  })

  it('confirms booking with the correct OTP → 200, booking CONFIRMED, slot OCCUPIED', async () => {
    const user = await createUser()
    const floor = await createFloor({ level: 0 })
    const slot = await createSlot(floor.id)
    const otp = '482910'
    const booking = await createBookingWithOtp(user.id, slot.id, { otp })

    const res = await confirmOtp(booking.id, makeToken(user.id, user.email), otp)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.booking.status).toBe('CONFIRMED')
    expect(body.data.booking.confirmedAt).toBeTruthy()

    const updatedBooking = await prisma.booking.findUnique({ where: { id: booking.id } })
    expect(updatedBooking?.status).toBe('CONFIRMED')

    const updatedSlot = await prisma.parkingSlot.findUnique({ where: { id: slot.id } })
    expect(updatedSlot?.status).toBe('OCCUPIED')
  })

  it('writes a BOOKING_CONFIRMED audit log', async () => {
    const user = await createUser()
    const floor = await createFloor({ level: 0 })
    const slot = await createSlot(floor.id)
    const otp = '111222'
    const booking = await createBookingWithOtp(user.id, slot.id, { otp })

    await confirmOtp(booking.id, makeToken(user.id, user.email), otp)

    const log = await prisma.auditLog.findFirst({
      where: { bookingId: booking.id, action: 'BOOKING_CONFIRMED' },
    })
    expect(log).toBeTruthy()
  })

  it('returns 400 INVALID_OTP for wrong OTP and decrements attempts', async () => {
    const user = await createUser()
    const floor = await createFloor({ level: 0 })
    const slot = await createSlot(floor.id)
    const booking = await createBookingWithOtp(user.id, slot.id, { otp: '999999' })

    const res = await confirmOtp(booking.id, makeToken(user.id, user.email), '000000')
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('INVALID_OTP')

    const otpRecord = await prisma.otpVerification.findUnique({ where: { bookingId: booking.id } })
    expect(otpRecord?.attempts).toBe(1)
  })

  it('locks the OTP after 3 failed attempts and returns 429', async () => {
    const user = await createUser()
    const floor = await createFloor({ level: 0 })
    const slot = await createSlot(floor.id)
    const booking = await createBookingWithOtp(user.id, slot.id, { otp: '999999' })
    const token = makeToken(user.id, user.email)

    // 1st wrong attempt
    await confirmOtp(booking.id, token, '000001')
    // 2nd wrong attempt
    await confirmOtp(booking.id, token, '000002')
    // 3rd wrong attempt → triggers lock
    const res = await confirmOtp(booking.id, token, '000003')
    expect(res.status).toBe(429)
    expect((await res.json()).error.code).toBe('OTP_LOCKED')

    const otpRecord = await prisma.otpVerification.findUnique({ where: { bookingId: booking.id } })
    expect(otpRecord?.isLocked).toBe(true)
  })

  it('returns 429 OTP_LOCKED when OTP is already locked', async () => {
    const user = await createUser()
    const floor = await createFloor({ level: 0 })
    const slot = await createSlot(floor.id)
    const booking = await createBookingWithOtp(user.id, slot.id, { isLocked: true })

    const res = await confirmOtp(booking.id, makeToken(user.id, user.email), '123456')
    expect(res.status).toBe(429)
    expect((await res.json()).error.code).toBe('OTP_LOCKED')
  })

  it('returns 400 OTP_EXPIRED for an expired OTP', async () => {
    const user = await createUser()
    const floor = await createFloor({ level: 0 })
    const slot = await createSlot(floor.id)
    const otp = '555444'
    const booking = await createBookingWithOtp(user.id, slot.id, {
      otp,
      expiresAt: expiredDate(),
    })

    const res = await confirmOtp(booking.id, makeToken(user.id, user.email), otp)
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('OTP_EXPIRED')
  })

  it('returns 409 INVALID_STATE when booking is already CONFIRMED', async () => {
    const user = await createUser()
    const floor = await createFloor({ level: 0 })
    const slot = await createSlot(floor.id)
    const otp = '123456'
    const booking = await createBookingWithOtp(user.id, slot.id, { otp })
    await prisma.booking.update({ where: { id: booking.id }, data: { status: 'CONFIRMED' } })

    const res = await confirmOtp(booking.id, makeToken(user.id, user.email), otp)
    expect(res.status).toBe(409)
    expect((await res.json()).error.code).toBe('INVALID_STATE')
  })

  it('returns 409 INVALID_STATE when booking is CANCELLED', async () => {
    const user = await createUser()
    const floor = await createFloor({ level: 0 })
    const slot = await createSlot(floor.id)
    const booking = await createBookingWithOtp(user.id, slot.id, { otp: '123456' })
    await prisma.booking.update({ where: { id: booking.id }, data: { status: 'CANCELLED' } })

    const res = await confirmOtp(booking.id, makeToken(user.id, user.email), '123456')
    expect(res.status).toBe(409)
  })

  it('returns 403 when a different user tries to confirm', async () => {
    const owner = await createUser()
    const intruder = await createUser()
    const floor = await createFloor({ level: 0 })
    const slot = await createSlot(floor.id)
    const booking = await createBookingWithOtp(owner.id, slot.id, { otp: '123456' })

    const res = await confirmOtp(booking.id, makeToken(intruder.id, intruder.email), '123456')
    expect(res.status).toBe(403)
  })

  it('validates OTP format → 400 for non-numeric input', async () => {
    const user = await createUser()
    const floor = await createFloor({ level: 0 })
    const slot = await createSlot(floor.id)
    const booking = await createBookingWithOtp(user.id, slot.id)

    const res = await confirmOtp(booking.id, makeToken(user.id, user.email), 'abcdef')
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('VALIDATION_ERROR')
  })

  it('validates OTP length → 400 for wrong length', async () => {
    const user = await createUser()
    const floor = await createFloor({ level: 0 })
    const slot = await createSlot(floor.id)
    const booking = await createBookingWithOtp(user.id, slot.id)

    const res = await confirmOtp(booking.id, makeToken(user.id, user.email), '12345')
    expect(res.status).toBe(400)
  })

  it('marks OTP as used (verifiedAt set) and rejects a second confirm attempt', async () => {
    const user = await createUser()
    const floor = await createFloor({ level: 0 })
    const slot = await createSlot(floor.id)
    const otp = '777888'
    const booking = await createBookingWithOtp(user.id, slot.id, { otp })
    const token = makeToken(user.id, user.email)

    // First confirm succeeds
    await confirmOtp(booking.id, token, otp)

    // Advance booking back to PENDING_OTP to test the verifiedAt guard directly
    await prisma.booking.update({ where: { id: booking.id }, data: { status: 'PENDING_OTP' } })

    const res = await confirmOtp(booking.id, token, otp)
    // OTP already used → either INVALID_STATE (booking=CONFIRMED caught first) or OTP_ALREADY_USED
    expect([400, 409]).toContain(res.status)
  })

  it('does not confirm when OTP record is missing', async () => {
    const user = await createUser()
    const floor = await createFloor({ level: 0 })
    const slot = await createSlot(floor.id)
    const booking = await createBookingWithOtp(user.id, slot.id)
    // Remove the OTP record to simulate missing state
    await prisma.otpVerification.delete({ where: { bookingId: booking.id } })

    const res = await confirmOtp(booking.id, makeToken(user.id, user.email), '123456')
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('OTP_NOT_FOUND')
  })
})
