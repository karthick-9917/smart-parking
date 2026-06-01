import { cn } from '@/lib/utils'

type StatCard = {
  label: string
  value: string | number
  sub?: string
  icon: React.ReactNode
  color: string
}

type Props = {
  totalBookings: number
  activeBookings: number
  confirmedToday: number
  availableNow: number
}

export const DashboardStats = ({
  totalBookings,
  activeBookings,
  confirmedToday,
  availableNow,
}: Props) => {
  const stats: StatCard[] = [
    {
      label: 'Total Bookings',
      value: totalBookings,
      icon: (
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
      ),
      color: 'bg-blue-50 text-blue-600',
    },
    {
      label: 'Active Bookings',
      value: activeBookings,
      sub: 'Pending OTP + Confirmed',
      icon: (
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
      color: 'bg-amber-50 text-amber-600',
    },
    {
      label: 'Confirmed Today',
      value: confirmedToday,
      icon: (
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
      color: 'bg-green-50 text-green-600',
    },
    {
      label: 'Available Slots',
      value: availableNow,
      sub: 'Right now',
      icon: (
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 13l4 4L19 7" />
        </svg>
      ),
      color: 'bg-emerald-50 text-emerald-600',
    },
  ]

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {stats.map((stat) => (
        <div
          key={stat.label}
          className="flex items-start gap-4 rounded-xl border border-slate-200 bg-white p-5"
        >
          <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-lg', stat.color)}>
            {stat.icon}
          </div>
          <div>
            <p className="text-2xl font-bold text-slate-900">{stat.value}</p>
            <p className="text-sm font-medium text-slate-700">{stat.label}</p>
            {stat.sub && <p className="text-xs text-slate-500 mt-0.5">{stat.sub}</p>}
          </div>
        </div>
      ))}
    </div>
  )
}
