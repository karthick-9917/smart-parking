'use client'

import {
  useState,
  useEffect,
  useRef,
  useCallback,
  type KeyboardEvent,
  type ClipboardEvent,
} from 'react'
import { cn } from '@/lib/utils'
import { ApiError, bookingsApi } from '@/lib/api'
import type { CreateBookingResponse } from '@/types'

// ─── Constants ────────────────────────────────────────────────────────────────

const TOTAL_SECONDS    = 5 * 60   // must match server OTP_EXPIRY_MS
const MAX_ATTEMPTS     = 3
const RESEND_COOLDOWN  = 60       // seconds between resend clicks

// ─── Helpers ─────────────────────────────────────────────────────────────────

function secsFromNow(date: Date): number {
  return Math.max(0, Math.floor((date.getTime() - Date.now()) / 1000))
}

function fmt(secs: number): string {
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

// ─── Countdown ring ───────────────────────────────────────────────────────────

const R = 30
const C = 2 * Math.PI * R   // ≈ 188.5

type RingProps = { secondsLeft: number; totalSeconds: number }

const CountdownRing = ({ secondsLeft, totalSeconds }: RingProps) => {
  const pct      = secondsLeft / totalSeconds
  const offset   = C * (1 - pct)
  const ringColor =
    secondsLeft > 120 ? '#22c55e' :
    secondsLeft > 40  ? '#f59e0b' :
    '#ef4444'

  return (
    <div className="relative flex items-center justify-center" aria-hidden>
      <svg width="80" height="80" style={{ transform: 'rotate(-90deg)' }}>
        {/* Track */}
        <circle cx="40" cy="40" r={R} fill="none" stroke="#e2e8f0" strokeWidth="4" />
        {/* Progress arc */}
        <circle
          cx="40" cy="40" r={R}
          fill="none"
          stroke={ringColor}
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={C}
          strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 0.9s linear, stroke 0.4s ease' }}
        />
      </svg>
      {/* Centre text */}
      <div className="absolute flex flex-col items-center leading-tight">
        <span
          className={cn(
            'font-mono text-[15px] font-bold tabular-nums',
            secondsLeft === 0   ? 'text-red-600' :
            secondsLeft <= 40   ? 'text-red-500' :
            secondsLeft <= 120  ? 'text-amber-500' :
            'text-slate-700'
          )}
        >
          {fmt(secondsLeft)}
        </span>
        <span className="text-[9px] uppercase tracking-wider text-slate-400">left</span>
      </div>
    </div>
  )
}

// ─── OTP digit boxes ──────────────────────────────────────────────────────────

type BoxesProps = {
  digits: string[]
  refs: React.MutableRefObject<(HTMLInputElement | null)[]>
  filled: boolean     // all 6 filled?
  shaking: boolean
  disabled: boolean
  hasError: boolean
  onChange: (next: string[]) => void
}

const OTPBoxes = ({ digits, refs, filled, shaking, disabled, hasError, onChange }: BoxesProps) => {

  function handleChange(i: number, raw: string) {
    const d = raw.replace(/\D/g, '').slice(-1)
    const next = [...digits]
    next[i] = d
    onChange(next)
    if (d && i < 5) refs.current[i + 1]?.focus()
  }

  function handleKeyDown(i: number, e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace') {
      if (digits[i]) {
        const next = [...digits]; next[i] = ''; onChange(next)
      } else if (i > 0) {
        const next = [...digits]; next[i - 1] = ''; onChange(next)
        refs.current[i - 1]?.focus()
      }
      e.preventDefault()
    }
    if (e.key === 'ArrowLeft'  && i > 0) refs.current[i - 1]?.focus()
    if (e.key === 'ArrowRight' && i < 5) refs.current[i + 1]?.focus()
  }

  function handlePaste(e: ClipboardEvent<HTMLInputElement>) {
    e.preventDefault()
    const text = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6)
    if (!text) return
    const next = Array(6).fill('')
    text.split('').forEach((c, i) => { next[i] = c })
    onChange(next)
    refs.current[Math.min(text.length, 5)]?.focus()
  }

  return (
    <div
      className={cn('flex items-center gap-2', shaking && 'animate-shake')}
      role="group"
      aria-label="Enter OTP digits"
    >
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => { refs.current[i] = el }}
          type="text"
          inputMode="numeric"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          maxLength={1}
          value={d}
          onChange={(e) => handleChange(i, e.target.value)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          onPaste={handlePaste}
          onFocus={(e) => e.target.select()}
          disabled={disabled}
          aria-label={`Digit ${i + 1}`}
          className={cn(
            'h-12 w-10 rounded-xl border-2 text-center font-mono text-xl font-bold',
            'caret-transparent transition-all duration-150 select-none',
            'focus:outline-none',
            // Default
            !d && !hasError && 'border-slate-200 bg-slate-50 text-slate-900 focus:border-blue-500 focus:bg-blue-50/60 focus:shadow-[0_0_0_3px_rgba(59,130,246,0.15)]',
            // Filled
            d  && !hasError && 'border-blue-400 bg-blue-50 text-blue-700 shadow-[0_0_0_3px_rgba(59,130,246,0.12)]',
            // Error
            hasError && d  && 'border-red-400 bg-red-50 text-red-700',
            hasError && !d && 'border-red-200 bg-red-50/50 text-red-700 focus:border-red-400',
            // Disabled
            disabled && 'cursor-not-allowed opacity-40',
            // Gap after box 2 (visual grouping)
            i === 2 && 'mr-1.5',
          )}
        />
      ))}
    </div>
  )
}

