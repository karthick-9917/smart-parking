# SmartPark — Security Audit

**Date:** 2026-06-02  
**Auditor:** Claude Code (automated static analysis)  
**Scope:** Full codebase — authentication, authorisation, API surface, transport security, real-time layer, dependency hygiene  
**Branch audited:** `feature/test_coverage`

---

## Executive Summary

SmartPark has a solid cryptographic foundation: bcrypt for passwords and OTP hashes, parameterised Prisma queries (no SQL injection surface), HTTP-only cookies, constant-time login comparison, and atomic Prisma transactions for all booking mutations. However, **four critical-severity gaps** and **six high-severity gaps** were found that must be closed before a production deployment.

| Severity | Count |
|---|---|
| Critical | 4 |
| High | 6 |
| Medium | 5 |
| Low / Info | 5 |

---

## Critical

### C-1 — No server-side route guard (middleware missing)

**File:** `middleware.ts` — does not exist  
**Impact:** Admin pages (`/admin/*`) are protected only by a client-side `useEffect` redirect in `app/(dashboard)/admin/layout.tsx`. An attacker with a valid EMPLOYEE token can request any admin route directly — the server renders the page and returns the HTML. There is no edge-level enforcement.

```ts
// app/(dashboard)/admin/layout.tsx — current (client-only)
useEffect(() => {
  if (!loading && user && user.role !== 'ADMIN') {
    router.replace('/dashboard')  // runs only in the browser
  }
}, [user, loading, router])
```

**Fix:** Create `middleware.ts` at the project root that validates the `auth-token` cookie and checks the decoded role before the request reaches any route handler or page.

```ts
// middleware.ts
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { verifyToken } from '@/lib/auth'

export function middleware(request: NextRequest) {
  const token = request.cookies.get('auth-token')?.value
  const { pathname } = request.nextUrl

  if (!token) return NextResponse.redirect(new URL('/login', request.url))

  try {
    const payload = verifyToken(token)
    if (pathname.startsWith('/admin') && payload.role !== 'ADMIN') {
      return NextResponse.redirect(new URL('/dashboard', request.url))
    }
  } catch {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/(dashboard)/:path*', '/admin/:path*'],
}
```

---

### C-2 — JWT role trusted from token, never re-verified against the database

**Files:** `lib/auth.ts`, all API route handlers  
**Impact:** The role embedded in the JWT is used directly to authorise admin actions (e.g. `booking.userId !== user.sub && user.role !== 'ADMIN'` in `app/api/bookings/[bookingId]/route.ts:140`). If an employee's role is downgraded in the database, their existing token still carries `ADMIN` for up to 7 days. CLAUDE.md explicitly requires: _"Never trust client-supplied role. Re-fetch role from the DB in every Server Action and protected route handler."_ This is not implemented.

**Fix:** Add a thin `getAuthUserFromDb` helper to `lib/auth.ts` and use it in any route that performs a role check:

```ts
// lib/auth.ts — add
export async function getAuthUserFromDb(request: Request) {
  const payload = getAuthUser(request)
  if (!payload) return null
  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    select: { id: true, email: true, role: true, isActive: true },
  })
  if (!user || !user.isActive) return null
  return user
}
```

---

### C-3 — No rate limiting on authentication or OTP endpoints

**Files:** `app/api/auth/login/route.ts`, `app/api/bookings/route.ts`, `app/api/bookings/[bookingId]/resend-otp/route.ts`  
**Impact:** Login is bruteforceable without any throttling. OTP resend has no limit — an attacker can generate an unlimited number of OTPs for a target booking, burning through SMS/email budget and increasing the probability of a correct guess via parallel requests. CLAUDE.md mandates Upstash Redis for rate limiting (`UPSTASH_REDIS_REST_URL` is in `.env.example`) but no implementation exists.

**Fix:** Add Upstash rate limiting to at minimum the three endpoints above. Example for login:

```ts
import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'

const ratelimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(5, '1 m'), // 5 attempts per minute per IP
})

// In POST /api/auth/login:
const ip = request.headers.get('x-forwarded-for') ?? 'anonymous'
const { success } = await ratelimit.limit(`login:${ip}`)
if (!success) {
  return NextResponse.json(
    { error: { code: 'RATE_LIMITED', message: 'Too many attempts. Try again later.' } },
    { status: 429 }
  )
}
```

---

### C-4 — Pusher channels are public — booking notifications expose user IDs

