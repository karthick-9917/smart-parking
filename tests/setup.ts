import { beforeEach, afterAll } from 'vitest'
import { prisma } from '@/lib/prisma'

// Wipe all tables before each test in dependency (FK) order.
// Keeps tests isolated without spinning up a new DB per test.
beforeEach(async () => {
  await prisma.$transaction([
    prisma.auditLog.deleteMany(),
    prisma.notification.deleteMany(),
    prisma.otpVerification.deleteMany(),
    prisma.booking.deleteMany(),
    prisma.vehicle.deleteMany(),
    prisma.parkingSlot.deleteMany(),
    prisma.parkingFloor.deleteMany(),
    prisma.user.deleteMany(),
  ])
})

afterAll(async () => {
  await prisma.$disconnect()
})
