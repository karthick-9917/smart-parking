import type { Metadata } from 'next'
import { BookingHistory } from '@/components/dashboard/BookingHistory'

export const metadata: Metadata = { title: 'My Bookings — SmartPark' }

export default function MyBookingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">My Bookings</h1>
        <p className="mt-1 text-sm text-slate-500">
          View and manage all your parking reservations.
        </p>
      </div>
      <BookingHistory />
    </div>
  )
}
