# SmartPark — Office Car Parking Slot Booking System

## Project Description

SmartPark is an internal web application for managing office car parking. Employees book slots in advance via a seat-map style interface. Bookings are confirmed by OTP. Admins manage layout, capacity, and view analytics. The system supports real-time slot availability to prevent double-booking.

---

## Architecture Overview

```
Browser (Next.js App Router)
  └── React Server Components (pages, layouts, data fetching)
  └── Client Components (slot map, booking wizard, real-time state)
       │
       ├── Server Actions  ──► Prisma ORM ──► PostgreSQL
       │
       ├── Route Handlers (/api/*)
       │    ├── OTP send/verify  (Twilio / AWS SNS)
       │    └── Webhooks / integrations
       │
       └── Pusher / Ably  (real-time slot availability broadcast)
```

**Key architectural decisions:**

- Use **Server Components** for all read-only pages (slot map initial render, analytics).
- Use **Server Actions** for mutations (book slot, cancel, admin operations).
- Use **Route Handlers** only for third-party callbacks (OTP provider webhooks) and public APIs.
- Real-time updates are pushed from the server after a successful booking mutation and received by a thin Pusher/Ably client in the slot map component.
- Role-based access (`EMPLOYEE` / `ADMIN`) is enforced in middleware and in every Server Action — never trust the client.

---

## File Structure

```
smartpark/
├── app/                          # Next.js App Router
│   ├── (auth)/                   # Route group — unauthenticated layout
│   │   ├── login/page.tsx
│   │   └── verify-otp/page.tsx
│   ├── (dashboard)/              # Route group — authenticated layout
│   │   ├── layout.tsx            # Shell with nav, session guard
│   │   ├── book/
│   │   │   ├── page.tsx          # Slot selection (Server Component)
│   │   │   └── SlotMap.tsx       # Interactive map (Client Component)
│   │   ├── my-bookings/page.tsx
│   │   └── admin/
│   │       ├── layout.tsx        # Admin-only guard
│   │       ├── slots/page.tsx
│   │       └── analytics/page.tsx
│   ├── api/
│   │   ├── otp/route.ts
│   │   └── webhooks/route.ts
│   ├── actions/                  # Server Actions (grouped by domain)
│   │   ├── booking.ts
│   │   ├── admin.ts
│   │   └── otp.ts
│   ├── layout.tsx                # Root layout
│   └── globals.css
│
├── components/
│   ├── ui/                       # Generic, reusable UI primitives
│   └── parking/                  # Domain-specific components
│       ├── SlotMap.tsx
│       ├── SlotCell.tsx
│       └── BookingDrawer.tsx
│
├── lib/
│   ├── prisma.ts                 # Singleton Prisma client
│   ├── auth.ts                   # Session helpers (next-auth or custom)
│   ├── otp.ts                    # OTP generation / verification logic
│   └── realtime.ts               # Pusher/Ably server-side trigger helpers
│
├── prisma/
│   ├── schema.prisma
│   └── migrations/
│
├── types/                        # Shared TypeScript types (no runtime code)
│   └── index.ts
│
├── middleware.ts                  # Auth + role guard for route groups
├── next.config.ts
├── tailwind.config.ts
├── tsconfig.json
└── .env.local                    # Never committed
```

---

## Coding Conventions

### TypeScript
- `strict: true` always. No `any` — use `unknown` and narrow.
- Prefer `type` over `interface` for data shapes. Use `interface` only when extension is the intent.
- Export types from `types/index.ts`; keep component-local types inline.

### React / Next.js
- Default to Server Components. Add `"use client"` only when you need browser APIs, event handlers, or `useState`/`useEffect`.
- Server Actions live in `app/actions/`. They must be `async` functions in files that start with `"use server"`.
- No direct `fetch` calls inside components — compose data fetching in Server Components or Server Actions.
- Do not put business logic in route handlers. Route handlers call lib functions.

### Prisma
- All DB access through the singleton in `lib/prisma.ts`.
- Use `prisma.$transaction` for operations that touch more than one table.
- Never expose raw Prisma types to the client. Map to plain response types in the action.

### Tailwind CSS
- No inline `style` attributes. All styling via Tailwind utility classes.
- Extract repeated class groups into a named component, not a CSS class.
- Use `cn()` (clsx + tailwind-merge) for conditional class merging.

### General
- One exported component per file. File name matches component name.
- No default exports from `lib/` files — named exports only.
- Prefer `const` arrow functions for components; use `function` declarations for Server Actions and utility functions.
- No `console.log` in committed code. Use structured logging via a `lib/logger.ts` wrapper.

---

## API Conventions

All route handlers under `app/api/` follow these rules:

- **Method semantics**: GET = safe read, POST = create/trigger, PATCH = partial update, DELETE = remove.
- **Response shape**:
  ```ts
  // Success
  { data: T }
  // Error
  { error: { code: string; message: string } }
  ```
- **HTTP status codes**: 200 OK, 201 Created, 400 Bad Request, 401 Unauthorized, 403 Forbidden, 404 Not Found, 409 Conflict (double-booking), 500 Internal Server Error.
- **Input validation**: Use `zod` at the top of every route handler and Server Action. Reject before touching the DB.
- **Auth check first**: Validate session before reading the request body.