// ─── Attempt dots ─────────────────────────────────────────────────────────────

const AttemptDots = ({ used, max }: { used: number; max: number }) => (
  <div className="flex items-center gap-1.5" role="status" aria-label={`${max - used} attempts remaining`}>
    {Array.from({ length: max }).map((_, i) => (
      <span
        key={i}
        className={cn(
          'h-2 w-2 rounded-full transition-all duration-300',
          i < used ? 'bg-red-400 scale-110' : 'bg-slate-200',
        )}
      />
    ))}
    <span className="ml-1 text-xs text-slate-500">
      {max - used} attempt{max - used !== 1 ? 's' : ''} left
    </span>
  </div>
)

// ─── Success view ─────────────────────────────────────────────────────────────

const SuccessView = () => (
  <div className="flex flex-col items-center gap-4 py-6 text-center animate-pop-in">
    {/* Animated check circle */}
    <div className="relative flex items-center justify-center">
      <svg width="80" height="80" viewBox="0 0 80 80">
        {/* Green circle fill */}
        <circle cx="40" cy="40" r={R} fill="#dcfce7" stroke="#bbf7d0" strokeWidth="2" />
        {/* Animated ring */}
        <circle
          cx="40" cy="40" r={R}
          fill="none"
          stroke="#16a34a"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={C}
          strokeDashoffset={C}
          className="animate-ring-fill"
        />
        {/* Animated checkmark */}
        <path
          d="M26 41 l10 10 l18 -20"
          fill="none"
          stroke="#16a34a"
          strokeWidth="3.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray="56"
          strokeDashoffset="56"
          className="animate-draw-check"
        />
      </svg>
    </div>
    <div>
      <p className="text-xl font-bold text-slate-900">Booking confirmed!</p>
      <p className="mt-1 text-sm text-slate-500">Your parking slot has been reserved.</p>
    </div>
  </div>
)

// ─── Locked / expired panels ─────────────────────────────────────────────────

const LockedPanel = ({ onResend, resending }: { onResend: () => void; resending: boolean }) => (
  <div className="flex flex-col items-center gap-4 py-4 text-center">
    <div className="flex h-16 w-16 items-center justify-center rounded-full bg-red-100 text-red-600 animate-pop-in">
      <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
      </svg>
    </div>
    <div>
      <p className="font-semibold text-slate-900">Too many incorrect attempts</p>
      <p className="mt-1 text-sm text-slate-500">This OTP has been locked. Request a new one.</p>
    </div>
    <ResendButton
      cooldownLeft={0}
      canResend
      resending={resending}
      onResend={onResend}
      variant="primary"
    />
  </div>
)

const ExpiredPanel = ({ onResend, resending }: { onResend: () => void; resending: boolean }) => (
  <div className="flex flex-col items-center gap-4 py-4 text-center">
    <div className="flex h-16 w-16 items-center justify-center rounded-full bg-amber-100 text-amber-600 animate-pop-in">
      <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    </div>
    <div>
      <p className="font-semibold text-slate-900">OTP has expired</p>
      <p className="mt-1 text-sm text-slate-500">Request a new code to continue.</p>
    </div>
    <ResendButton
      cooldownLeft={0}
      canResend
      resending={resending}
      onResend={onResend}
      variant="primary"
    />
  </div>
)

// ─── Resend button ────────────────────────────────────────────────────────────

type ResendBtnProps = {
  cooldownLeft: number
  canResend: boolean
  resending: boolean
  onResend: () => void
  variant?: 'ghost' | 'primary'
}

