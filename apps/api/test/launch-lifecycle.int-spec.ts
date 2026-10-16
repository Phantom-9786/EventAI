import { Server } from 'http';
import { AddressInfo } from 'net';
import { createHmac, randomUUID } from 'crypto';
import * as argon2 from 'argon2';
import { ConfigService } from '../src/common/config/config.service';
import { createExpressApp } from '../src/express/app';
import { CacheService } from '../src/common/cache/cache.service';
import { NotificationsService } from '../src/modules/notifications/notifications.service';
import { PaymentsService } from '../src/modules/payments/payments.service';
import { MediaProviderFactory } from '../src/modules/events/media-provider.factory';
import { EventMediaService } from '../src/modules/events/event-media.service';
import { prepareTestDatabase, createUser, createEventFixture, uniqueSuffix, TestPrisma } from './db';

/** Real Express + PostgreSQL. Provider boundaries are replaced before the app starts. */
describe('launch lifecycle (isolated PostgreSQL, mocked external providers)', () => {
  let prisma: TestPrisma;
  let server: Server;
  let base: string;
  let admin: string;
  let customer: string;
  let notifications: NotificationsService;
  let sendEmail: jest.SpyInstance;
  let upload: jest.Mock;
  let destroy: jest.Mock;
  let orders: jest.Mock;
  const originalEnv = { ...process.env };
  const secret = 'isolated-fixture-razorpay-secret';
  const webhookSecret = 'isolated-fixture-webhook-secret';

  async function request(path: string, token = '', method = 'GET', body?: unknown, status = 200) {
    const response = await fetch(`${base}/api${path}`, {
      method,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await response.json();
    expect({ status: response.status, ...(response.status === status ? {} : { body: json }) }).toEqual({ status });
    return json;
  }

  async function register(prefix: string) {
    return request('/auth/register', '', 'POST', {
      email: `${prefix}-${uniqueSuffix()}@example.test`, password: 'IsolatedTest123!', firstName: 'Launch', lastName: 'Fixture',
    }, 201);
  }

  beforeAll(async () => {
    prisma = await prepareTestDatabase();
    process.env.RAZORPAY_KEY_ID = 'rzp_test_isolated_fixture';
    process.env.RAZORPAY_KEY_SECRET = secret;
    process.env.RAZORPAY_WEBHOOK_SECRET = webhookSecret;
    notifications = new NotificationsService(prisma as never);
    sendEmail = jest.spyOn(notifications, 'sendEmail').mockResolvedValue(true);
    upload = jest.fn(async (_buffer, folder, publicId) => ({
      url: `https://res.cloudinary.com/fixture/image/upload/v1/${folder}/${publicId}.png`,
      publicId: `${folder}/${publicId}`, providerId: 'fixture',
    }));
    destroy = jest.fn().mockResolvedValue(undefined);
    jest.spyOn(MediaProviderFactory, 'createProviders').mockReturnValue([{
      id: 'fixture', cloudName: 'fixture', isConfigured: () => true,
      checkHealth: async () => ({ healthy: true, usagePercent: 0 }), getUsagePercent: async () => 0,
      upload, destroy,
    }]);
    const payments = new PaymentsService(prisma as never, notifications);
    orders = jest.fn(async ({ amount, currency }) => ({ id: `order_${uniqueSuffix()}`, amount, currency, status: 'created' }));
    jest.spyOn(payments as never as { ensureClient: () => unknown }, 'ensureClient').mockReturnValue({ orders: { create: orders } });
    const cache = new CacheService(new ConfigService({}));
    const app = createExpressApp({
      prisma, cache, notificationsService: notifications, paymentsService: payments,
      jwtSecret: 'isolated-launch-test-jwt-secret-32-characters',
      env: { NODE_ENV: 'test', FRONTEND_URL: 'http://localhost:3100' },
    });
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const passwordHash = await argon2.hash('IsolatedTest123!');
    const fixture = await createUser(prisma, uniqueSuffix(), { role: 'ADMIN', passwordHash });
    admin = (await request('/auth/login', '', 'POST', { email: fixture.email, password: 'IsolatedTest123!' })).accessToken;
    customer = (await register('customer')).accessToken;
  }, 60_000);

  afterAll(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    await prisma?.$disconnect();
    jest.restoreAllMocks();
    process.env = originalEnv;
  });

  it('registers, rotates a refresh cookie, revokes logout sessions, and enforces roles from the database', async () => {
    const email = `session-${uniqueSuffix()}@example.test`;
    const response = await fetch(`${base}/api/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'IsolatedTest123!', firstName: 'Session', lastName: 'Fixture' }) });
    expect(response.status).toBe(201);
    const cookie = response.headers.get('set-cookie')!.split(';')[0];
    expect(response.headers.get('set-cookie')).toContain('HttpOnly');
    const auth = await response.json();
    expect((await request('/auth/me', auth.accessToken)).user.role).toBe('CUSTOMER');
    await request('/admin/stats', auth.accessToken, 'GET', undefined, 403);
    await request('/admin/stats', '', 'GET', undefined, 401);
    const refresh = await fetch(`${base}/api/auth/refresh`, { method: 'POST', headers: { Cookie: cookie } });
    expect(refresh.status).toBe(200);
    const rotated = refresh.headers.get('set-cookie')!.split(';')[0];
    expect(rotated).not.toBe(cookie);
    expect((await fetch(`${base}/api/auth/logout`, { method: 'POST', headers: { Cookie: rotated } })).status).toBe(200);
    expect((await fetch(`${base}/api/auth/refresh`, { method: 'POST', headers: { Cookie: rotated } })).status).toBe(401);
    expect(sendEmail).toHaveBeenCalled();
  });

  it('rejects and resubmits an organizer application, approves via admin, and completes draft → review → publish', async () => {
    const applicant = await register('organizer');
    const token = applicant.accessToken;
    const application = await request('/organizers/apply', token, 'POST', { organizationName: 'Isolated Launch Organizer' }, 201);
    expect(application.organizer.status).toBe('PENDING');
    const organizerId = application.organizer.id;
    await request('/organizers/me/events', token, 'GET', undefined, 403);
    await request(`/admin/organizers/${organizerId}/approve`, token, 'POST', {}, 403);
    await request(`/admin/organizers/${organizerId}/reject`, admin, 'POST', { reason: 'Add organization details' });
    expect((await request('/organizers/me', token)).organizer.applicationStatus).toBe('REJECTED');
    await request('/organizers/apply', token, 'POST', { organizationName: 'Isolated Launch Organizer', description: 'Complete organization details' }, 201);
    await request(`/admin/organizers/${organizerId}/approve`, admin, 'POST', {});
    // The API reads the current DB role, even though the bearer token was issued to a customer.
    expect((await request('/auth/me', token)).user.role).toBe('ORGANIZER');
    const category = await prisma.category.create({ data: { name: `Launch ${uniqueSuffix()}`, slug: `launch-${uniqueSuffix()}` } });
    const venue = (await request('/organizers/venues', token, 'POST', { name: 'Isolated Launch Hall', address: '1 Fixture Road', city: 'Mumbai', state: 'MH', capacity: 10 }, 201)).venue;
    const data = { title: 'Isolated Launch Festival', description: 'A complete isolated event lifecycle fixture.', categoryId: category.id, venueId: venue.id, startDate: new Date(Date.now() + 7 * 86400000).toISOString(), endDate: new Date(Date.now() + 8 * 86400000).toISOString() };
    await request('/events', token, 'POST', { ...data, title: '' }, 400);
    const event = (await request('/events', token, 'POST', data, 201)).event;
    await request(`/events/${event.id}/publish`, token, 'POST', {}, 403);
    await request(`/events/${event.id}/tickets`, token, 'POST', { name: 'General', price: 15000, totalQuantity: 10, maxPerBooking: 4 }, 201);
    await request(`/events/${event.id}/submit`, token, 'POST', {});
    await request(`/admin/events/${event.id}/review`, admin, 'POST', { action: 'REJECT', reason: 'Clarify the description' });
    await request(`/events/${event.id}`, token, 'PATCH', { description: 'An updated and complete isolated event description.' });
    await request(`/events/${event.id}/submit`, token, 'POST', {});
    await request(`/admin/events/${event.id}/review`, admin, 'POST', { action: 'APPROVE' });
    await request(`/events/${event.id}/publish`, token, 'POST', {});
    expect((await request(`/venues/${venue.id}`)).venue.id).toBe(venue.id);
    expect((await request(`/events/${event.slug}`)).event.status).toBe('PUBLISHED');
    expect((await request('/events?query=Isolated%20Launch')).events.some((e: { id: string }) => e.id === event.id)).toBe(true);
    await request(`/events/${event.id}/manage`, customer, 'GET', undefined, 403);
    // Material edits must require review and must disappear from public discovery.
    await request(`/events/${event.id}`, token, 'PATCH', { title: 'Updated Isolated Launch Festival' });
    expect((await request(`/events/${event.id}/manage`, token)).event.moderation.status).toBe('PENDING_APPROVAL');
    await request(`/events/${event.slug}`, '', 'GET', undefined, 404);
    expect((await request('/events?query=Updated%20Isolated')).events.some((e: { id: string }) => e.id === event.id)).toBe(false);
  });

  it('reserves server-priced inventory, reuses orders, validates signatures, mints tickets exactly once, and protects ticket access', async () => {
    const fixture = await createEventFixture(prisma, { totalQuantity: 4, price: 15000 });
    const bookingInput = { eventId: fixture.eventId, idempotencyKey: randomUUID(), items: [{ ticketTypeId: fixture.ticketTypeId, quantity: 2 }] };
    const booking = (await request('/bookings', customer, 'POST', bookingInput, 201)).booking;
    expect((await request('/bookings', customer, 'POST', bookingInput, 201)).booking.id).toBe(booking.id);
    expect(booking.totalAmount).toBe(30000);
    expect((await prisma.ticketType.findUniqueOrThrow({ where: { id: fixture.ticketTypeId } })).availableQuantity).toBe(2);
    const order = await request('/payments/order', customer, 'POST', { bookingId: booking.id }, 201);
    const repeated = await request('/payments/order', customer, 'POST', { bookingId: booking.id }, 201);
    expect(repeated.orderId).toBe(order.orderId);
    const payload = { bookingId: booking.id, razorpayOrderId: order.orderId, razorpayPaymentId: `pay_${uniqueSuffix()}`, razorpaySignature: '0'.repeat(64) };
    await request('/payments/verify', customer, 'POST', payload, 403);
    payload.razorpaySignature = createHmac('sha256', secret).update(`${payload.razorpayOrderId}|${payload.razorpayPaymentId}`).digest('hex');
    const verified = await request('/payments/verify', customer, 'POST', payload);
    expect(verified.booking.status).toBe('CONFIRMED');
    expect(verified.booking.tickets).toHaveLength(2);
    await request('/payments/verify', customer, 'POST', payload);
    expect(await prisma.ticket.count({ where: { bookingId: booking.id } })).toBe(2);
    expect((await request(`/payments/tickets/${verified.booking.tickets[0].id}/qr`, customer)).dataUrl).toMatch(/^data:image\/png/);
    await request(`/bookings/${booking.id}`, admin, 'GET', undefined, 404);
    expect((await request('/bookings', customer)).bookings.some((b: { id: string }) => b.id === booking.id)).toBe(true);
    const raw = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: payload.razorpayPaymentId, order_id: order.orderId } } } });
    expect((await fetch(`${base}/api/payments/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-razorpay-signature': 'invalid' }, body: raw })).status).toBe(403);
    const webhook = await fetch(`${base}/api/payments/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-razorpay-signature': createHmac('sha256', webhookSecret).update(raw).digest('hex') }, body: raw });
    expect(await webhook.json()).toMatchObject({ handled: false });
    expect(await prisma.ticket.count({ where: { bookingId: booking.id } })).toBe(2);
  });

  it('handles a signed payment failure and unpaid cancellation without tickets or refunds', async () => {
    const fixture = await createEventFixture(prisma, { totalQuantity: 2 });
    const booking = (await request('/bookings', customer, 'POST', { eventId: fixture.eventId, idempotencyKey: randomUUID(), items: [{ ticketTypeId: fixture.ticketTypeId, quantity: 1 }] }, 201)).booking;
    const order = await request('/payments/order', customer, 'POST', { bookingId: booking.id }, 201);
    const raw = JSON.stringify({ event: 'payment.failed', payload: { payment: { entity: { id: `pay_${uniqueSuffix()}`, order_id: order.orderId, error_description: 'Fixture decline' } } } });
    expect((await fetch(`${base}/api/payments/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-razorpay-signature': createHmac('sha256', webhookSecret).update(raw).digest('hex') }, body: raw })).status).toBe(200);
    expect((await request(`/bookings/${booking.id}/cancel`, customer, 'POST', {})).booking.status).toBe('CANCELLED');
    expect((await prisma.ticketType.findUniqueOrThrow({ where: { id: fixture.ticketTypeId } })).availableQuantity).toBe(2);
    expect(await prisma.ticket.count({ where: { bookingId: booking.id } })).toBe(0);
  });

  it('persists event media, forbids other owners, removes references, and handles unavailable storage', async () => {
    const fixture = await createEventFixture(prisma);
    const media = new EventMediaService(prisma as never);
    const buffer = Buffer.from('89504e470d0a1a0a0000000d494844520000000100000001', 'hex');
    const file = { buffer, mimetype: 'image/png', size: buffer.length };
    await expect(media.upload('other-user', fixture.eventId, file)).rejects.toThrow('You do not own this event');
    const image = await media.upload(fixture.userId, fixture.eventId, file);
    await prisma.event.update({ where: { id: fixture.eventId }, data: { coverImage: image.url, images: [image.url] } });
    expect(await prisma.eventMediaAsset.count({ where: { eventId: fixture.eventId, url: image.url } })).toBe(1);
    await media.delete(fixture.userId, fixture.eventId, image.url);
    expect(destroy).toHaveBeenCalled();
    expect((await prisma.event.findUniqueOrThrow({ where: { id: fixture.eventId } })).images).toEqual([]);
    upload.mockRejectedValueOnce(new Error('Invalid fixture credentials'));
    await expect(media.upload(fixture.userId, fixture.eventId, file)).rejects.toThrow();
  });

  it('isolates notification ownership, persists read state, and deduplicates booking notifications', async () => {
    const me = (await request('/auth/me', customer)).user;
    const input = { userId: me.id, type: 'BOOKING_CONFIRMED' as const, title: 'Fixture booking', message: 'Fixture only', data: { bookingId: uniqueSuffix() } };
    const first = await notifications.createInAppNotification(input);
    const duplicate = await notifications.createInAppNotification(input);
    expect(duplicate!.id).toBe(first!.id);
    await expect(notifications.markAsRead('another-user', first!.id)).rejects.toThrow('Notification not found');
    await notifications.markAsRead(me.id, first!.id);
    expect((await prisma.notification.findUniqueOrThrow({ where: { id: first!.id } })).isRead).toBe(true);
  });
});
