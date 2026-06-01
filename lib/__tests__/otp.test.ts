import { describe, it, expect } from 'vitest'
import {
  generateOtp,
  hashOtp,
  verifyOtpHash,
  otpExpiresAt,
  OTP_LENGTH,
  OTP_EXPIRY_MS,
  OTP_MAX_ATTEMPTS,
} from '@/lib/otp'

describe('generateOtp', () => {
  it('produces a string of exactly OTP_LENGTH digits', () => {
    for (let i = 0; i < 50; i++) {
      const otp = generateOtp()
      expect(otp).toHaveLength(OTP_LENGTH)
      expect(otp).toMatch(/^\d+$/)
    }
  })

  it('pads with leading zeros so length is always 6', () => {
    // All returned values should be exactly 6 characters including any leading zeros
    const otps = Array.from({ length: 100 }, generateOtp)
    expect(otps.every(o => o.length === OTP_LENGTH)).toBe(true)
  })

  it('produces values across a wide range (not always the same)', () => {
    const set = new Set(Array.from({ length: 20 }, generateOtp))
    expect(set.size).toBeGreaterThan(1)
  })
})

describe('hashOtp / verifyOtpHash', () => {
  it('verifies correct OTP against its hash', async () => {
    const otp = '482910'
    const hash = await hashOtp(otp)
    expect(await verifyOtpHash(otp, hash)).toBe(true)
  })

  it('rejects a wrong OTP', async () => {
    const hash = await hashOtp('111111')
    expect(await verifyOtpHash('999999', hash)).toBe(false)
  })

  it('never stores plaintext — hash is a bcrypt string', async () => {
    const otp = '123456'
    const hash = await hashOtp(otp)
    expect(hash).not.toBe(otp)
    expect(hash).toMatch(/^\$2[ab]\$\d+\$/)
  })

  it('two hashes of the same OTP are not equal (bcrypt uses a random salt)', async () => {
    const h1 = await hashOtp('123456')
    const h2 = await hashOtp('123456')
    expect(h1).not.toBe(h2)
    // but both verify correctly
    expect(await verifyOtpHash('123456', h1)).toBe(true)
    expect(await verifyOtpHash('123456', h2)).toBe(true)
  })
})

describe('otpExpiresAt', () => {
  it('returns a date approximately OTP_EXPIRY_MS in the future', () => {
    const before = Date.now()
    const expiry = otpExpiresAt()
    const after = Date.now()
    expect(expiry.getTime()).toBeGreaterThanOrEqual(before + OTP_EXPIRY_MS)
    expect(expiry.getTime()).toBeLessThanOrEqual(after + OTP_EXPIRY_MS + 50)
  })

  it('OTP_MAX_ATTEMPTS is 3', () => {
    expect(OTP_MAX_ATTEMPTS).toBe(3)
  })
})
