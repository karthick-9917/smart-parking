import { describe, it, expect } from 'vitest'
import { POST, GET } from '@/app/api/bookings/route'
import { makeRequest, createUser, createFloor, createSlot, createBookingWithOtp, bearer, makeToken, futureDate } from '@/tests/helpers'
import { prisma } from '@/lib/prisma'

// ─── POST /api/bookings ───────────────────────────────────────────────────────

describe('POST /api/bookings', () => {
  function bookingBody(slotId: string, date: string, overrides?: Record<string, unknown>) {
    return { slotId, date, startTime: '09:00', endTime: '17:00', ...overrides }
  }

  it('returns 401 without auth', async () => {
    const res = await POST(makeRequest('/api/bookings', { method: 'POST', body: {} }))
    expect(res.status).toBe(401)
  })

  it('creates a booking and returns 201 with bookingId + OTP details', async () => {
    const user = await createUser()
    const floor = await createFloor({ level: 0 })
    const slot = await createSlot(floor.id)
    const date = futureDate()
    const token = makeToken(user.id, user.email)

    const res = await POST(makeRequest('/api/bookings', {
      method: 'POST',
      headers: bearer(token),
      body: bookingBody(slot.id, date),
    }))

    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.data.bookingId).toBeTruthy()
    expect(body.data.status).toBe('PENDING_OTP')
    expect(body.data.otpExpiresAt).toBeTruthy()
    // NODE_ENV=test → code is returned
    expect(body.data.otpCode).toMatch(/^\d{6}$/)
  })

  it('reserves the slot (status → RESERVED) after booking', async () => {
    const user = await createUser()
    const floor = await createFloor({ level: 0 })
    const slot = await createSlot(floor.id)
    const token = makeToken(user.id, user.email)

    await POST(makeRequest('/api/bookings', {
      method: 'POST',
      headers: bearer(token),
      body: bookingBody(slot.id, futureDate()),
    }))

    const updated = await prisma.parkingSlot.findUnique({ where: { id: slot.id } })
    expect(updated?.status).toBe('RESERVED')
  })

  it('stores OTP hash (not plaintext) with a 5-minute expiry', async () => {
    const user = await createUser()
    const floor = await createFloor({ level: 0 })
    const slot = await createSlot(floor.id)
    const token = makeToken(user.id, user.email)
    const before = Date.now()

    const body = await (await POST(makeRequest('/api/bookings', {
      method: 'POST',
      headers: bearer(token),
      body: bookingBody(slot.id, futureDate()),
    }))).json()

    const otp = await prisma.otpVerification.findUnique({
      where: { bookingId: body.data.bookingId },
    })
    expect(otp?.otpHash).toMatch(/^\$2[ab]\$/)
    expect(otp?.otpHash).not.toBe(body.data.otpCode)
    // expiresAt ≈ now + 5 min
    expect(otp!.expiresAt.getTime()).toBeGreaterThan(before + 4 * 60 * 1000)
    expect(otp!.expiresAt.getTime()).toBeLessThan(before + 6 * 60 * 1000)
  })

  it('writes a BOOKING_CREATED audit log', async () => {
    const user = await createUser()
    const floor = await createFloor({ level: 0 })
    const slot = await createSlot(floor.id)
    const token = makeToken(user.id, user.email)

    const body = await (await POST(makeRequest('/api/bookings', {
      method: 'POST',
      headers: bearer(token),
      body: bookingBody(slot.id, futureDate()),
    }))).json()

    const log = await prisma.auditLog.findFirst({
      where: { bookingId: body.data.bookingId, action: 'BOOKING_CREATED' },
    })
    expect(log).toBeTruthy()
  })

  it('returns 404 for a non-existent slot', async () => {
    const user = await createUser()
    const token = makeToken(user.id, user.email)
    const res = await POST(makeRequest('/api/bookings', {
      method: 'POST',
      headers: bearer(token),
      body: bookingBody('nonexistent', futureDate()),
    }))
    expect(res.status).toBe(404)
  })

  it('returns 409 for a MAINTENANCE slot', async () => {
    const user = await createUser()
    const floor = await createFloor({ level: 0 })
    const slot = await createSlot(floor.id, { status: 'MAINTENANCE' })
    const token = makeToken(user.id, user.email)
    const res = await POST(makeRequest('/api/bookings', {
      method: 'POST',
      headers: bearer(token),
      body: bookingBody(slot.id, futureDate()),
    }))
    expect(res.status).toBe(409)
    expect((await res.json()).error.code).toBe('SLOT_UNAVAILABLE')
  })

  it('returns 409 when an overlapping booking already exists', async () => {
    const user = await createUser()
    const floor = await createFloor({ level: 0 })
    const slot = await createSlot(floor.id)
    const date = futureDate()
    // Pre-existing booking 08:00–18:00 overlaps our 09:00–17:00
    await createBookingWithOtp(user.id, slot.id, { date, startTime: '08:00', endTime: '18:00' })

    const token = makeToken(user.id, user.email)
    const res = await POST(makeRequest('/api/bookings', {
      method: 'POST',
      headers: bearer(token),
      body: bookingBody(slot.id, date),
    }))
    expect(res.status).toBe(409)
    expect((await res.json()).error.code).toBe('SLOT_CONFLICT')
  })

  it('allows non-overlapping bookings on the same slot (adjacent windows)', async () => {
    const user = await createUser()
    const floor = await createFloor({ level: 0 })
    const slot = await createSlot(floor.id)
    const date = futureDate()
    await createBookingWithOtp(user.id, slot.id, { date, startTime: '09:00', endTime: '12:00' })

    // Update slot back to AVAILABLE so the second booking can proceed
    await prisma.parkingSlot.update({ where: { id: slot.id }, data: { status: 'AVAILABLE' } })

    const token = makeToken(user.id, user.email)
    const res = await POST(makeRequest('/api/bookings', {
      method: 'POST',
      headers: bearer(token),
      body: bookingBody(slot.id, date, { startTime: '13:00', endTime: '18:00' }),
    }))
    expect(res.status).toBe(201)
  })

  it('returns 404 when vehicleId belongs to a different user', async () => {
    const owner = await createUser()
    const intruder = await createUser()
    const floor = await createFloor({ level: 0 })
    const slot = await createSlot(floor.id)
    const vehicle = await prisma.vehicle.create({
      data: { userId: owner.id, licensePlate: 'TN-01-TEST', isPrimary: true },
    })
    const token = makeToken(intruder.id, intruder.email)
    const res = await POST(makeRequest('/api/bookings', {
      method: 'POST',
      headers: bearer(token),
      body: bookingBody(slot.id, futureDate(), { vehicleId: vehicle.id }),
    }))
    expect(res.status).toBe(404)
    expect((await res.json()).error.code).toBe('VEHICLE_NOT_FOUND')
  })

  it('validates required fields → 400', async () => {
    const user = await createUser()
    const token = makeToken(user.id, user.email)
    const res = await POST(makeRequest('/api/bookings', {
      method: 'POST',
      headers: bearer(token),
      body: { startTime: '09:00' },
    }))
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('VALIDATION_ERROR')
  })

  it('validates startTime < endTime → 400', async () => {
    const user = await createUser()
    const floor = await createFloor({ level: 0 })
    const slot = await createSlot(floor.id)
    const token = makeToken(user.id, user.email)
    const res = await POST(makeRequest('/api/bookings', {
      method: 'POST',
      headers: bearer(token),
      body: bookingBody(slot.id, futureDate(), { startTime: '18:00', endTime: '08:00' }),
    }))
    expect(res.status).toBe(400)
  })

  // ── Concurrency ─────────────────────────────────────────────────────────────
  // Two simultaneous requests for the same slot/window: exactly one must win.

  it('prevents double-booking under concurrent requests', async () => {
    const user = await createUser()
    const floor = await createFloor({ level: 0 })
    const slot = await createSlot(floor.id)
    const date = futureDate()
    const token = makeToken(user.id, user.email)

    const makeReq = () =>
      makeRequest('/api/bookings', {
        method: 'POST',
        headers: bearer(token),
        body: bookingBody(slot.id, date),
      })

    const [res1, res2] = await Promise.all([POST(makeReq()), POST(makeReq())])
    const statuses = [res1.status, res2.status].sort((a, b) => a - b)
    expect(statuses).toEqual([201, 409])

    // Exactly one booking was persisted
    const count = await prisma.booking.count({ where: { slotId: slot.id } })
    expect(count).toBe(1)
  })
})

