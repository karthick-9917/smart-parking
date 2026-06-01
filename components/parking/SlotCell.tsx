'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'
import type { SlotWithAvailability } from '@/types'

type Props = {
  slot: SlotWithAvailability
  isSelected: boolean
  isFlashing?: boolean
  onClick?: () => void
}

export const SlotCell = ({ slot, isSelected, isFlashing, onClick }: Props) => {
  const [pressed, setPressed] = useState(false)

  function handleClick() {
    if (!slot.isAvailable || !onClick) return
    setPressed(true)
    setTimeout(() => setPressed(false), 120)
    onClick()
  }

  const available = slot.isAvailable

  return (
    <button
      type="button"
      disabled={!available}
      onClick={handleClick}
      aria-label={`Slot ${slot.label}${!available ? ` — ${slot.status}` : ' — Available'}`}
      aria-pressed={isSelected}
      className={cn(
        // Base shape — parking bay viewed from above
        'relative flex flex-col items-center justify-center select-none',
        'w-[54px] h-[46px]',
        'rounded-t-xl rounded-b-md',
        'border-2 border-b-[3px]',
        'text-[11px] font-bold leading-none',
        'transition-all duration-150',

        // ── Available ────────────────────────────────────────────────────────
        available && !isSelected && [
          'bg-[#1a2744] border-[#2a3d6e] border-b-[#111d3a] text-slate-300',
          'hover:bg-[#203261] hover:border-[#3d5ba0] hover:border-b-[#1a2855] hover:text-white',
          'hover:-translate-y-0.5 hover:shadow-lg hover:shadow-blue-900/40',
          'cursor-pointer',
        ],

        // ── Selected ─────────────────────────────────────────────────────────
        isSelected && [
          'bg-[#f5c518] border-[#e6b800] border-b-[#c9a000] text-[#1a1a1a]',
          '-translate-y-1 shadow-xl shadow-yellow-500/30',
          'cursor-pointer',
        ],

        // ── Reserved ─────────────────────────────────────────────────────────
        !available && slot.status === 'RESERVED' && [
          'bg-[#2d2a18] border-[#4a4520] border-b-[#332f1a] text-amber-600',
          'cursor-not-allowed opacity-80',
        ],

        // ── Occupied ─────────────────────────────────────────────────────────
        !available && slot.status === 'OCCUPIED' && [
          'bg-[#2a1a1a] border-[#4a2a2a] border-b-[#3a1a1a] text-red-700',
          'cursor-not-allowed',
        ],

        // ── Maintenance ───────────────────────────────────────────────────────
        !available && slot.status === 'MAINTENANCE' && [
          'bg-[#1e1e1e] border-[#333] border-b-[#222] text-slate-600',
          'cursor-not-allowed',
        ],

        // ── Click press animation ─────────────────────────────────────────────
        pressed && 'scale-90',

        // ── Live flash on status change ───────────────────────────────────────
        isFlashing && !isSelected && 'animate-[flash_0.6s_ease-in-out_2]',
      )}
    >
      {/* Slot label */}
      <span className="tracking-wider">{slot.label}</span>

      {/* EV/Handicap badges */}
      <span className="flex gap-0.5 mt-0.5">
        {slot.isEVCharging && (
          <span className={cn('text-[9px]', isSelected ? 'text-emerald-700' : 'text-emerald-500')}>
            ⚡
          </span>
        )}
        {slot.isHandicap && (
          <span className={cn('text-[9px]', isSelected ? 'text-blue-700' : 'text-blue-400')}>
            ♿
          </span>
        )}
      </span>

      {/* Occupied car icon */}
      {slot.status === 'OCCUPIED' && (
        <span className="absolute inset-0 flex items-center justify-center opacity-20">
          <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
            <path d="M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8l-2.08-5.99zM6.5 16c-.83 0-1.5-.67-1.5-1.5S5.67 13 6.5 13s1.5.67 1.5 1.5S7.33 16 6.5 16zm11 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zM5 11l1.5-4.5h11L19 11H5z" />
          </svg>
        </span>
      )}

      {/* Maintenance X */}
      {slot.status === 'MAINTENANCE' && (
        <span className="absolute inset-0 flex items-center justify-center">
          <svg className="w-4 h-4 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </span>
      )}
    </button>
  )
}
