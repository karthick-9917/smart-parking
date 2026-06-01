import Pusher from 'pusher'
import type { SlotUpdateEvent } from '@/types'

let _pusher: Pusher | null = null

function getPusher(): Pusher | null {
  if (_pusher) return _pusher
  const { PUSHER_APP_ID, PUSHER_KEY, PUSHER_SECRET, PUSHER_CLUSTER } = process.env
  if (!PUSHER_APP_ID || !PUSHER_KEY || !PUSHER_SECRET || !PUSHER_CLUSTER) return null
  _pusher = new Pusher({
    appId: PUSHER_APP_ID,
    key: PUSHER_KEY,
    secret: PUSHER_SECRET,
    cluster: PUSHER_CLUSTER,
    useTLS: true,
  })
  return _pusher
}

// Broadcast on channel `parking-floor-{floorId}` so clients can subscribe per floor.
export async function broadcastSlotUpdate(event: SlotUpdateEvent): Promise<void> {
  const pusher = getPusher()
  if (!pusher) return
  try {
    await pusher.trigger(`parking-floor-${event.floorId}`, 'slot-updated', event)
  } catch (err) {
    console.error('[realtime] Pusher trigger failed', err)
  }
}
