'use client'

import { useEffect, useState } from 'react'
import { useAuth } from '@/lib/context/auth'
import { bookingsApi, floorsApi } from '@/lib/api'
import { DashboardStats } from '@/components/dashboard/DashboardStats'
import { BookingHistory } from '@/components/dashboard/BookingHistory'
import { Spinner } from '@/components/ui/Spinner'
import Link from 'next/link'

export default function DashboardPage() {
  const { user } = useAuth()

  const [stats, setStats] = useState({
    totalBookings: 0,
    activeBookings: 0,
    confirmedToday: 0,
    availableNow: 0,
  })
  const [loadingStats, setLoadingStats] = useState(true)

  useEffect(() => {
    async function fetchStats() {
      try {
        const [all, active, floors] = await Promise.all([
          bookingsApi.list({ limit: '1' }),
          bookingsApi.list({ status: 'PENDING_OTP', limit: '1' }),
          floorsApi.list(),
        ])
        const confirmed = await bookingsApi.list({
          status: 'CONFIRMED',
          date: new Date().toISOString().slice(0, 10),
          limit: '1',
        })
        const totalAvailable = floors.reduce((a, f) => a + f.availableSlots, 0)
        setStats({
          totalBookings: all.total,
          activeBookings: active.total,
          confirmedToday: confirmed.total,
          availableNow: totalAvailable,
        })
      } catch {
        // Silently fail — stats are non-critical
      } finally {
        setLoadingStats(false)
      }
    }
    void fetchStats()
  }, [])

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            Good {getGreeting()}, {user?.name.split(' ')[0]} 👋
          </h1>
          <p className="mt-1 text-sm text-slate-500">Here&apos;s your parking overview for today.</p>
        </div>
        <Link
          href="/book"
          className="inline-flex h-10 items-center gap-2 rounded-lg bg-blue-600 px-5 text-sm font-medium text-white transition-colors hover:bg-blue-700"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Book a Slot
        </Link>
      </div>

      {/* Stats */}
      {loadingStats ? (
        <div className="flex h-32 items-center justify-center">
          <Spinner />
        </div>
      ) : (
        <DashboardStats {...stats} />
      )}

      {/* Recent bookings */}
      <div>
        <h2 className="mb-4 text-lg font-semibold text-slate-900">My Bookings</h2>
        <BookingHistory />
      </div>
    </div>
  )
}

function getGreeting() {
  const hour = new Date().getHours()
  if (hour < 12) return 'morning'
  if (hour < 17) return 'afternoon'
  return 'evening'
}
