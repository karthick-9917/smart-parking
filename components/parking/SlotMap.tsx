'use client'

import { useState, useMemo } from 'react'
import { SlotCell } from './SlotCell'
import { BookingModal } from './BookingModal'
import { OTPModal } from './OTPModal'
import { useSlotUpdates } from '@/hooks/useSlotUpdates'
import { Spinner } from '@/components/ui/Spinner'
import { Button } from '@/components/ui/Button'
import { cn, todayISO, formatTime } from '@/lib/utils'
import type { FloorSummary, SlotWithAvailability, CreateBookingResponse } from '@/types'

type Props = { floors: FloorSummary[] }

const TIME_OPTIONS = [
  '06:00', '07:00', '08:00', '09:00', '10:00', '11:00', '12:00',
  '13:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00',
  '20:00', '21:00', '22:00',
]

// Convert numeric row → letter (0→A, 1→B, …)
function rowLabel(row: number) {
  return String.fromCharCode(65 + row)
}

// ─── Legend ───────────────────────────────────────────────────────────────────

const LEGEND = [
  { color: 'bg-[#1a2744] border-[#2a3d6e]', label: 'Available' },
  { color: 'bg-[#f5c518] border-[#e6b800]', label: 'Selected' },
  { color: 'bg-[#2d2a18] border-[#4a4520]', label: 'Reserved' },
  { color: 'bg-[#2a1a1a] border-[#4a2a2a]', label: 'Occupied' },
  { color: 'bg-[#1e1e1e] border-[#333]',    label: 'Maintenance' },
]

// ─── Live status badge ────────────────────────────────────────────────────────

const LiveBadge = ({ isLive, lastUpdated }: { isLive: boolean; lastUpdated: Date | null }) => (
  <div className={cn(
    'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium',
    isLive
      ? 'border-green-800 bg-green-950/60 text-green-400'
      : 'border-amber-800 bg-amber-950/60 text-amber-400'
  )}>
    <span className={cn(
      'h-1.5 w-1.5 rounded-full',
      isLive ? 'bg-green-400 animate-pulse' : 'bg-amber-400'
    )} />
    {isLive
      ? lastUpdated ? `Live · ${lastUpdated.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}` : 'Live'
      : 'Reconnecting…'}
  </div>
)

// ─── Entrance visual ──────────────────────────────────────────────────────────

const EntranceBar = () => (
  <div className="flex items-center gap-3 py-4">
    <div className="h-px flex-1 bg-gradient-to-r from-transparent via-slate-600 to-slate-600" />
    <div className="flex items-center gap-2 rounded-full border border-dashed border-slate-600 px-4 py-1.5">
      <svg className="h-3.5 w-3.5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
      </svg>
      <span className="text-[11px] font-semibold tracking-[0.25em] text-slate-400 uppercase">
        Entrance
      </span>
    </div>
    <div className="h-px flex-1 bg-gradient-to-l from-transparent via-slate-600 to-slate-600" />
  </div>
)

// ─── Slot grid ────────────────────────────────────────────────────────────────

type GridProps = {
  rows: [number, SlotWithAvailability[]][]
  selectedId: string | null
  flashingSlots: Set<string>
  onSelect: (slot: SlotWithAvailability) => void
  midCol: number
}

const SlotGrid = ({ rows, selectedId, flashingSlots, onSelect, midCol }: GridProps) => {
  if (rows.length === 0) return null

  const allCols = [...new Set(rows.flatMap(([, slots]) => slots.map((s) => s.column ?? 0)))].sort(
    (a, b) => a - b
  )

  const leftCols  = allCols.filter((c) => c <= midCol)
  const rightCols = allCols.filter((c) => c > midCol)

  return (
    <div className="space-y-1.5">
      {/* Column header */}
      <div className="flex items-center gap-1 pl-8 text-[10px] text-slate-600">
        {leftCols.map((c) => (
          <span key={c} className="flex w-[54px] items-center justify-center">{c + 1}</span>
        ))}
        {leftCols.length > 0 && rightCols.length > 0 && <span className="w-8" />}
        {rightCols.map((c) => (
          <span key={c} className="flex w-[54px] items-center justify-center">{c + 1}</span>
        ))}
      </div>

      {/* Rows */}
      {rows.map(([rowNum, rowSlots]) => {
        const byCol = Object.fromEntries(rowSlots.map((s) => [s.column ?? 0, s]))
        return (
          <div key={rowNum} className="flex items-center gap-1">
            {/* Row label */}
            <span className="flex w-7 items-center justify-center text-xs font-bold text-slate-500">
              {rowLabel(rowNum)}
            </span>

            {/* Left bay */}
            {leftCols.map((c) => {
              const slot = byCol[c]
              return slot ? (
                <SlotCell
                  key={slot.id}
                  slot={slot}
                  isSelected={selectedId === slot.id}
                  isFlashing={flashingSlots.has(slot.id)}
                  onClick={slot.isAvailable ? () => onSelect(slot) : undefined}
                />
              ) : (
                <div key={c} className="w-[54px] h-[46px]" />
              )
            })}

            {/* Aisle */}
            {leftCols.length > 0 && rightCols.length > 0 && (
              <div className="flex w-8 items-center justify-center">
                <div className="h-full border-l border-dashed border-slate-700" />
              </div>
            )}

            {/* Right bay */}
            {rightCols.map((c) => {
              const slot = byCol[c]
              return slot ? (
                <SlotCell
                  key={slot.id}
                  slot={slot}
                  isSelected={selectedId === slot.id}
                  isFlashing={flashingSlots.has(slot.id)}
                  onClick={slot.isAvailable ? () => onSelect(slot) : undefined}
                />
              ) : (
                <div key={c} className="w-[54px] h-[46px]" />
              )
            })}
          </div>
        )
      })}
    </div>
  )
}