### Key Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/otp` | Send OTP to employee email/phone |
| POST | `/api/otp/verify` | Verify OTP and issue session |
| POST | `/api/webhooks` | Inbound webhooks from OTP provider |

Booking mutations are Server Actions, not REST endpoints.

---

## Prisma Schema Overview

Core models (expand in `prisma/schema.prisma`):

```prisma
model User {
  id        String   @id @default(cuid())
  email     String   @unique
  phone     String?
  role      Role     @default(EMPLOYEE)
  bookings  Booking[]
}

model ParkingSlot {
  id        String   @id @default(cuid())
  label     String   // e.g. "A-12"
  zone      String
  status    SlotStatus @default(AVAILABLE)
  bookings  Booking[]
}

model Booking {
  id        String   @id @default(cuid())
  userId    String
  slotId    String
  date      DateTime
  status    BookingStatus @default(PENDING_OTP)
  otp       String?
  otpExpiry DateTime?
  user      User        @relation(fields: [userId], references: [id])
  slot      ParkingSlot @relation(fields: [slotId], references: [id])
}

enum Role          { EMPLOYEE ADMIN }
enum SlotStatus    { AVAILABLE OCCUPIED RESERVED MAINTENANCE }
enum BookingStatus { PENDING_OTP CONFIRMED CANCELLED EXPIRED }
```

---

## Testing Strategy

- **Unit tests** (`__tests__/` adjacent to the file under test): pure functions in `lib/` — OTP generation, slot availability logic.
- **Integration tests**: Server Actions tested against a real PostgreSQL test database (do not mock Prisma).
- **Component tests** (React Testing Library): SlotMap interactions — slot selection, disabled states, booking drawer open/close.
- **E2E tests** (Playwright): golden paths — employee books a slot end-to-end, OTP flow, admin cancels a booking.
- Test file naming: `*.test.ts` for unit/integration, `*.spec.ts` for Playwright.
- CI must pass all tests before merge. No `test.only` or `test.skip` in committed code.

---

## Security Guidelines

- **Never trust client-supplied role**. Re-fetch role from the DB in every Server Action and protected route handler.
- **OTP**: 6-digit numeric, 5-minute expiry, max 3 attempts before lockout. Store only the hash (bcrypt), never plaintext.
- **Session**: HTTP-only cookies, `SameSite=Lax`, short-lived JWTs or next-auth sessions. No session data in `localStorage`.
- **CSRF**: Server Actions use Next.js built-in CSRF protection. Route handlers that mutate state must verify `Origin` header.
- **Input validation**: Every Server Action and route handler validates input with `zod` before touching the DB.
- **SQL injection**: Not possible through Prisma parameterized queries — never use `prisma.$queryRawUnsafe`.
- **Rate limiting**: Apply to `/api/otp` (send + verify). Use Redis or Upstash for distributed rate-limit counters.
- **Environment secrets**: `DATABASE_URL`, `OTP_PROVIDER_KEY`, `NEXTAUTH_SECRET`, pusher keys — always in `.env.local`, never in code or `next.config.ts`.
- **Audit log**: Write an immutable audit row for every booking creation, cancellation, and admin action.

---

## Real-Time Slot Availability

- After a booking Server Action succeeds, trigger a channel event (e.g. `parking:slots`) with the updated slot state.
- The `SlotMap` Client Component subscribes to this channel on mount and merges incoming updates into local state.
- On initial page load, slot state is server-rendered — real-time layer only handles delta updates.
- If the real-time connection drops, the map shows a "Reconnecting…" banner and falls back to polling every 30 s.

---

## MCP Integration Ideas

The following MCP servers would extend SmartPark's capabilities inside Claude Code and future AI features:

| Server | Use Case |
|--------|----------|
| `@prisma/mcp` | Query and inspect the live DB schema and data during development |
| `@vercel/mcp` | Deploy previews, env var management, and log inspection |
| `@upstash/mcp` | Inspect Redis rate-limit counters and OTP lockout state |
| `@playwright/mcp` | Drive the running app for AI-assisted E2E test authoring |
| Custom `smartpark-analytics-mcp` | Expose occupancy stats and anomaly detection to an AI agent |

To add an MCP server: `claude mcp add <name> <command>` — documented in `.claude/settings.json`.

---

## Scope Boundaries

**In scope:**
- Employee slot booking with OTP confirmation
- Seat-map style slot selection UI
- Admin CRUD for slots (add, deactivate, set maintenance)
- Parking analytics dashboard (occupancy by zone, peak hours, user breakdown)
- Role-based access: `EMPLOYEE` and `ADMIN`
- Real-time slot status updates

**Out of scope (do not build unless explicitly decided):**
- Payment processing or billing
- Vehicle registration / license plate recognition
- Guest or visitor bookings (non-employees)
- Mobile native app (iOS/Android)
- Multi-building / multi-campus support
- Hardware integrations (barrier gates, sensors)
- Calendar integrations (Google Calendar, Outlook)
- Waitlists or recurring bookings

---

## Environment Setup

```bash
# Install dependencies
npm install

# Set up environment
cp .env.example .env.local
# Fill in DATABASE_URL, NEXTAUTH_SECRET, OTP_*, PUSHER_* values

# Run DB migrations
npx prisma migrate dev

# Start dev server
npm run dev
```

Database: PostgreSQL 15+. Local dev can use Docker: `docker run -e POSTGRES_PASSWORD=pass -p 5432:5432 postgres:15`.
