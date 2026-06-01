'use client'

import { useState, useEffect, useCallback } from 'react'
import { bookingsApi, floorsApi, ApiError } from '@/lib/api'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { formatDate, formatTime } from '@/lib/utils'
import type { BookingItem, FloorSummary, SlotWithAvailability } from '@/types'

type Tab = 'overview' | 'bookings' | 'slots'

const STATUS_LABELS: Record<string, string> = {
  PENDING_OTP: 'Pending OTP',
  CONFIRMED: 'Confirmed',
  CANCELLED: 'Cancelled',
  EXPIRED: 'Expired',
}

const badgeVariant = (status: string) => {
  if (status === 'CONFIRMED') return 'success'
  if (status === 'PENDING_OTP') return 'warning'
  if (status === 'CANCELLED' || status === 'EXPIRED') return 'error'
  return 'neutral'
}

export const AdminPanel = () => {
  const [tab, setTab] = useState<Tab>('overview')

  return (
    <div className="space-y-6">
      {/* Tabs */}
      <div className="flex gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1 w-fit">
        {(['overview', 'bookings', 'slots'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-lg px-4 py-2 text-sm font-medium capitalize transition-colors ${
              tab === t ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'overview' && <OverviewTab />}
      {tab === 'bookings' && <AllBookingsTab />}
      {tab === 'slots' && <SlotsTab />}
    </div>
  )
}

// ─── Overview ─────────────────────────────────────────────────────────────────

const OverviewTab = () => {
  const [floors, setFloors] = useState<FloorSummary[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    floorsApi
      .list()
      .then(setFloors)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="flex h-40 items-center justify-center"><Spinner /></div>

  const totalSlots = floors.reduce((a, f) => a + f.totalSlots, 0)
  const totalAvailable = floors.reduce((a, f) => a + f.availableSlots, 0)
  const occupancyRate = totalSlots > 0 ? Math.round(((totalSlots - totalAvailable) / totalSlots) * 100) : 0

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        {[
          { label: 'Total Floors', value: floors.length },
          { label: 'Total Slots', value: totalSlots },
          { label: 'Occupancy', value: `${occupancyRate}%` },
        ].map(({ label, value }) => (
          <div key={label} className="rounded-xl border border-slate-200 bg-white p-5">
            <p className="text-2xl font-bold text-slate-900">{value}</p>
            <p className="text-sm text-slate-600">{label}</p>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100">
          <h3 className="font-semibold text-slate-900">Floor Occupancy</h3>
        </div>
        <div className="divide-y divide-slate-100">
          {floors.map((floor) => {
            const used = floor.totalSlots - floor.availableSlots
            const pct = floor.totalSlots > 0 ? Math.round((used / floor.totalSlots) * 100) : 0
            return (
              <div key={floor.id} className="px-5 py-4">
                <div className="mb-2 flex items-center justify-between">
                  <span className="font-medium text-slate-800">{floor.name}</span>
                  <span className="text-sm text-slate-500">{used}/{floor.totalSlots} used ({pct}%)</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full bg-blue-500 transition-all"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ─── All Bookings ─────────────────────────────────────────────────────────────

const AllBookingsTab = () => {
  const [bookings, setBookings] = useState<BookingItem[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [cancelling, setCancelling] = useState<string | null>(null)
  const [error, setError] = useState('')
  const LIMIT = 10

  const fetchBookings = useCallback(async () => {
    setLoading(true)
    try {
      const data = await bookingsApi.list({ page: String(page), limit: String(LIMIT) })
      setBookings(data.bookings)
      setTotal(data.total)
    } catch {
      setError('Failed to load bookings.')
    } finally {
      setLoading(false)
    }
  }, [page])

  useEffect(() => { void fetchBookings() }, [fetchBookings])

  async function handleCancel(id: string) {
    setCancelling(id)
    try {
      await bookingsApi.cancel(id)
      void fetchBookings()
    } catch (err) {
      if (err instanceof ApiError) setError(err.message)
    } finally {
      setCancelling(null)
    }
  }

  const totalPages = Math.ceil(total / LIMIT)

  if (loading) return <div className="flex h-40 items-center justify-center"><Spinner /></div>

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{error}</div>
      )}
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50">
              <th className="px-4 py-3 text-left font-medium text-slate-600">Employee</th>
              <th className="px-4 py-3 text-left font-medium text-slate-600">Date</th>
              <th className="px-4 py-3 text-left font-medium text-slate-600">Time</th>
              <th className="px-4 py-3 text-left font-medium text-slate-600">Slot</th>
              <th className="px-4 py-3 text-left font-medium text-slate-600">Status</th>
              <th className="px-4 py-3 text-right font-medium text-slate-600">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {bookings.map((b) => (
              <tr key={b.id} className="hover:bg-slate-50">
                <td className="px-4 py-3 text-slate-700 font-medium">{b.slot.label} — {b.slot.floor?.name}</td>
                <td className="px-4 py-3 text-slate-600">{formatDate(b.date)}</td>
                <td className="px-4 py-3 text-slate-600">{formatTime(b.startTime)}–{formatTime(b.endTime)}</td>
                <td className="px-4 py-3 font-medium text-slate-900">{b.slot.label}</td>
                <td className="px-4 py-3">
                  <Badge variant={badgeVariant(b.status)}>{STATUS_LABELS[b.status] ?? b.status}</Badge>
                </td>
                <td className="px-4 py-3 text-right">
                  {(b.status === 'PENDING_OTP' || b.status === 'CONFIRMED') && (
                    <Button variant="danger" size="sm" loading={cancelling === b.id} onClick={() => handleCancel(b.id)}>
                      Cancel
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {totalPages > 1 && (
        <div className="flex justify-end gap-2">
          <Button variant="secondary" size="sm" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
          <Button variant="secondary" size="sm" disabled={page === totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
        </div>
      )}
    </div>
  )
}

// ─── Slots ────────────────────────────────────────────────────────────────────

const SlotsTab = () => {
  const [floors, setFloors] = useState<FloorSummary[]>([])
  const [selectedFloorId, setSelectedFloorId] = useState('')
  const [slots, setSlots] = useState<SlotWithAvailability[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    floorsApi.list().then((data) => {
      setFloors(data)
      if (data[0]) setSelectedFloorId(data[0].id)
    }).catch(() => {})
  }, [])

  useEffect(() => {
    if (!selectedFloorId) return
    setLoading(true)
    floorsApi.slots(selectedFloorId).then((data) => setSlots(data.slots)).catch(() => {}).finally(() => setLoading(false))
  }, [selectedFloorId])

  const slotStatusColor: Record<string, string> = {
    AVAILABLE: 'bg-green-50 text-green-700',
    RESERVED: 'bg-amber-50 text-amber-700',
    OCCUPIED: 'bg-red-50 text-red-700',
    MAINTENANCE: 'bg-slate-100 text-slate-600',
  }

  return (
    <div className="space-y-4">
      <select
        className="h-9 rounded-lg border border-slate-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        value={selectedFloorId}
        onChange={(e) => setSelectedFloorId(e.target.value)}
      >
        {floors.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
      </select>

      {loading ? (
        <div className="flex h-40 items-center justify-center"><Spinner /></div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50">
                <th className="px-4 py-3 text-left font-medium text-slate-600">Label</th>
                <th className="px-4 py-3 text-left font-medium text-slate-600">Zone</th>
                <th className="px-4 py-3 text-left font-medium text-slate-600">Status</th>
                <th className="px-4 py-3 text-left font-medium text-slate-600">Features</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {slots.map((s) => (
                <tr key={s.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-semibold text-slate-900">{s.label}</td>
                  <td className="px-4 py-3 text-slate-600">{s.zone ?? '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${slotStatusColor[s.status] ?? ''}`}>
                      {s.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-500">
                    {[s.isEVCharging && '⚡ EV', s.isHandicap && '♿'].filter(Boolean).join(' ') || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
