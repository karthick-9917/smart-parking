import { describe, it, expect } from 'vitest'
import { GET, DELETE } from '@/app/api/bookings/[bookingId]/route'
import { makeRequest, routeParams, createUser, createFloor, createSlot, createBookingWithOtp, bearer, makeToken } from '@/tests/helpers'
import { prisma } from '@/lib/prisma'

// ─── GET /api/bookings/[bookingId] ────────────────────────────────────────────

describe('GET /api/bookings/:bookingId', () => {
  it('returns 401 without auth', async () => {
    const res = await GET(
      makeRequest('/api/bookings/x'),
      routeParams({ bookingId: 'x' })
    )
    expect(res.status).toBe(401)
  })

  it('returns 404 for a non-existent booking', async () => {
    const user = await createUser()
    const res = await GET(
      makeRequest('/api/bookings/nonexistent', { headers: bearer(makeToken(user.id, user.email)) }),
      routeParams({ bookingId: 'nonexistent' })
    )
    expect(res.status).toBe(404)
  })

  it('returns full booking detail for the owner', async () => {
    const user = await createUser()
    const floor = await createFloor({ level: 0 })
    const slot = await createSlot(floor.id)
    const booking = await createBookingWithOtp(user.id, slot.id)

    const res = await GET(
      makeRequest(`/api/bookings/${booking.id}`, { headers: bearer(makeToken(user.id, user.email)) }),
      routeParams({ bookingId: booking.id })
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.id).toBe(booking.id)
    expect(body.data.status).toBe('PENDING_OTP')
    expect(body.data.slot).toBeDefined()
    expect(body.data.slot.floor).toBeDefined()
  })

  it('includes OTP status with attemptsRemaining', async () => {
    const user = await createUser()
    const floor = await createFloor({ level: 0 })
    const slot = await createSlot(floor.id)
    const booking = await createBookingWithOtp(user.id, slot.id)

    const body = await (await GET(
      makeRequest(`/api/bookings/${booking.id}`, { headers: bearer(makeToken(user.id, user.email)) }),
      routeParams({ bookingId: booking.id })
    )).json()

    expect(body.data.otp).not.toBeNull()
    expect(body.data.otp.attemptsRemaining).toBeGreaterThan(0)
    expect(body.data.otp.expiresAt).toBeTruthy()
    expect(body.data.otp.isLocked).toBe(false)
  })

  it('does not expose otpHash in the response', async () => {
    const user = await createUser()
    const floor = await createFloor({ level: 0 })
    const slot = await createSlot(floor.id)
    const booking = await createBookingWithOtp(user.id, slot.id)

    const body = await (await GET(
      makeRequest(`/api/bookings/${booking.id}`, { headers: bearer(makeToken(user.id, user.email)) }),
      routeParams({ bookingId: booking.id })
    )).json()

    expect(JSON.stringify(body)).not.toContain('otpHash')
  })

  it('returns 403 when a different user requests the booking', async () => {
    const owner = await createUser()
    const intruder = await createUser()
    const floor = await createFloor({ level: 0 })
    const slot = await createSlot(floor.id)
    const booking = await createBookingWithOtp(owner.id, slot.id)

    const res = await GET(
      makeRequest(`/api/bookings/${booking.id}`, { headers: bearer(makeToken(intruder.id, intruder.email)) }),
      routeParams({ bookingId: booking.id })
    )
    expect(res.status).toBe(403)
  })

  it('allows an ADMIN to view any booking', async () => {
    const owner = await createUser()
    const admin = await createUser({ role: 'ADMIN' })
    const floor = await createFloor({ level: 0 })
    const slot = await createSlot(floor.id)
    const booking = await createBookingWithOtp(owner.id, slot.id)

    const res = await GET(
      makeRequest(`/api/bookings/${booking.id}`, { headers: bearer(makeToken(admin.id, admin.email, 'ADMIN')) }),
      routeParams({ bookingId: booking.id })
    )
    expect(res.status).toBe(200)
    expect((await res.json()).data.id).toBe(booking.id)
  })
})

// ─── DELETE /api/bookings/[bookingId] ─────────────────────────────────────────

