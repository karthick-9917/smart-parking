'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/context/auth'
import { ApiError } from '@/lib/api'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'

export const RegisterForm = () => {
  const { register } = useAuth()
  const router = useRouter()

  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    employeeId: '',
    phone: '',
    department: '',
  })
  const [loading, setLoading] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState('')

  function set(field: string, value: string) {
    setForm((f) => ({ ...f, [field]: value }))
    setFieldErrors((e) => ({ ...e, [field]: '' }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await register({
        name: form.name,
        email: form.email,
        password: form.password,
        employeeId: form.employeeId,
        phone: form.phone || undefined,
        department: form.department || undefined,
      })
      router.replace('/dashboard')
    } catch (err) {
      if (err instanceof ApiError) {
        const codeToField: Record<string, string> = {
          EMAIL_TAKEN: 'email',
          EMPLOYEE_ID_TAKEN: 'employeeId',
          PHONE_TAKEN: 'phone',
        }
        const field = codeToField[err.code]
        if (field) {
          setFieldErrors((fe) => ({ ...fe, [field]: err.message }))
        } else {
          setError(err.message)
        }
      } else {
        setError('Something went wrong. Please try again.')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          label="Full name"
          placeholder="Alice Smith"
          value={form.name}
          onChange={(e) => set('name', e.target.value)}
          error={fieldErrors.name}
          required
        />
        <Input
          label="Employee ID"
          placeholder="EMP-0001"
          value={form.employeeId}
          onChange={(e) => set('employeeId', e.target.value)}
          error={fieldErrors.employeeId}
          required
        />
      </div>

      <Input
        label="Work email"
        type="email"
        placeholder="you@company.com"
        value={form.email}
        onChange={(e) => set('email', e.target.value)}
        error={fieldErrors.email}
        autoComplete="email"
        required
      />

      <Input
        label="Password"
        type="password"
        placeholder="At least 8 characters"
        value={form.password}
        onChange={(e) => set('password', e.target.value)}
        error={fieldErrors.password}
        autoComplete="new-password"
        required
        minLength={8}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          label="Phone (optional)"
          type="tel"
          placeholder="+91 99999 99999"
          value={form.phone}
          onChange={(e) => set('phone', e.target.value)}
          error={fieldErrors.phone}
        />
        <Input
          label="Department (optional)"
          placeholder="Engineering"
          value={form.department}
          onChange={(e) => set('department', e.target.value)}
        />
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 border border-red-200">
          {error}
        </div>
      )}

      <Button type="submit" loading={loading} className="w-full">
        Create account
      </Button>

      <p className="text-center text-sm text-slate-500">
        Already registered?{' '}
        <Link href="/login" className="font-medium text-blue-600 hover:text-blue-700">
          Sign in
        </Link>
      </p>
    </form>
  )
}
