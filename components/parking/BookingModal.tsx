'use client'

import { useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { ApiError, bookingsApi } from '@/lib/api'
import { todayISO } from '@/lib/utils'
import type { SlotWithAvailability, CreateBookingResponse } from '@/types'

type Props = {
  slot: SlotWithAvailability
  floorName: string
  open: boolean
  onClose: () => void
  onBooked: (result: CreateBookingResponse) => void
}

const TIME_OPTIONS = [
  '06:00', '07:00', '08:00', '09:00', '10:00', '11:00',
  '12:00', '13:00', '14:00', '15:00', '16:00', '17:00',
  '18:00', '19:00', '20:00', '21:00', '22:00',
]

export const BookingModal = ({ slot, floorName, open, onClose, onBooked }: Props) => {
  const [date, setDate] = useState(todayISO())
  const [startTime, setStartTime] = useState('09:00')
  const [endTime, setEndTime] = useState('18:00')
  const [vehicleNumber, setVehicleNumber] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    if (startTime >= endTime) {
      setError('End time must be after start time.')
      return
    }

    setLoading(true)
    try {
      const result = await bookingsApi.create({
        slotId: slot.id,
        date,
        startTime,
        endTime,
        vehicleNumber: vehicleNumber || undefined,
      })
      onBooked(result)
    } catch (err) {
      if (err instanceof ApiError) {
        const messages: Record<string, string> = {
          SLOT_UNAVAILABLE: 'This slot is not available.',
          SLOT_CONFLICT: 'This slot is already booked for the selected time.',
          VALIDATION_ERROR: 'Please check the date and times.',
        }
        setError(messages[err.code] ?? err.message)
      } else {
        setError('Something went wrong. Please try again.')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={`Book ${slot.label}`}>
      <div className="mb-4 flex items-center gap-2 rounded-lg bg-slate-50 px-4 py-3 text-sm text-slate-600">
        <svg className="h-4 w-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
        </svg>
        <span>Floor {floorName} &bull; Slot {slot.label}</span>
        {slot.isEVCharging && <span className="ml-auto text-emerald-600 font-medium">⚡ EV</span>}
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <Input
          label="Date"
          type="date"
          value={date}
          min={todayISO()}
          onChange={(e) => setDate(e.target.value)}
          required
        />

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-slate-700">Start time</label>
            <select
              className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
            >
              {TIME_OPTIONS.slice(0, -1).map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-slate-700">End time</label>
            <select
              className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
            >
              {TIME_OPTIONS.slice(1).map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
        </div>

        <Input
          label="Vehicle number (optional)"
          placeholder="TN 01 AB 1234"
          value={vehicleNumber}
          onChange={(e) => setVehicleNumber(e.target.value.toUpperCase())}
        />

        {error && (
          <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 border border-red-200">
            {error}
          </div>
        )}

        <div className="flex gap-3 pt-1">
          <Button type="button" variant="secondary" className="flex-1" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button type="submit" className="flex-1" loading={loading}>
            Confirm &amp; Get OTP
          </Button>
        </div>
      </form>
    </Modal>
  )
}
