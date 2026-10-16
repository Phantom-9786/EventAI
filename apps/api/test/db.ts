import { execSync } from 'child_process';
import { randomBytes } from 'crypto';
import path from 'path';
import { PrismaClient } from '@eventai/database';

/**
 * Shared infrastructure for the DB-backed integration tests.
 *
 * These tests run against a REAL PostgreSQL database provisioned by
 * `prisma migrate deploy` — the same migrations production uses. They
 * are isolated from dev/production data in three ways:
 *  1. A dedicated database whose name must contain "test" (hard guard).
 *  2. Every fixture is namespaced with a unique per-run suffix.
 *  3. All external services (Brevo, Razorpay, Google, Groq) are stubbed
 *     in the specs — no network calls, no real credentials required.
 */

export type TestPrisma = PrismaClient;

/** Returns the test DATABASE_URL and points process.env at it. */
export function resolveTestDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL ?? '';
  if (!url) {
    throw new Error(
      'Integration tests need a database: set TEST_DATABASE_URL (e.g. postgresql://user:pass@localhost:5432/eventai_test)',
    );
  }
  const parsed = new URL(url);
  const dbName = parsed.pathname.slice(1);
  if (!['postgresql:', 'postgres:'].includes(parsed.protocol) ||
      !['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname) ||
      !/^[a-z0-9_]*_test$/i.test(dbName) || parsed.searchParams.has('host') ||
      parsed.searchParams.has('schema') || process.env.TEST_DATABASE_RESET_ALLOWED !== '1') {
    throw new Error(
      'Refusing database reset: use an explicitly verified disposable loopback database ending in _test and set TEST_DATABASE_RESET_ALLOWED=1',
    );
  }
  return url;
}

/** Applies all Prisma migrations and wipes test tables for a clean slate. */
export async function prepareTestDatabase(): Promise<TestPrisma> {
  const url = resolveTestDatabaseUrl();
  process.env.DATABASE_URL = url;

  const schema = path.resolve(__dirname, '../../..', 'packages/database/prisma/schema.prisma');
  execSync(`npx prisma migrate deploy --schema "${schema}"`, {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: url },
  });

  const prisma = new PrismaClient({ datasources: { db: { url } } });
  await prisma.$connect();
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE "users", "sessions", "password_resets", "email_verification_tokens",
     "organizers", "categories", "venues", "events", "ticket_types",
     "bookings", "booking_items", "tickets", "payments", "notifications" CASCADE`,
  );
  return prisma;
}

/** Unique per-run suffix so repeated runs never collide. */
export function uniqueSuffix(): string {
  return randomBytes(5).toString('hex');
}

/** Creates a user with a unique email; passwordHash optional. */
export async function createUser(
  prisma: TestPrisma,
  suffix: string,
  overrides: { email?: string; passwordHash?: string; role?: 'CUSTOMER' | 'ORGANIZER' | 'ADMIN' } = {},
) {
  return prisma.user.create({
    data: {
      email: overrides.email ?? `int-${suffix}@example.test`,
      passwordHash: overrides.passwordHash ?? null,
      firstName: 'Int',
      lastName: 'Test',
      role: overrides.role ?? 'CUSTOMER',
    },
  });
}

export interface EventFixture {
  userId: string;
  organizerId: string;
  categoryId: string;
  venueId: string;
  eventId: string;
  ticketTypeId: string;
  suffix: string;
}

/**
 * Creates the full chain user → organizer → category → venue → event →
 * ticket type. The event is PUBLISHED and starts in 7 days so it is
 * open for booking by default.
 */
export async function createEventFixture(
  prisma: TestPrisma,
  opts: {
    city?: string;
    status?: 'DRAFT' | 'PUBLISHED' | 'CANCELLED';
    title?: string;
    startDate?: Date;
    totalQuantity?: number;
    availableQuantity?: number;
    maxPerBooking?: number;
    price?: number;
    ticketTypeName?: string;
    tags?: string[];
  } = {},
): Promise<EventFixture> {
  const suffix = uniqueSuffix();
  const user = await createUser(prisma, suffix, {
    role: 'ORGANIZER',
    email: `org-${suffix}@example.test`,
  });
  const organizer = await prisma.organizer.create({
    data: { userId: user.id, organizationName: `Org ${suffix}` },
  });
  const category = await prisma.category.create({
    data: { name: `Category ${suffix}`, slug: `cat-${suffix}` },
  });
  const venue = await prisma.venue.create({
    data: {
      name: `Venue ${suffix}`,
      address: '1 Test Street',
      city: opts.city ?? 'Bengaluru',
      state: 'Karnataka',
      capacity: 100,
      organizerId: organizer.id,
    },
  });
  const startDate = opts.startDate ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const event = await prisma.event.create({
    data: {
      title: opts.title ?? `Test Event ${suffix}`,
      slug: `test-event-${suffix}`,
      description: 'A test event created by the integration suite.',
      shortDescription: 'Created by the integration suite.',
      categoryId: category.id,
      organizerId: organizer.id,
      venueId: venue.id,
      startDate,
      endDate: new Date(startDate.getTime() + 3 * 60 * 60 * 1000),
      status: opts.status ?? 'PUBLISHED',
      tags: opts.tags ?? ['quantum', 'music'],
    },
  });
  const ticketType = await prisma.ticketType.create({
    data: {
      eventId: event.id,
      name: opts.ticketTypeName ?? 'General',
      price: opts.price ?? 100000,
      totalQuantity: opts.totalQuantity ?? 10,
      availableQuantity: opts.availableQuantity ?? opts.totalQuantity ?? 10,
      maxPerBooking: opts.maxPerBooking ?? 5,
    },
  });
  return {
    userId: user.id,
    organizerId: organizer.id,
    categoryId: category.id,
    venueId: venue.id,
    eventId: event.id,
    ticketTypeId: ticketType.id,
    suffix,
  };
}
