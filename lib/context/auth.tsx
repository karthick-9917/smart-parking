'use client'

import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'
import { authApi, type RegisterData, ApiError } from '@/lib/api'
import type { UserResponse } from '@/types'

type AuthState = {
  user: UserResponse | null
  loading: boolean
  login: (email: string, password: string) => Promise<void>
  register: (data: RegisterData) => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserResponse | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    authApi
      .me()
      .then((data) => setUser(data.user))
      .catch(() => setUser(null))
      .finally(() => setLoading(false))
  }, [])

  async function login(email: string, password: string) {
    const data = await authApi.login({ email, password })
    setUser(data.user)
  }

  async function register(data: RegisterData) {
    const res = await authApi.register(data)
    setUser(res.user)
  }

  async function logout() {
    try {
      await authApi.logout()
    } catch (err) {
      if (!(err instanceof ApiError)) throw err
    } finally {
      setUser(null)
    }
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
