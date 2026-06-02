import { cn } from '@/lib/utils'
import type { SlotWithAvailability, SlotStatus } from '@/types'

type Props = {
  slot: SlotWithAvailability
  selected?: boolean
  flashing?: boolean
  onClick?: () => void
}

const statusStyles: Record<SlotStatus, string> = {
  AVAILABLE: 'bg-green-50 border-green-400 text-green-800 hover:bg-green-100 cursor-pointer',
  RESERVED: 'bg-amber-50 border-amber-400 text-amber-800 cursor-not-allowed',
  OCCUPIED: 'bg-red-50 border-red-400 text-red-800 cursor-not-allowed',
  MAINTENANCE: 'bg-slate-100 border-slate-300 text-slate-500 cursor-not-allowed',
}

const statusLabel: Record<SlotStatus, string> = {
  AVAILABLE: 'Free',
  RESERVED: 'Reserved',
  OCCUPIED: 'Occupied',
  MAINTENANCE: 'Maintenance',
}

export const SlotCard = ({ slot, selected, flashing, onClick }: Props) => {
  const isClickable = slot.isAvailable && onClick

  return (
    <button
      type="button"
      disabled={!isClickable}
      onClick={isClickable ? onClick : undefined}
      title={`${slot.label} — ${statusLabel[slot.status]}`}
      className={cn(
        'flex flex-col items-center justify-center rounded-lg border-2 p-2 transition-all',
        'min-h-[64px] min-w-[60px] text-xs font-medium',
        statusStyles[slot.status],
        selected && 'ring-2 ring-blue-500 ring-offset-2',
        flashing && 'animate-flash',
        slot.isEVCharging && 'ring-1 ring-emerald-400',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500'
      )}
    >
      <span className="font-semibold text-sm leading-tight">{slot.label}</span>
      {slot.isEVCharging && <span className="text-emerald-600" title="EV Charging">⚡</span>}
      {slot.isHandicap && <span title="Accessible">♿</span>}
      <span className="text-[10px] opacity-70 mt-0.5">{statusLabel[slot.status]}</span>
    </button>
  )
}
