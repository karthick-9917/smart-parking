import type { Metadata } from 'next'
import { LoginForm } from '@/components/auth/LoginForm'

export const metadata: Metadata = { title: 'Sign in — SmartPark' }

export default function LoginPage() {
  return (
    <>
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-slate-900">Welcome back</h2>
        <p className="mt-1 text-sm text-slate-500">Sign in to manage your parking bookings</p>
      </div>
      <LoginForm />
    </>
  )
}