describe('DELETE /api/bookings/:bookingId', () => {
  it('returns 401 without auth', async () => {
    const res = await DELETE(
      makeRequest('/api/bookings/x', { method: 'DELETE' }),
      routeParams({ bookingId: 'x' })
    )
    expect(res.status).toBe(401)
  })

  it('returns 404 for a non-existent booking', async () => {
    const user = await createUser()
    const res = await DELETE(
      makeRequest('/api/bookings/nonexistent', { method: 'DELETE', headers: bearer(makeToken(user.id, user.email)) }),
      routeParams({ bookingId: 'nonexistent' })
    )
    expect(res.status).toBe(404)
  })

  it('cancels a PENDING_OTP booking and releases the slot', async () => {
    const user = await createUser()
    const floor = await createFloor({ level: 0 })
    const slot = await createSlot(floor.id)
    const booking = await createBookingWithOtp(user.id, slot.id)

    const res = await DELETE(
      makeRequest(`/api/bookings/${booking.id}`, { method: 'DELETE', headers: bearer(makeToken(user.id, user.email)) }),
      routeParams({ bookingId: booking.id })
    )
    expect(res.status).toBe(200)
    expect((await res.json()).data.cancelled).toBe(true)

    const updated = await prisma.parkingSlot.findUnique({ where: { id: slot.id } })
    expect(updated?.status).toBe('AVAILABLE')

    const cancelled = await prisma.booking.findUnique({ where: { id: booking.id } })
    expect(cancelled?.status).toBe('CANCELLED')
    expect(cancelled?.cancelledAt).not.toBeNull()
  })

  it('cancels a CONFIRMED booking and releases the slot', async () => {
    const user = await createUser()
    const floor = await createFloor({ level: 0 })
    const slot = await createSlot(floor.id)
    const booking = await createBookingWithOtp(user.id, slot.id)
    await prisma.booking.update({ where: { id: booking.id }, data: { status: 'CONFIRMED' } })
    await prisma.parkingSlot.update({ where: { id: slot.id }, data: { status: 'OCCUPIED' } })

    const res = await DELETE(
      makeRequest(`/api/bookings/${booking.id}`, { method: 'DELETE', headers: bearer(makeToken(user.id, user.email)) }),
      routeParams({ bookingId: booking.id })
    )
    expect(res.status).toBe(200)

    const updated = await prisma.parkingSlot.findUnique({ where: { id: slot.id } })
    expect(updated?.status).toBe('AVAILABLE')
  })

  it('writes a BOOKING_CANCELLED audit log', async () => {
    const user = await createUser()
    const floor = await createFloor({ level: 0 })
    const slot = await createSlot(floor.id)
    const booking = await createBookingWithOtp(user.id, slot.id)

    await DELETE(
      makeRequest(`/api/bookings/${booking.id}`, { method: 'DELETE', headers: bearer(makeToken(user.id, user.email)) }),
      routeParams({ bookingId: booking.id })
    )

    const log = await prisma.auditLog.findFirst({
      where: { bookingId: booking.id, action: 'BOOKING_CANCELLED' },
    })
    expect(log).toBeTruthy()
  })

  it('returns 403 when a different user tries to cancel', async () => {
    const owner = await createUser()
    const intruder = await createUser()
    const floor = await createFloor({ level: 0 })
    const slot = await createSlot(floor.id)
    const booking = await createBookingWithOtp(owner.id, slot.id)

    const res = await DELETE(
      makeRequest(`/api/bookings/${booking.id}`, { method: 'DELETE', headers: bearer(makeToken(intruder.id, intruder.email)) }),
      routeParams({ bookingId: booking.id })
    )
    expect(res.status).toBe(403)
  })

  it('allows an ADMIN to cancel any booking', async () => {
    const owner = await createUser()
    const admin = await createUser({ role: 'ADMIN' })
    const floor = await createFloor({ level: 0 })
    const slot = await createSlot(floor.id)
    const booking = await createBookingWithOtp(owner.id, slot.id)

    const res = await DELETE(
      makeRequest(`/api/bookings/${booking.id}`, { method: 'DELETE', headers: bearer(makeToken(admin.id, admin.email, 'ADMIN')) }),
      routeParams({ bookingId: booking.id })
    )
    expect(res.status).toBe(200)
  })

  it('returns 409 INVALID_STATE for an already-cancelled booking', async () => {
    const user = await createUser()
    const floor = await createFloor({ level: 0 })
    const slot = await createSlot(floor.id)
    const booking = await createBookingWithOtp(user.id, slot.id)
    await prisma.booking.update({ where: { id: booking.id }, data: { status: 'CANCELLED' } })

    const res = await DELETE(
      makeRequest(`/api/bookings/${booking.id}`, { method: 'DELETE', headers: bearer(makeToken(user.id, user.email)) }),
      routeParams({ bookingId: booking.id })
    )
    expect(res.status).toBe(409)
    expect((await res.json()).error.code).toBe('INVALID_STATE')
  })

  it('returns 409 INVALID_STATE for an EXPIRED booking', async () => {
    const user = await createUser()
    const floor = await createFloor({ level: 0 })
    const slot = await createSlot(floor.id)
    const booking = await createBookingWithOtp(user.id, slot.id)
    await prisma.booking.update({ where: { id: booking.id }, data: { status: 'EXPIRED' } })

    const res = await DELETE(
      makeRequest(`/api/bookings/${booking.id}`, { method: 'DELETE', headers: bearer(makeToken(user.id, user.email)) }),
      routeParams({ bookingId: booking.id })
    )
    expect(res.status).toBe(409)
    expect((await res.json()).error.code).toBe('INVALID_STATE')
  })
})