**Files:** `lib/realtime.ts`, `hooks/useBookingUpdates.ts`, `hooks/useSlotUpdates.ts`  
**Impact:** All Pusher channels use the public channel pattern (`parking-floor-{floorId}`, `booking-user-{userId}`). Any client with the `NEXT_PUBLIC_PUSHER_KEY` — which is exposed to every browser by design — can subscribe to `booking-user-{anyUserId}` and receive real-time booking status events for any user, including slot labels, floor names, confirmation times, and cancellation times. Pusher's private channels require server-side auth before a subscription is granted.

**Fix:** Switch to private Pusher channels and implement the auth endpoint:

```ts
// app/api/pusher/auth/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { getPusher } from '@/lib/realtime'
import { getAuthUser } from '@/lib/auth'

export async function POST(request: NextRequest) {
  const user = getAuthUser(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.text()
  const params = new URLSearchParams(body)
  const socketId = params.get('socket_id')!
  const channelName = params.get('channel_name')!

  // Only allow the user to auth their own booking channel
  if (channelName === `private-booking-user-${user.sub}` ||
      channelName.startsWith('private-parking-floor-')) {
    const auth = getPusher()!.authorizeChannel(socketId, channelName)
    return NextResponse.json(auth)
  }

  return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
}
```

Then rename channels to `private-parking-floor-{id}` and `private-booking-user-{id}`, and configure `pusher-js` with `authEndpoint: '/api/pusher/auth'`.

---

## High

### H-1 — JWT token returned in API response body

**Files:** `app/api/auth/login/route.ts:85-88`, `app/api/auth/register/route.ts:89-92`  
**Impact:** The signed JWT is set as an HTTP-only cookie (good) AND simultaneously returned in the JSON body (`data.token`). The body token is readable by any JavaScript running on the page, including injected third-party scripts. If an XSS vulnerability is ever introduced, session tokens are immediately harvestable.

**Fix:** Remove `token` from the JSON response body. The HTTP-only cookie is sufficient for all browser flows. API consumers that need a token (e.g. mobile clients) should use a separate dedicated endpoint with additional controls.

---

### H-2 — No token revocation: deactivated accounts retain valid sessions

**Files:** `lib/auth.ts`, `app/api/auth/me/route.ts`  
**Impact:** `isActive` is checked in `/api/auth/me` but not in `getAuthUser()`, which is used in every other route. A deactivated user can continue to call all booking and slot APIs for up to 7 days using a token issued before deactivation. There is also no mechanism for admins to invalidate specific sessions (e.g. on security incident).

**Fix (short term):** Check `isActive` inside `getAuthUser()` — or better, use the `getAuthUserFromDb` helper from C-2 which always re-fetches the user.  
**Fix (long term):** Maintain a token version counter per user in the DB and embed it in the JWT. Invalidate all sessions by incrementing the counter.

---

### H-3 — OTP plaintext exposed in non-production API responses

**Files:** `app/api/bookings/route.ts:271`, `app/api/bookings/[bookingId]/resend-otp/route.ts:93`  
**Impact:** Both booking creation and OTP resend return `otpCode` in the response body when `NODE_ENV !== 'production'`. Staging and review environments will expose real OTP values to any client that can call these APIs, defeating the purpose of OTP verification.

```ts
// Current — leaks OTP in staging
...(process.env.NODE_ENV !== 'production' && { otpCode }),
```

**Fix:** Remove OTP from the response entirely. Write the OTP to a structured log entry (at `debug` level) that is only accessible to developers with server log access. Never transmit the plaintext OTP to the client under any circumstances.

---

### H-4 — No HTTP security headers

**File:** `next.config.ts` (currently empty config)  
**Impact:** No `Content-Security-Policy`, `Strict-Transport-Security`, `X-Frame-Options`, `X-Content-Type-Options`, or `Permissions-Policy` headers are emitted. The application is exposed to clickjacking, MIME-sniffing, and protocol downgrade attacks.

**Fix:** Add a `headers()` export to `next.config.ts`:

```ts
const securityHeaders = [
  { key: 'X-DNS-Prefetch-Control', value: 'on' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",   // tighten after nonce setup
      "style-src 'self' 'unsafe-inline'",
      "connect-src 'self' wss://*.pusher.com https://sockjs-*.pusher.com",
      "img-src 'self' data:",
      "frame-ancestors 'none'",
    ].join('; '),
  },
]

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: '/(.*)', headers: securityHeaders }]
  },
}
```

---

### H-5 — `/api/floors` is unauthenticated

**File:** `app/api/floors/route.ts`  
**Impact:** The floors listing endpoint requires no authentication. An unauthenticated actor can enumerate all active parking floors, their names, levels, total slot counts, and real-time available slot counts — indefinitely and at any rate. This is an information disclosure and facilitates targeted reconnaissance (e.g. which floors have free slots right now).

