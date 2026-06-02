import { prisma } from './prisma'

type BookingStatus = 'PENDING_OTP' | 'CONFIRMED' | 'CANCELLED' | 'EXPIRED' | 'NO_SHOW'

export type SlotAvailabilityEntry = {
  isAvailable: boolean
  bookingId: string | null
  bookingStatus: BookingStatus | null
}

export type SlotAvailabilityMap = Map<string, SlotAvailabilityEntry>

// Returns a map of slotId → availability for the given date + time window.
// A slot is unavailable if a PENDING_OTP or CONFIRMED booking overlaps the window.
export async function getSlotAvailability(
  slotIds: string[],
  date: Date,
  startTime: Date,
  endTime: Date
): Promise<SlotAvailabilityMap> {
  const map: SlotAvailabilityMap = new Map(
    slotIds.map(id => [id, { isAvailable: true, bookingId: null, bookingStatus: null }])
  )

  if (slotIds.length === 0) return map

  const bookings = await prisma.booking.findMany({
    where: {
      slotId: { in: slotIds },
      date,
      status: { in: ['PENDING_OTP', 'CONFIRMED'] },
      // Overlap: booking starts before our end AND booking ends after our start
      startTime: { lt: endTime },
      endTime: { gt: startTime },
    },
    select: { slotId: true, id: true, status: true },
  })

  for (const b of bookings as { slotId: string; id: string; status: BookingStatus }[]) {
    map.set(b.slotId, {
      isAvailable: false,
      bookingId: b.id,
      bookingStatus: b.status,
    })
  }

  return map
}

// Build a UTC Date for a date + HH:MM time string pair.
export function toUtcDateTime(date: string, time: string): Date {
  return new Date(`${date}T${time}:00.000Z`)
}

// Build a UTC Date for just the date (midnight), used for @db.Date fields.
export function toUtcDate(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`)
}
