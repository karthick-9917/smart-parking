import { describe, it, expect } from 'vitest'
import { GET } from '@/app/api/floors/route'
import { GET as GET_SLOTS } from '@/app/api/floors/[floorId]/slots/route'
import { makeRequest, routeParams, createFloor, createSlot, createUser, createBookingWithOtp, bearer, makeToken, futureDate } from '@/tests/helpers'

describe('GET /api/floors', () => {
  it('returns an empty array when no floors exist', async () => {
    const res = await GET(makeRequest('/api/floors'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data).toEqual([])
  })

  it('returns active floors ordered by level', async () => {
    await createFloor({ name: 'Ground', level: 0 })
    await createFloor({ name: 'Level 1', level: 1 })
    const res = await GET(makeRequest('/api/floors'))
    const body = await res.json()
    expect(body.data).toHaveLength(2)
    expect(body.data[0].level).toBe(0)
    expect(body.data[1].level).toBe(1)
  })

  it('excludes inactive floors', async () => {
    await createFloor({ level: 0 })
    await createFloor({ level: 1, isActive: false })
    const body = await (await GET(makeRequest('/api/floors'))).json()
    expect(body.data).toHaveLength(1)
  })

  it('includes availableSlots count for the default (full-day) window', async () => {
    const floor = await createFloor({ level: 0 })
    await createSlot(floor.id)
    await createSlot(floor.id)
    const body = await (await GET(makeRequest('/api/floors'))).json()
    expect(body.data[0].availableSlots).toBe(2)
  })

  it('subtracts slots that have an active booking in the queried window', async () => {
    const user = await createUser()
    const floor = await createFloor({ level: 0 })
    const slot1 = await createSlot(floor.id)
    const slot2 = await createSlot(floor.id)
    const date = futureDate()
    await createBookingWithOtp(user.id, slot1.id, { date, startTime: '09:00', endTime: '18:00' })

    const body = await (await GET(makeRequest('/api/floors', {
      searchParams: { date, startTime: '09:00', endTime: '18:00' },
    }))).json()

    // slot1 booked, slot2 free → 1 available
    expect(body.data[0].availableSlots).toBe(1)
    void slot2 // used to silence unused variable warning
  })

  it('rejects invalid date format → 400', async () => {
    const res = await GET(makeRequest('/api/floors', { searchParams: { date: '01-06-2026' } }))
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('VALIDATION_ERROR')
  })

  it('rejects startTime ≥ endTime → 400', async () => {
    const res = await GET(makeRequest('/api/floors', {
      searchParams: { date: futureDate(), startTime: '18:00', endTime: '09:00' },
    }))
    expect(res.status).toBe(400)
  })
})

describe('GET /api/floors/:floorId/slots', () => {
  it('returns 401 without auth', async () => {
    const floor = await createFloor({ level: 0 })
    const res = await GET_SLOTS(
      makeRequest(`/api/floors/${floor.id}/slots`),
      routeParams({ floorId: floor.id })
    )
    expect(res.status).toBe(401)
  })

  it('returns 404 for a non-existent floor', async () => {
    const user = await createUser()
    const token = makeToken(user.id, user.email)
    const res = await GET_SLOTS(
      makeRequest('/api/floors/nonexistent/slots', { headers: bearer(token) }),
      routeParams({ floorId: 'nonexistent' })
    )
    expect(res.status).toBe(404)
  })

  it('returns all slots with isAvailable for an authenticated user', async () => {
    const user = await createUser()
    const floor = await createFloor({ level: 0 })
    await createSlot(floor.id)
    await createSlot(floor.id)
    const token = makeToken(user.id, user.email)

    const res = await GET_SLOTS(
      makeRequest(`/api/floors/${floor.id}/slots`, { headers: bearer(token) }),
      routeParams({ floorId: floor.id })
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.slots).toHaveLength(2)
    expect(body.data.slots.every((s: { isAvailable: boolean }) => s.isAvailable)).toBe(true)
  })

  it('marks a slot as unavailable when there is an active booking in the window', async () => {
    const user = await createUser()
    const floor = await createFloor({ level: 0 })
    const slot = await createSlot(floor.id)
    const date = futureDate()
    await createBookingWithOtp(user.id, slot.id, { date, startTime: '09:00', endTime: '18:00' })

    const token = makeToken(user.id, user.email)
    const res = await GET_SLOTS(
      makeRequest(`/api/floors/${floor.id}/slots`, {
        headers: bearer(token),
        searchParams: { date, startTime: '09:00', endTime: '18:00' },
      }),
      routeParams({ floorId: floor.id })
    )
    const body = await res.json()
    const s = body.data.slots.find((x: { id: string }) => x.id === slot.id)
    expect(s.isAvailable).toBe(false)
    expect(s.bookingId).toBeTruthy()
  })

  it('marks MAINTENANCE slots as unavailable regardless of bookings', async () => {
    const user = await createUser()
    const floor = await createFloor({ level: 0 })
    await createSlot(floor.id, { status: 'MAINTENANCE' })
    const token = makeToken(user.id, user.email)

    const res = await GET_SLOTS(
      makeRequest(`/api/floors/${floor.id}/slots`, { headers: bearer(token) }),
      routeParams({ floorId: floor.id })
    )
    const body = await res.json()
    expect(body.data.slots[0].isAvailable).toBe(false)
  })
})
