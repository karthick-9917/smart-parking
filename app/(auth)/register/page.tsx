import type { Metadata } from 'next'
import { RegisterForm } from '@/components/auth/RegisterForm'

export const metadata: Metadata = { title: 'Create account — SmartPark' }

export default function RegisterPage() {
  return (
    <>
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-slate-900">Create your account</h2>
        <p className="mt-1 text-sm text-slate-500">Join SmartPark to book your parking slot</p>
      </div>
      <RegisterForm />
    </>
  )
}
