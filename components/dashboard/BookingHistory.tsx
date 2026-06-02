'use client'

import { useState, useEffect, useCallback } from 'react'
import { bookingsApi, ApiError } from '@/lib/api'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { formatDate, formatTime, cn } from '@/lib/utils'
import { useAuth } from '@/lib/context/auth'
import { useBookingUpdates } from '@/hooks/useBookingUpdates'
import type { BookingItem, BookingUpdateEvent } from '@/types'

type StatusFilter = 'ALL' | 'PENDING_OTP' | 'CONFIRMED' | 'CANCELLED' | 'EXPIRED'

const badgeVariant = (status: string) => {
  if (status === 'CONFIRMED') return 'success'
  if (status === 'PENDING_OTP') return 'warning'
  if (status === 'CANCELLED') return 'error'
  return 'neutral'
}

const STATUS_LABELS: Record<string, string> = {
  PENDING_OTP: 'Pending OTP',
  CONFIRMED: 'Confirmed',
  CANCELLED: 'Cancelled',
  EXPIRED: 'Expired',
  NO_SHOW: 'No Show',
}

export const BookingHistory = () => {
  const { user } = useAuth()
  const [bookings, setBookings] = useState<BookingItem[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL')
  const [loading, setLoading] = useState(true)
  const [cancelling, setCancelling] = useState<string | null>(null)
  const [error, setError] = useState('')

  const LIMIT = 8

  const fetchBookings = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await bookingsApi.list({
        status: statusFilter === 'ALL' ? undefined : statusFilter,
        page: String(page),
        limit: String(LIMIT),
      })
      setBookings(data.bookings)
      setTotal(data.total)
    } catch {
      setError('Failed to load bookings.')
    } finally {
      setLoading(false)
    }
  }, [statusFilter, page])

  useEffect(() => {
    void fetchBookings()
  }, [fetchBookings])

  const handleBookingUpdate = useCallback((event: BookingUpdateEvent) => {
    setBookings((prev) =>
      prev.map((b) =>
        b.id === event.bookingId
          ? {
              ...b,
              status: event.status,
              confirmedAt: event.confirmedAt,
              cancelledAt: event.cancelledAt,
            }
          : b
      )
    )
  }, [])

  const { isLive } = useBookingUpdates(user?.id ?? null, handleBookingUpdate)

  async function handleCancel(bookingId: string) {
    setCancelling(bookingId)
    try {
      await bookingsApi.cancel(bookingId)
      void fetchBookings()
    } catch (err) {
      if (err instanceof ApiError) setError(err.message)
    } finally {
      setCancelling(null)
    }
  }

  const totalPages = Math.ceil(total / LIMIT)

  return (
    <div className="space-y-4">
      {/* Filter + live badge */}
      <div className="flex flex-wrap items-center gap-2">
        <div className={cn(
          'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium',
          isLive
            ? 'border-green-200 bg-green-50 text-green-700'
            : 'border-amber-200 bg-amber-50 text-amber-700'
        )}>
          <span className={cn('h-1.5 w-1.5 rounded-full', isLive ? 'bg-green-500 animate-pulse' : 'bg-amber-400')} />
          {isLive ? 'Live' : 'Connecting…'}
        </div>
        {(['ALL', 'PENDING_OTP', 'CONFIRMED', 'CANCELLED'] as StatusFilter[]).map((s) => (
          <button
            key={s}
            onClick={() => { setStatusFilter(s); setPage(1) }}
            className={`rounded-full px-3 py-1 text-sm font-medium transition-colors ${
              statusFilter === s
                ? 'bg-blue-600 text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            {s === 'ALL' ? 'All' : STATUS_LABELS[s]}
          </button>
        ))}
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex h-40 items-center justify-center">
          <Spinner />
        </div>
      ) : bookings.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-10 text-center text-sm text-slate-500">
          No bookings found.
        </div>
      ) : (
        <>
          {/* Table */}
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50">
                  <th className="px-4 py-3 text-left font-medium text-slate-600">Date</th>
                  <th className="px-4 py-3 text-left font-medium text-slate-600">Time</th>
                  <th className="px-4 py-3 text-left font-medium text-slate-600">Slot</th>
                  <th className="px-4 py-3 text-left font-medium text-slate-600">Floor</th>
                  <th className="px-4 py-3 text-left font-medium text-slate-600">Status</th>
                  <th className="px-4 py-3 text-right font-medium text-slate-600">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {bookings.map((b) => (
                  <tr key={b.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 text-slate-700">{formatDate(b.date)}</td>
                    <td className="px-4 py-3 text-slate-600">
                      {formatTime(b.startTime)} – {formatTime(b.endTime)}
                    </td>
                    <td className="px-4 py-3 font-medium text-slate-900">{b.slot.label}</td>
                    <td className="px-4 py-3 text-slate-600">{b.slot.floor?.name ?? '—'}</td>
                    <td className="px-4 py-3">
                      <Badge variant={badgeVariant(b.status)}>
                        {STATUS_LABELS[b.status] ?? b.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {(b.status === 'PENDING_OTP' || b.status === 'CONFIRMED') && (
                        <Button
                          variant="danger"
                          size="sm"
                          loading={cancelling === b.id}
                          onClick={() => handleCancel(b.id)}
                        >
                          Cancel
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between">
              <p className="text-sm text-slate-500">
                {(page - 1) * LIMIT + 1}–{Math.min(page * LIMIT, total)} of {total}
              </p>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={page === 1}
                  onClick={() => setPage((p) => p - 1)}
                >
                  Previous
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={page === totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
