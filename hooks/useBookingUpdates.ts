'use client'

import { useEffect, useRef, useState } from 'react'
import type { BookingUpdateEvent } from '@/types'

export function useBookingUpdates(
  userId: string | null,
  onUpdate: (event: BookingUpdateEvent) => void
): { isLive: boolean } {
  const [isLive, setIsLive] = useState(false)
  const pusherRef = useRef<import('pusher-js').default | null>(null)
  const channelRef = useRef<import('pusher-js').Channel | null>(null)

  useEffect(() => {
    if (!userId) return

    const key = process.env.NEXT_PUBLIC_PUSHER_KEY
    const cluster = process.env.NEXT_PUBLIC_PUSHER_CLUSTER ?? 'ap2'
    if (!key) return

    let cancelled = false

    import('pusher-js').then((mod) => {
      if (cancelled) return
      const PusherClient = mod.default
      const pusher = new PusherClient(key, { cluster })
      pusherRef.current = pusher

      const channel = pusher.subscribe(`booking-user-${userId}`)
      channelRef.current = channel

      channel.bind('booking-updated', (data: BookingUpdateEvent) => {
        onUpdate(data)
      })

      pusher.connection.bind('connected', () => setIsLive(true))
      pusher.connection.bind('disconnected', () => setIsLive(false))
      pusher.connection.bind('failed', () => setIsLive(false))
    })

    return () => {
      cancelled = true
      channelRef.current?.unbind_all()
      channelRef.current?.unsubscribe()
      pusherRef.current?.disconnect()
      pusherRef.current = null
      channelRef.current = null
    }
  }, [userId, onUpdate])

  return { isLive }
}