// ─── GET /api/bookings ────────────────────────────────────────────────────────

describe('GET /api/bookings', () => {
  it('returns 401 without auth', async () => {
    expect((await GET(makeRequest('/api/bookings'))).status).toBe(401)
  })

  it('returns only the authenticated user\'s bookings', async () => {
    const alice = await createUser()
    const bob = await createUser()
    const floor = await createFloor({ level: 0 })
    const slot1 = await createSlot(floor.id)
    const slot2 = await createSlot(floor.id)
    await createBookingWithOtp(alice.id, slot1.id)
    await createBookingWithOtp(bob.id, slot2.id)

    const body = await (await GET(makeRequest('/api/bookings', {
      headers: bearer(makeToken(alice.id, alice.email)),
    }))).json()

    expect(body.data.total).toBe(1)
    expect(body.data.bookings[0].slot).toBeDefined()
  })

  it('filters by status', async () => {
    const user = await createUser()
    const floor = await createFloor({ level: 0 })
    const slot1 = await createSlot(floor.id)
    const slot2 = await createSlot(floor.id)
    const b1 = await createBookingWithOtp(user.id, slot1.id)
    await createBookingWithOtp(user.id, slot2.id)
    // Confirm first booking
    await prisma.booking.update({ where: { id: b1.id }, data: { status: 'CONFIRMED' } })
    await prisma.parkingSlot.update({ where: { id: slot1.id }, data: { status: 'OCCUPIED' } })

    const token = makeToken(user.id, user.email)
    const body = await (await GET(makeRequest('/api/bookings', {
      headers: bearer(token),
      searchParams: { status: 'CONFIRMED' },
    }))).json()

    expect(body.data.total).toBe(1)
    expect(body.data.bookings[0].status).toBe('CONFIRMED')
  })

  it('paginates results correctly', async () => {
    const user = await createUser()
    const floor = await createFloor({ level: 0 })
    // Create 5 bookings
    for (let i = 0; i < 5; i++) {
      const slot = await createSlot(floor.id, { row: i + 1 })
      await createBookingWithOtp(user.id, slot.id)
    }
    const token = makeToken(user.id, user.email)

    const page1 = await (await GET(makeRequest('/api/bookings', {
      headers: bearer(token),
      searchParams: { limit: '2', page: '1' },
    }))).json()
    const page2 = await (await GET(makeRequest('/api/bookings', {
      headers: bearer(token),
      searchParams: { limit: '2', page: '2' },
    }))).json()

    expect(page1.data.bookings).toHaveLength(2)
    expect(page1.data.total).toBe(5)
    expect(page2.data.bookings).toHaveLength(2)
    // No overlap between pages
    const ids1 = page1.data.bookings.map((b: { id: string }) => b.id)
    const ids2 = page2.data.bookings.map((b: { id: string }) => b.id)
    expect(ids1.some((id: string) => ids2.includes(id))).toBe(false)
  })

  it('rejects invalid status query param → 400', async () => {
    const user = await createUser()
    const res = await GET(makeRequest('/api/bookings', {
      headers: bearer(makeToken(user.id, user.email)),
      searchParams: { status: 'INVALID_STATUS' },
    }))
    expect(res.status).toBe(400)
  })
})
