import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { getSlotAvailability, toUtcDate, toUtcDateTime } from '@/lib/slot'
import type { ApiError, ApiSuccess, FloorSummary } from '@/types'

const querySchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD')
    .optional(),
  startTime: z
    .string()
    .regex(/^\d{2}:\d{2}$/, 'startTime must be HH:MM')
    .optional(),
  endTime: z
    .string()
    .regex(/^\d{2}:\d{2}$/, 'endTime must be HH:MM')
    .optional(),
})

// GET /api/floors?date=YYYY-MM-DD&startTime=HH:MM&endTime=HH:MM
// Returns all active floors with available-slot counts for the requested window.
// date/startTime/endTime default to today full-day when omitted.
export async function GET(
  request: NextRequest
): Promise<NextResponse<ApiSuccess<FloorSummary[]> | ApiError>> {
  const params = Object.fromEntries(request.nextUrl.searchParams)
  const parsed = querySchema.safeParse(params)
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message ?? 'Invalid query' } },
      { status: 400 }
    )
  }

  const today = new Date().toISOString().slice(0, 10)
  const date = parsed.data.date ?? today
  const startTime = parsed.data.startTime ?? '00:00'
  const endTime = parsed.data.endTime ?? '23:59'

  if (startTime >= endTime) {
    return NextResponse.json(
      { error: { code: 'VALIDATION_ERROR', message: 'startTime must be before endTime' } },
      { status: 400 }
    )
  }

  const floors = await prisma.parkingFloor.findMany({
    where: { isActive: true },
    orderBy: { level: 'asc' },
    include: {
      slots: {
        where: { status: 'AVAILABLE' },
        select: { id: true },
      },
    },
  })

  type FloorRow = { id: string; name: string; level: number; description: string | null; totalSlots: number; slots: { id: string }[] }
  const floors_ = floors as FloorRow[]
  const allSlotIds = floors_.flatMap(f => f.slots.map(s => s.id))

  const availabilityMap = await getSlotAvailability(
    allSlotIds,
    toUtcDate(date),
    toUtcDateTime(date, startTime),
    toUtcDateTime(date, endTime)
  )

  const data: FloorSummary[] = floors_.map(f => ({
    id: f.id,
    name: f.name,
    level: f.level,
    description: f.description,
    totalSlots: f.totalSlots,
    availableSlots: f.slots.filter(s => availabilityMap.get(s.id)?.isAvailable ?? false).length,
  }))

  return NextResponse.json({ data })
}
