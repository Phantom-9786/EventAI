import type { NotificationsService } from '../src/modules/notifications/notifications.service';
import type { PaymentsService } from '../src/modules/payments/payments.service';
import { ConflictException, NotFoundException } from '../src/common/exceptions';
import { BookingsService } from '../src/modules/bookings/bookings.service';
import { createEventFixture, createUser, prepareTestDatabase, uniqueSuffix, type TestPrisma } from './db';

/**
 * DB-backed integration tests for the booking engine: real transactions
 * against real PostgreSQL verify the conditional stock decrement (no
 * oversell under concurrency), idempotency, server-side pricing, expiry
 * release, and unpaid cancellation. Razorpay + Brevo are stubbed.
 */
describe('BookingsService (integration)', () => {
  let prisma: TestPrisma;
  let bookings: BookingsService;
  let buyerId: string;
  let notifications: { sendBookingCancellation: jest.Mock; createInAppNotification: jest.Mock };

  const itemsFor = (ticketTypeId: string, quantity: number) => [
    { ticketTypeId, quantity },
  ];
  const key = () => `int-key-${uniqueSuffix()}`;

  beforeAll(async () => {
    prisma = await prepareTestDatabase();
    notifications = {
      sendBookingCancellation: jest.fn(async () => true),
      createInAppNotification: jest.fn(async () => undefined),
    };
    const payments = { requestRefund: jest.fn() } as unknown as PaymentsService;
    bookings = new BookingsService(
      prisma as never,
      payments,
      notifications as unknown as NotificationsService,
    );
    buyerId = (await createUser(prisma, uniqueSuffix())).id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('creates a booking: stock decremented, server-priced, TTL set', async () => {
    const fx = await createEventFixture(prisma, { totalQuantity: 10, price: 250000 });

    const booking = await bookings.create(buyerId, {
      eventId: fx.eventId,
      idempotencyKey: key(),
      items: itemsFor(fx.ticketTypeId, 2),
    } as never);

    expect(booking.status).toBe('PENDING');
    expect(booking.totalAmount).toBe(500000); // 2 × 250000 paise
    expect(booking.items).toHaveLength(1);
    expect(booking.items[0].unitPrice).toBe(250000);
    expect(booking.expiresAt).toBeTruthy();

    const type = await prisma.ticketType.findUniqueOrThrow({ where: { id: fx.ticketTypeId } });
    expect(type.availableQuantity).toBe(8);
  });

  it('is idempotent: the same key returns the same booking without re-decrementing', async () => {
    const fx = await createEventFixture(prisma, { totalQuantity: 10 });

    const idemKey = key();
    const first = await bookings.create(buyerId, {
      eventId: fx.eventId,
      idempotencyKey: idemKey,
      items: itemsFor(fx.ticketTypeId, 1),
    } as never);
    const second = await bookings.create(buyerId, {
      eventId: fx.eventId,
      idempotencyKey: idemKey,
      items: itemsFor(fx.ticketTypeId, 1),
    } as never);

    expect(second.id).toBe(first.id);
    const type = await prisma.ticketType.findUniqueOrThrow({ where: { id: fx.ticketTypeId } });
    expect(type.availableQuantity).toBe(9);
    expect(await prisma.booking.count({ where: { idempotencyKey: idemKey } })).toBe(1);
  });

  it('never oversells under concurrency: only one of two competing bookings wins', async () => {
    const fx = await createEventFixture(prisma, { totalQuantity: 3 });

    const attempt = (idemKey: string) =>
      bookings.create(buyerId, {
        eventId: fx.eventId,
        idempotencyKey: idemKey,
        items: itemsFor(fx.ticketTypeId, 2),
      } as never);

    const [a, b] = await Promise.allSettled([attempt(key()), attempt(key())]);
    const fulfilled = [a, b].filter((r) => r.status === 'fulfilled');
    const rejected = [a, b].filter(
      (r): r is PromiseRejectedResult =>
        r.status === 'rejected' && r.reason instanceof ConflictException,
    );

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const type = await prisma.ticketType.findUniqueOrThrow({ where: { id: fx.ticketTypeId } });
    expect(type.availableQuantity).toBe(1); // 3 - 2 sold; nothing lost, nothing oversold
    expect(await prisma.booking.count({ where: { eventId: fx.eventId } })).toBe(1);
  });

  it('enforces maxPerBooking without touching stock', async () => {
    const fx = await createEventFixture(prisma, { totalQuantity: 10, maxPerBooking: 2 });

    await expect(
      bookings.create(buyerId, {
        eventId: fx.eventId,
        idempotencyKey: key(),
        items: itemsFor(fx.ticketTypeId, 3),
      } as never),
    ).rejects.toThrow(ConflictException);

    const type = await prisma.ticketType.findUniqueOrThrow({ where: { id: fx.ticketTypeId } });
    expect(type.availableQuantity).toBe(10);
  });

  it('rejects bookings for an already-started event', async () => {
    const fx = await createEventFixture(prisma, {
      startDate: new Date(Date.now() - 60 * 60 * 1000),
    });

    await expect(
      bookings.create(buyerId, {
        eventId: fx.eventId,
        idempotencyKey: key(),
        items: itemsFor(fx.ticketTypeId, 1),
      } as never),
    ).rejects.toThrow(new ConflictException('This event has already started'));
  });

  it('rejects unknown or wrong-event ticket types', async () => {
    const fx = await createEventFixture(prisma);
    const other = await createEventFixture(prisma);

    await expect(
      bookings.create(buyerId, {
        eventId: fx.eventId,
        idempotencyKey: key(),
        items: itemsFor(other.ticketTypeId, 1),
      } as never),
    ).rejects.toThrow(NotFoundException);
  });

  it('cancels an unpaid booking: stock restored, notification sent, re-cancel blocked', async () => {
    const fx = await createEventFixture(prisma, { totalQuantity: 5 });

    const booking = await bookings.create(buyerId, {
      eventId: fx.eventId,
      idempotencyKey: key(),
      items: itemsFor(fx.ticketTypeId, 3),
    } as never);
    expect(await prisma.ticketType.findUniqueOrThrow({ where: { id: fx.ticketTypeId } }))
      .toMatchObject({ availableQuantity: 2 });

    const cancelled = await bookings.cancelOwn(buyerId, booking.id, 'change of plans');
    expect(cancelled.status).toBe('CANCELLED');
    expect(notifications.sendBookingCancellation).toHaveBeenCalledTimes(1);

    expect(await prisma.ticketType.findUniqueOrThrow({ where: { id: fx.ticketTypeId } }))
      .toMatchObject({ availableQuantity: 5 });

    await expect(bookings.cancelOwn(buyerId, booking.id)).rejects.toThrow(
      new ConflictException('This booking is already closed'),
    );
  });

  it('expires a stale booking and releases its stock on the next list', async () => {
    const fx = await createEventFixture(prisma, { totalQuantity: 4 });

    const booking = await bookings.create(buyerId, {
      eventId: fx.eventId,
      idempotencyKey: key(),
      items: itemsFor(fx.ticketTypeId, 2),
    } as never);
    await prisma.booking.update({
      where: { id: booking.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    await bookings.listOwn(buyerId, 1, 10);

    const expired = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(expired.status).toBe('EXPIRED');
    expect(await prisma.ticketType.findUniqueOrThrow({ where: { id: fx.ticketTypeId } }))
      .toMatchObject({ availableQuantity: 4 });
  });

  it("hides other users' bookings", async () => {
    const fx = await createEventFixture(prisma);
    const otherUser = await createUser(prisma, uniqueSuffix());
    const booking = await bookings.create(otherUser.id, {
      eventId: fx.eventId,
      idempotencyKey: key(),
      items: itemsFor(fx.ticketTypeId, 1),
    } as never);

    await expect(bookings.getOwn(buyerId, booking.id)).rejects.toThrow(NotFoundException);
  });
});
