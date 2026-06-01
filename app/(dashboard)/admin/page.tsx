import type { Metadata } from 'next'
import { AdminPanel } from '@/components/admin/AdminPanel'

export const metadata: Metadata = { title: 'Admin Dashboard — SmartPark' }

export default function AdminPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Admin Dashboard</h1>
        <p className="mt-1 text-sm text-slate-500">
          Manage parking floors, slots, and all bookings.
        </p>
      </div>
      <AdminPanel />
    </div>
  )
}