**Fix:** Add `getAuthUser` check at the top of the `GET` handler, consistent with `/api/floors/[floorId]/slots` which already requires auth.

---

### H-6 — Admin panel `AllBookingsTab` calls the user-scoped bookings endpoint

**Files:** `components/admin/AdminPanel.tsx:132`, `app/api/bookings/route.ts:44`  
**Impact:** The admin panel's "Bookings" tab calls `GET /api/bookings`, which applies `where: { userId: user.sub }` — filtering to only the requesting admin's own bookings. An admin using this UI sees only their personal bookings, not all employee bookings. This is a broken access control in the opposite direction: an admin privilege without the data access it implies.

**Fix:** Add a separate admin-scoped endpoint (`GET /api/admin/bookings`) that:
1. Re-validates the role against the DB (per C-2)
2. Omits the `userId` filter
3. Includes employee name/email in the response

---

## Medium

### M-1 — `x-forwarded-for` accepted verbatim for audit log IP

**Files:** `app/api/bookings/route.ts:156`, `app/api/bookings/[bookingId]/route.ts:154`, `app/api/bookings/[bookingId]/confirm/route.ts:124`  
**Impact:** Any client can set `X-Forwarded-For: 1.2.3.4` to spoof the source IP recorded in audit logs, undermining the audit trail for incident response.

**Fix:** Only trust `x-forwarded-for` when the request originates from a trusted reverse proxy. In production behind a known proxy (Vercel, Nginx), take only the first IP from the header. In development, fall back to the connection IP.

---

### M-2 — Weak password policy

**File:** `app/api/auth/register/route.ts:9`  
**Impact:** `password: z.string().min(8).max(100)` accepts passwords like `password`, `12345678`, or any 8-character string. No complexity requirement is enforced.

**Fix:** Add a regex or zod refinement:
```ts
password: z.string().min(12).max(100)
  .regex(/[A-Z]/, 'Must contain an uppercase letter')
  .regex(/[0-9]/, 'Must contain a number')
  .regex(/[^A-Za-z0-9]/, 'Must contain a special character'),
```

---

### M-3 — Login failures not recorded in the audit log

**File:** `app/api/auth/login/route.ts`  
**Impact:** Only successful logins are written to `AuditLog` (action: `USER_LOGIN`). Failed attempts — whether from a wrong password or an unknown email — produce no audit record. This makes brute-force detection and forensic analysis impossible.

**Fix:** Write an audit record on failure:
```ts
await prisma.auditLog.create({
  data: {
    action: 'LOGIN_FAILED',
    metadata: { email, reason: 'invalid_credentials' },
    ipAddress: ip,
    userAgent: ua,
  },
})
```

---

### M-4 — Self-registration is fully open (no domain restriction)

**File:** `app/api/auth/register/route.ts`  
**Impact:** Anyone can register an account with any email address. For an internal office parking system, this should be restricted to employees with corporate email domains.

**Fix:** Add domain validation:
```ts
email: z.string().email().refine(
  (e) => e.endsWith('@yourcompany.com'),
  'Only company email addresses are permitted'
),
```
Or implement an admin-approval flow for new registrations.

---

### M-5 — `booking-user-{userId}` channel leaks internal user IDs

**File:** `lib/realtime.ts`  
**Impact:** Even before the C-4 fix is applied, the channel naming pattern encodes a user's database ID in a predictable form. If user IDs are sequential integers or short cuid strings, enumeration becomes trivial.

**Fix:** Addressed by C-4 (private channels with server-side auth). As an interim measure, use an HMAC of the user ID instead of the raw ID:
```ts
import { createHmac } from 'crypto'
const channelToken = createHmac('sha256', process.env.PUSHER_SECRET!)
  .update(userId)
  .digest('hex')
  .slice(0, 16)
// channel: `booking-user-${channelToken}`
```

---

## Low / Informational

### L-1 — `.env.example` references `NEXTAUTH_SECRET` which is not used

**File:** `.env.example:9`  
The example file documents `NEXTAUTH_SECRET` and `NEXTAUTH_URL`, implying next-auth is used. The actual application uses a custom JWT via `JWT_SECRET`. `NEXTAUTH_SECRET` is never read. This misleads developers during environment setup and may cause them to skip setting the real secret.

**Fix:** Remove `NEXTAUTH_SECRET`/`NEXTAUTH_URL` from `.env.example`. Add `JWT_SECRET` with a generation instruction.

---

### L-2 — JWT defaults to 7-day expiry if `JWT_EXPIRES_IN` is unset

