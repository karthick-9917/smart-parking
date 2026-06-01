// ─── Auth ─────────────────────────────────────────────────────────────────────

export type UserRole = 'EMPLOYEE' | 'ADMIN'

export type UserResponse = {
  id: string
  email: string
  name: string
  phone: string | null
  role: UserRole
  employeeId: string
  department: string | null
  isActive: boolean
  createdAt: string
}

export type AuthTokenPayload = {
  sub: string
  email: string
  role: UserRole
}

export type AuthResponse = {
  user: UserResponse
  token: string
}

// ─── Parking ──────────────────────────────────────────────────────────────────

export type SlotStatus = 'AVAILABLE' | 'OCCUPIED' | 'RESERVED' | 'MAINTENANCE'
export type BookingStatus = 'PENDING_OTP' | 'CONFIRMED' | 'CANCELLED' | 'EXPIRED' | 'NO_SHOW'

export type FloorSummary = {
  id: string
  name: string
  level: number
  description: string | null
  totalSlots: number
  availableSlots: number
}

export type SlotWithAvailability = {
  id: string
  label: string
  zone: string
  row: number
  column: number
  status: SlotStatus
  isEVCharging: boolean
  isHandicap: boolean
  notes: string | null
  isAvailable: boolean
  bookingId: string | null
  bookingStatus: BookingStatus | null
}

export type FloorSlotsResponse = {
  floor: { id: string; name: string; level: number }
  slots: SlotWithAvailability[]
  date: string
  startTime: string
  endTime: string
}

export type LockResponse = {
  bookingId: string
  slotId: string
  date: string
  startTime: string
  endTime: string
}

export type SlotUpdateEvent = {
  slotId: string
  floorId: string
  label: string
  status: SlotStatus
  isAvailable: boolean
}

// ─── Bookings ─────────────────────────────────────────────────────────────────

export type BookingItem = {
  id: string
  date: string
  startTime: string
  endTime: string
  status: BookingStatus
  vehicleNumber: string | null
  confirmedAt: string | null
  cancelledAt: string | null
  createdAt: string
  slot: {
    id: string
    label: string
    zone: string
    isEVCharging: boolean
    isHandicap: boolean
    floor: { id: string; name: string; level: number }
  }
}

export type BookingOtpStatus = {
  expiresAt: string
  isLocked: boolean
  attemptsRemaining: number
  verifiedAt: string | null
}

export type BookingDetail = BookingItem & {
  userId: string
  vehicleId: string | null
  otp: BookingOtpStatus | null
}

export type CreateBookingResponse = {
  bookingId: string
  status: 'PENDING_OTP'
  otpExpiresAt: string
  otpCode?: string   // non-production environments only
}

// ─── API envelope ─────────────────────────────────────────────────────────────

export type ApiSuccess<T> = { data: T }
export type ApiError = { error: { code: string; message: string } }
