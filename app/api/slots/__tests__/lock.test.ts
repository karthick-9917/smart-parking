import { describe, it, expect } from 'vitest'
import { POST, DELETE } from '@/app/api/slots/[slotId]/lock/route'
import { makeRequest, routeParams, createUser, createFloor, createSlot, createBookingWithOtp, bearer, makeToken, futureDate } from '@/tests/helpers'
import { prisma } from '@/lib/prisma'

function lockBody(date: string, overrides?: Record<string, unknown>) {
  return { date, startTime: '09:00', endTime: '17:00', ...overrides }
}

describe('POST /api/slots/:slotId/lock', () => {
  it('returns 401 without auth', async () => {
    const floor = await createFloor({ level: 0 })
    const slot = await createSlot(floor.id)
    const res = await POST(
      makeRequest(`/api/slots/${slot.id}/lock`, { method: 'POST', body: lockBody(futureDate()) }),
      routeParams({ slotId: slot.id })
    )
    expect(res.status).toBe(401)
  })

  it('locks an available slot → 201, slot becomes RESERVED', async () => {
    const user = await createUser()
    const floor = await createFloor({ level: 0 })
    const slot = await createSlot(floor.id)
    const token = makeToken(user.id, user.email)
    const date = futureDate()

    const res = await POST(
      makeRequest(`/api/slots/${slot.id}/lock`, {
        method: 'POST',
        headers: bearer(token),
        body: lockBody(date),
      }),
      routeParams({ slotId: slot.id })
    )

    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.data.bookingId).toBeTruthy()
    expect(body.data.slotId).toBe(slot.id)

    const updated = await prisma.parkingSlot.findUnique({ where: { id: slot.id } })
    expect(updated?.status).toBe('RESERVED')
  })

  it('returns 404 for a non-existent slot', async () => {
    const user = await createUser()
    const token = makeToken(user.id, user.email)
    const res = await POST(
      makeRequest('/api/slots/nonexistent/lock', {
        method: 'POST',
        headers: bearer(token),
        body: lockBody(futureDate()),
      }),
      routeParams({ slotId: 'nonexistent' })
    )
    expect(res.status).toBe(404)
  })

  it('returns 409 SLOT_UNAVAILABLE for a MAINTENANCE slot', async () => {
    const user = await createUser()
    const floor = await createFloor({ level: 0 })
    const slot = await createSlot(floor.id, { status: 'MAINTENANCE' })
    const token = makeToken(user.id, user.email)
    const res = await POST(
      makeRequest(`/api/slots/${slot.id}/lock`, {
        method: 'POST',
        headers: bearer(token),
        body: lockBody(futureDate()),
      }),
      routeParams({ slotId: slot.id })
    )
    expect(res.status).toBe(409)
    expect((await res.json()).error.code).toBe('SLOT_UNAVAILABLE')
  })

  it('returns 409 SLOT_CONFLICT for an OCCUPIED slot', async () => {
    const user = await createUser()
    const floor = await createFloor({ level: 0 })
    const slot = await createSlot(floor.id, { status: 'OCCUPIED' })
    const token = makeToken(user.id, user.email)
    const res = await POST(
      makeRequest(`/api/slots/${slot.id}/lock`, {
        method: 'POST',
        headers: bearer(token),
        body: lockBody(futureDate()),
      }),
      routeParams({ slotId: slot.id })
    )
    expect(res.status).toBe(409)
  })

  it('returns 409 when the slot already has an overlapping booking', async () => {
    const user = await createUser()
    const floor = await createFloor({ level: 0 })
    const slot = await createSlot(floor.id)
    const date = futureDate()
    // Place an existing booking
    await createBookingWithOtp(user.id, slot.id, { date, startTime: '08:00', endTime: '18:00' })

    const token = makeToken(user.id, user.email)
    const res = await POST(
      makeRequest(`/api/slots/${slot.id}/lock`, {
        method: 'POST',
        headers: bearer(token),
        body: lockBody(date, { startTime: '09:00', endTime: '17:00' }),
      }),
      routeParams({ slotId: slot.id })
    )
    expect(res.status).toBe(409)
    expect((await res.json()).error.code).toBe('SLOT_CONFLICT')
  })

  it('validates required fields → 400', async () => {
    const user = await createUser()
    const floor = await createFloor({ level: 0 })
    const slot = await createSlot(floor.id)
    const token = makeToken(user.id, user.email)
    const res = await POST(
      makeRequest(`/api/slots/${slot.id}/lock`, {
        method: 'POST',
        headers: bearer(token),
        body: { startTime: '09:00' }, // missing date + endTime
      }),
      routeParams({ slotId: slot.id })
    )
    expect(res.status).toBe(400)
  })

  it('validates startTime must be before endTime → 400', async () => {
    const user = await createUser()
    const floor = await createFloor({ level: 0 })
    const slot = await createSlot(floor.id)
    const token = makeToken(user.id, user.email)
    const res = await POST(
      makeRequest(`/api/slots/${slot.id}/lock`, {
        method: 'POST',
        headers: bearer(token),
        body: lockBody(futureDate(), { startTime: '18:00', endTime: '08:00' }),
      }),
      routeParams({ slotId: slot.id })
    )
    expect(res.status).toBe(400)
  })
})

