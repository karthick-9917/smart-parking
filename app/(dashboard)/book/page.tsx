import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { verifyToken } from '@/lib/auth'
import { ParkingGrid } from '@/components/parking/ParkingGrid'
import type { FloorSummary } from '@/types'

export const metadata = { title: 'Book a Slot — SmartPark' }

async function getFloors(): Promise<FloorSummary[]> {
  const floors = await prisma.parkingFloor.findMany({
    where: { isActive: true },
    orderBy: { level: 'asc' },
    include: { _count: { select: { slots: { where: { status: 'AVAILABLE' } } } } },
  })

  type FloorRow = (typeof floors)[number]
  return floors.map((f: FloorRow) => ({
    id: f.id,
    name: f.name,
    level: f.level,
    description: f.description ?? null,
    totalSlots: f.totalSlots,
    availableSlots: f._count.slots,
  }))
}

export default async function BookPage() {
  // Verify auth server-side to avoid client flash
  const cookieStore = await cookies()
  const token = cookieStore.get('auth-token')?.value
  if (!token) redirect('/login')

  try {
    verifyToken(token)
  } catch {
    redirect('/login')
  }

  const floors = await getFloors()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Book a Parking Slot</h1>
        <p className="mt-1 text-sm text-slate-500">
          Select a floor, date, and time window, then click an available slot to proceed.
        </p>
      </div>

      {floors.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-12 text-center">
          <p className="text-slate-500">No parking floors are currently available.</p>
          <p className="mt-1 text-sm text-slate-400">Please contact your admin.</p>
        </div>
      ) : (
        <ParkingGrid floors={floors} />
      )}
    </div>
  )
}