**File:** `lib/auth.ts:5`  
```ts
const expiresIn = (process.env.JWT_EXPIRES_IN ?? '7d') as jwt.SignOptions['expiresIn']
```
If `JWT_EXPIRES_IN` is absent from the environment, sessions last 7 days silently. A missing env var should fail loudly, not apply a long-lived default.

**Fix:** Throw on missing `JWT_EXPIRES_IN` alongside `JWT_SECRET`, or choose a shorter hardcoded default (e.g. `'24h'`).

---

### L-3 — bcrypt rounds inconsistency

**Files:** `app/api/auth/register/route.ts:70` (12 rounds), `lib/otp.ts` (10 rounds)  
Password hashing uses 12 rounds (good for 2026 hardware). OTP hashing uses 10 rounds. While OTPs are shorter-lived and less sensitive than passwords, keeping rounds consistent reduces cognitive overhead when reviewing cryptographic parameters.

---

### L-4 — No `SameSite=Strict` on auth cookie

**Files:** `app/api/auth/login/route.ts:93`, `app/api/auth/register/route.ts:96`  
```ts
sameSite: 'lax',
```
`SameSite=Lax` allows the cookie to be sent on top-level navigations. For a parking booking system that has no OAuth flow or cross-site redirects, `SameSite=Strict` is safer and provides additional CSRF protection on top of Next.js's built-in defence.

---

### L-5 — No `Secure` flag on auth cookie in development

**Files:** Same as L-4  
```ts
secure: process.env.NODE_ENV === 'production',
```
While expected during development, this means developers running the app over HTTPS locally (e.g. with `next dev --experimental-https`) won't trigger the secure flag. Consider always setting `secure: true` and document that the dev server must be run over HTTP.

---

## Positive Findings

The following security controls are correctly implemented:

| Control | Location | Notes |
|---|---|---|
| Constant-time login comparison | `app/api/auth/login/route.ts:53-56` | Dummy hash prevents user enumeration via timing |
| bcrypt for passwords | `app/api/auth/register/route.ts:70` | 12 rounds — appropriate |
| bcrypt for OTP | `lib/otp.ts` | Hash-only storage; plaintext never persisted to DB |
| Parameterised queries | All Prisma calls | No SQL injection surface |
| Atomic booking transactions | `app/api/bookings/route.ts` | Slot conflict check + create + reserve in one TX |
| DB-level double-booking constraint | `prisma/schema.prisma` | `@@unique([slotId, date, startTime, endTime])` |
| OTP max attempts + lockout | `lib/otp.ts`, confirm route | 3 attempts then `isLocked = true` |
| OTP 5-minute expiry | `lib/otp.ts` | Enforced at verification time |
| HTTP-only cookie | Login + register routes | Cookie not accessible to JavaScript |
| Ownership checks on bookings | `app/api/bookings/[bookingId]/route.ts` | `booking.userId !== user.sub` before any mutation |
| No raw query usage | Entire codebase | `$queryRawUnsafe` never used |
| Zod validation on all inputs | All route handlers | Validates before DB access |
| Audit log for mutations | Booking create/confirm/cancel | Immutable `AuditLog` table records all mutations |
| `isActive` check on me endpoint | `app/api/auth/me/route.ts:43` | Deactivated accounts blocked at session refresh |
| IP + UA captured in audit logs | Booking mutation routes | Present (though spoofable — see M-1) |

---

## Remediation Priority

| Priority | Item | Effort |
|---|---|---|
| P0 (before any production traffic) | C-1 Server-side middleware | 1–2 h |
| P0 | C-3 Rate limiting on login + OTP | 2–3 h |
| P0 | C-4 Private Pusher channels | 3–4 h |
| P0 | H-3 Remove OTP from API response | 30 min |
| P1 (within 1 sprint) | C-2 Re-fetch role from DB | 2–3 h |
| P1 | H-1 Remove token from response body | 30 min |
| P1 | H-2 Token revocation on deactivate | 2–3 h |
| P1 | H-4 Security headers in next.config.ts | 1 h |
| P1 | H-5 Auth on `/api/floors` | 30 min |
| P1 | H-6 Admin-scoped bookings endpoint | 2–3 h |
| P2 (next sprint) | M-1 Proxy-aware IP extraction | 1 h |
| P2 | M-2 Stronger password policy | 30 min |
| P2 | M-3 Audit failed logins | 1 h |
| P2 | M-4 Email domain restriction | 1 h |
| P3 (backlog) | L-1 Fix `.env.example` | 15 min |
| P3 | L-2 Strict JWT expiry default | 15 min |
| P3 | L-4 SameSite=Strict cookie | 15 min |
