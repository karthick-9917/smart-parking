import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { getSlotAvailability, toUtcDate, toUtcDateTime } from '@/lib/slot'
import type { ApiError, ApiSuccess, FloorSlotsResponse, SlotWithAvailability } from '@/types'

const querySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD').optional(),
  startTime: z.string().regex(/^\d{2}:\d{2}$/, 'startTime must be HH:MM').optional(),
  endTime: z.string().regex(/^\d{2}:\d{2}$/, 'endTime must be HH:MM').optional(),
})

// GET /api/floors/[floorId]/slots?date=YYYY-MM-DD&startTime=HH:MM&endTime=HH:MM
// Returns every slot on the floor annotated with real-time booking availability.
// Requires authentication.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ floorId: string }> }
): Promise<NextResponse<ApiSuccess<FloorSlotsResponse> | ApiError>> {
  const user = getAuthUser(request)
  if (!user) {
    return NextResponse.json(
      { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } },
      { status: 401 }
    )
  }

  const { floorId } = await params

  const rawParams = Object.fromEntries(request.nextUrl.searchParams)
  const parsed = querySchema.safeParse(rawParams)
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

  const floor = await prisma.parkingFloor.findUnique({
    where: { id: floorId, isActive: true },
    include: {
      slots: {
        orderBy: [{ row: 'asc' }, { column: 'asc' }],
      },
    },
  })

  if (!floor) {
    return NextResponse.json(
      { error: { code: 'NOT_FOUND', message: 'Floor not found' } },
      { status: 404 }
    )
  }

  type SlotRow = {
    id: string; label: string; zone: string; row: number; column: number
    status: string; isEVCharging: boolean; isHandicap: boolean; notes: string | null
  }
  const slots_ = floor.slots as SlotRow[]
  const slotIds = slots_.map(s => s.id)

  const availabilityMap = await getSlotAvailability(
    slotIds,
    toUtcDate(date),
    toUtcDateTime(date, startTime),
    toUtcDateTime(date, endTime)
  )

  const slots: SlotWithAvailability[] = slots_.map(slot => {
    const avail = availabilityMap.get(slot.id)!
    return {
      id: slot.id,
      label: slot.label,
      zone: slot.zone,
      row: slot.row,
      column: slot.column,
      status: slot.status as SlotWithAvailability['status'],
      isEVCharging: slot.isEVCharging,
      isHandicap: slot.isHandicap,
      notes: slot.notes,
      // isAvailable: physical status must be AVAILABLE AND no booking conflict
      isAvailable: slot.status === 'AVAILABLE' && avail.isAvailable,
      bookingId: avail.bookingId,
      bookingStatus: avail.bookingStatus as SlotWithAvailability['bookingStatus'],
    }
  })

  return NextResponse.json({
    data: {
      floor: { id: floor.id, name: floor.name, level: floor.level },
      slots,
      date,
      startTime,
      endTime,
    },
  })
}