describe('DELETE /api/slots/:slotId/lock', () => {
  it('returns 401 without auth', async () => {
    const res = await DELETE(
      makeRequest('/api/slots/x/lock', { method: 'DELETE', body: { bookingId: 'x' } }),
      routeParams({ slotId: 'x' })
    )
    expect(res.status).toBe(401)
  })

  it('releases a PENDING_OTP booking → slot AVAILABLE', async () => {
    const user = await createUser()
    const floor = await createFloor({ level: 0 })
    const slot = await createSlot(floor.id)
    const booking = await createBookingWithOtp(user.id, slot.id)
    const token = makeToken(user.id, user.email)

    const res = await DELETE(
      makeRequest(`/api/slots/${slot.id}/lock`, {
        method: 'DELETE',
        headers: bearer(token),
        body: { bookingId: booking.id },
      }),
      routeParams({ slotId: slot.id })
    )
    expect(res.status).toBe(200)
    expect((await res.json()).data.released).toBe(true)

    const updated = await prisma.parkingSlot.findUnique({ where: { id: slot.id } })
    expect(updated?.status).toBe('AVAILABLE')
  })

  it('returns 403 when a different user tries to release the lock', async () => {
    const owner = await createUser()
    const intruder = await createUser()
    const floor = await createFloor({ level: 0 })
    const slot = await createSlot(floor.id)
    const booking = await createBookingWithOtp(owner.id, slot.id)
    const token = makeToken(intruder.id, intruder.email)

    const res = await DELETE(
      makeRequest(`/api/slots/${slot.id}/lock`, {
        method: 'DELETE',
        headers: bearer(token),
        body: { bookingId: booking.id },
      }),
      routeParams({ slotId: slot.id })
    )
    expect(res.status).toBe(403)
  })

  it('returns 409 when booking is not PENDING_OTP', async () => {
    const user = await createUser()
    const floor = await createFloor({ level: 0 })
    const slot = await createSlot(floor.id)
    const booking = await createBookingWithOtp(user.id, slot.id)
    // Advance booking to CONFIRMED
    await prisma.booking.update({ where: { id: booking.id }, data: { status: 'CONFIRMED' } })
    const token = makeToken(user.id, user.email)

    const res = await DELETE(
      makeRequest(`/api/slots/${slot.id}/lock`, {
        method: 'DELETE',
        headers: bearer(token),
        body: { bookingId: booking.id },
      }),
      routeParams({ slotId: slot.id })
    )
    expect(res.status).toBe(409)
    expect((await res.json()).error.code).toBe('INVALID_STATE')
  })
})
