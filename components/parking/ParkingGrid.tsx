'use client'

import { useState, useCallback, useEffect } from 'react'
import { SlotCard } from './SlotCard'
import { BookingModal } from './BookingModal'
import { OTPModal } from './OTPModal'
import { floorsApi } from '@/lib/api'
import { Spinner } from '@/components/ui/Spinner'
import { todayISO } from '@/lib/utils'
import type { FloorSummary, SlotWithAvailability, CreateBookingResponse } from '@/types'

type Props = {
  floors: FloorSummary[]
}

export const ParkingGrid = ({ floors }: Props) => {
  const [selectedFloorId, setSelectedFloorId] = useState<string>(floors[0]?.id ?? '')
  const [date, setDate] = useState(todayISO())
  const [startTime, setStartTime] = useState('09:00')
  const [endTime, setEndTime] = useState('18:00')

  const [slots, setSlots] = useState<SlotWithAvailability[]>([])
  const [loadingSlots, setLoadingSlots] = useState(false)
  const [slotsError, setSlotsError] = useState('')

  const [selectedSlot, setSelectedSlot] = useState<SlotWithAvailability | null>(null)
  const [pendingBooking, setPendingBooking] = useState<CreateBookingResponse | null>(null)

  const selectedFloor = floors.find((f) => f.id === selectedFloorId)

  const fetchSlots = useCallback(async () => {
    if (!selectedFloorId) return
    setLoadingSlots(true)
    setSlotsError('')
    try {
      const data = await floorsApi.slots(selectedFloorId, { date, startTime, endTime })
      setSlots(data.slots)
    } catch {
      setSlotsError('Failed to load slots. Please refresh.')
    } finally {
      setLoadingSlots(false)
    }
  }, [selectedFloorId, date, startTime, endTime])

  useEffect(() => {
    void fetchSlots()
  }, [fetchSlots])

  function handleBooked(result: CreateBookingResponse) {
    setSelectedSlot(null)
    setPendingBooking(result)
  }

  function handleConfirmed() {
    setPendingBooking(null)
    void fetchSlots()
  }

  const rows = slots.reduce<Record<number, SlotWithAvailability[]>>((acc, slot) => {
    const r = slot.row ?? 0
    if (!acc[r]) acc[r] = []
    acc[r].push(slot)
    return acc
  }, {})

  return (
    <div className="space-y-6">
      {/* Controls */}
      <div className="flex flex-wrap gap-3 rounded-xl border border-slate-200 bg-white p-4">
        {/* Floor selector */}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-slate-500 uppercase tracking-wide">Floor</label>
          <select
            className="h-9 rounded-lg border border-slate-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={selectedFloorId}
            onChange={(e) => setSelectedFloorId(e.target.value)}
          >
            {floors.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name} ({f.availableSlots} free)
              </option>
            ))}
          </select>
        </div>

        {/* Date */}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-slate-500 uppercase tracking-wide">Date</label>
          <input
            type="date"
            min={todayISO()}
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="h-9 rounded-lg border border-slate-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Time range */}
        <div className="flex items-end gap-2">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-500 uppercase tracking-wide">From</label>
            <input
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              className="h-9 rounded-lg border border-slate-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <span className="pb-1.5 text-slate-400">–</span>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-500 uppercase tracking-wide">To</label>
            <input
              type="time"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              className="h-9 rounded-lg border border-slate-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-4 text-xs">
        {[
          { color: 'bg-green-100 border-green-400', label: 'Available' },
          { color: 'bg-amber-100 border-amber-400', label: 'Reserved' },
          { color: 'bg-red-100 border-red-400', label: 'Occupied' },
          { color: 'bg-slate-100 border-slate-300', label: 'Maintenance' },
        ].map(({ color, label }) => (
          <span key={label} className="flex items-center gap-1.5">
            <span className={`h-3 w-3 rounded border ${color}`} />
            {label}
          </span>
        ))}
        <span className="flex items-center gap-1.5">
          <span className="text-emerald-600">⚡</span> EV Charging
        </span>
      </div>

      {/* Grid */}
      {loadingSlots ? (
        <div className="flex h-48 items-center justify-center">
          <Spinner size="lg" />
        </div>
      ) : slotsError ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center text-sm text-red-600">
          {slotsError}
        </div>
      ) : slots.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-10 text-center text-sm text-slate-500">
          No slots found for this floor.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white p-4">
          <p className="mb-3 text-xs font-medium text-slate-500 uppercase tracking-wide">
            {selectedFloor?.name} — Click an available slot to book
          </p>
          <div className="space-y-2">
            {Object.entries(rows)
              .sort(([a], [b]) => Number(a) - Number(b))
              .map(([row, rowSlots]) => (
                <div key={row} className="flex flex-wrap gap-2">
                  {rowSlots
                    .sort((a, b) => (a.column ?? 0) - (b.column ?? 0))
                    .map((slot) => (
                      <SlotCard
                        key={slot.id}
                        slot={slot}
                        selected={selectedSlot?.id === slot.id}
                        onClick={slot.isAvailable ? () => setSelectedSlot(slot) : undefined}
                      />
                    ))}
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Modals */}
      {selectedSlot && selectedFloor && (
        <BookingModal
          slot={selectedSlot}
          floorName={selectedFloor.name}
          open={Boolean(selectedSlot)}
          onClose={() => setSelectedSlot(null)}
          onBooked={handleBooked}
        />
      )}

      {pendingBooking && (
        <OTPModal
          booking={pendingBooking}
          open={Boolean(pendingBooking)}
          onClose={() => {
            setPendingBooking(null)
            void fetchSlots()
          }}
          onConfirmed={handleConfirmed}
        />
      )}
    </div>
  )
}
