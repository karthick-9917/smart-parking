import { describe, it, expect } from 'vitest'
import { POST } from '@/app/api/bookings/[bookingId]/resend-otp/route'
import { makeRequest, routeParams, createUser, createFloor, createSlot, createBookingWithOtp, bearer, makeToken, expiredDate } from '@/tests/helpers'
import { prisma } from '@/lib/prisma'

async function resendOtp(bookingId: string, token: string) {
  return POST(
    makeRequest(`/api/bookings/${bookingId}/resend-otp`, {
      method: 'POST',
      headers: bearer(token),
      body: {},
    }),
    routeParams({ bookingId })
  )
}

describe('POST /api/bookings/:bookingId/resend-otp', () => {
  it('returns 401 without auth', async () => {
    const res = await POST(
      makeRequest('/api/bookings/x/resend-otp', { method: 'POST', body: {} }),
      routeParams({ bookingId: 'x' })
    )
    expect(res.status).toBe(401)
  })

  it('returns 404 for a non-existent booking', async () => {
    const user = await createUser()
    const res = await resendOtp('nonexistent', makeToken(user.id, user.email))
    expect(res.status).toBe(404)
  })

  it('returns 200 with new OTP expiry and otpCode (NODE_ENV=test)', async () => {
    const user = await createUser()
    const floor = await createFloor({ level: 0 })
    const slot = await createSlot(floor.id)
    const booking = await createBookingWithOtp(user.id, slot.id)

    const res = await resendOtp(booking.id, makeToken(user.id, user.email))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.otpExpiresAt).toBeTruthy()
    // NODE_ENV=test → code is returned
    expect(body.data.otpCode).toMatch(/^\d{6}$/)
  })

  it('generates a fresh OTP hash (different from original)', async () => {
    const user = await createUser()
    const floor = await createFloor({ level: 0 })
    const slot = await createSlot(floor.id)
    const booking = await createBookingWithOtp(user.id, slot.id, { otp: '111111' })

    const before = await prisma.otpVerification.findUnique({ where: { bookingId: booking.id } })

    await resendOtp(booking.id, makeToken(user.id, user.email))

    const after = await prisma.otpVerification.findUnique({ where: { bookingId: booking.id } })
    expect(after?.otpHash).not.toBe(before?.otpHash)
  })

  it('resets attempts to 0 on resend', async () => {
    const user = await createUser()
    const floor = await createFloor({ level: 0 })
    const slot = await createSlot(floor.id)
    const booking = await createBookingWithOtp(user.id, slot.id)
    // Simulate 2 failed attempts
    await prisma.otpVerification.update({
      where: { bookingId: booking.id },
      data: { attempts: 2 },
    })

    await resendOtp(booking.id, makeToken(user.id, user.email))

    const record = await prisma.otpVerification.findUnique({ where: { bookingId: booking.id } })
    expect(record?.attempts).toBe(0)
  })

  it('unlocks a locked OTP on resend', async () => {
    const user = await createUser()
    const floor = await createFloor({ level: 0 })
    const slot = await createSlot(floor.id)
    const booking = await createBookingWithOtp(user.id, slot.id, { isLocked: true, attempts: 3 })

    const res = await resendOtp(booking.id, makeToken(user.id, user.email))
    expect(res.status).toBe(200)

    const record = await prisma.otpVerification.findUnique({ where: { bookingId: booking.id } })
    expect(record?.isLocked).toBe(false)
    expect(record?.attempts).toBe(0)
  })

  it('resets expiry to ~5 minutes from now', async () => {
    const user = await createUser()
    const floor = await createFloor({ level: 0 })
    const slot = await createSlot(floor.id)
    const booking = await createBookingWithOtp(user.id, slot.id, { expiresAt: expiredDate() })
    const before = Date.now()

    await resendOtp(booking.id, makeToken(user.id, user.email))

    const record = await prisma.otpVerification.findUnique({ where: { bookingId: booking.id } })
    expect(record!.expiresAt.getTime()).toBeGreaterThan(before + 4 * 60 * 1000)
    expect(record!.expiresAt.getTime()).toBeLessThan(before + 6 * 60 * 1000)
  })

  it('does not create a duplicate OTP record (updates in place)', async () => {
    const user = await createUser()
    const floor = await createFloor({ level: 0 })
    const slot = await createSlot(floor.id)
    const booking = await createBookingWithOtp(user.id, slot.id)

    await resendOtp(booking.id, makeToken(user.id, user.email))
    await resendOtp(booking.id, makeToken(user.id, user.email))

    const count = await prisma.otpVerification.count({ where: { bookingId: booking.id } })
    expect(count).toBe(1)
  })

  it('returns 403 when a different user requests the resend', async () => {
    const owner = await createUser()
    const intruder = await createUser()
    const floor = await createFloor({ level: 0 })
    const slot = await createSlot(floor.id)
    const booking = await createBookingWithOtp(owner.id, slot.id)

    const res = await resendOtp(booking.id, makeToken(intruder.id, intruder.email))
    expect(res.status).toBe(403)
  })

  it('returns 409 INVALID_STATE for a CONFIRMED booking', async () => {
    const user = await createUser()
    const floor = await createFloor({ level: 0 })
    const slot = await createSlot(floor.id)
    const booking = await createBookingWithOtp(user.id, slot.id)
    await prisma.booking.update({ where: { id: booking.id }, data: { status: 'CONFIRMED' } })

    const res = await resendOtp(booking.id, makeToken(user.id, user.email))
    expect(res.status).toBe(409)
    expect((await res.json()).error.code).toBe('INVALID_STATE')
  })

  it('returns 409 INVALID_STATE for a CANCELLED booking', async () => {
    const user = await createUser()
    const floor = await createFloor({ level: 0 })
    const slot = await createSlot(floor.id)
    const booking = await createBookingWithOtp(user.id, slot.id)
    await prisma.booking.update({ where: { id: booking.id }, data: { status: 'CANCELLED' } })

    const res = await resendOtp(booking.id, makeToken(user.id, user.email))
    expect(res.status).toBe(409)
    expect((await res.json()).error.code).toBe('INVALID_STATE')
  })
})
