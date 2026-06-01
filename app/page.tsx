import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { verifyToken } from '@/lib/auth'

export default async function RootPage() {
  const cookieStore = await cookies()
  const token = cookieStore.get('auth-token')?.value

  if (token) {
    try {
      verifyToken(token)
      redirect('/dashboard')
    } catch {
      // Invalid token — fall through to login
    }
  }

  redirect('/login')
}
