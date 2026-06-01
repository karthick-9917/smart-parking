# SmartPark — Software Specification

> Office Car Parking Slot Booking Platform  
> Version 1.0 · Stack: Next.js 15 · TypeScript · Prisma · PostgreSQL · Tailwind CSS · Pusher

---

## Table of Contents

1. [Requirements](#1-requirements)
2. [Technical Design](#2-technical-design)
3. [Implementation Plan](#3-implementation-plan)
4. [Scope Boundaries](#4-scope-boundaries)
5. [Success Criteria](#5-success-criteria)
6. [Database Relationships](#6-database-relationships)
7. [API Contracts](#7-api-contracts)
8. [Frontend Component Tree](#8-frontend-component-tree)
9. [OTP Flow Diagram](#9-otp-flow-diagram)
10. [Security Considerations](#10-security-considerations)
11. [Grading Rubric Mapping](#11-grading-rubric-mapping)

---

## 1. Requirements

### 1.1 Functional Requirements

#### Employee (Role: EMPLOYEE)

| ID | Requirement |
|----|-------------|
| FR-01 | Employee can log in using their registered work email via OTP |
| FR-02 | Employee can view a floor-wise, seat-map style parking slot grid |
| FR-03 | Employee can select a date and time window for their booking |
| FR-04 | Employee can select an available slot and initiate a booking |
| FR-05 | Employee receives a 6-digit OTP on email to confirm the booking |
| FR-06 | Booking is confirmed only after successful OTP verification |
| FR-07 | Employee can view their booking history (all statuses) |
| FR-08 | Employee can cancel their own confirmed or pending booking |
| FR-09 | Employee can see real-time slot availability without refreshing |
| FR-10 | Employee receives notification when their pending booking expires |

#### Admin (Role: ADMIN)

| ID | Requirement |
|----|-------------|
| FR-11 | Admin can create, rename, and deactivate parking floors |
| FR-12 | Admin can add, edit, and remove individual parking slots |
| FR-13 | Admin can set a slot to MAINTENANCE (blocking all bookings for it) |
| FR-14 | Admin can bulk-change slot status for multiple slots at once |
| FR-15 | Admin can view all bookings with filters (date, floor, user, status) |
| FR-16 | Admin can cancel any booking with a reason |
| FR-17 | Admin can view occupancy analytics by zone, floor, and time period |
| FR-18 | Admin sees peak-hours chart and top-user breakdown |

### 1.2 Non-Functional Requirements

| ID | Requirement | Target |
|----|-------------|--------|
| NFR-01 | Slot status updates visible to all users | ≤ 2 seconds via Pusher |
| NFR-02 | Booking action end-to-end response time | ≤ 500 ms (p95) |
| NFR-03 | OTP email delivery | ≤ 30 seconds |
| NFR-04 | System uptime | 99.5% |
| NFR-05 | Concurrent users supported | ≥ 200 simultaneous |
| NFR-06 | Database query time for slot map (per floor) | ≤ 50 ms |
| NFR-07 | Accessibility | WCAG 2.1 AA for all interactive elements |
| NFR-08 | Mobile responsiveness | Usable on viewport ≥ 375 px |

### 1.3 Constraints

- Deployment runtime: Node.js 18.20.5 (Vercel compatible)
- PostgreSQL 15+ required for `@db.Date` type and index features
- Pusher free tier: 200 concurrent connections, 200 k messages/day (sufficient for office use)
- No payment processing, hardware integration, or external calendar sync in v1.0

---

## 2. Technical Design

### 2.1 Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Browser (Client)                          │
│  Server Components (static, data-fetched)                        │
│  Client Components (interactive: SlotMap, OTP forms, charts)    │
│  Pusher JS client (real-time slot state via WebSocket)          │
└────────────────────┬───────────────────────────────────────────┘
                     │  HTTPS
┌────────────────────▼───────────────────────────────────────────┐
│                   Next.js 15 App Router (Vercel)                │
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────┐   │
│  │ Server       │  │ Route        │  │ Middleware          │   │
│  │ Actions      │  │ Handlers     │  │ (auth + role guard) │   │
│  │ (mutations)  │  │ (OTP, health,│  │                     │   │
│  └──────┬───────┘  │  Pusher auth,│  └────────────────────┘   │
│         │          │  cron)       │                              │
│         │          └──────┬───────┘                             │
│         │                 │                                      │
│  ┌──────▼─────────────────▼──────────────────────────────┐     │
│  │                    lib/ layer                           │     │
│  │  prisma.ts · auth.ts · otp.ts · mailer.ts             │     │
│  │  realtime.ts · ratelimit.ts · audit.ts · logger.ts    │     │
│  └──────┬────────────────────────────────────────────────┘     │
└─────────┼──────────────────────────────────────────────────────┘
          │
   ┌──────┴──────────────────────────────────┐
   │                                          │
┌──▼────────┐  ┌────────────┐  ┌───────────▼──────┐
│ PostgreSQL│  │  Pusher    │  │  Upstash Redis    │
│  (Neon)   │  │  Channels  │  │  (rate limiting)  │
│  via      │  │  (real-    │  │                   │
│  Prisma   │  │  time)     │  └───────────────────┘
└───────────┘  └────────────┘
```

### 2.2 Technology Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Framework | Next.js 15 App Router | Server Components reduce client JS; built-in Server Actions for mutations |
| ORM | Prisma 5 | Type-safe queries; migration tooling; generates TypeScript types from schema |
| Auth | NextAuth v5 (Credentials) | OTP-based login fits Credentials provider; JWT session avoids DB session table |
| Real-time | Pusher Channels | Managed WebSocket; private channels; simpler ops than self-hosted Socket.IO |
| Rate limiting | Upstash Redis + @upstash/ratelimit | Serverless-native; sliding window; no persistent connections needed |
| Email | Nodemailer (SMTP / AWS SES) | Standard; swappable transport; Ethereal for local dev |
| Charts | Recharts | React-native; composable; no D3 expertise required |
| Validation | Zod | TypeScript-first; composable; parse-don't-validate pattern |
| Testing | Vitest + RTL + Playwright | Vitest is ESM-native; RTL for components; Playwright for E2E |

### 2.3 Data Flow: Booking

```
Employee selects slot
        │
        ▼
createBooking() Server Action
  ├── Zod validates input
  ├── Re-fetch user role from DB
  ├── prisma.$transaction {
  │     SELECT ParkingSlot FOR UPDATE
  │     Guard: status must be AVAILABLE
  │     Guard: no user conflict on same date+time
  │     INSERT Booking (status=PENDING_OTP)
  │     INSERT OtpRequest (hash, expiresAt=+5min)
  │     UPDATE ParkingSlot (status=RESERVED)
  │   }
  ├── Send OTP email (lib/mailer)
  ├── Pusher trigger: slot.reserved → all floor subscribers
  └── Write AuditLog: BOOKING_CREATED
        │
        ▼
Employee enters OTP
        │
        ▼
confirmBooking() Server Action
  ├── Zod validates {bookingId, otp}
  ├── Fetch OtpRequest: check !isLocked, !verifiedAt, expiresAt > now()
  ├── bcrypt.compare(otp, otpRequest.otpHash)
  │     ├── FAIL: attempts++ → if ≥3: isLocked=true, Booking→EXPIRED, Slot→AVAILABLE
  │     │         Pusher: slot.available
  │     └── PASS: prisma.$transaction {
  │               OtpRequest.verifiedAt = now()
  │               Booking.status = CONFIRMED
  │               ParkingSlot.status = OCCUPIED
  │             }
  │             Pusher: slot.confirmed
  └── Write AuditLog: BOOKING_CONFIRMED
```

---

## 3. Implementation Plan

### Phase 0 — Foundation (Days 1–2)

**Deliverable:** Runnable Next.js app with DB schema migrated, auth scaffolded, CI skeleton live.

| Task | Files |
|------|-------|
| Manual scaffold (Node 18 — write config files directly) | `package.json`, `next.config.ts`, `tsconfig.json`, `tailwind.config.ts`, `postcss.config.mjs`, `.gitignore` |
| Prisma schema + initial migration | `prisma/schema.prisma`, `prisma/migrations/` |
| Prisma singleton | `lib/prisma.ts` |
| NextAuth v5 setup | `lib/auth.ts`, `app/api/auth/[...nextauth]/route.ts` |
| Middleware route guards | `middleware.ts` |
| Shared types | `types/index.ts` |
| Test configs | `vitest.config.ts`, `playwright.config.ts` |
| CI skeleton | `.github/workflows/ci.yml` |

### Phase 1 — Auth + OTP Login (Days 3–4)

**Deliverable:** Employee can log in via email OTP.

| Task | Files |
|------|-------|
| OTP core logic | `lib/otp.ts` |
| Email delivery | `lib/mailer.ts` |
| Rate limiting | `lib/ratelimit.ts` |
| Audit logging | `lib/audit.ts` |
| OTP route handlers | `app/api/otp/send/route.ts`, `app/api/otp/verify/route.ts` |
| Auth UI | `components/auth/LoginForm.tsx`, `components/auth/LoginOtpForm.tsx` |
| Auth pages | `app/(auth)/login/page.tsx`, `app/(auth)/verify-otp/page.tsx` |
| Unit tests | `lib/__tests__/otp.test.ts` |

### Phase 2 — Core Booking Flow (Days 5–8)

**Deliverable:** Visual slot map, booking with OTP confirm, cancel, real-time updates.

| Task | Files |
|------|-------|
| Pusher server helpers | `lib/realtime.ts` |
| Pusher auth endpoint | `app/api/webhooks/pusher/route.ts` |
| Slot data actions | `app/actions/slots.ts` |
| Dashboard layout | `app/(dashboard)/layout.tsx`, `components/layout/AppShell.tsx` |
| Slot map components | `components/parking/SlotMap.tsx`, `components/parking/SlotCell.tsx` |
| Real-time hooks | `lib/hooks/usePusherChannel.ts`, `lib/hooks/useSlotMap.ts` |
| Booking actions | `app/actions/booking.ts` |
| Booking UI | `components/parking/BookingDrawer.tsx`, `components/parking/BookingOtpForm.tsx` |
| Booking pages | `app/(dashboard)/book/[floorId]/page.tsx`, `app/(dashboard)/book/confirm/page.tsx` |
| History | `app/(dashboard)/my-bookings/page.tsx`, `components/parking/BookingHistoryList.tsx` |
| Expiry cron | `app/api/cron/expire-bookings/route.ts` |
| Integration tests | `app/actions/__tests__/booking.integration.test.ts` |

### Phase 3 — Admin Dashboard (Days 9–11)

**Deliverable:** Floor/slot CRUD, slot blocking, admin booking management.

| Task | Files |
|------|-------|
| Admin actions | `app/actions/admin.ts` |
| Admin layout + guard | `app/(dashboard)/admin/layout.tsx` |
| Floor management | `components/admin/FloorForm.tsx`, `app/(dashboard)/admin/slots/page.tsx` |
| Slot editor | `components/admin/SlotEditor.tsx`, `components/admin/SlotGrid.tsx` |
| Bulk operations | `components/admin/BlockSlotsPanel.tsx` |
| Admin bookings | `components/admin/AdminBookingTable.tsx`, `app/(dashboard)/admin/bookings/page.tsx` |
| Admin E2E | `e2e/admin.spec.ts` |

### Phase 4 — Analytics (Days 12–13)

**Deliverable:** Occupancy charts, peak hours, top users, analytics MCP server.

| Task | Files |
|------|-------|
| Analytics action | `app/actions/admin.ts` — `getAnalytics()` |
| Chart components | `components/analytics/OccupancyChart.tsx`, `PeakHoursChart.tsx`, `ZoneHeatMap.tsx` |
| Analytics page | `app/(dashboard)/admin/analytics/page.tsx` |
| MCP server | `mcp/smartpark-analytics/index.ts` |

### Phase 5 — Hardening + CI/CD (Days 14–16)

**Deliverable:** Security hardened, 80% test coverage, full pipeline, production deploy.

| Task | Files |
|------|-------|
| Security middleware helpers | `lib/middleware-helpers.ts` |
| Logger with OTP scrubbing | `lib/logger.ts` |
| Security headers | `next.config.ts` — `headers()` |
| Full CI pipeline | `.github/workflows/ci.yml` (all 5 jobs) |
| Staging + prod workflows | `.github/workflows/deploy-staging.yml`, `deploy-prod.yml` |
| Test seed | `prisma/seed.ts` |
| E2E suite | `e2e/employee-booking.spec.ts`, `e2e/real-time.spec.ts` |

### Timeline Summary

| Phase | Days | Deliverable |
|-------|------|-------------|
| 0: Foundation | 1–2 | Runnable app, schema migrated, CI skeleton |
| 1: Auth + OTP Login | 3–4 | OTP login, session, route guards |
| 2: Core Booking | 5–8 | Slot map, book, OTP confirm, cancel, real-time |
| 3: Admin Dashboard | 9–11 | Floor/slot CRUD, blocking, admin booking list |
| 4: Analytics | 12–13 | Charts, aggregations, MCP analytics server |
| 5: Hardening + CI/CD | 14–16 | Security, 80% coverage, E2E, full pipeline, prod deploy |
| **Total** | **16 days** | **Production-ready SmartPark v1.0** |

---

## 4. Scope Boundaries

### In Scope (v1.0)

| Feature | Description |
|---------|-------------|
| OTP-based login | Email OTP via Nodemailer / AWS SES |
| Visual slot map | Floor-wise grid (BookMyShow style) |
| Booking with OTP confirmation | PENDING_OTP → CONFIRMED flow |
| Real-time availability | Pusher private channels per floor |
| Booking cancellation | By owner or admin |
| Booking history | Per-user paginated list |
| Admin floor + slot CRUD | Create, edit, deactivate floors and slots |
| Slot blocking | MAINTENANCE status; auto-cancels active bookings |
| Bulk slot operations | Multi-select status change |
| Admin booking management | Paginated all-bookings view with filters |
| Parking analytics | Occupancy by day/zone, peak hours, top users |
| Audit log | Immutable record for all mutations |
| CI/CD pipeline | GitHub Actions → Vercel |

### Out of Scope (v1.0)

| Feature | Reason |
|---------|--------|
| Recurring bookings | Requires RRULE engine + cross-date conflict detection — deferred to v2 |
| Payment processing | No business requirement for v1 |
| Guest / visitor bookings | Employees only |
| Mobile native app | Responsive web is sufficient for office use |
| Multi-campus / multi-building | Single building; future SaaS concern |
| Hardware integrations | Barrier gates, sensors, license plate recognition |
| Calendar sync | Google Calendar / Outlook integration |
| Waitlist | Queue management deferred to v2 |
| SMS OTP delivery | Email only for v1 |
| Vehicle registration database | Optional vehicle number field only |

---

## 5. Success Criteria

### Functional Acceptance

| Criterion | Verification |
|-----------|-------------|
| Employee completes full booking flow (select → book → OTP → confirmed) | `e2e/employee-booking.spec.ts` passes |
| Two simultaneous users cannot book the same slot | Integration test: concurrent `createBooking` returns 409 for the second |
| Slot appears RESERVED to other users within 2 s of booking | `e2e/real-time.spec.ts`: second browser context sees update |
| OTP expires and slot is released after 5 minutes | Integration test: mock time, run cron, verify Booking=EXPIRED + Slot=AVAILABLE |
| Admin blocks a slot; active bookings on it are cancelled | Integration test + `e2e/admin.spec.ts` |
| Analytics page shows correct occupancy totals | Integration test: seed known data, verify `groupBy` output |

### Technical Quality

| Criterion | Target | Measurement |
|-----------|--------|-------------|
| Unit + integration test coverage | ≥ 80% statements | `npm run test:all -- --coverage` |
| TypeScript errors | 0 | `npm run typecheck` |
| ESLint errors | 0 | `npm run lint` |
| Next.js production build | No errors | `npm run build` |
| All 5 CI jobs pass | Green on every PR | GitHub Actions status |
| No high/critical npm vulnerabilities | 0 | `npm audit` |
| Production smoke test | `/api/health` → 200 | Post-deploy workflow step |

---

## 6. Database Relationships

### Entity-Relationship Overview

```
User
 ├──< Booking         (one user → many bookings)
 ├──< OtpRequest      (one user → many OTP requests)
 └──< AuditLog        (one user → many audit entries, nullable actor)

Floor
 └──< ParkingSlot     (one floor → many slots)

ParkingSlot
 └──< Booking         (one slot → many bookings, constrained by unique index)

Booking
 ├──1 OtpRequest      (one booking → at most one active OTP, via unique bookingId)
 └──< AuditLog        (one booking → many audit entries)
```

### Relationship Details

```
User {1} ──────────── {M} Booking
  Booking.userId = User.id
  Cascade: RESTRICT (cannot delete user with bookings)

User {1} ──────────── {M} OtpRequest
  OtpRequest.userId = User.id
  Both LOGIN and BOOKING_CONFIRM OTPs reference the same user

Floor {1} ─────────── {M} ParkingSlot
  ParkingSlot.floorId = Floor.id
  Cascade: RESTRICT (cannot delete floor with active slots)

ParkingSlot {1} ────── {M} Booking
  Booking.slotId = ParkingSlot.id
  @@unique([slotId, date, startTime, endTime]) — DB enforces no double-booking
  Cascade: RESTRICT

Booking {1} ────────── {0..1} OtpRequest   [BOOKING_CONFIRM purpose only]
  OtpRequest.bookingId = Booking.id (unique)
  OtpRequest.bookingId is NULL for LOGIN purpose

User    {0..1} ──────── {M} AuditLog   [actor — null for system actions]
Booking {0..1} ──────── {M} AuditLog   [subject]
```

### Full Schema

```prisma
// prisma/schema.prisma

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum Role          { EMPLOYEE ADMIN }
enum SlotStatus    { AVAILABLE OCCUPIED RESERVED MAINTENANCE }
enum BookingStatus { PENDING_OTP CONFIRMED CANCELLED EXPIRED NO_SHOW }
enum OtpPurpose    { LOGIN BOOKING_CONFIRM }
enum AuditAction   {
  BOOKING_CREATED BOOKING_CONFIRMED BOOKING_CANCELLED BOOKING_EXPIRED
  SLOT_CREATED SLOT_UPDATED SLOT_BLOCKED
  FLOOR_CREATED FLOOR_UPDATED
  USER_LOGIN USER_LOGOUT ADMIN_ACTION
}

model User {
  id          String   @id @default(cuid())
  email       String   @unique
  name        String
  phone       String?  @unique
  role        Role     @default(EMPLOYEE)
  employeeId  String   @unique
  department  String?
  isActive    Boolean  @default(true)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  bookings    Booking[]
  otpRequests OtpRequest[]
  auditLogs   AuditLog[]

  @@index([email])
  @@index([employeeId])
  @@index([role])
}

model Floor {
  id          String   @id @default(cuid())
  name        String
  level       Int      @unique
  description String?
  isActive    Boolean  @default(true)
  totalSlots  Int      @default(0)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  slots       ParkingSlot[]

  @@index([level])
  @@index([isActive])
}

model ParkingSlot {
  id           String     @id @default(cuid())
  label        String
  zone         String
  floorId      String
  row          Int
  column       Int
  status       SlotStatus @default(AVAILABLE)
  isEVCharging Boolean    @default(false)
  isHandicap   Boolean    @default(false)
  notes        String?
  createdAt    DateTime   @default(now())
  updatedAt    DateTime   @updatedAt

  floor        Floor      @relation(fields: [floorId], references: [id])
  bookings     Booking[]

  @@unique([floorId, label])
  @@unique([floorId, row, column])
  @@index([floorId])
  @@index([status])
  @@index([zone])
  @@index([floorId, status])
}

model Booking {
  id                 String        @id @default(cuid())
  userId             String
  slotId             String
  date               DateTime      @db.Date
  startTime          DateTime
  endTime            DateTime
  status             BookingStatus @default(PENDING_OTP)
  vehicleNumber      String?
  confirmedAt        DateTime?
  cancelledAt        DateTime?
  cancelledBy        String?
  cancellationReason String?
  createdAt          DateTime      @default(now())
  updatedAt          DateTime      @updatedAt

  user               User          @relation(fields: [userId], references: [id])
  slot               ParkingSlot   @relation(fields: [slotId], references: [id])
  otpRequest         OtpRequest?   @relation("BookingOtp")
  auditLogs          AuditLog[]

  @@unique([slotId, date, startTime, endTime])
  @@index([userId])
  @@index([slotId])
  @@index([date])
  @@index([status])
  @@index([userId, date])
  @@index([slotId, date, status])
}

model OtpRequest {
  id          String     @id @default(cuid())
  userId      String
  purpose     OtpPurpose
  bookingId   String?    @unique
  otpHash     String
  attempts    Int        @default(0)
  maxAttempts Int        @default(3)
  expiresAt   DateTime
  verifiedAt  DateTime?
  isLocked    Boolean    @default(false)
  deliveredTo String
  createdAt   DateTime   @default(now())
  updatedAt   DateTime   @updatedAt

  user        User       @relation(fields: [userId], references: [id])
  booking     Booking?   @relation("BookingOtp", fields: [bookingId], references: [id])

  @@index([userId, purpose])
  @@index([expiresAt])
  @@index([bookingId])
}

model AuditLog {
  id        String      @id @default(cuid())
  action    AuditAction
  userId    String?
  bookingId String?
  slotId    String?
  metadata  Json?
  ipAddress String?
  userAgent String?
  createdAt DateTime    @default(now())

  user      User?       @relation(fields: [userId], references: [id])
  booking   Booking?    @relation(fields: [bookingId], references: [id])

  @@index([userId])
  @@index([bookingId])
  @@index([action])
  @@index([createdAt])
}
```

### Index Strategy

| Query | Index Used |
|-------|------------|
| Slot availability for a floor | `(floorId, status)` |
| User's booking list | `(userId, date)` |
| Conflict check before booking | `(slotId, date, status)` |
| Cron: find expired PENDING_OTP | `(expiresAt)` |
| Admin booking filters | `(date)`, `(status)`, `(userId)` |
| Audit log by actor | `(userId)`, `(createdAt)` |

---

## 7. API Contracts

All Server Actions return `ActionResult<T>`:
```typescript
type ActionResult<T> = { data: T } | { error: { code: string; message: string } }
```

### Route Handlers

---

#### `POST /api/otp/send`

Send a login OTP to a registered employee email.

**Auth:** None · **Rate limit:** 5 req / 15 min per email

**Request:**
```json
{ "email": "employee@company.com" }
```

**Responses:**
```json
// 200 — OTP sent
{ "data": { "otpRequestId": "clxxx", "expiresAt": "2026-05-26T12:05:00Z" } }

// 400 — validation failure
{ "error": { "code": "VALIDATION_ERROR", "message": "Invalid email address" } }

// 404 — not in system
{ "error": { "code": "USER_NOT_FOUND", "message": "No account found for this email" } }

// 429 — rate limited (+ Retry-After header)
{ "error": { "code": "RATE_LIMITED", "message": "Too many OTP requests. Try again later." } }
```

---

#### `POST /api/otp/verify`

Verify login OTP and issue a session cookie.

**Auth:** None · **Rate limit:** 5 req / 15 min per email

**Request:**
```json
{ "email": "employee@company.com", "otp": "482910" }
```

**Responses:**
```json
// 200 — session issued via Set-Cookie
{ "data": { "redirectTo": "/book" } }

// 400 — wrong OTP
{ "error": { "code": "OTP_INVALID", "message": "Incorrect OTP. 2 attempts remaining." } }

// 400 — expired
{ "error": { "code": "OTP_EXPIRED", "message": "OTP has expired. Please request a new one." } }

// 403 — locked after 3 fails
{ "error": { "code": "OTP_LOCKED", "message": "Too many failed attempts. Request a new OTP." } }
```

---

#### `POST /api/webhooks/pusher`

Pusher private channel authentication.

**Auth:** Valid NextAuth session (401 if none)

**Body:** `application/x-www-form-urlencoded`
```
socket_id=123.456&channel_name=private-parking:floor-clxxx
```

**Channel access rules:**
- `private-parking:floor-{id}` — any authenticated user
- `private-parking:user-{userId}` — session.user.id must equal userId
- `private-parking:admin` — session.user.role must be ADMIN

**Response:** Pusher auth token (raw Pusher format)

---

#### `GET /api/health`

Uptime check / post-deploy smoke test.

**Auth:** None

**Response:**
```json
// 200
{ "data": { "status": "ok", "db": "connected", "timestamp": "2026-05-26T12:00:00Z" } }

// 503
{ "error": { "code": "DB_UNAVAILABLE", "message": "Database connection failed" } }
```

---

#### `GET /api/cron/expire-bookings`

Release RESERVED slots for expired PENDING_OTP bookings. Called by Vercel Cron every 5 min.

**Auth:** `Authorization: Bearer {CRON_SECRET}` header (403 if missing/wrong)

**Response:**
```json
{ "data": { "expired": 3 } }
```

---

### Server Actions

#### `createBooking(input)`

```typescript
type CreateBookingInput = {
  slotId: string         // cuid
  date: string           // "YYYY-MM-DD"
  startTime: string      // ISO 8601
  endTime: string        // ISO 8601
  vehicleNumber?: string // max 10 chars
}
// Returns: { data: { bookingId, otpRequestId, expiresAt } }
// Errors: VALIDATION_ERROR · SLOT_UNAVAILABLE (409) · CONFLICT_BOOKING (409) · UNAUTHORIZED (401)
```

#### `confirmBooking(input)`

```typescript
type ConfirmBookingInput = { bookingId: string; otp: string }  // otp: /^\d{6}$/
// Returns: { data: BookingDTO }
// Errors: OTP_INVALID · OTP_EXPIRED · OTP_LOCKED (403) · BOOKING_NOT_FOUND (404)
```

#### `cancelBooking(input)`

```typescript
type CancelBookingInput = { bookingId: string; reason?: string }
// Returns: { data: { bookingId } }
// Errors: BOOKING_NOT_FOUND · ALREADY_CANCELLED (409) · FORBIDDEN (403)
```

#### `getMyBookings(input)`

```typescript
type PaginationInput = { page: number; pageSize: number; status?: BookingStatus }
// Returns: { data: { items: BookingDTO[], total, page, pageSize } }
```

#### `resendBookingOtp(input)`

```typescript
// Returns: { data: { expiresAt: string } }
// Errors: BOOKING_NOT_FOUND · RESEND_LIMIT_EXCEEDED (max 2 resends per booking)
```

#### `getSlotMapForFloor(input)`

```typescript
type SlotMapInput = { floorId: string; date: string }
type SlotMapDTO = {
  floor: FloorDTO
  slots: SlotCellDTO[]   // SlotCellDTO: { id, label, zone, row, column, status, isEVCharging, isHandicap }
  gridRows: number
  gridCols: number
}
```

#### `getAnalytics(input)` _(Admin only)_

```typescript
type AnalyticsInput = { from: string; to: string; floorId?: string; zone?: string }
type AnalyticsDTO = {
  occupancyByDay:   Array<{ date: string; confirmed: number; total: number; rate: number }>
  occupancyByZone:  Array<{ zone: string; confirmed: number; rate: number }>
  peakHours:        Array<{ hour: number; count: number }>
  topUsers:         Array<{ userId: string; name: string; bookingCount: number }>
  totalBookings:    number
  cancellationRate: number
}
```

---

## 8. Frontend Component Tree

```
app/
│
├── layout.tsx                                ROOT LAYOUT [SERVER]
│   Provides: <html>, Tailwind base, NextAuth SessionProvider
│
├── (auth)/                                   AUTH ROUTE GROUP
│   ├── layout.tsx                            [SERVER] Centered card, no nav
│   ├── login/page.tsx                        [SERVER] → <LoginForm />
│   │   └── components/auth/LoginForm.tsx     [CLIENT]
│   │       ├── <Input type="email" />
│   │       ├── <Button type="submit" />
│   │       └── POST /api/otp/send → redirect /verify-otp
│   │
│   └── verify-otp/page.tsx                   [SERVER] → <LoginOtpForm />
│       └── components/auth/LoginOtpForm.tsx  [CLIENT]
│           ├── 6× <Input maxLength=1 /> (auto-focus chain)
│           └── POST /api/otp/verify → redirect /book
│
└── (dashboard)/                              AUTHENTICATED ROUTE GROUP
    ├── layout.tsx                            [SERVER] Fetches session → <AppShell />
    │   └── components/layout/AppShell.tsx   [SERVER]
    │       ├── components/layout/Sidebar.tsx     [CLIENT] Active link state
    │       └── components/layout/TopBar.tsx      [CLIENT] User menu, sign-out
    │
    ├── book/
    │   ├── page.tsx                          [SERVER] → <FloorTabs /> + <DateSelector />
    │   │   ├── components/parking/FloorTabs.tsx    [CLIENT] URL param: ?floor=
    │   │   └── components/parking/DateSelector.tsx [CLIENT] URL param: ?date=
    │   │
    │   ├── [floorId]/page.tsx                [SERVER] Fetches SlotMapDTO → <SlotMap />
    │   │   └── components/parking/SlotMap.tsx  [CLIENT]  ← CENTRAL INTERACTIVE COMPONENT
    │   │       ├── useSlotMap(floorId, date)    merges server state + Pusher deltas
    │   │       ├── usePusherChannel(...)        subscribes to private-parking:floor-{id}
    │   │       ├── components/parking/SlotCell.tsx  [CLIENT] × N slots
    │   │       │   Colours: green=AVAILABLE · red=OCCUPIED · amber=RESERVED · grey=MAINTENANCE
    │   │       ├── components/parking/SlotLegend.tsx  [SERVER] static legend
    │   │       └── components/parking/BookingDrawer.tsx [CLIENT] (opens on slot click)
    │   │           ├── Slot label, zone, floor, date/time inputs
    │   │           ├── <Button> → createBooking action → loading state
    │   │           └── On success: navigate /book/confirm?bookingId=
    │   │
    │   └── confirm/page.tsx                  [SERVER] → <BookingOtpForm />
    │       └── components/parking/BookingOtpForm.tsx [CLIENT]
    │           ├── 6× <Input /> (same pattern as login)
    │           ├── Countdown timer (reads expiresAt from URL param)
    │           ├── Resend link → resendBookingOtp action
    │           └── confirmBooking action → on success: redirect /my-bookings
    │
    ├── my-bookings/page.tsx                  [SERVER] → <BookingHistoryList />
    │   └── components/parking/BookingHistoryList.tsx [CLIENT]
    │       ├── components/parking/BookingCard.tsx    [SERVER] per-row
    │       │   └── components/parking/CancelBookingButton.tsx [CLIENT]
    │       │       └── <ConfirmDialog /> → cancelBooking action
    │       └── components/ui/Pagination.tsx  [CLIENT]
    │
    └── admin/
        ├── layout.tsx                        [SERVER] ADMIN role guard → redirect /book if EMPLOYEE
        ├── page.tsx                          [SERVER] Quick stats summary
        │
        ├── slots/[floorId]/page.tsx          [SERVER] → <FloorEditorPage />
        │   ├── components/admin/SlotGrid.tsx       [CLIENT] Visual drag-to-place grid
        │   ├── components/admin/SlotEditor.tsx     [CLIENT] Create/edit slot form
        │   ├── components/admin/BlockSlotsPanel.tsx[CLIENT] Multi-select + bulk status
        │   └── components/admin/FloorForm.tsx      [CLIENT]
        │
        ├── bookings/page.tsx                 [SERVER] → <AdminBookingTable />
        │   └── components/admin/AdminBookingTable.tsx [CLIENT]
        │       Column sort, status/date/floor/user filters, per-row cancel
        │
        └── analytics/page.tsx               [SERVER] → <AnalyticsDashboard />
            ├── components/analytics/AnalyticsSummaryCards.tsx [SERVER]
            ├── components/analytics/OccupancyChart.tsx        [CLIENT] Recharts BarChart
            ├── components/analytics/PeakHoursChart.tsx        [CLIENT] Recharts LineChart
            ├── components/analytics/ZoneHeatMap.tsx           [CLIENT] Recharts custom grid
            └── components/analytics/TopUsersTable.tsx         [SERVER]
```

**Client-side Hooks (`lib/hooks/`)**

| Hook | Purpose |
|------|---------|
| `useSlotMap(floorId, date)` | `Map<slotId, SlotCellDTO>` — merges server-rendered initial state with Pusher delta updates; 30 s fallback poll on disconnect |
| `usePusherChannel(channel, handlers)` | Subscribe / unsubscribe on mount/unmount; exposes reconnect state |
| `useBooking()` | Wraps `createBooking` + `confirmBooking` with loading / error state |
| `useToast()` | Global toast queue |

---

## 9. OTP Flow Diagram

### Flow A: Login OTP

```
Employee          Browser           /api/otp/send        /api/otp/verify        DB
────────          ───────           ─────────────        ───────────────        ──

Enter email ─────► POST /api/otp/send
                                    Rate limit check
                                    Lookup User by email
                                    generateOtp() → "482910"
                                    hashOtp()     → "$2b$..."
                                    INSERT OtpRequest ─────────────────────────────────►
                                    sendOtpEmail("482910") ──────────────────────────────► inbox
                  ◄── 200 { otpRequestId, expiresAt }
Redirect → /verify-otp

Enter "482910" ──► POST /api/otp/verify
                                                         Rate limit check
                                                         Fetch OtpRequest ◄─────────────
                                                         Check !isLocked ✓
                                                         Check expiresAt > now() ✓
                                                         bcrypt.compare("482910", "$2b$...") → true
                                                         UPDATE OtpRequest.verifiedAt ───────────────►
                                                         NextAuth signIn() → JWT cookie
                  ◄── Set-Cookie: session + redirect /book
Navigate /book
```

### Flow B: Booking Confirmation OTP

```
Employee      SlotMap       createBooking()     DB / OtpRequest     Pusher        Email
────────      ───────       ───────────────     ───────────────     ──────        ─────

Click slot ──► BookingDrawer
Click Book ──────────────────► createBooking()
                                $transaction {
                                  INSERT Booking(PENDING_OTP)
                                  INSERT OtpRequest ───────────────────────────►
                                  UPDATE Slot → RESERVED
                                }
                                sendOtpEmail() ──────────────────────────────────────────► inbox
                                trigger slot.reserved ──────────────────────────► All tabs
              ◄─── { bookingId, expiresAt }

Navigate /book/confirm
[5 min countdown]

Enter OTP ────────────────────────────────────────────────────────► confirmBooking()
                                                                     Fetch OtpRequest
                                                                     Check !locked !expired
                                                                     bcrypt.compare → true
                                                                     $transaction {
                                                                       OtpRequest.verifiedAt
                                                                       Booking → CONFIRMED
                                                                       Slot → OCCUPIED
                                                                     }
                                                                     trigger slot.confirmed ──► All tabs

──── EXPIRY PATH (OTP not entered within 5 min) ─────────────────────────────────────────────────────

Vercel Cron calls GET /api/cron/expire-bookings (every 5 min)
  Find OtpRequest: expiresAt < now AND verifiedAt IS NULL AND purpose = BOOKING_CONFIRM
  $transaction {
    Booking → EXPIRED
    Slot    → AVAILABLE
  }
  trigger slot.available ──────────────────────────────────────────────────────────────► All tabs
  writeAudit(BOOKING_EXPIRED)
```

### OTP State Machine

```
                     ┌─────────────────────────────────────────┐
                     │                CREATED                   │
                     │  attempts=0, isLocked=false              │
                     │  verifiedAt=null, expiresAt=+5min        │
                     └───┬──────────────────┬───────────────────┘
                         │                  │
            wrong OTP    │                  │  wrong OTP
            attempts < 3 │                  │  attempts = 3
            attempts++   │                  │
                         │              ┌───▼───────┐
                         │              │  LOCKED   │
                         │              │isLocked=true│
                         │              └───────────┘
                         │
            expiresAt < now()  ──────►  EXPIRED  (detected at verify time)
                         │
            correct OTP  │
            !expired     │
            !locked      │
                         ▼
                    ┌─────────┐
                    │VERIFIED │
                    │verifiedAt=now│
                    └─────────┘

Booking status follows OtpRequest for BOOKING_CONFIRM purpose:
  PENDING_OTP ──[verified]──► CONFIRMED  (Slot → OCCUPIED)
  PENDING_OTP ──[locked/expired]──► EXPIRED  (Slot → AVAILABLE)
  PENDING_OTP ──[user/admin cancel]──► CANCELLED  (Slot → AVAILABLE)
```

---

## 10. Security Considerations

### Authentication & Session

| Control | Detail |
|---------|--------|
| No passwords | OTP-only; no credential database to breach |
| JWT signing | `NEXTAUTH_SECRET` ≥ 32 chars; `openssl rand -base64 32` |
| Cookie flags | `httpOnly: true` · `sameSite: "lax"` · `secure: true` (prod) |
| Session lifetime | `maxAge: 8 h` · `updateAge: 1 h` (rolling) |
| Role never trusted from client | Every Server Action re-fetches `user.role` from DB |

### OTP Security

| Control | Detail |
|---------|--------|
| No plaintext OTP stored | `bcrypt.hash(otp, 10)` — only hash in `OtpRequest.otpHash` |
| Entropy | `crypto.randomInt(100000, 999999)` — 900,000 possibilities |
| Short expiry | 5 minutes; checked on every verify call |
| Attempt limiting | 3 wrong → `isLocked = true`; new OTP request required |
| Log scrubbing | `lib/logger.ts` replaces `/\b\d{6}\b/g → [REDACTED]` before any write |

### Input Validation

| Control | Detail |
|---------|--------|
| Zod at all entry points | Every Server Action + Route Handler validates before touching DB |
| String limits | `.trim().max(N)` on all string fields |
| No raw SQL | `prisma.$queryRawUnsafe` is banned; all queries use parameterized Prisma API |
| Admin notes | Rendered as plain text only — never `dangerouslySetInnerHTML` |

### CSRF

| Control | Detail |
|---------|--------|
| Server Actions | Next.js 15 built-in `Origin` header validation on all Server Actions |
| Mutating Route Handlers | `assertSameOrigin(request)` from `lib/middleware-helpers.ts` |
| Pusher webhooks | HMAC signature verification before processing |

### Rate Limiting (Upstash Redis)

| Limiter | Key | Window | Limit |
|---------|-----|--------|-------|
| `otpSendLimiter` | `otp:send:{email}` | 15 min sliding | 5 req |
| `otpVerifyLimiter` | `otp:verify:{email}` | 15 min sliding | 5 req |
| `bookingLimiter` | `booking:{userId}` | 1 hour sliding | 10 req |

All return `429` with `Retry-After` header.

### Audit Log

- `lib/audit.ts` → `writeAudit(action, opts)` wraps `prisma.auditLog.create`
- Every mutation writes one row: captures `userId`, `ipAddress` (`x-forwarded-for`), `userAgent`
- No delete path in codebase — rows are permanent

### HTTP Security Headers (`next.config.ts`)

```
X-Frame-Options:           DENY
X-Content-Type-Options:    nosniff
Referrer-Policy:           strict-origin-when-cross-origin
Permissions-Policy:        camera=(), microphone=(), geolocation=()
Strict-Transport-Security: max-age=31536000; includeSubDomains  (prod only)
```

### Dependency Security

- `npm audit` runs on every CI PR; high/critical findings block merge
- Secrets: `.env.local` in `.gitignore`; CI via GitHub Actions Secrets; Vercel via dashboard

---

## 11. Grading Rubric Mapping

| Rubric Category | Weight | SmartPark Implementation | Evidence Files |
|----------------|--------|--------------------------|----------------|
| **Functional Correctness** | 30% | FR-01 to FR-18 all implemented and tested | `e2e/employee-booking.spec.ts`, `e2e/admin.spec.ts` |
| **Database Design** | 15% | 6 models, 5 enums, explicit indexes, DB-level `@@unique` for double-booking prevention, immutable audit log | `prisma/schema.prisma` |
| **API Design** | 10% | Consistent `ActionResult<T>` envelope, Zod at all entry points, correct HTTP status codes, rate limiting | `app/actions/`, `app/api/` |
| **Security** | 15% | OTP hashing, session hardening, CSRF, rate limiting, audit log, no raw SQL, input sanitisation, security headers | `lib/otp.ts`, `lib/ratelimit.ts`, `next.config.ts`, `middleware.ts` |
| **Real-Time Architecture** | 10% | Pusher private channels (floor / user / admin), server-side trigger after DB commit, fallback 30 s polling | `lib/realtime.ts`, `lib/hooks/useSlotMap.ts` |
| **Frontend Quality** | 10% | Server/Client Component split, BookMyShow-style slot grid, responsive (≥ 375 px), WCAG 2.1 AA, optimistic updates | `components/parking/SlotMap.tsx` |
| **Testing** | 5% | Unit (otp, mailer, realtime), integration (real DB), component (RTL), E2E (Playwright), ≥ 80% coverage | `vitest.config.ts`, `playwright.config.ts`, CI coverage report |
| **CI/CD** | 5% | 5-job pipeline (lint → unit → integration → build → e2e), staging + prod deploys, manual prod approval gate | `.github/workflows/` |

### Bonus Credit Opportunities

| Opportunity | Implementation |
|-------------|---------------|
| MCP integration | Custom `smartpark-analytics` MCP: natural-language queries + anomaly detection |
| Accessibility audit | axe-core integrated into Playwright E2E suite |
| Advanced analytics | Recharts `ZoneHeatMap` beyond standard bar/line charts |
| Audit log UI | Admin page to browse audit log with action/date/user filters |
