'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useAuth } from '@/lib/context/auth'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/Button'

const navLinks = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/book', label: 'Book a Slot' },
  { href: '/my-bookings', label: 'My Bookings' },
]

const adminLinks = [{ href: '/admin', label: 'Admin' }]

export const Navbar = () => {
  const { user, logout } = useAuth()
  const pathname = usePathname()
  const router = useRouter()

  const allLinks = user?.role === 'ADMIN' ? [...navLinks, ...adminLinks] : navLinks

  async function handleLogout() {
    await logout()
    router.replace('/login')
  }

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/60">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        {/* Logo */}
        <Link href="/dashboard" className="flex items-center gap-2 font-semibold text-slate-900">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 text-white text-sm font-bold">
            SP
          </span>
          <span className="hidden sm:block">SmartPark</span>
        </Link>

        {/* Nav links */}
        <nav className="hidden gap-1 md:flex">
          {allLinks.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              className={cn(
                'rounded-md px-3 py-2 text-sm font-medium transition-colors',
                pathname === href || pathname.startsWith(href + '/')
                  ? 'bg-blue-50 text-blue-700'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              )}
            >
              {label}
            </Link>
          ))}
        </nav>

        {/* User */}
        <div className="flex items-center gap-3">
          {user && (
            <span className="hidden text-sm text-slate-600 sm:block">
              {user.name.split(' ')[0]}
            </span>
          )}
          <Button variant="ghost" size="sm" onClick={handleLogout}>
            Sign out
          </Button>
        </div>
      </div>

      {/* Mobile nav */}
      <div className="flex gap-1 overflow-x-auto border-t border-slate-100 px-4 py-1 md:hidden">
        {allLinks.map(({ href, label }) => (
          <Link
            key={href}
            href={href}
            className={cn(
              'whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              pathname === href
                ? 'bg-blue-50 text-blue-700'
                : 'text-slate-600 hover:bg-slate-100'
            )}
          >
            {label}
          </Link>
        ))}
      </div>
    </header>
  )
}