const ResendButton = ({ cooldownLeft, canResend, resending, onResend, variant = 'ghost' }: ResendBtnProps) => {
  if (variant === 'primary') {
    return (
      <button
        type="button"
        onClick={onResend}
        disabled={resending}
        className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-50"
      >
        {resending ? (
          <span className="flex items-center gap-2">
            <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
            Sending…
          </span>
        ) : 'Resend OTP'}
      </button>
    )
  }

  return (
    <div className="flex items-center justify-center gap-1.5 text-xs">
      <span className="text-slate-500">Didn't receive it?</span>
      {canResend ? (
        <button
          type="button"
          onClick={onResend}
          disabled={resending}
          className="font-semibold text-blue-600 transition hover:text-blue-700 disabled:opacity-50"
        >
          {resending ? 'Sending…' : 'Resend OTP'}
        </button>
      ) : (
        <span className="font-medium text-slate-400">
          Resend in {fmt(cooldownLeft)}
        </span>
      )}
    </div>
  )
}

// ─── Main OTPModal ────────────────────────────────────────────────────────────

type Props = {
  booking: CreateBookingResponse
  open: boolean
  onClose: () => void
  onConfirmed: () => void
}

export const OTPModal = ({ booking, open, onClose, onConfirmed }: Props) => {
  /* ── Digits state ─────────────────────────────────────────── */
  const [digits, setDigits] = useState<string[]>(Array(6).fill(''))
  const inputRefs = useRef<(HTMLInputElement | null)[]>([null, null, null, null, null, null])

  /* ── Timer state ──────────────────────────────────────────── */
  const [expiresAt, setExpiresAt]   = useState(() => new Date(booking.otpExpiresAt))
  const [secondsLeft, setSecondsLeft] = useState(() => secsFromNow(new Date(booking.otpExpiresAt)))

  /* ── Resend cooldown ──────────────────────────────────────── */
  const [resendCooldown, setResendCooldown] = useState(0)

  /* ── Attempt tracking ─────────────────────────────────────── */
  const [attemptsUsed, setAttemptsUsed]     = useState(0)

  /* ── Flow state ───────────────────────────────────────────── */
  const [phase, setPhase] = useState<'input' | 'locked' | 'success'>('input')
  const [loading, setLoading]   = useState(false)
  const [resending, setResending] = useState(false)
  const [shaking, setShaking]   = useState(false)
  const [errorMsg, setErrorMsg] = useState('')

  const otp        = digits.join('')
  const allFilled  = otp.length === 6
  const isExpired  = secondsLeft === 0
  const hasError   = Boolean(errorMsg)

  /* ── 1-second tick ────────────────────────────────────────── */
  useEffect(() => {
    if (!open) return
    const id = setInterval(() => {
      setSecondsLeft(secsFromNow(expiresAt))
      setResendCooldown((c) => Math.max(0, c - 1))
    }, 1000)
    return () => clearInterval(id)
  }, [open, expiresAt])

  /* ── Auto-focus first box ─────────────────────────────────── */
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRefs.current[0]?.focus(), 60)
    }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Reset on open ────────────────────────────────────────── */
  useEffect(() => {
    if (open) {
      setDigits(Array(6).fill(''))
      setPhase('input')
      setErrorMsg('')
      setAttemptsUsed(0)
      setExpiresAt(new Date(booking.otpExpiresAt))
      setSecondsLeft(secsFromNow(new Date(booking.otpExpiresAt)))
    }
  }, [open, booking.otpExpiresAt])

  /* ── Trigger shake ────────────────────────────────────────── */
  const triggerShake = useCallback(() => {
    setShaking(true)
    setTimeout(() => setShaking(false), 500)
  }, [])

  /* ── Verify ───────────────────────────────────────────────── */
  async function handleVerify(e?: React.FormEvent) {
    e?.preventDefault()
    if (!allFilled || loading || isExpired || phase !== 'input') return
    setErrorMsg('')
    setLoading(true)
    try {
      await bookingsApi.confirm(booking.bookingId, otp)
      setPhase('success')
      setTimeout(onConfirmed, 2000)
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === 'OTP_LOCKED') {
          setPhase('locked')
        } else if (err.code === 'OTP_EXPIRED') {
          setSecondsLeft(0)
          setErrorMsg('OTP has expired. Request a new one.')
          triggerShake()
        } else if (err.code === 'INVALID_OTP') {
          const newUsed = attemptsUsed + 1
          setAttemptsUsed(newUsed)
          if (newUsed >= MAX_ATTEMPTS) {
            setPhase('locked')
          } else {
            setErrorMsg(err.message)
            triggerShake()
            setDigits(Array(6).fill(''))
            setTimeout(() => inputRefs.current[0]?.focus(), 50)
          }
        } else {
          setErrorMsg(err.message)
          triggerShake()
        }
      } else {
        setErrorMsg('Network error. Please try again.')
        triggerShake()
      }
    } finally {
      setLoading(false)
    }
  }

  /* ── Resend ───────────────────────────────────────────────── */
  async function handleResend() {
    if (resending || resendCooldown > 0) return
    setResending(true)
    setErrorMsg('')
    try {
      const res = await bookingsApi.resendOtp(booking.bookingId)
      const newExpiry = new Date(res.otpExpiresAt)
      setExpiresAt(newExpiry)
      setSecondsLeft(secsFromNow(newExpiry))
      setDigits(Array(6).fill(''))
      setAttemptsUsed(0)
      setPhase('input')
      setResendCooldown(RESEND_COOLDOWN)
      setTimeout(() => inputRefs.current[0]?.focus(), 60)
    } catch (err) {
      if (err instanceof ApiError) setErrorMsg(err.message)
    } finally {
      setResending(false)
    }
  }

  if (!open) return null

  /* ── Backdrop + panel ─────────────────────────────────────── */
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="otp-title"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={phase === 'success' ? undefined : onClose}
      />

      {/* Panel */}
      <div className="relative w-full max-w-sm overflow-hidden rounded-t-3xl sm:rounded-2xl bg-white shadow-2xl">

        {/* ── Drag handle (mobile) ─────────────────────────────── */}
        <div className="mx-auto mt-3 h-1 w-10 rounded-full bg-slate-200 sm:hidden" />

        {/* ── Header ───────────────────────────────────────────── */}
        {phase !== 'success' && (
          <div className="flex items-center justify-between px-6 pt-5 pb-1">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-100">
                <svg className="h-4 w-4 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
              </div>
              <h2 id="otp-title" className="text-base font-bold text-slate-900">Verify OTP</h2>
            </div>
            <button
              onClick={onClose}
              className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
              aria-label="Close"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}

        {/* ── Body ─────────────────────────────────────────────── */}
        <div className="px-6 pb-8 pt-4">

          {/* ── SUCCESS ─────────────────────────────────────────── */}
          {phase === 'success' && <SuccessView />}

          {/* ── LOCKED ──────────────────────────────────────────── */}
          {phase === 'locked' && (
            <LockedPanel onResend={handleResend} resending={resending} />
          )}

          {/* ── EXPIRED (handled inline) / INPUT ────────────────── */}
          {phase === 'input' && (
            <form onSubmit={handleVerify} className="flex flex-col items-center gap-5" noValidate>

              {/* Dev banner */}
              {booking.otpCode && (
                <div className="w-full rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-center text-xs text-amber-800">
                  Dev mode — OTP:&nbsp;
                  <button
                    type="button"
                    className="font-mono font-bold tracking-widest hover:underline"
                    onClick={() => {
                      const d = booking.otpCode!.split('')
                      setDigits(d)
                      setTimeout(() => inputRefs.current[5]?.focus(), 30)
                    }}
                  >
                    {booking.otpCode}
                  </button>
                  &nbsp;(click to fill)
                </div>
              )}

              {/* Instruction */}
              <p className="text-center text-sm text-slate-500">
                Enter the 6-digit code sent to your registered email
              </p>

              {/* Countdown ring */}
              {!isExpired ? (
                <CountdownRing secondsLeft={secondsLeft} totalSeconds={TOTAL_SECONDS} />
              ) : (
                <ExpiredPanel onResend={handleResend} resending={resending} />
              )}

              {/* OTP boxes — hidden while expired */}
              {!isExpired && (
                <>
                  <OTPBoxes
                    digits={digits}
                    refs={inputRefs}
                    filled={allFilled}
                    shaking={shaking}
                    disabled={loading}
                    hasError={hasError}
                    onChange={(next) => { setDigits(next); setErrorMsg('') }}
                  />

                  {/* Attempt dots — show after first wrong attempt */}
                  {attemptsUsed > 0 && (
                    <AttemptDots used={attemptsUsed} max={MAX_ATTEMPTS} />
                  )}

                  {/* Error message */}
                  {errorMsg && (
                    <div
                      role="alert"
                      className={cn(
                        'w-full rounded-xl border px-4 py-3 text-sm font-medium text-center',
                        'border-red-200 bg-red-50 text-red-700',
                      )}
                    >
                      {errorMsg}
                    </div>
                  )}

                  {/* Verify button */}
                  <button
                    type="submit"
                    disabled={!allFilled || loading}
                    className={cn(
                      'w-full rounded-xl py-3 text-sm font-bold transition-all duration-150',
                      'focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2',
                      allFilled && !loading
                        ? 'bg-blue-600 text-white shadow-md shadow-blue-200 hover:bg-blue-700 active:scale-[.98]'
                        : 'bg-slate-100 text-slate-400 cursor-not-allowed',
                    )}
                  >
                    {loading ? (
                      <span className="flex items-center justify-center gap-2">
                        <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                        </svg>
                        Verifying…
                      </span>
                    ) : 'Verify Code'}
                  </button>

                  {/* Resend */}
                  <ResendButton
                    cooldownLeft={resendCooldown}
                    canResend={resendCooldown === 0}
                    resending={resending}
                    onResend={handleResend}
                  />
                </>
              )}
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
