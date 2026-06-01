'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { floorsApi } from '@/lib/api'
import type { SlotWithAvailability, SlotUpdateEvent } from '@/types'

type UseSlotUpdatesReturn = {
  slots: SlotWithAvailability[]
  loading: boolean
  error: string
  isLive: boolean
  flashingSlots: Set<string>
  lastUpdated: Date | null
  refresh: () => Promise<void>
}

const POLL_INTERVAL_MS = 30_000

export function useSlotUpdates(
  floorId: string,
  date: string,
  startTime: string,
  endTime: string
): UseSlotUpdatesReturn {
  const [slots, setSlots] = useState<SlotWithAvailability[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [isLive, setIsLive] = useState(false)
  const [flashingSlots, setFlashingSlots] = useState<Set<string>>(new Set())
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  const prevSlotsRef = useRef<SlotWithAvailability[]>([])
  const pusherRef = useRef<import('pusher-js').default | null>(null)
  const channelRef = useRef<import('pusher-js').Channel | null>(null)

  // Apply incoming event from Pusher (single-slot patch)
  const applySlotEvent = useCallback((event: SlotUpdateEvent) => {
    setSlots((prev) => {
      const next = prev.map((s) =>
        s.id === event.slotId
          ? { ...s, status: event.status, isAvailable: event.isAvailable }
          : s
      )
      return next
    })
    setFlashingSlots((prev) => {
      const n = new Set(prev)
      n.add(event.slotId)
      return n
    })
    setTimeout(
      () =>
        setFlashingSlots((prev) => {
          const n = new Set(prev)
          n.delete(event.slotId)
          return n
        }),
      1500
    )
  }, [])

  const fetchSlots = useCallback(async () => {
    if (!floorId) return
    try {
      const data = await floorsApi.slots(floorId, { date, startTime, endTime })
      const prev = prevSlotsRef.current

      // Detect status changes for flash animation (polling path)
      if (prev.length > 0) {
        const changed = new Set<string>()
        for (const s of data.slots) {
          const old = prev.find((p) => p.id === s.id)
          if (old && old.status !== s.status) changed.add(s.id)
        }
        if (changed.size > 0) {
          setFlashingSlots(changed)
          setTimeout(() => setFlashingSlots(new Set()), 1500)
        }
      }

      prevSlotsRef.current = data.slots
      setSlots(data.slots)
      setIsLive(true)
      setError('')
      setLastUpdated(new Date())
    } catch {
      setIsLive(false)
      setError('Unable to load slot data. Retrying…')
    } finally {
      setLoading(false)
    }
  }, [floorId, date, startTime, endTime])

  // ── Pusher subscription ───────────────────────────────────────────────────
  useEffect(() => {
    if (!floorId) return

    const key = process.env.NEXT_PUBLIC_PUSHER_KEY
    const cluster = process.env.NEXT_PUBLIC_PUSHER_CLUSTER ?? 'ap2'

    if (!key) return // No Pusher config — polling handles updates

    let cancelled = false

    import('pusher-js').then((mod) => {
      if (cancelled) return
      const PusherClient = mod.default
      const pusher = new PusherClient(key, { cluster })
      pusherRef.current = pusher
      const channel = pusher.subscribe(`parking-floor-${floorId}`)
      channelRef.current = channel

      channel.bind('slot-updated', (data: SlotUpdateEvent) => {
        applySlotEvent(data)
        setLastUpdated(new Date())
        setIsLive(true)
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
  }, [floorId, applySlotEvent])

  // ── Polling (fallback or primary) ─────────────────────────────────────────
  useEffect(() => {
    setLoading(true)
    prevSlotsRef.current = []
    void fetchSlots()

    const timer = setInterval(fetchSlots, POLL_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [fetchSlots])

  return { slots, loading, error, isLive, flashingSlots, lastUpdated, refresh: fetchSlots }
}
