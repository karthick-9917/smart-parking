import {
  PrismaClient,
  Role,
  SlotStatus,
  BookingStatus,
  OtpPurpose,
  NotificationType,
  NotificationChannel,
  AuditAction,
} from "@prisma/client";
import bcrypt from "bcrypt";

const prisma = new PrismaClient();

// ─── Date helpers ─────────────────────────────────────────────────────────────

function dt(base: Date, hours: number, minutes = 0): Date {
  const d = new Date(base);
  d.setHours(hours, minutes, 0, 0);
  return d;
}

function addMinutes(d: Date, mins: number): Date {
  return new Date(d.getTime() + mins * 60_000);
}

// ─── Reference dates (anchored to 2026-06-01) ─────────────────────────────────

const TODAY       = new Date("2026-06-01T00:00:00.000Z");
const YESTERDAY   = new Date("2026-05-31T00:00:00.000Z");
const TWO_AGO     = new Date("2026-05-30T00:00:00.000Z");
const THREE_AGO   = new Date("2026-05-29T00:00:00.000Z");
const TOMORROW    = new Date("2026-06-02T00:00:00.000Z");
const NEXT_WEEK   = new Date("2026-06-08T00:00:00.000Z");

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("🌱  Seeding SmartPark…\n");

  // ── Wipe in FK-safe order ──────────────────────────────────────────────────
  await prisma.auditLog.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.otpVerification.deleteMany();
  await prisma.booking.deleteMany();
  await prisma.vehicle.deleteMany();
  await prisma.parkingSlot.deleteMany();
  await prisma.parkingFloor.deleteMany();
  await prisma.user.deleteMany();

  // ── 1. Users ───────────────────────────────────────────────────────────────
  const [adminRajan, adminPriya] = await Promise.all([
    prisma.user.create({ data: {
      email: "rajan.krishnamurthy@smartpark.internal",
      name: "Rajan Krishnamurthy",
      phone: "+91-98400-10001",
      role: Role.ADMIN, employeeId: "ADM-001", department: "Facilities",
    }}),
    prisma.user.create({ data: {
      email: "priya.sundaram@smartpark.internal",
      name: "Priya Sundaram",
      phone: "+91-98400-10002",
      role: Role.ADMIN, employeeId: "ADM-002", department: "IT Operations",
    }}),
  ]);

  const employeeSeed = [
    { email: "karthick.baskar@smartpark.internal",  name: "Karthick Baskar",    phone: "+91-98400-20001", employeeId: "EMP-001", department: "Engineering"  },
    { email: "arun.venkatesh@smartpark.internal",   name: "Arun Venkatesh",     phone: "+91-98400-20002", employeeId: "EMP-002", department: "Engineering"  },
    { email: "deepa.nair@smartpark.internal",       name: "Deepa Nair",         phone: "+91-98400-20003", employeeId: "EMP-003", department: "Product"      },
    { email: "suresh.raman@smartpark.internal",     name: "Suresh Raman",       phone: "+91-98400-20004", employeeId: "EMP-004", department: "Design"       },
    { email: "meena.pillai@smartpark.internal",     name: "Meena Pillai",       phone: "+91-98400-20005", employeeId: "EMP-005", department: "HR"           },
    { email: "vijay.anand@smartpark.internal",      name: "Vijay Anand",        phone: "+91-98400-20006", employeeId: "EMP-006", department: "Finance"      },
    { email: "kavitha.shankar@smartpark.internal",  name: "Kavitha Shankar",    phone: "+91-98400-20007", employeeId: "EMP-007", department: "Marketing"    },
    { email: "ramesh.kumar@smartpark.internal",     name: "Ramesh Kumar",       phone: "+91-98400-20008", employeeId: "EMP-008", department: "Operations"   },
    { email: "lakshmi.iyer@smartpark.internal",     name: "Lakshmi Iyer",       phone: "+91-98400-20009", employeeId: "EMP-009", department: "DevOps"       },
    { email: "prashanth.reddy@smartpark.internal",  name: "Prashanth Reddy",    phone: "+91-98400-20010", employeeId: "EMP-010", department: "Engineering"  },
    { email: "nithya.gopal@smartpark.internal",     name: "Nithya Gopal",       phone: "+91-98400-20011", employeeId: "EMP-011", department: "Product"      },
    { email: "siva.subramanian@smartpark.internal", name: "Siva Subramanian",   phone: "+91-98400-20012", employeeId: "EMP-012", department: "Engineering"  },
  ];

  const emps = await Promise.all(
    employeeSeed.map((d) => prisma.user.create({ data: { ...d, role: Role.EMPLOYEE } }))
  );

  const [e1, e2, e3, e4, e5, e6, e7, e8, e9, e10, e11, e12] = emps;

  console.log(`  ✓ Users:     2 admins + ${emps.length} employees`);

  // ── 2. Vehicles ───────────────────────────────────────────────────────────
  const vehicleSeed = [
    { userId: e1.id,        licensePlate: "TN 01 AB 1234", make: "Honda",   model: "City",      color: "White",   isPrimary: true  },
    { userId: e2.id,        licensePlate: "TN 09 CD 5678", make: "Hyundai", model: "Creta",     color: "Grey",    isPrimary: true  },
    { userId: e2.id,        licensePlate: "TN 09 CD 5679", make: "Yamaha",  model: "FZ S",      color: "Black",   isPrimary: false },
    { userId: e3.id,        licensePlate: "KA 03 EF 2345", make: "Maruti",  model: "Swift",     color: "Red",     isPrimary: true  },
    { userId: e4.id,        licensePlate: "TN 21 GH 3456", make: "Toyota",  model: "Innova",    color: "Silver",  isPrimary: true  },
    { userId: e5.id,        licensePlate: "TN 07 IJ 4567", make: "Maruti",  model: "Baleno",    color: "Blue",    isPrimary: true  },
    { userId: e6.id,        licensePlate: "TN 22 KL 5678", make: "Kia",     model: "Seltos",    color: "Black",   isPrimary: true  },
    { userId: e7.id,        licensePlate: "AP 29 MN 6789", make: "Tata",    model: "Nexon EV",  color: "White",   isPrimary: true  },
    { userId: e8.id,        licensePlate: "TN 19 OP 7890", make: "Honda",   model: "Amaze",     color: "Pearl",   isPrimary: true  },
    { userId: e9.id,        licensePlate: "TN 04 QR 8901", make: "Hyundai", model: "Verna",     color: "Blue",    isPrimary: true  },
    { userId: e10.id,       licensePlate: "TN 11 ST 9012", make: "Ford",    model: "EcoSport",  color: "Orange",  isPrimary: true  },
    { userId: e11.id,       licensePlate: "KA 05 UV 0123", make: "Renault", model: "Duster",    color: "Brown",   isPrimary: true  },
    { userId: e12.id,       licensePlate: "TN 02 WX 1357", make: "Tata",    model: "Altroz",    color: "Green",   isPrimary: true  },
    { userId: adminRajan.id, licensePlate: "TN 01 YZ 2468", make: "Toyota", model: "Fortuner",  color: "White",   isPrimary: true  },
    { userId: adminPriya.id, licensePlate: "TN 09 AA 3579", make: "Honda",  model: "WR-V",      color: "Silver",  isPrimary: true  },
  ];

  const vehicles = await Promise.all(
    vehicleSeed.map((v) => prisma.vehicle.create({ data: v }))
  );

  // Named references for readability below
  const [vE1, vE2a, , vE3, vE4, vE5, vE6, vE7, vE8, vE9, vE10, vE11, vE12, vAdmin1, vAdmin2] = vehicles;

  console.log(`  ✓ Vehicles:  ${vehicles.length} (1 primary per person; e2 has 2)`);

  // ── 3. Parking Floors ────────────────────────────────────────────────────
  const [floorG, floor1, floor2] = await Promise.all([
    prisma.parkingFloor.create({ data: {
      name: "Ground Floor", level: 0,
      description: "Main entrance — Zone B compact and standard bays",
      totalSlots: 32,
    }}),
    prisma.parkingFloor.create({ data: {
      name: "Level 1", level: 1,
      description: "Zone A premium bays, nearest the elevator lobby",
      totalSlots: 32,
    }}),
    prisma.parkingFloor.create({ data: {
      name: "Level 2", level: 2,
      description: "VIP reserved bays (Zone V) and EV charging points (Zone EV)",
      totalSlots: 16,
    }}),
  ]);

  console.log(`  ✓ Floors:    3 (Ground · Level 1 · Level 2)`);

  // ── 4. Parking Slots ─────────────────────────────────────────────────────

  // Ground Floor — Zone B, 4 rows × 8 cols = 32 slots
  // B-01 and B-02 are handicap bays
  const groundSlotData = Array.from({ length: 4 }, (_, row) =>
    Array.from({ length: 8 }, (_, col) => {
      const n = row * 8 + col + 1;
      return {
        floorId: floorG.id, label: `B-${String(n).padStart(2, "0")}`,
        zone: "B", row, column: col,
        status: SlotStatus.AVAILABLE,
        isHandicap: n <= 2, isEVCharging: false,
      };
    })
  ).flat();

  // Level 1 — Zone A, 4 rows × 8 cols = 32 slots
  // A-15 is under maintenance (pillar damage)
  const level1SlotData = Array.from({ length: 4 }, (_, row) =>
    Array.from({ length: 8 }, (_, col) => {
      const n = row * 8 + col + 1;
      return {
        floorId: floor1.id, label: `A-${String(n).padStart(2, "0")}`,
        zone: "A", row, column: col,
        status: n === 15 ? SlotStatus.MAINTENANCE : SlotStatus.AVAILABLE,
        isHandicap: n <= 2, isEVCharging: false,
        notes: n === 15 ? "Pillar damage — under repair since 2026-05-20" : null,
      };
    })
  ).flat();

  // Level 2 — Zone V (VIP): rows 0-1 cols 0-3; Zone EV: rows 0-1 cols 4-7
  const level2SlotData = [
    ...Array.from({ length: 2 }, (_, row) =>
      Array.from({ length: 4 }, (_, col) => ({
        floorId: floor2.id,
        label: `V-${String(row * 4 + col + 1).padStart(2, "0")}`,
        zone: "V", row, column: col,
        status: SlotStatus.AVAILABLE, isHandicap: false, isEVCharging: false,
      }))
    ).flat(),
    ...Array.from({ length: 2 }, (_, row) =>
      Array.from({ length: 4 }, (_, col) => ({
        floorId: floor2.id,
        label: `EV-${String(row * 4 + col + 1).padStart(2, "0")}`,
        zone: "EV", row, column: col + 4,
        status: SlotStatus.AVAILABLE, isHandicap: false, isEVCharging: true,
      }))
    ).flat(),
  ];

  await prisma.parkingSlot.createMany({ data: groundSlotData });
  await prisma.parkingSlot.createMany({ data: level1SlotData });
  await prisma.parkingSlot.createMany({ data: level2SlotData });

  // Fetch with stable ordering for index-based reference below
  const gSlots  = await prisma.parkingSlot.findMany({ where: { floorId: floorG.id  }, orderBy: [{ row: "asc" }, { column: "asc" }] });
  const a1Slots = await prisma.parkingSlot.findMany({ where: { floorId: floor1.id }, orderBy: [{ row: "asc" }, { column: "asc" }] });
  const vipSlots = await prisma.parkingSlot.findMany({ where: { floorId: floor2.id, zone: "V"  }, orderBy: [{ row: "asc" }, { column: "asc" }] });
  const evSlots  = await prisma.parkingSlot.findMany({ where: { floorId: floor2.id, zone: "EV" }, orderBy: [{ row: "asc" }, { column: "asc" }] });

  const totalSlots = gSlots.length + a1Slots.length + vipSlots.length + evSlots.length;
  console.log(`  ✓ Slots:     ${totalSlots} (${gSlots.length} Zone-B · ${a1Slots.length} Zone-A · ${vipSlots.length} Zone-V · ${evSlots.length} Zone-EV · 1 MAINTENANCE)`);

  // ── 5. Bookings ───────────────────────────────────────────────────────────
  // Each slot appears at most once per date+startTime+endTime (unique constraint).
  // Working hours: 09:00–18:00; half-day slots: 09:00–13:00 and 13:00–18:00.

  type BookingInput = Parameters<typeof prisma.booking.create>[0]["data"];

  function book(
    user: { id: string }, slot: { id: string }, vehicle: { id: string } | null,
    date: Date, startHour: number, endHour: number,
    status: BookingStatus, vehicleNumber?: string,
  ): BookingInput {
    const start = dt(date, startHour);
    const end   = dt(date, endHour);
    return {
      userId:    user.id,
      slotId:    slot.id,
      vehicleId: vehicle?.id,
      date,
      startTime: start,
      endTime:   end,
      status,
      vehicleNumber: vehicleNumber ?? undefined,
      confirmedAt:   status === BookingStatus.CONFIRMED  ? addMinutes(start, -57) : undefined,
      cancelledAt:   status === BookingStatus.CANCELLED  ? addMinutes(start, -120) : undefined,
      cancelledBy:   status === BookingStatus.CANCELLED  ? user.id : undefined,
    };
  }

  const bookingInputs: BookingInput[] = [

    // ── 3 days ago (2026-05-29) ──────────────────────────────────────────────
    book(e1,  gSlots[0],   vE1,    THREE_AGO, 9, 18, BookingStatus.CONFIRMED),
    book(e2,  gSlots[1],   vE2a,   THREE_AGO, 9, 18, BookingStatus.CONFIRMED),
    book(e3,  a1Slots[0],  vE3,    THREE_AGO, 9, 18, BookingStatus.CONFIRMED),
    book(e4,  a1Slots[1],  vE4,    THREE_AGO, 9, 18, BookingStatus.CANCELLED),
    book(e9,  evSlots[0],  vE9,    THREE_AGO, 9, 18, BookingStatus.CONFIRMED),

    // ── 2 days ago (2026-05-30) ──────────────────────────────────────────────
    book(e1,  gSlots[0],   vE1,    TWO_AGO, 9, 18, BookingStatus.CONFIRMED),
    book(e2,  gSlots[1],   vE2a,   TWO_AGO, 9, 18, BookingStatus.CONFIRMED),
    book(e3,  a1Slots[0],  vE3,    TWO_AGO, 9, 18, BookingStatus.CONFIRMED),
    book(e4,  a1Slots[1],  vE4,    TWO_AGO, 9, 18, BookingStatus.CONFIRMED),
    book(e5,  a1Slots[2],  vE5,    TWO_AGO, 9, 13, BookingStatus.CONFIRMED),
    book(e6,  a1Slots[3],  vE6,    TWO_AGO, 13, 18, BookingStatus.CONFIRMED),
    book(e7,  vipSlots[0], vE7,    TWO_AGO, 9, 18, BookingStatus.NO_SHOW),   // booked VIP but never showed
    book(e9,  evSlots[0],  vE9,    TWO_AGO, 9, 18, BookingStatus.CONFIRMED), // EV charging
    book(e10, gSlots[4],   vE10,   TWO_AGO, 9, 18, BookingStatus.CONFIRMED),

    // ── Yesterday (2026-05-31) ───────────────────────────────────────────────
    book(e1,  gSlots[0],   vE1,    YESTERDAY, 9, 18, BookingStatus.CONFIRMED),
    book(e2,  gSlots[1],   vE2a,   YESTERDAY, 9, 18, BookingStatus.CONFIRMED),
    book(e3,  a1Slots[0],  vE3,    YESTERDAY, 9, 18, BookingStatus.CONFIRMED),
    book(e4,  a1Slots[1],  vE4,    YESTERDAY, 8, 17, BookingStatus.CONFIRMED),
    book(e6,  a1Slots[3],  vE6,    YESTERDAY, 9, 13, BookingStatus.CONFIRMED),
    book(e7,  vipSlots[0], vE7,    YESTERDAY, 9, 18, BookingStatus.CONFIRMED),
    book(e8,  gSlots[5],   vE8,    YESTERDAY, 13, 18, BookingStatus.CONFIRMED),
    book(e9,  evSlots[0],  vE9,    YESTERDAY, 9, 18, BookingStatus.CONFIRMED),
    book(e11, a1Slots[5],  vE11,   YESTERDAY, 9, 18, BookingStatus.CANCELLED),
    book(e12, gSlots[7],   vE12,   YESTERDAY, 10, 17, BookingStatus.EXPIRED),  // OTP never confirmed
    book(e5,  a1Slots[6],  vE5,    YESTERDAY, 9, 18, BookingStatus.CANCELLED),

    // ── Today (2026-06-01) ───────────────────────────────────────────────────
    book(e1,  gSlots[0],   vE1,    TODAY, 9, 18, BookingStatus.CONFIRMED),
    book(e2,  gSlots[1],   vE2a,   TODAY, 9, 18, BookingStatus.CONFIRMED),
    book(e3,  a1Slots[0],  vE3,    TODAY, 9, 18, BookingStatus.CONFIRMED),
    book(e6,  a1Slots[3],  vE6,    TODAY, 9, 18, BookingStatus.CONFIRMED),
    book(e8,  gSlots[4],   vE8,    TODAY, 9, 13, BookingStatus.CONFIRMED),
    book(e9,  evSlots[0],  vE9,    TODAY, 9, 18, BookingStatus.CONFIRMED),    // EV charging
    book(e10, a1Slots[2],  vE10,   TODAY, 13, 18, BookingStatus.PENDING_OTP), // awaiting OTP
    book(e12, gSlots[6],   null,   TODAY, 10, 17, BookingStatus.PENDING_OTP, "TN 02 WX 1357"),
    book(e11, vipSlots[1], vE11,   TODAY, 9, 18, BookingStatus.CANCELLED),

    // ── Tomorrow (2026-06-02) ─────────────────────────────────────────────────
    book(e1,  gSlots[0],   vE1,    TOMORROW, 9, 18, BookingStatus.CONFIRMED),
    book(e4,  a1Slots[1],  vE4,    TOMORROW, 8, 17, BookingStatus.CONFIRMED),
    book(e7,  evSlots[1],  vE7,    TOMORROW, 9, 18, BookingStatus.CONFIRMED),  // Nexon EV on EV bay
    book(e5,  a1Slots[4],  vE5,    TOMORROW, 9, 18, BookingStatus.PENDING_OTP),

    // ── Next week (2026-06-08) ────────────────────────────────────────────────
    book(e2,       a1Slots[1],   vE2a,   NEXT_WEEK, 9, 18, BookingStatus.CONFIRMED),
    book(e3,       gSlots[2],    vE3,    NEXT_WEEK, 9, 18, BookingStatus.CONFIRMED),
    book(adminRajan, vipSlots[0], vAdmin1, NEXT_WEEK, 9, 18, BookingStatus.CONFIRMED), // admin VIP
    book(adminPriya, vipSlots[2], vAdmin2, NEXT_WEEK, 9, 18, BookingStatus.CONFIRMED),
    book(e9,       evSlots[2],   vE9,    NEXT_WEEK, 9, 18, BookingStatus.CONFIRMED),
  ];

  const bookings = await Promise.all(
    bookingInputs.map((data) => prisma.booking.create({ data }))
  );

  const byStatus = (s: BookingStatus) => bookings.filter((b) => b.status === s).length;
  console.log(
    `  ✓ Bookings:  ${bookings.length} total` +
    `  (${byStatus(BookingStatus.CONFIRMED)} confirmed` +
    ` · ${byStatus(BookingStatus.PENDING_OTP)} pending` +
    ` · ${byStatus(BookingStatus.CANCELLED)} cancelled` +
    ` · ${byStatus(BookingStatus.EXPIRED)} expired` +
    ` · ${byStatus(BookingStatus.NO_SHOW)} no-show)`
  );

  // ── Update live slot statuses (today's active bookings) ───────────────────
  const todayConfirmed  = bookings.filter((b) => b.status === BookingStatus.CONFIRMED  && b.date.getTime() === TODAY.getTime());
  const todayPending    = bookings.filter((b) => b.status === BookingStatus.PENDING_OTP && b.date.getTime() === TODAY.getTime());

  await Promise.all([
    ...todayConfirmed.map((b) => prisma.parkingSlot.update({ where: { id: b.slotId }, data: { status: SlotStatus.OCCUPIED  } })),
    ...todayPending.map(  (b) => prisma.parkingSlot.update({ where: { id: b.slotId }, data: { status: SlotStatus.RESERVED  } })),
  ]);

  // ── 6. OTP Verifications ─────────────────────────────────────────────────
  // Known test OTP: 482910 (useful in integration tests — bcrypt hash below)
  const verifiedHash = await bcrypt.hash("482910", 10);
  const pendingHash  = await bcrypt.hash("193847", 10); // different OTP for pending

  const confirmedBookings = bookings.filter((b) => b.status === BookingStatus.CONFIRMED);
  const pendingBookings   = bookings.filter((b) => b.status === BookingStatus.PENDING_OTP);
  const expiredBookings   = bookings.filter((b) => b.status === BookingStatus.EXPIRED);

  // Verified OTPs (booking confirmed)
  const userEmailCache = new Map<string, string>();
  const allUsers = await prisma.user.findMany({ select: { id: true, email: true } });
  allUsers.forEach((u) => userEmailCache.set(u.id, u.email));

  await Promise.all(
    confirmedBookings.map((b) =>
      prisma.otpVerification.create({ data: {
        userId:      b.userId,
        bookingId:   b.id,
        purpose:     OtpPurpose.BOOKING_CONFIRM,
        otpHash:     verifiedHash,
        attempts:    1,
        expiresAt:   addMinutes(b.startTime, -55),
        verifiedAt:  addMinutes(b.startTime, -57),
        isLocked:    false,
        deliveredTo: userEmailCache.get(b.userId)!,
      }})
    )
  );

  // Live pending OTPs (expires 5 min from now)
  const seedTime = new Date();
  await Promise.all(
    pendingBookings.map((b) =>
      prisma.otpVerification.create({ data: {
        userId:      b.userId,
        bookingId:   b.id,
        purpose:     OtpPurpose.BOOKING_CONFIRM,
        otpHash:     pendingHash,  // OTP: 193847
        attempts:    0,
        expiresAt:   addMinutes(seedTime, 5),
        verifiedAt:  null,
        isLocked:    false,
        deliveredTo: userEmailCache.get(b.userId)!,
      }})
    )
  );

  // Locked/expired OTPs (3 failed attempts → isLocked)
  await Promise.all(
    expiredBookings.map((b) =>
      prisma.otpVerification.create({ data: {
        userId:      b.userId,
        bookingId:   b.id,
        purpose:     OtpPurpose.BOOKING_CONFIRM,
        otpHash:     verifiedHash,
        attempts:    3,
        expiresAt:   addMinutes(b.startTime, -55),
        verifiedAt:  null,
        isLocked:    true,
        deliveredTo: userEmailCache.get(b.userId)!,
      }})
    )
  );

  console.log(
    `  ✓ OTPs:      ${confirmedBookings.length} verified` +
    ` · ${pendingBookings.length} pending (OTP: 193847)` +
    ` · ${expiredBookings.length} locked`
  );

  // ── 7. Notifications ──────────────────────────────────────────────────────
  const notifRows = bookings.flatMap((b) => {
    const rows = [];

    // OTP sent
    rows.push({
      userId: b.userId, bookingId: b.id,
      type: NotificationType.OTP_SENT,
      channel: NotificationChannel.EMAIL,
      title: "Parking OTP sent",
      message: "Your 6-digit OTP to confirm your parking slot has been sent to your email.",
      isRead: b.status !== BookingStatus.PENDING_OTP,
      sentAt: b.createdAt,
    });

    if (b.status === BookingStatus.CONFIRMED) {
      rows.push({
        userId: b.userId, bookingId: b.id,
        type: NotificationType.BOOKING_CONFIRMED,
        channel: NotificationChannel.EMAIL,
        title: "Booking confirmed ✓",
        message: `Your parking slot has been confirmed for ${b.date.toDateString()}.`,
        isRead: b.date < TODAY,
        sentAt: b.confirmedAt ?? b.createdAt,
      });
    }

    if (b.status === BookingStatus.CANCELLED) {
      rows.push({
        userId: b.userId, bookingId: b.id,
        type: NotificationType.BOOKING_CANCELLED,
        channel: NotificationChannel.EMAIL,
        title: "Booking cancelled",
        message: "Your parking booking has been cancelled. The slot is now available.",
        isRead: true,
        sentAt: b.cancelledAt ?? b.createdAt,
      });
    }

    if (b.status === BookingStatus.EXPIRED) {
      rows.push({
        userId: b.userId, bookingId: b.id,
        type: NotificationType.OTP_EXPIRY_WARNING,
        channel: NotificationChannel.EMAIL,
        title: "OTP expiry warning",
        message: "Your OTP is about to expire. Please verify within the next minute.",
        isRead: true,
        sentAt: addMinutes(b.createdAt, 4),
      });
      rows.push({
        userId: b.userId, bookingId: b.id,
        type: NotificationType.BOOKING_EXPIRED,
        channel: NotificationChannel.EMAIL,
        title: "Booking expired",
        message: "Your OTP was not verified in time. The slot has been released.",
        isRead: true,
        sentAt: addMinutes(b.createdAt, 5),
      });
    }

    if (b.status === BookingStatus.NO_SHOW) {
      rows.push({
        userId: b.userId, bookingId: b.id,
        type: NotificationType.BOOKING_CANCELLED,
        channel: NotificationChannel.EMAIL,
        title: "No-show recorded",
        message: "You were marked as a no-show for your parking booking.",
        isRead: true,
        sentAt: addMinutes(b.startTime, 60),
      });
    }

    return rows;
  });

  await prisma.notification.createMany({ data: notifRows });
  console.log(`  ✓ Notifications: ${notifRows.length}`);

  // ── 8. Audit Logs ─────────────────────────────────────────────────────────
  const auditRows = [
    // Booking created audit for every booking
    ...bookings.map((b) => ({
      action: AuditAction.BOOKING_CREATED,
      userId: b.userId, bookingId: b.id,
      metadata: { slotId: b.slotId, date: b.date, status: b.status },
    })),
    // Booking confirmed audit
    ...confirmedBookings.map((b) => ({
      action: AuditAction.BOOKING_CONFIRMED,
      userId: b.userId, bookingId: b.id,
      metadata: { confirmedAt: b.confirmedAt },
    })),
    // Booking cancelled audit
    ...bookings.filter((b) => b.status === BookingStatus.CANCELLED).map((b) => ({
      action: AuditAction.BOOKING_CANCELLED,
      userId: b.cancelledBy ?? b.userId, bookingId: b.id,
      metadata: { reason: b.cancellationReason, cancelledAt: b.cancelledAt },
    })),
    // Booking expired audit
    ...expiredBookings.map((b) => ({
      action: AuditAction.BOOKING_EXPIRED,
      userId: null as string | null, bookingId: b.id,   // system action
      metadata: { slotId: b.slotId },
    })),
    // Admin actions
    { action: AuditAction.FLOOR_CREATED, userId: adminRajan.id, metadata: { floorName: "Ground Floor" } },
    { action: AuditAction.FLOOR_CREATED, userId: adminRajan.id, metadata: { floorName: "Level 1" } },
    { action: AuditAction.FLOOR_CREATED, userId: adminRajan.id, metadata: { floorName: "Level 2" } },
    { action: AuditAction.SLOT_BLOCKED,  userId: adminPriya.id, slotId: a1Slots[14].id, metadata: { reason: "Pillar damage — under repair", status: "MAINTENANCE" } },
  ];

  await prisma.auditLog.createMany({ data: auditRows });
  console.log(`  ✓ Audit logs: ${auditRows.length}`);

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  SmartPark seed complete

  Users         14  (2 admins · 12 employees)
  Vehicles      ${vehicles.length}
  Floors         3  (Ground · L1 · L2)
  Slots         ${totalSlots}  (80 total · 1 MAINTENANCE · ${todayConfirmed.length} OCCUPIED · ${todayPending.length} RESERVED today)
  Bookings      ${bookings.length}
  OTPs          ${confirmedBookings.length + pendingBookings.length + expiredBookings.length}
  Notifications ${notifRows.length}
  Audit logs    ${auditRows.length}

  Test OTPs:
    Verified booking OTP : 482910
    Live pending OTP     : 193847

  Test accounts (all @smartpark.internal):
    Admin   → rajan.krishnamurthy  / priya.sundaram
    Employee→ karthick.baskar (EMP-001, Engineering)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);
}

main()
  .catch((e) => {
    console.error("\n❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
