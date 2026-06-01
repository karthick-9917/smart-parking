import type {
  UserResponse,
  FloorSummary,
  SlotWithAvailability,
  FloorSlotsResponse,
  BookingItem,
  BookingDetail,
  CreateBookingResponse,
  LockResponse,
} from '@/types'

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    credentials: 'include',
  })
  const json = await res.json()
  if (!res.ok) {
    throw new ApiError(
      json.error?.code ?? 'UNKNOWN',
      json.error?.message ?? 'Request failed',
      res.status
    )
  }
  return json.data as T
}

function qs(params?: Record<string, string | undefined>): string {
  if (!params) return ''
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) p.set(k, v)
  }
  const s = p.toString()
  return s ? `?${s}` : ''
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

export type RegisterData = {
  name: string
  email: string
  password: string
  employeeId: string
  phone?: string
  department?: string
}

export const authApi = {
  login: (body: { email: string; password: string }) =>
    request<{ user: UserResponse; token: string }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  register: (body: RegisterData) =>
    request<{ user: UserResponse; token: string }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  me: () => request<{ user: UserResponse }>('/api/auth/me'),

  logout: () =>
    request<{ success: boolean }>('/api/auth/logout', { method: 'POST' }),
}

// ─── Floors ───────────────────────────────────────────────────────────────────

export type FloorQueryParams = {
  date?: string
  startTime?: string
  endTime?: string
}

export const floorsApi = {
  list: (params?: FloorQueryParams) =>
    request<FloorSummary[]>(`/api/floors${qs(params)}`),

  slots: (floorId: string, params?: FloorQueryParams) =>
    request<FloorSlotsResponse>(`/api/floors/${floorId}/slots${qs(params)}`),
}

// ─── Bookings ─────────────────────────────────────────────────────────────────

export type CreateBookingBody = {
  slotId: string
  date: string
  startTime: string
  endTime: string
  vehicleId?: string
  vehicleNumber?: string
  notes?: string
}

export type BookingListParams = {
  status?: string
  date?: string
  page?: string
  limit?: string
}

export type BookingListResponse = {
  bookings: BookingItem[]
  total: number
  page: number
  limit: number
}

export const bookingsApi = {
  create: (body: CreateBookingBody) =>
    request<CreateBookingResponse>('/api/bookings', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  list: (params?: BookingListParams) =>
    request<BookingListResponse>(`/api/bookings${qs(params)}`),

  get: (bookingId: string) =>
    request<BookingDetail>(`/api/bookings/${bookingId}`),

  cancel: (bookingId: string) =>
    request<{ cancelled: boolean }>(`/api/bookings/${bookingId}`, {
      method: 'DELETE',
    }),

  confirm: (bookingId: string, otp: string) =>
    request<{ booking: { id: string; status: string; confirmedAt: string } }>(
      `/api/bookings/${bookingId}/confirm`,
      { method: 'POST', body: JSON.stringify({ otp }) }
    ),

  resendOtp: (bookingId: string) =>
    request<{ otpExpiresAt: string; otpCode?: string }>(
      `/api/bookings/${bookingId}/resend-otp`,
      { method: 'POST', body: JSON.stringify({}) }
    ),
}

// ─── Slots ────────────────────────────────────────────────────────────────────

export type LockBody = {
  date: string
  startTime: string
  endTime: string
}

export const slotsApi = {
  lock: (slotId: string, body: LockBody) =>
    request<LockResponse>(`/api/slots/${slotId}/lock`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  unlock: (slotId: string, bookingId: string) =>
    request<{ released: boolean }>(`/api/slots/${slotId}/lock`, {
      method: 'DELETE',
      body: JSON.stringify({ bookingId }),
    }),
}

// ─── Admin ────────────────────────────────────────────────────────────────────

export type AdminBookingListParams = {
  status?: string
  date?: string
  floorId?: string
  page?: string
  limit?: string
}

export const adminApi = {
  bookings: (params?: AdminBookingListParams) =>
    request<BookingListResponse>(`/api/admin/bookings${qs(params)}`),

  updateSlotStatus: (slotId: string, status: string) =>
    request<SlotWithAvailability>(`/api/admin/slots/${slotId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),
}
