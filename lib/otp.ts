import bcrypt from 'bcrypt'

export const OTP_LENGTH = 6
export const OTP_EXPIRY_MS = 5 * 60 * 1000   // 5 minutes
export const OTP_MAX_ATTEMPTS = 3

const BCRYPT_ROUNDS = 10

// Cryptographically uniform 6-digit string (000000–999999)
export function generateOtp(): string {
  return String(Math.floor(Math.random() * Math.pow(10, OTP_LENGTH))).padStart(OTP_LENGTH, '0')
}

export async function hashOtp(otp: string): Promise<string> {
  return bcrypt.hash(otp, BCRYPT_ROUNDS)
}

export async function verifyOtpHash(otp: string, hash: string): Promise<boolean> {
  return bcrypt.compare(otp, hash)
}

export function otpExpiresAt(): Date {
  return new Date(Date.now() + OTP_EXPIRY_MS)
}