// ─── Selection bar ────────────────────────────────────────────────────────────

const SelectionBar = ({
  slot,
  floorName,
  startTime,
  endTime,
  onBook,
  onClear,
}: {
  slot: SlotWithAvailability
  floorName: string
  startTime: string
  endTime: string
  onBook: () => void
  onClear: () => void
}) => (
  <div className="animate-slide-up fixed bottom-0 inset-x-0 z-30 border-t border-slate-700 bg-[#0d1117]/95 backdrop-blur-md px-4 py-4 sm:px-6">
    <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
      <div className="flex items-center gap-4">
        {/* Slot badge */}
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[#f5c518] text-sm font-black text-[#1a1a1a]">
          {slot.label}
        </div>
        <div>
          <p className="text-sm font-semibold text-white">
            Slot {slot.label}
            {slot.isEVCharging && <span className="ml-1.5 text-emerald-400">⚡ EV</span>}
            {slot.isHandicap && <span className="ml-1 text-blue-400">♿</span>}
          </p>
          <p className="text-xs text-slate-400">
            {floorName} · {formatTime(`1970-01-01T${startTime}:00Z`)} – {formatTime(`1970-01-01T${endTime}:00Z`)}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={onClear}
          className="text-sm text-slate-400 hover:text-white transition-colors"
        >
          Clear
        </button>
        <Button
          onClick={onBook}
          className="bg-[#f5c518] text-[#1a1a1a] hover:bg-[#f0bc00] font-bold px-6"
        >
          Book Now →
        </Button>
      </div>
    </div>
  </div>
)

// ─── Main component ───────────────────────────────────────────────────────────

export const SlotMap = ({ floors }: Props) => {
  const [selectedFloorId, setSelectedFloorId] = useState(floors[0]?.id ?? '')
  const [date, setDate] = useState(todayISO())
  const [startTime, setStartTime] = useState('09:00')
  const [endTime, setEndTime] = useState('18:00')

  const [selectedSlot, setSelectedSlot] = useState<SlotWithAvailability | null>(null)
  const [bookingSlot, setBookingSlot] = useState<SlotWithAvailability | null>(null)
  const [pendingBooking, setPendingBooking] = useState<CreateBookingResponse | null>(null)

  const { slots, loading, error, isLive, flashingSlots, lastUpdated, refresh } =
    useSlotUpdates(selectedFloorId, date, startTime, endTime)

  const selectedFloor = floors.find((f) => f.id === selectedFloorId)

  // Build sorted rows
  const rows = useMemo<[number, SlotWithAvailability[]][]>(() => {
    const map = new Map<number, SlotWithAvailability[]>()
    for (const s of slots) {
      const r = s.row ?? 0
      if (!map.has(r)) map.set(r, [])
      map.get(r)!.push(s)
    }
    return [...map.entries()]
      .sort(([a], [b]) => a - b)
      .map(([r, ss]) => [r, ss.sort((a, b) => (a.column ?? 0) - (b.column ?? 0))])
  }, [slots])

  // Midpoint column for aisle split
  const midCol = useMemo(() => {
    if (rows.length === 0) return 0
    const allCols = rows.flatMap(([, ss]) => ss.map((s) => s.column ?? 0))
    const max = Math.max(...allCols, 0)
    return Math.floor(max / 2)
  }, [rows])

  const availableCount = slots.filter((s) => s.isAvailable).length

  function handleBook() {
    if (!selectedSlot) return
    setBookingSlot(selectedSlot)
    setSelectedSlot(null)
  }

  function handleBooked(result: CreateBookingResponse) {
    setBookingSlot(null)
    setPendingBooking(result)
  }

  function handleConfirmed() {
    setPendingBooking(null)
    void refresh()
  }

  return (
    // Dark cinema-style background
    <div className="min-h-screen bg-[#0d1117] pb-28 pt-2">
      {/* ── Top controls ───────────────────────────────────────────────────── */}
      <div className="sticky top-0 z-20 border-b border-slate-800 bg-[#0d1117]/95 backdrop-blur-md px-4 py-3 sm:px-6">
        <div className="mx-auto flex max-w-7xl flex-wrap items-end gap-3">
          {/* Floor */}
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Floor
            </label>
            <select
              value={selectedFloorId}
              onChange={(e) => { setSelectedFloorId(e.target.value); setSelectedSlot(null) }}
              className="h-9 rounded-lg border border-slate-700 bg-[#161b22] px-3 text-sm text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              {floors.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name} — {f.availableSlots} free
                </option>
              ))}
            </select>
          </div>

          {/* Date */}
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Date
            </label>
            <input
              type="date"
              min={todayISO()}
              value={date}
              onChange={(e) => { setDate(e.target.value); setSelectedSlot(null) }}
              className="h-9 rounded-lg border border-slate-700 bg-[#161b22] px-3 text-sm text-white focus:outline-none focus:ring-1 focus:ring-blue-500 [color-scheme:dark]"
            />
          </div>

          {/* Time */}
          <div className="flex items-end gap-2">
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">From</label>
              <select
                value={startTime}
                onChange={(e) => { setStartTime(e.target.value); setSelectedSlot(null) }}
                className="h-9 rounded-lg border border-slate-700 bg-[#161b22] px-3 text-sm text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                {TIME_OPTIONS.slice(0, -1).map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <span className="pb-2 text-slate-600">–</span>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">To</label>
              <select
                value={endTime}
                onChange={(e) => { setEndTime(e.target.value); setSelectedSlot(null) }}
                className="h-9 rounded-lg border border-slate-700 bg-[#161b22] px-3 text-sm text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                {TIME_OPTIONS.slice(1).map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>

          {/* Live badge + count */}
          <div className="ml-auto flex items-center gap-3 pb-0.5">
            <span className="text-xs text-slate-500">
              <span className="font-semibold text-slate-300">{availableCount}</span> slots free
            </span>
            <LiveBadge isLive={isLive} lastUpdated={lastUpdated} />
          </div>
        </div>
      </div>

      {/* ── Main map area ────────────────────────────────────────────────────── */}
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <EntranceBar />

        {loading ? (
          <div className="flex h-64 items-center justify-center">
            <div className="flex flex-col items-center gap-3">
              <Spinner size="lg" className="border-slate-700 border-t-blue-500" />
              <p className="text-sm text-slate-500">Loading parking map…</p>
            </div>
          </div>
        ) : error ? (
          <div className="flex h-48 flex-col items-center justify-center gap-3">
            <p className="text-sm text-red-400">{error}</p>
            <button
              onClick={() => void refresh()}
              className="text-xs font-medium text-blue-400 hover:text-blue-300 underline"
            >
              Retry
            </button>
          </div>
        ) : slots.length === 0 ? (
          <div className="flex h-48 items-center justify-center">
            <p className="text-sm text-slate-500">No slots configured for this floor.</p>
          </div>
        ) : (
          <>
            {/* ── Overflow scroll on small screens ─────────────────────────── */}
            <div className="overflow-x-auto pb-4">
              <SlotGrid
                rows={rows}
                selectedId={selectedSlot?.id ?? null}
                flashingSlots={flashingSlots}
                onSelect={(slot) => setSelectedSlot((prev) => prev?.id === slot.id ? null : slot)}
                midCol={midCol}
              />
            </div>

            {/* ── Legend ───────────────────────────────────────────────────── */}
            <div className="mt-8 flex flex-wrap justify-center gap-5 border-t border-slate-800 pt-6">
              {LEGEND.map(({ color, label }) => (
                <span key={label} className="flex items-center gap-2 text-xs text-slate-400">
                  <span className={cn('h-[14px] w-[18px] rounded-sm border-2', color)} />
                  {label}
                </span>
              ))}
              <span className="flex items-center gap-2 text-xs text-slate-400">
                <span className="text-emerald-400">⚡</span> EV Charging
              </span>
              <span className="flex items-center gap-2 text-xs text-slate-400">
                <span className="text-blue-400">♿</span> Accessible
              </span>
            </div>

            {/* ── Tap hint ─────────────────────────────────────────────────── */}
            {!selectedSlot && availableCount > 0 && (
              <p className="mt-4 text-center text-xs text-slate-600">
                Tap an available slot to select it
              </p>
            )}
          </>
        )}
      </div>

      {/* ── Selection bar (sticky bottom) ─────────────────────────────────── */}
      {selectedSlot && selectedFloor && (
        <SelectionBar
          slot={selectedSlot}
          floorName={selectedFloor.name}
          startTime={startTime}
          endTime={endTime}
          onBook={handleBook}
          onClear={() => setSelectedSlot(null)}
        />
      )}

      {/* ── Booking modal ──────────────────────────────────────────────────── */}
      {bookingSlot && selectedFloor && (
        <BookingModal
          slot={bookingSlot}
          floorName={selectedFloor.name}
          open
          onClose={() => setBookingSlot(null)}
          onBooked={handleBooked}
        />
      )}

      {/* ── OTP modal ─────────────────────────────────────────────────────── */}
      {pendingBooking && (
        <OTPModal
          booking={pendingBooking}
          open
          onClose={() => { setPendingBooking(null); void refresh() }}
          onConfirmed={handleConfirmed}
        />
      )}
    </div>
  )
}
